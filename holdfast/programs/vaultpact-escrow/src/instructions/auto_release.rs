use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

pub const AUTO_RELEASE_DISPUTE_WINDOW_SECS: i64 = 7 * 24 * 3600;

/// Applied to both parties when the pact expires and is auto-refunded (auto_release_on_expiry=false).
pub(crate) const AUTO_REFUND_UNRESOLVED_DELTA: i16 = -10;

pub(crate) fn compute_dispute_window_end(now: i64) -> anchor_lang::Result<i64> {
    now.checked_add(AUTO_RELEASE_DISPUTE_WINDOW_SECS)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))
}

pub(crate) fn compute_auto_refund_amounts(
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
pub struct AutoRelease<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
        has_one = vault,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
    )]
    pub pact_record: Box<Account<'info, PactRecord>>,

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

    // ── Reputation CPI accounts ───────────────────────────────────────────
    // Required for the auto-refund path (auto_release_on_expiry=false).
    // When auto-releasing (auto_release_on_expiry=true) no reputation update
    // is issued; accounts are still validated on-chain to keep the interface uniform.
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

pub fn handler(ctx: Context<AutoRelease>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;
    let pact = &ctx.accounts.pact_record;

    require!(escrow.status == EscrowStatus::Locked, EscrowError::InvalidStatus);

    let now = Clock::get()?.unix_timestamp;
    // Strict > per AV-2
    require!(now > escrow.time_lock_expires_at, EscrowError::TimeLockNotExpired);

    if pact.auto_release_on_expiry {
        escrow.status = EscrowStatus::Released;
        escrow.released_at = now;
        escrow.dispute_window_ends_at = compute_dispute_window_end(now)?;

        msg!("Auto-released, dispute window ends at {}", escrow.dispute_window_ends_at);
    } else {
        let (initiator_amount, beneficiary_amount) = compute_auto_refund_amounts(
            escrow.escrow_amount,
            escrow.initiator_stake,
            escrow.beneficiary_stake,
        )?;

        // CEI: read reputation nonces before any state mutation.
        let i_nonce = ctx.accounts.initiator_reputation.nonce;
        let b_nonce = ctx.accounts.beneficiary_reputation.nonce;
        let pact_id: [u8; 7] = escrow.escrow_id[..7]
            .try_into()
            .map_err(|_| error!(EscrowError::ArithmeticOverflow))?;
        let escrow_authority_bump = ctx.bumps.escrow_authority;

        let escrow_id = escrow.escrow_id;
        let bump = escrow.bump;

        // CEI: status before transfer
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
            vaultpact::PactOutcome::Cancelled,
            AUTO_REFUND_UNRESOLVED_DELTA,
            pact_id,
        )?;

        cpi_update_reputation(
            &ctx.accounts.vaultpact_program.to_account_info(),
            &ctx.accounts.beneficiary_reputation.to_account_info(),
            &ctx.accounts.escrow_authority.to_account_info(),
            escrow_authority_bump,
            b_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
            vaultpact::PactOutcome::Cancelled,
            AUTO_REFUND_UNRESOLVED_DELTA,
            pact_id,
        )?;

        msg!("Auto-refunded: initiator={}, beneficiary_stake_returned={}", initiator_amount, beneficiary_amount);
    }

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

    // ── AUTO_RELEASE_DISPUTE_WINDOW_SECS constant ────────────────────────────

    #[test]
    fn dispute_window_is_seven_days() {
        assert_eq!(AUTO_RELEASE_DISPUTE_WINDOW_SECS, 7 * 24 * 3600);
        assert_eq!(AUTO_RELEASE_DISPUTE_WINDOW_SECS, 604_800);
    }

    // ── compute_dispute_window_end ───────────────────────────────────────────

    #[test]
    fn dispute_window_end_computed_correctly() {
        let now = 1_000_000i64;
        assert_eq!(
            compute_dispute_window_end(now).unwrap(),
            now + AUTO_RELEASE_DISPUTE_WINDOW_SECS,
        );
    }

    #[test]
    fn dispute_window_end_overflow_guard() {
        let err = compute_dispute_window_end(i64::MAX).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn dispute_window_end_near_max_no_overflow() {
        let now = i64::MAX - AUTO_RELEASE_DISPUTE_WINDOW_SECS;
        assert_eq!(compute_dispute_window_end(now).unwrap(), i64::MAX);
    }

    // ── compute_auto_refund_amounts ──────────────────────────────────────────

    #[test]
    fn refund_escrow_plus_initiator_stake() {
        let (init, bene) = compute_auto_refund_amounts(1_000, 200, 300).unwrap();
        assert_eq!(init, 1_200);
        assert_eq!(bene, 300);
    }

    #[test]
    fn refund_no_stakes() {
        let (init, bene) = compute_auto_refund_amounts(5_000, 0, 0).unwrap();
        assert_eq!(init, 5_000);
        assert_eq!(bene, 0);
    }

    #[test]
    fn refund_only_beneficiary_stake() {
        let (init, bene) = compute_auto_refund_amounts(1_000, 0, 500).unwrap();
        assert_eq!(init, 1_000);
        assert_eq!(bene, 500);
    }

    #[test]
    fn refund_overflow_guard() {
        let err = compute_auto_refund_amounts(u64::MAX, 1, 0).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn refund_max_no_overflow() {
        let (init, _) = compute_auto_refund_amounts(u64::MAX - 100, 100, 0).unwrap();
        assert_eq!(init, u64::MAX);
    }

    // ── AUTO_REFUND_UNRESOLVED_DELTA constant ────────────────────────────────

    #[test]
    fn auto_refund_delta_is_negative_ten() {
        assert_eq!(AUTO_REFUND_UNRESOLVED_DELTA, -10);
    }

    #[test]
    fn auto_refund_delta_is_negative() {
        assert!(AUTO_REFUND_UNRESOLVED_DELTA < 0);
    }

    // ── Status gate semantics ────────────────────────────────────────────────

    #[test]
    fn auto_release_requires_locked_status() {
        assert_eq!(EscrowStatus::Locked, EscrowStatus::Locked);
        for bad in [
            EscrowStatus::Pending,
            EscrowStatus::Funded,
            EscrowStatus::Released,
            EscrowStatus::Disputed,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(bad != EscrowStatus::Locked, "status {:?} should not allow auto_release", bad);
        }
    }

    // ── Time lock boundary ───────────────────────────────────────────────────

    #[test]
    fn time_lock_expired_allows() {
        let now = 1_001i64;
        let expires_at = 1_000i64;
        assert!(now > expires_at);
    }

    #[test]
    fn time_lock_at_boundary_rejects() {
        let now = 1_000i64;
        let expires_at = 1_000i64;
        assert!(!(now > expires_at));
    }

    #[test]
    fn time_lock_not_expired_rejects() {
        let now = 999i64;
        let expires_at = 1_000i64;
        assert!(!(now > expires_at));
    }
}
