use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

/// Mutual cancellation records a completed pact with no score change.
/// The zero delta still increments pacts_completed and updates last_pact_ts.
pub(crate) const MUTUAL_CANCEL_SCORE_DELTA: i16 = 0;

#[derive(Accounts)]
pub struct MutualCancelEscrow<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>,

    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = initiator @ EscrowError::UnauthorizedSigner,
        has_one = beneficiary @ EscrowError::UnauthorizedSigner,
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

    // Present → dispute is active → mutual cancel is blocked.
    #[account(
        seeds = [b"dispute", escrow_account.escrow_id.as_ref()],
        bump,
    )]
    pub dispute_record: Option<Box<Account<'info, DisputeRecord>>>,

    #[account(constraint = initiator_wallet.authority == initiator.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub initiator_wallet: Account<'info, vaultpact::AgentWallet>,

    #[account(constraint = beneficiary_wallet.authority == beneficiary.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub beneficiary_wallet: Account<'info, vaultpact::AgentWallet>,

    pub token_program: Program<'info, Token>,

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

pub(crate) fn compute_mutual_cancel_refunds(
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
) -> anchor_lang::Result<(u64, u64)> {
    let initiator_amount = escrow_amount
        .checked_add(initiator_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))?;
    Ok((initiator_amount, beneficiary_stake))
}

pub(crate) fn is_blacklisted(status: u8) -> bool {
    status == crate::AGENT_STATUS_BLACKLISTED
}

pub fn handler(ctx: Context<MutualCancelEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Locked, EscrowError::InvalidStatus);

    // Dispute PDA must not exist — belt-and-suspenders alongside the status check.
    require!(ctx.accounts.dispute_record.is_none(), EscrowError::DisputeInProgress);

    require!(!is_blacklisted(ctx.accounts.initiator_wallet.status), EscrowError::BlacklistedSigner);
    require!(!is_blacklisted(ctx.accounts.beneficiary_wallet.status), EscrowError::BlacklistedSigner);

    let (initiator_amount, beneficiary_amount) = compute_mutual_cancel_refunds(
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
    let now = Clock::get()?.unix_timestamp;

    // CEI: state transition before transfers.
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::MutuallyCancelled;
    escrow.cancelled_at = now;

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

    // Zero-delta reputation update: increments pacts_completed and last_pact_ts
    // without penalising either party for an agreed cancellation.
    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        escrow_authority_bump,
        i_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Cancelled,
        MUTUAL_CANCEL_SCORE_DELTA,
        pact_id,
    )?;

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        escrow_authority_bump,
        b_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Cancelled,
        MUTUAL_CANCEL_SCORE_DELTA,
        pact_id,
    )?;

    msg!(
        "MutuallyCancelled: initiator_returned={}, beneficiary_stake_returned={}",
        initiator_amount,
        beneficiary_amount,
    );
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

    // ── compute_mutual_cancel_refunds ────────────────────────────────────────

    #[test]
    fn initiator_gets_escrow_plus_stake() {
        let (init, bene) = compute_mutual_cancel_refunds(1_000, 200, 300).unwrap();
        assert_eq!(init, 1_200);
        assert_eq!(bene, 300);
    }

    #[test]
    fn no_stakes_returns_escrow_only() {
        let (init, bene) = compute_mutual_cancel_refunds(5_000, 0, 0).unwrap();
        assert_eq!(init, 5_000);
        assert_eq!(bene, 0);
    }

    #[test]
    fn only_beneficiary_stake() {
        let (init, bene) = compute_mutual_cancel_refunds(1_000, 0, 500).unwrap();
        assert_eq!(init, 1_000);
        assert_eq!(bene, 500);
    }

    #[test]
    fn overflow_guard() {
        let err = compute_mutual_cancel_refunds(u64::MAX, 1, 0).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn max_no_overflow() {
        let (init, _) = compute_mutual_cancel_refunds(u64::MAX - 50, 50, 0).unwrap();
        assert_eq!(init, u64::MAX);
    }

    // ── MUTUAL_CANCEL_SCORE_DELTA constant ───────────────────────────────────

    #[test]
    fn mutual_cancel_delta_is_zero() {
        assert_eq!(MUTUAL_CANCEL_SCORE_DELTA, 0);
    }

    // ── is_blacklisted ───────────────────────────────────────────────────────

    #[test]
    fn active_not_blacklisted() {
        assert!(!is_blacklisted(0));
    }

    #[test]
    fn frozen_not_blacklisted() {
        assert!(!is_blacklisted(1));
    }

    #[test]
    fn blacklisted_is_blacklisted() {
        assert!(is_blacklisted(2));
    }

    #[test]
    fn unknown_status_not_blacklisted() {
        assert!(!is_blacklisted(3));
        assert!(!is_blacklisted(255));
    }

    // ── Status gate semantics ────────────────────────────────────────────────

    #[test]
    fn mutual_cancel_requires_locked_status() {
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
            assert!(bad != EscrowStatus::Locked, "status {:?} should not allow mutual_cancel", bad);
        }
    }
}
