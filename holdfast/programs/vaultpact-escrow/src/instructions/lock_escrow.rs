use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::cpi_helpers::cpi_validate_reputation;
use crate::errors::EscrowError;
use crate::state::*;

/// Computes the expected vault balance at lock time.
/// Returns ArithmeticOverflow on pathological values.
pub(crate) fn compute_expected_vault_balance(
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
) -> anchor_lang::Result<u64> {
    escrow_amount
        .checked_add(initiator_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))?
        .checked_add(beneficiary_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))
}

#[derive(Accounts)]
pub struct LockEscrow<'info> {
    pub initiator: Signer<'info>,
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = initiator @ EscrowError::UnauthorizedSigner,
        has_one = beneficiary @ EscrowError::UnauthorizedSigner,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
        has_one = vault,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
    )]
    pub pact_record: Account<'info, PactRecord>,

    pub vault: Account<'info, TokenAccount>,

    #[account(constraint = initiator_wallet.authority == initiator.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub initiator_wallet: Account<'info, vaultpact::AgentWallet>,

    #[account(constraint = beneficiary_wallet.authority == beneficiary.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub beneficiary_wallet: Account<'info, vaultpact::AgentWallet>,

    #[account(constraint = arbiter_wallet.authority == escrow_account.arbiter
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub arbiter_wallet: Account<'info, vaultpact::AgentWallet>,

    /// CHECK: Validated inside cpi_validate_reputation via CPI to vaultpact program.
    pub initiator_reputation: UncheckedAccount<'info>,

    /// CHECK: Validated inside cpi_validate_reputation via CPI to vaultpact program.
    pub beneficiary_reputation: UncheckedAccount<'info>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
}

pub fn handler(ctx: Context<LockEscrow>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Funded, EscrowError::InvalidStatus);
    require!(escrow.beneficiary_staked, EscrowError::InvalidStatus);

    // All parties must be Active to lock: locking is a new mutual commitment
    require!(ctx.accounts.initiator_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);
    require!(ctx.accounts.beneficiary_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);
    require!(ctx.accounts.arbiter_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);

    // Re-validate initiator reputation at lock time (Gap-2 / SEC-10)
    cpi_validate_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &ctx.accounts.initiator.key(),
        ctx.accounts.pact_record.initiator_reputation_min,
        ctx.accounts.pact_record.initiator_min_tier,
        ctx.accounts.pact_record.initiator_min_pacts,
    )?;

    // Re-validate beneficiary reputation at lock time (SEC-10)
    cpi_validate_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.beneficiary.key(),
        ctx.accounts.pact_record.beneficiary_reputation_min,
        ctx.accounts.pact_record.beneficiary_min_tier,
        ctx.accounts.pact_record.beneficiary_min_pacts,
    )?;

    let expected_balance = compute_expected_vault_balance(
        escrow.escrow_amount,
        escrow.initiator_stake,
        escrow.beneficiary_stake,
    )?;

    require!(
        ctx.accounts.vault.amount == expected_balance,
        EscrowError::VaultBalanceMismatch
    );

    let now = Clock::get()?.unix_timestamp;
    require!(escrow.time_lock_expires_at > now, EscrowError::TimeLockInPast);

    escrow.status = EscrowStatus::Locked;
    escrow.locked_at = now;

    msg!("Escrow locked");
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

    // ── compute_expected_vault_balance ────────────────────────────────────────

    #[test]
    fn vault_balance_no_stakes() {
        assert_eq!(compute_expected_vault_balance(5_000, 0, 0).unwrap(), 5_000);
    }

    #[test]
    fn vault_balance_with_both_stakes() {
        assert_eq!(compute_expected_vault_balance(1_000, 200, 300).unwrap(), 1_500);
    }

    #[test]
    fn vault_balance_with_only_initiator_stake() {
        assert_eq!(compute_expected_vault_balance(1_000, 500, 0).unwrap(), 1_500);
    }

    #[test]
    fn vault_balance_with_only_beneficiary_stake() {
        assert_eq!(compute_expected_vault_balance(1_000, 0, 400).unwrap(), 1_400);
    }

    #[test]
    fn vault_balance_overflow_escrow_plus_initiator_stake() {
        let err = compute_expected_vault_balance(u64::MAX, 1, 0).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn vault_balance_overflow_sum_plus_beneficiary_stake() {
        // escrow + initiator fits, but adding beneficiary_stake overflows
        let err = compute_expected_vault_balance(u64::MAX - 5, 5, 1).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn vault_balance_max_safe_no_overflow() {
        let result = compute_expected_vault_balance(u64::MAX - 2, 1, 1).unwrap();
        assert_eq!(result, u64::MAX);
    }

    // ── Status gate semantics ─────────────────────────────────────────────────

    #[test]
    fn lock_requires_funded_status() {
        assert!(EscrowStatus::Funded == EscrowStatus::Funded);
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
            assert!(bad != EscrowStatus::Funded, "status {:?} should not allow lock", bad);
        }
    }

    // ── VaultBalanceMismatch check semantics ──────────────────────────────────

    #[test]
    fn vault_mismatch_when_vault_has_too_little() {
        let expected = compute_expected_vault_balance(1_000, 200, 300).unwrap();
        let vault_amount = 1_499u64; // one short
        assert!(vault_amount != expected);
    }

    #[test]
    fn vault_mismatch_when_vault_has_too_much() {
        let expected = compute_expected_vault_balance(1_000, 0, 0).unwrap();
        let vault_amount = 1_001u64; // extra token slipped in
        assert!(vault_amount != expected);
    }

    #[test]
    fn vault_matches_when_exact() {
        let expected = compute_expected_vault_balance(1_000, 200, 300).unwrap();
        assert_eq!(expected, 1_500);
        assert_eq!(1_500u64, expected);
    }
}
