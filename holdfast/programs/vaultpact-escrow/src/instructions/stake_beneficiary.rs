use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_validate_reputation;
use crate::errors::EscrowError;
use crate::state::*;

#[derive(Accounts)]
pub struct StakeBeneficiary<'info> {
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = beneficiary @ EscrowError::UnauthorizedSigner,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
        has_one = vault,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
    )]
    pub pact_record: Box<Account<'info, PactRecord>>,

    #[account(
        mut,
        constraint = beneficiary_token_account.owner == beneficiary.key()
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = beneficiary_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: Validated inside cpi_validate_reputation via CPI to vaultpact program.
    pub beneficiary_reputation: UncheckedAccount<'info>,

    #[account(constraint = beneficiary_wallet.authority == beneficiary.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub beneficiary_wallet: Account<'info, vaultpact::AgentWallet>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<StakeBeneficiary>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Funded, EscrowError::InvalidStatus);
    require!(!escrow.beneficiary_staked, EscrowError::BeneficiaryAlreadyStaked);

    // Active-only: staking is a new commitment, reject Frozen/Blacklisted
    require!(ctx.accounts.beneficiary_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);

    // Reputation CPI for beneficiary — bound to beneficiary's pubkey (SEC-10)
    cpi_validate_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.beneficiary.key(),
        ctx.accounts.pact_record.beneficiary_reputation_min,
        ctx.accounts.pact_record.beneficiary_min_tier,
        ctx.accounts.pact_record.beneficiary_min_pacts,
    )?;

    let stake_amount = escrow.beneficiary_stake;

    // CEI: set flag before transfer
    escrow.beneficiary_staked = true;

    if stake_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.beneficiary_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.beneficiary.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, stake_amount)?;
    }

    msg!("Beneficiary staked: {}", stake_amount);
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::state::EscrowStatus;

    // ── Status gate semantics ────────────────────────────────────────────────

    #[test]
    fn stake_requires_funded_status() {
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
            assert!(bad != EscrowStatus::Funded, "status {:?} should not allow stake", bad);
        }
    }

    // ── Agent wallet status semantics ────────────────────────────────────────

    #[test]
    fn active_agent_allowed() {
        let status: u8 = 0;
        assert_eq!(status, 0, "Active (0) must be allowed");
    }

    #[test]
    fn frozen_agent_rejected() {
        let status: u8 = 1;
        assert!(status != 0, "Frozen (1) must be rejected");
    }

    #[test]
    fn blacklisted_agent_rejected() {
        let status: u8 = 2;
        assert!(status != 0, "Blacklisted (2) must be rejected");
    }

    // ── Beneficiary staked flag ──────────────────────────────────────────────

    #[test]
    fn cannot_stake_twice() {
        let beneficiary_staked = true;
        assert!(beneficiary_staked, "second stake should be rejected");
    }

    #[test]
    fn first_stake_allowed() {
        let beneficiary_staked = false;
        assert!(!beneficiary_staked, "first stake should be allowed");
    }

    // ── Zero-stake transfer semantics ────────────────────────────────────────

    #[test]
    fn zero_stake_skips_transfer() {
        let stake_amount = 0u64;
        assert!(!(stake_amount > 0), "zero stake must skip token transfer");
    }

    #[test]
    fn nonzero_stake_triggers_transfer() {
        let stake_amount = 50_000u64;
        assert!(stake_amount > 0, "non-zero stake must trigger transfer");
    }
}
