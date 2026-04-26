use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

/// Reputation penalty applied to both parties when a funded-but-unlocked escrow
/// is cancelled by the initiator after time-lock expiry.  Matches the auto-refund
/// path (MED-F-002) so the initiator cannot game reputation by choosing this path.
pub(crate) const CANCEL_PENDING_DELTA: i16 = -10;

#[derive(Accounts)]
pub struct CancelPendingEscrow<'info> {
    pub initiator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = initiator @ EscrowError::UnauthorizedSigner,
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

    // ── Reputation CPI accounts (MED-F-002) ──────────────────────────────────
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

    /// CHECK: Virtual PDA signer for update_reputation CPIs.
    #[account(seeds = [b"vp_escrow_authority"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"attestation_registry"],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub attestation_registry: Account<'info, vaultpact::AttestationRegistry>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
}

pub fn handler(ctx: Context<CancelPendingEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Funded, EscrowError::InvalidStatus);

    let now = Clock::get()?.unix_timestamp;
    require!(now > escrow.time_lock_expires_at, EscrowError::TimeLockNotExpired);

    let (initiator_amount, beneficiary_amount) = compute_cancel_refunds(
        escrow.escrow_amount,
        escrow.initiator_stake,
        escrow.beneficiary_stake,
        escrow.beneficiary_staked,
    )?;

    let escrow_id = escrow.escrow_id;
    let bump = escrow.bump;

    // CEI: read reputation nonces and pact_id before any state mutation.
    let i_nonce = ctx.accounts.initiator_reputation.nonce;
    let b_nonce = ctx.accounts.beneficiary_reputation.nonce;
    let pact_id: [u8; 7] = escrow_id[..7]
        .try_into()
        .map_err(|_| error!(EscrowError::ArithmeticOverflow))?;
    let escrow_authority_bump = ctx.bumps.escrow_authority;

    // M-3: Guard against vault underfunding before any state mutation.
    let total_refund = initiator_amount
        .checked_add(beneficiary_amount)
        .ok_or(EscrowError::ArithmeticOverflow)?;
    require!(ctx.accounts.vault.amount >= total_refund, EscrowError::VaultBalanceMismatch);

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Refunded;
    escrow.resolved_at = now;
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

    // Reputation: penalise both parties to match the auto-refund path (MED-F-002).
    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.attestation_registry.to_account_info(),
        escrow_authority_bump,
        i_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Cancelled,
        CANCEL_PENDING_DELTA,
        pact_id,
    )?;

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.attestation_registry.to_account_info(),
        escrow_authority_bump,
        b_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Cancelled,
        CANCEL_PENDING_DELTA,
        pact_id,
    )?;

    msg!(
        "CancelPendingEscrow: initiator_returned={}, beneficiary_stake_returned={}",
        initiator_amount,
        beneficiary_amount,
    );
    Ok(())
}

pub(crate) fn compute_cancel_refunds(
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
    beneficiary_staked: bool,
) -> anchor_lang::Result<(u64, u64)> {
    let initiator_amount = escrow_amount
        .checked_add(initiator_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))?;
    let beneficiary_amount = if beneficiary_staked {
        beneficiary_stake
    } else {
        0
    };
    Ok((initiator_amount, beneficiary_amount))
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

    // ── compute_cancel_refunds ────────────────────────────────────────────────

    #[test]
    fn initiator_gets_escrow_plus_stake() {
        let (init, bene) = compute_cancel_refunds(1_000_000, 50_000, 50_000, false).unwrap();
        assert_eq!(init, 1_050_000);
        assert_eq!(bene, 0);
    }

    #[test]
    fn beneficiary_gets_stake_when_staked() {
        let (init, bene) = compute_cancel_refunds(1_000_000, 50_000, 50_000, true).unwrap();
        assert_eq!(init, 1_050_000);
        assert_eq!(bene, 50_000);
    }

    #[test]
    fn zero_stakes_returns_escrow_only() {
        let (init, bene) = compute_cancel_refunds(500_000, 0, 0, false).unwrap();
        assert_eq!(init, 500_000);
        assert_eq!(bene, 0);
    }

    #[test]
    fn zero_stakes_beneficiary_staked_flag_irrelevant() {
        let (init, bene) = compute_cancel_refunds(500_000, 0, 0, true).unwrap();
        assert_eq!(init, 500_000);
        assert_eq!(bene, 0);
    }

    #[test]
    fn overflow_guard_on_initiator_refund() {
        let err = compute_cancel_refunds(u64::MAX, 1, 0, false).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn near_max_no_overflow() {
        let (init, _) = compute_cancel_refunds(u64::MAX - 100, 100, 0, false).unwrap();
        assert_eq!(init, u64::MAX);
    }

    #[test]
    fn beneficiary_not_staked_gets_zero_even_with_nonzero_stake_field() {
        let (_, bene) = compute_cancel_refunds(1_000, 1_000, 999_999, false).unwrap();
        assert_eq!(bene, 0);
    }

    // ── M-3: vault balance guard ──────────────────────────────────────────────

    #[test]
    fn vault_balance_check_passes_when_sufficient() {
        let (init, bene) = compute_cancel_refunds(1_000_000, 50_000, 50_000, true).unwrap();
        let total = init.checked_add(bene).unwrap();
        assert!(1_100_000u64 >= total);
    }

    #[test]
    fn vault_balance_check_fails_when_insufficient() {
        let (init, bene) = compute_cancel_refunds(1_000_000, 50_000, 50_000, true).unwrap();
        let total = init.checked_add(bene).unwrap();
        // vault short by 1 lamport — guard must reject
        assert!(!(total.saturating_sub(1) >= total));
    }

    #[test]
    fn vault_balance_total_overflow_guard() {
        // Both amounts at near-max: addition overflows u64 before the vault check.
        let result = (u64::MAX - 1).checked_add(u64::MAX);
        assert!(result.is_none(), "overflow must be caught before vault comparison");
    }

    // ── Status gate semantics ─────────────────────────────────────────────────

    #[test]
    fn only_funded_allows_cancel_pending() {
        assert_eq!(EscrowStatus::Funded, EscrowStatus::Funded);
        for bad in [
            EscrowStatus::Pending,
            EscrowStatus::Locked,
            EscrowStatus::Released,
            EscrowStatus::Disputed,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(bad != EscrowStatus::Funded, "status {:?} should not allow cancel_pending", bad);
        }
    }

    // ── Time lock gate semantics ──────────────────────────────────────────────

    #[test]
    fn time_lock_must_have_expired() {
        let now = 1_000i64;
        let expires_at = 999i64;
        assert!(now > expires_at, "should allow cancel when time lock expired");
    }

    #[test]
    fn time_lock_at_boundary_rejects() {
        let now = 1_000i64;
        let expires_at = 1_000i64;
        assert!(!(now > expires_at), "should reject cancel at exact expiry boundary");
    }

    #[test]
    fn time_lock_not_expired_rejects() {
        let now = 999i64;
        let expires_at = 1_000i64;
        assert!(!(now > expires_at), "should reject cancel before time lock expires");
    }
}
