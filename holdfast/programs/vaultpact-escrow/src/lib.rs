use anchor_lang::prelude::*;

pub mod cpi_helpers;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

pub const AGENT_STATUS_ACTIVE: u8 = 0;
pub const AGENT_STATUS_FROZEN: u8 = 1;
pub const AGENT_STATUS_BLACKLISTED: u8 = 2;

// ── Fuzz helpers ─────────────────────────────────────────────────────
//
// Re-exports pub(crate) pure functions for cargo-fuzz targets.
// Only active under the `fuzz-helpers` feature; zero cost in normal builds.

#[cfg(feature = "fuzz-helpers")]
pub mod fuzz_helpers {
    use anchor_lang::prelude::Pubkey;
    use anchor_lang::Result;

    // pub types can be re-exported directly
    pub use crate::state::dispute_record::ArbiterDecision;
    pub use crate::state::escrow_account::EscrowStatus;
    pub use crate::errors::EscrowError;

    // pub(crate) functions require wrapper functions to cross the crate boundary

    pub fn compute_dispute_payouts(
        escrow_amount: u64,
        initiator_stake: u64,
        beneficiary_stake: u64,
        slash_loser_stake: bool,
        decision: &ArbiterDecision,
    ) -> Result<(u64, u64)> {
        crate::instructions::resolve_dispute::compute_dispute_payouts(
            escrow_amount,
            initiator_stake,
            beneficiary_stake,
            slash_loser_stake,
            decision,
        )
    }

    pub fn dispute_reputation_deltas(decision: &ArbiterDecision) -> Result<(i16, i16)> {
        crate::instructions::resolve_dispute::dispute_reputation_deltas(decision)
    }

    pub fn validate_init_params(
        initiator: &Pubkey,
        beneficiary: &Pubkey,
        arbiter: &Pubkey,
        escrow_amount: u64,
        initiator_stake: u64,
        beneficiary_stake: u64,
        time_lock_expires_at: i64,
        now: i64,
        slash_loser_stake: bool,
        dispute_deadline_secs: i64,
    ) -> Result<()> {
        crate::instructions::initialize_escrow::validate_init_params(
            initiator,
            beneficiary,
            arbiter,
            escrow_amount,
            initiator_stake,
            beneficiary_stake,
            time_lock_expires_at,
            now,
            slash_loser_stake,
            dispute_deadline_secs,
        )
    }
}

// Devnet fallback escrow program ID generated for CAS-27 fallback remediation.
// Keypair: holdfast/keys/devnet-escrow-fallback.json
// HOLDFAST_ESCROW_AUTHORITY PDA derived from this ID:
//   find_program_address([b"vp_escrow_authority"], this_id) => DZifyzpP2weUS2QSpenB3fH9xdCyeYLduB8PxyEqoHwj (bump 254)
declare_id!("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");

#[program]
pub mod vaultpact_escrow {
    use super::*;

    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, params: InitializeEscrowParams) -> Result<()> {
        initialize_escrow::handler(ctx, params)
    }

    pub fn deposit_funds(ctx: Context<DepositFunds>) -> Result<()> {
        deposit_funds::handler(ctx)
    }

    pub fn stake_beneficiary(ctx: Context<StakeBeneficiary>) -> Result<()> {
        stake_beneficiary::handler(ctx)
    }

    pub fn lock_escrow(ctx: Context<LockEscrow>) -> Result<()> {
        lock_escrow::handler(ctx)
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        release_escrow::handler(ctx)
    }

    pub fn claim_released(ctx: Context<ClaimReleased>) -> Result<()> {
        claim_released::handler(ctx)
    }

    pub fn auto_release(ctx: Context<AutoRelease>) -> Result<()> {
        auto_release::handler(ctx)
    }

    pub fn raise_dispute(ctx: Context<RaiseDispute>, params: RaiseDisputeParams) -> Result<()> {
        raise_dispute::handler(ctx, params)
    }

    pub fn escalate_dispute(ctx: Context<EscalateDispute>) -> Result<()> {
        escalate_dispute::handler(ctx)
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, params: ResolveDisputeParams) -> Result<()> {
        resolve_dispute::handler(ctx, params)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        refund::handler(ctx)
    }

    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        close_escrow::handler(ctx)
    }

    pub fn protocol_freeze_pact(ctx: Context<ProtocolFreezePact>) -> Result<()> {
        protocol_freeze_pact::handler(ctx)
    }

    pub fn mutual_cancel_escrow(ctx: Context<MutualCancelEscrow>) -> Result<()> {
        mutual_cancel_escrow::handler(ctx)
    }

    pub fn cancel_pending_escrow(ctx: Context<CancelPendingEscrow>) -> Result<()> {
        cancel_pending_escrow::handler(ctx)
    }
}
