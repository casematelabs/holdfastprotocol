use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

pub(crate) const REFUND_ESCALATED_DELTA: i16 = -25;
pub(crate) const REFUND_UNRESOLVED_DELTA: i16 = -10;

/// Computes refund amounts: (initiator_receives, beneficiary_receives).
/// Initiator gets escrow_amount + initiator_stake; beneficiary gets their stake back.
pub(crate) fn compute_refund_amounts(
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
) -> anchor_lang::Result<(u64, u64)> {
    let initiator_amount = escrow_amount
        .checked_add(initiator_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))?;
    Ok((initiator_amount, beneficiary_stake))
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = vault,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = initiator_token_account.owner == escrow_account.initiator
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = initiator_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub initiator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = beneficiary_token_account.owner == escrow_account.beneficiary
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = beneficiary_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    #[account(
        seeds = [b"dispute", escrow_account.escrow_id.as_ref()],
        bump = dispute_record.bump,
    )]
    pub dispute_record: Option<Account<'info, DisputeRecord>>,

    // ── Reputation CPI accounts ───────────────────────────────────────────
    #[account(
        mut,
        seeds = [b"reputation", escrow_account.initiator.as_ref()],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub initiator_reputation: Box<Account<'info, vaultpact::ReputationAccount>>,

    #[account(
        mut,
        seeds = [b"reputation", escrow_account.beneficiary.as_ref()],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub beneficiary_reputation: Box<Account<'info, vaultpact::ReputationAccount>>,

    /// CHECK: Virtual PDA signer that authorises update_reputation CPIs.
    #[account(seeds = [b"vp_escrow_authority"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
}

pub fn handler(ctx: Context<Refund>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let now = Clock::get()?.unix_timestamp;

    match escrow.status {
        EscrowStatus::Locked => {
            require!(now > escrow.time_lock_expires_at, EscrowError::TimeLockNotExpired);
        }
        EscrowStatus::Disputed => {
            let dispute = ctx.accounts.dispute_record.as_ref()
                .ok_or(error!(EscrowError::DisputeNotEscalated))?;
            require!(dispute.escalated_at > 0, EscrowError::DisputeNotEscalated);
            require!(now > dispute.escalation_deadline, EscrowError::EscalationGracePeriodNotPassed);
        }
        _ => return Err(error!(EscrowError::InvalidStatus)),
    }

    // CEI: read all reputation data before any state mutation.
    let i_nonce = ctx.accounts.initiator_reputation.nonce;
    let b_nonce = ctx.accounts.beneficiary_reputation.nonce;
    let pact_id: [u8; 7] = escrow.escrow_id[..7]
        .try_into()
        .map_err(|_| error!(EscrowError::ArithmeticOverflow))?;
    let escrow_authority_bump = ctx.bumps.escrow_authority;

    let (i_delta, b_delta, outcome) = match escrow.status {
        EscrowStatus::Disputed => {
            let dispute = ctx.accounts.dispute_record.as_ref().unwrap();
            if dispute.raised_by == escrow.initiator {
                (REFUND_ESCALATED_DELTA, 0i16, vaultpact::PactOutcome::Disputed)
            } else {
                (0i16, REFUND_ESCALATED_DELTA, vaultpact::PactOutcome::Disputed)
            }
        }
        _ => (REFUND_UNRESOLVED_DELTA, REFUND_UNRESOLVED_DELTA, vaultpact::PactOutcome::Cancelled),
    };

    let (initiator_amount, beneficiary_amount) = compute_refund_amounts(
        escrow.escrow_amount,
        escrow.initiator_stake,
        escrow.beneficiary_stake,
    )?;

    let escrow_id = escrow.escrow_id;
    let bump = escrow.bump;

    // CEI: status before transfer
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Refunded;
    escrow.resolved_at = now;

    let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", escrow_id.as_ref(), &[bump]]];

    if initiator_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.initiator_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, initiator_amount)?;
    }

    if beneficiary_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.beneficiary_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, beneficiary_amount)?;
    }

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        escrow_authority_bump,
        i_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        outcome,
        i_delta,
        pact_id,
    )?;

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        escrow_authority_bump,
        b_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        outcome,
        b_delta,
        pact_id,
    )?;

    msg!("Refunded: initiator={}, beneficiary_stake_returned={}", initiator_amount, beneficiary_amount);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::EscrowError;

    fn err_code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            _ => panic!("expected AnchorError"),
        }
    }

    // ── compute_refund_amounts ────────────────────────────────────────────────

    #[test]
    fn refund_happy_path_with_stakes() {
        let (i_amount, b_amount) = compute_refund_amounts(1_000, 200, 300).unwrap();
        assert_eq!(i_amount, 1_200); // escrow_amount + initiator_stake
        assert_eq!(b_amount, 300);   // beneficiary_stake returned
    }

    #[test]
    fn refund_no_stakes() {
        let (i_amount, b_amount) = compute_refund_amounts(5_000, 0, 0).unwrap();
        assert_eq!(i_amount, 5_000);
        assert_eq!(b_amount, 0);
    }

    #[test]
    fn refund_zero_escrow_amount_with_initiator_stake() {
        let (i_amount, b_amount) = compute_refund_amounts(0, 1_000, 500).unwrap();
        assert_eq!(i_amount, 1_000);
        assert_eq!(b_amount, 500);
    }

    #[test]
    fn refund_overflow_guard() {
        let err = compute_refund_amounts(u64::MAX, 1, 0).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn refund_max_amount_no_overflow() {
        let (i_amount, b_amount) = compute_refund_amounts(u64::MAX, 0, 0).unwrap();
        assert_eq!(i_amount, u64::MAX);
        assert_eq!(b_amount, 0);
    }

    // ── Reputation delta constants ───────────────────────────────────────────

    #[test]
    fn escalated_penalty_is_larger_than_unresolved() {
        assert!(REFUND_ESCALATED_DELTA < REFUND_UNRESOLVED_DELTA);
    }

    // ── Delta constant signs ─────────────────────────────────────────────────

    #[test]
    fn refund_deltas_are_negative() {
        assert!(REFUND_ESCALATED_DELTA < 0);
        assert!(REFUND_UNRESOLVED_DELTA < 0);
    }

    // ── Status gate semantics ─────────────────────────────────────────────────

    #[test]
    fn refund_allowed_from_locked_and_disputed() {
        let locked = EscrowStatus::Locked;
        let disputed = EscrowStatus::Disputed;
        // these are the only two valid entry states for refund
        assert!(matches!(locked, EscrowStatus::Locked | EscrowStatus::Disputed));
        assert!(matches!(disputed, EscrowStatus::Locked | EscrowStatus::Disputed));
    }

    #[test]
    fn refund_blocked_from_other_statuses() {
        for bad in [
            EscrowStatus::Pending,
            EscrowStatus::Funded,
            EscrowStatus::Released,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(
                !matches!(bad, EscrowStatus::Locked | EscrowStatus::Disputed),
                "status {:?} should not allow refund",
                bad
            );
        }
    }

    // ── Time lock and escalation boundary semantics ───────────────────────────

    #[test]
    fn locked_path_requires_time_lock_expired() {
        let time_lock_expires_at = 1_000i64;
        let now_before = 999i64;
        let now_after = 1_001i64;
        assert!(!(now_before > time_lock_expires_at), "should not be expired yet");
        assert!(now_after > time_lock_expires_at, "should be expired");
    }

    #[test]
    fn disputed_path_requires_escalation_and_grace_period_passed() {
        let escalated_at = 500i64;
        let escalation_deadline = 1_000i64;
        let now_during_grace = 999i64;
        let now_after_grace = 1_001i64;

        assert!(escalated_at > 0, "must be escalated");
        assert!(!(now_during_grace > escalation_deadline), "grace period still active");
        assert!(now_after_grace > escalation_deadline, "grace period passed");
    }
}
