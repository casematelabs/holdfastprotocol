use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::cpi_helpers::cpi_validate_reputation;
use crate::errors::EscrowError;
use crate::state::*;

pub const MINIMUM_STAKE: u64 = 1_000;

/// Pure parameter validation, extracted for unit testing (excludes CPI and wallet status checks).
pub(crate) fn validate_init_params(
    initiator: &anchor_lang::prelude::Pubkey,
    beneficiary: &anchor_lang::prelude::Pubkey,
    arbiter: &anchor_lang::prelude::Pubkey,
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
    time_lock_expires_at: i64,
    now: i64,
    slash_loser_stake: bool,
    dispute_deadline_secs: i64,
) -> anchor_lang::Result<()> {
    use crate::errors::EscrowError;
    require!(
        initiator != beneficiary && initiator != arbiter && beneficiary != arbiter,
        EscrowError::DuplicateParticipants
    );
    require!(escrow_amount > 0, EscrowError::ZeroEscrowAmount);
    require!(time_lock_expires_at > now, EscrowError::TimeLockInPast);
    require!(
        dispute_deadline_secs >= 3_600 && dispute_deadline_secs <= 365 * 24 * 3_600 * 10,
        EscrowError::InvalidDisputeDeadline
    );
    if slash_loser_stake {
        require!(
            initiator_stake > 0 && beneficiary_stake > 0,
            EscrowError::SlashRequiresStake
        );
    }
    if initiator_stake > 0 {
        require!(initiator_stake >= MINIMUM_STAKE, EscrowError::StakeBelowMinimum);
    }
    if beneficiary_stake > 0 {
        require!(beneficiary_stake >= MINIMUM_STAKE, EscrowError::StakeBelowMinimum);
    }
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeEscrowParams {
    pub escrow_id: [u8; 32],
    pub beneficiary: Pubkey,
    pub arbiter: Pubkey,
    pub escrow_amount: u64,
    pub initiator_stake: u64,
    pub beneficiary_stake: u64,
    pub time_lock_expires_at: i64,
    // Pact fields
    pub deliverables_hash: [u8; 32],
    pub deliverables_uri: [u8; 128],
    pub auto_release_on_expiry: bool,
    pub slash_loser_stake: bool,
    pub dispute_deadline_secs: i64,
    pub initiator_reputation_min: u64,
    pub beneficiary_reputation_min: u64,
    pub initiator_min_tier: u8,
    pub initiator_min_pacts: u64,
    pub beneficiary_min_tier: u8,
    pub beneficiary_min_pacts: u64,
}

#[derive(Accounts)]
#[instruction(params: InitializeEscrowParams)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>,

    #[account(
        init,
        payer = initiator,
        space = EscrowAccount::LEN,
        seeds = [b"escrow", params.escrow_id.as_ref()],
        bump,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        init,
        payer = initiator,
        space = PactRecord::LEN,
        seeds = [b"pact", params.escrow_id.as_ref()],
        bump,
    )]
    pub pact_record: Box<Account<'info, PactRecord>>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = initiator,
        associated_token::mint = mint,
        associated_token::authority = escrow_account,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: Validated inside cpi_validate_reputation via CPI to vaultpact program.
    pub initiator_reputation: UncheckedAccount<'info>,

    #[account(constraint = initiator_wallet.authority == initiator.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub initiator_wallet: Account<'info, vaultpact::AgentWallet>,

    #[account(constraint = beneficiary_wallet.authority == params.beneficiary
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub beneficiary_wallet: Account<'info, vaultpact::AgentWallet>,

    #[account(constraint = arbiter_wallet.authority == params.arbiter
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub arbiter_wallet: Account<'info, vaultpact::AgentWallet>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeEscrow>, params: InitializeEscrowParams) -> Result<()> {
    let initiator_key = ctx.accounts.initiator.key();

    // Participant uniqueness
    require!(
        initiator_key != params.beneficiary
            && initiator_key != params.arbiter
            && params.beneficiary != params.arbiter,
        EscrowError::DuplicateParticipants
    );

    require!(params.escrow_amount > 0, EscrowError::ZeroEscrowAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(params.time_lock_expires_at > now, EscrowError::TimeLockInPast);

    require!(
        params.dispute_deadline_secs >= 3600
            && params.dispute_deadline_secs <= 365 * 24 * 3600 * 10,
        EscrowError::InvalidDisputeDeadline
    );

    // Gap-9: enforce minimum stake when slashing is enabled
    if params.slash_loser_stake {
        require!(
            params.initiator_stake > 0 && params.beneficiary_stake > 0,
            EscrowError::SlashRequiresStake
        );
    }
    if params.initiator_stake > 0 {
        require!(params.initiator_stake >= MINIMUM_STAKE, EscrowError::StakeBelowMinimum);
    }
    if params.beneficiary_stake > 0 {
        require!(params.beneficiary_stake >= MINIMUM_STAKE, EscrowError::StakeBelowMinimum);
    }

    // Agent status: all participants must be Active to create a new pact
    require!(ctx.accounts.initiator_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);
    require!(ctx.accounts.beneficiary_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);
    require!(ctx.accounts.arbiter_wallet.status == crate::AGENT_STATUS_ACTIVE, EscrowError::AgentNotActive);

    // Mint check: reject Token-2022
    require!(
        *ctx.accounts.mint.to_account_info().owner == spl_token::id(),
        EscrowError::UnsupportedMintVersion
    );

    // Reputation CPI for initiator — bound to initiator's pubkey (SEC-10)
    cpi_validate_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &initiator_key,
        params.initiator_reputation_min,
        params.initiator_min_tier,
        params.initiator_min_pacts,
    )?;

    // Effects
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.schema_version = EscrowAccount::SCHEMA_VERSION;
    escrow.bump = ctx.bumps.escrow_account;
    escrow.escrow_id = params.escrow_id;
    escrow.initiator = initiator_key;
    escrow.beneficiary = params.beneficiary;
    escrow.arbiter = params.arbiter;
    escrow.mint = ctx.accounts.mint.key();
    escrow.vault = ctx.accounts.vault.key();
    escrow.escrow_amount = params.escrow_amount;
    escrow.initiator_stake = params.initiator_stake;
    escrow.beneficiary_stake = params.beneficiary_stake;
    escrow.status = EscrowStatus::Pending;
    escrow.time_lock_expires_at = params.time_lock_expires_at;
    escrow.dispute_window_ends_at = 0;
    escrow.pact_record = ctx.accounts.pact_record.key();
    escrow.created_at = now;
    escrow.locked_at = 0;
    escrow.released_at = 0;
    escrow.resolved_at = 0;
    escrow.beneficiary_staked = false;

    let pact = &mut ctx.accounts.pact_record;
    pact.schema_version = PactRecord::SCHEMA_VERSION;
    pact.bump = ctx.bumps.pact_record;
    pact.pact_id = params.escrow_id;
    pact.escrow = escrow.key();
    pact.initiator_reputation_min = params.initiator_reputation_min;
    pact.beneficiary_reputation_min = params.beneficiary_reputation_min;
    pact.deliverables_hash = params.deliverables_hash;
    pact.deliverables_uri = params.deliverables_uri;
    pact.auto_release_on_expiry = params.auto_release_on_expiry;
    pact.slash_loser_stake = params.slash_loser_stake;
    pact.dispute_deadline_secs = params.dispute_deadline_secs;
    pact.created_at = now;
    pact.initiator_min_tier = params.initiator_min_tier;
    pact.initiator_min_pacts = params.initiator_min_pacts;
    pact.beneficiary_min_tier = params.beneficiary_min_tier;
    pact.beneficiary_min_pacts = params.beneficiary_min_pacts;

    msg!("Escrow initialized: id={:?}", &params.escrow_id[..8]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn err_code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            _ => panic!("expected AnchorError"),
        }
    }

    fn distinct_keys() -> (Pubkey, Pubkey, Pubkey) {
        (
            Pubkey::new_from_array([1u8; 32]),
            Pubkey::new_from_array([2u8; 32]),
            Pubkey::new_from_array([3u8; 32]),
        )
    }

    // ── Happy path ────────────────────────────────────────────────────────────

    #[test]
    fn valid_params_returns_ok() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let result = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000_000,   // escrow_amount
            0, 0,        // no stakes
            1_000_000_000, // time_lock far in future
            0,           // now
            false,       // no slash
            3_600,       // minimum dispute deadline
        );
        assert!(result.is_ok());
    }

    #[test]
    fn valid_params_with_stakes_no_slash() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let result = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            5_000, 1_000, 2_000, 9999, 0, false, 7_200,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn valid_params_slash_with_both_stakes() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let result = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            5_000, 1_000, 1_000, 9999, 0, true, 86_400,
        );
        assert!(result.is_ok());
    }

    // ── ZeroEscrowAmount ──────────────────────────────────────────────────────

    #[test]
    fn rejects_zero_escrow_amount() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            0, 0, 0, 9999, 0, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ZeroEscrowAmount));
    }

    // ── DuplicateParticipants ─────────────────────────────────────────────────

    #[test]
    fn rejects_initiator_equals_beneficiary() {
        let key = Pubkey::new_from_array([1u8; 32]);
        let arbiter = Pubkey::new_from_array([3u8; 32]);
        let err = validate_init_params(
            &key, &key, &arbiter, 1_000, 0, 0, 9999, 0, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::DuplicateParticipants));
    }

    #[test]
    fn rejects_initiator_equals_arbiter() {
        let key = Pubkey::new_from_array([1u8; 32]);
        let beneficiary = Pubkey::new_from_array([2u8; 32]);
        let err = validate_init_params(
            &key, &beneficiary, &key, 1_000, 0, 0, 9999, 0, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::DuplicateParticipants));
    }

    #[test]
    fn rejects_beneficiary_equals_arbiter() {
        let initiator = Pubkey::new_from_array([1u8; 32]);
        let key = Pubkey::new_from_array([2u8; 32]);
        let err = validate_init_params(
            &initiator, &key, &key, 1_000, 0, 0, 9999, 0, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::DuplicateParticipants));
    }

    // ── TimeLockInPast ────────────────────────────────────────────────────────

    #[test]
    fn rejects_time_lock_in_past() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 0,
            500,  // time_lock in past relative to now=1000
            1_000,
            false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::TimeLockInPast));
    }

    #[test]
    fn rejects_time_lock_equal_to_now() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let now = 1_000_000i64;
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 0, now, now, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::TimeLockInPast));
    }

    // ── InvalidDisputeDeadline ────────────────────────────────────────────────

    #[test]
    fn rejects_dispute_deadline_below_minimum() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 0, 9999, 0, false,
            3_599, // one second below 1-hour minimum
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::InvalidDisputeDeadline));
    }

    #[test]
    fn rejects_dispute_deadline_above_ten_years() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let ten_years_plus_one = 365i64 * 24 * 3_600 * 10 + 1;
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 0, 9999, 0, false, ten_years_plus_one,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::InvalidDisputeDeadline));
    }

    #[test]
    fn accepts_exactly_one_hour_dispute_deadline() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        assert!(validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 0, 9999, 0, false, 3_600,
        )
        .is_ok());
    }

    // ── SlashRequiresStake ────────────────────────────────────────────────────

    #[test]
    fn rejects_slash_without_initiator_stake() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 1_000, 9999, 0,
            true, // slash enabled
            3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::SlashRequiresStake));
    }

    #[test]
    fn rejects_slash_without_beneficiary_stake() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 1_000, 0, 9999, 0,
            true, // slash enabled
            3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::SlashRequiresStake));
    }

    // ── StakeBelowMinimum ─────────────────────────────────────────────────────

    #[test]
    fn rejects_initiator_stake_below_minimum() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 999, 0, 9999, 0, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::StakeBelowMinimum));
    }

    #[test]
    fn rejects_beneficiary_stake_below_minimum() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        let err = validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, 0, 1, 9999, 0, false, 3_600,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::StakeBelowMinimum));
    }

    #[test]
    fn accepts_exactly_minimum_stake() {
        let (initiator, beneficiary, arbiter) = distinct_keys();
        assert!(validate_init_params(
            &initiator, &beneficiary, &arbiter,
            1_000, MINIMUM_STAKE, MINIMUM_STAKE, 9999, 0, true, 3_600,
        )
        .is_ok());
    }
}
