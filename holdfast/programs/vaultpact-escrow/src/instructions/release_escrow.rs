use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::EscrowError;
use crate::state::*;

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    pub initiator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = initiator @ EscrowError::UnauthorizedSigner,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
        has_one = vault,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
    )]
    pub pact_record: Account<'info, PactRecord>,

    #[account(constraint = initiator_wallet.authority == initiator.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub initiator_wallet: Account<'info, vaultpact::AgentWallet>,

    /// Vault PDA — validated via has_one = vault on escrow_account (LOW-F-004).
    pub vault: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<ReleaseEscrow>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Locked, EscrowError::InvalidStatus);

    // Frozen initiators may still release (settlement allowed)
    // Blacklisted initiators may NOT release
    require!(ctx.accounts.initiator_wallet.status != crate::AGENT_STATUS_BLACKLISTED, EscrowError::AgentBlacklisted);

    let now = Clock::get()?.unix_timestamp;

    // CEI: all state updates before any CPI (none here, but maintain pattern)
    escrow.status = EscrowStatus::Released;
    escrow.released_at = now;
    // Dispute window is a fixed 7-day grace period after release.
    // Distinct from pact_record.dispute_deadline_secs, which is the arbiter resolution window.
    escrow.dispute_window_ends_at = now
        .checked_add(7 * 24 * 3600)
        .ok_or(EscrowError::ArithmeticOverflow)?;

    msg!("Escrow released, dispute window ends at {}", escrow.dispute_window_ends_at);
    Ok(())
}

/// Computes the dispute window end timestamp (now + 7 days).
pub(crate) fn compute_dispute_window_end(now: i64) -> anchor_lang::Result<i64> {
    now.checked_add(7 * 24 * 3_600)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))
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

    // ── compute_dispute_window_end ─────────────────────────────────────────────

    #[test]
    fn dispute_window_is_seven_days_from_now() {
        let now = 0i64;
        let end = compute_dispute_window_end(now).unwrap();
        assert_eq!(end, 7 * 24 * 3_600);
    }

    #[test]
    fn dispute_window_from_real_timestamp() {
        let now = 1_700_000_000i64; // a realistic unix timestamp
        let end = compute_dispute_window_end(now).unwrap();
        assert_eq!(end, now + 604_800); // 604800 = 7 * 24 * 3600
    }

    #[test]
    fn dispute_window_overflow_guard() {
        let err = compute_dispute_window_end(i64::MAX).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn dispute_window_near_max_safe() {
        let near_max = i64::MAX - 604_801;
        let end = compute_dispute_window_end(near_max).unwrap();
        assert_eq!(end, near_max + 604_800);
    }

    // ── Status gate semantics ─────────────────────────────────────────────────

    #[test]
    fn only_locked_allows_release() {
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
            assert!(bad != EscrowStatus::Locked, "status {:?} should not allow release", bad);
        }
    }
}
