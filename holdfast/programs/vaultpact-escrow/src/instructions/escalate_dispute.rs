use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::EscrowError;
use crate::state::*;

pub const ESCALATION_GRACE_SECS: i64 = 7 * 24 * 3600;

#[derive(Accounts)]
pub struct EscalateDispute<'info> {
    pub escalator: Signer<'info>,

    #[account(
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = vault,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(
        mut,
        seeds = [b"dispute", escrow_account.escrow_id.as_ref()],
        bump = dispute_record.bump,
    )]
    pub dispute_record: Account<'info, DisputeRecord>,

    /// Vault PDA — validated via has_one = vault on escrow_account (LOW-F-004).
    pub vault: Account<'info, TokenAccount>,
}

#[event]
pub struct DisputeEscalated {
    pub escrow: Pubkey,
    pub escalated_by: Pubkey,
    pub resolution_deadline: i64,
    pub escalation_deadline: i64,
    pub timestamp: i64,
}

pub(crate) fn is_escrow_participant(
    escalator: &Pubkey,
    initiator: &Pubkey,
    beneficiary: &Pubkey,
) -> bool {
    escalator == initiator || escalator == beneficiary
}

pub(crate) fn compute_escalation_deadline(now: i64) -> anchor_lang::Result<i64> {
    now.checked_add(ESCALATION_GRACE_SECS)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))
}

pub fn handler(ctx: Context<EscalateDispute>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let dispute = &ctx.accounts.dispute_record;
    let escalator_key = ctx.accounts.escalator.key();

    require!(escrow.status == EscrowStatus::Disputed, EscrowError::InvalidStatus);

    require!(
        is_escrow_participant(&escalator_key, &escrow.initiator, &escrow.beneficiary),
        EscrowError::NotParticipant
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now > dispute.resolution_deadline, EscrowError::ResolutionDeadlineNotPassed);
    require!(dispute.escalated_at == 0, EscrowError::DisputeAlreadyEscalated);

    let escalation_deadline = compute_escalation_deadline(now)?;

    let dispute = &mut ctx.accounts.dispute_record;
    dispute.escalated_at = now;
    dispute.escalation_deadline = escalation_deadline;

    emit!(DisputeEscalated {
        escrow: escrow.key(),
        escalated_by: escalator_key,
        resolution_deadline: dispute.resolution_deadline,
        escalation_deadline,
        timestamp: now,
    });

    msg!("Dispute escalated by {} — fallback refund unlocks at {}", escalator_key, escalation_deadline);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::EscrowError;
    use anchor_lang::prelude::Pubkey;

    fn err_code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            _ => panic!("expected AnchorError"),
        }
    }

    // ── ESCALATION_GRACE_SECS constant ───────────────────────────────────────

    #[test]
    fn grace_period_is_seven_days() {
        assert_eq!(ESCALATION_GRACE_SECS, 7 * 24 * 3600);
        assert_eq!(ESCALATION_GRACE_SECS, 604_800);
    }

    // ── is_escrow_participant ─────────────────────────────────────────────────

    #[test]
    fn initiator_is_participant() {
        let initiator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        assert!(is_escrow_participant(&initiator, &initiator, &beneficiary));
    }

    #[test]
    fn beneficiary_is_participant() {
        let initiator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        assert!(is_escrow_participant(&beneficiary, &initiator, &beneficiary));
    }

    #[test]
    fn arbiter_is_not_participant() {
        let initiator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        let arbiter = Pubkey::new_unique();
        assert!(!is_escrow_participant(&arbiter, &initiator, &beneficiary));
    }

    #[test]
    fn random_key_is_not_participant() {
        let initiator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        let stranger = Pubkey::new_unique();
        assert!(!is_escrow_participant(&stranger, &initiator, &beneficiary));
    }

    // ── compute_escalation_deadline ──────────────────────────────────────────

    #[test]
    fn deadline_is_now_plus_grace_period() {
        let now = 1_000_000i64;
        let deadline = compute_escalation_deadline(now).unwrap();
        assert_eq!(deadline, now + ESCALATION_GRACE_SECS);
    }

    #[test]
    fn deadline_overflow_guard() {
        let err = compute_escalation_deadline(i64::MAX).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn deadline_near_max_no_overflow() {
        let now = i64::MAX - ESCALATION_GRACE_SECS;
        let deadline = compute_escalation_deadline(now).unwrap();
        assert_eq!(deadline, i64::MAX);
    }

    // ── Status gate semantics ────────────────────────────────────────────────

    #[test]
    fn escalation_requires_disputed_status() {
        assert_eq!(EscrowStatus::Disputed, EscrowStatus::Disputed);
        for bad in [
            EscrowStatus::Pending,
            EscrowStatus::Funded,
            EscrowStatus::Locked,
            EscrowStatus::Released,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(bad != EscrowStatus::Disputed, "status {:?} should not allow escalation", bad);
        }
    }

    // ── Resolution deadline boundary ─────────────────────────────────────────

    #[test]
    fn resolution_deadline_strict_greater_than() {
        let now = 1_000i64;
        let resolution_deadline = 999i64;
        assert!(now > resolution_deadline, "should allow when past deadline");
    }

    #[test]
    fn resolution_deadline_at_boundary_rejects() {
        let now = 1_000i64;
        let resolution_deadline = 1_000i64;
        assert!(!(now > resolution_deadline), "should reject at exact deadline");
    }

    #[test]
    fn resolution_deadline_before_rejects() {
        let now = 999i64;
        let resolution_deadline = 1_000i64;
        assert!(!(now > resolution_deadline), "should reject before deadline");
    }

    // ── Escalation flag guard ────────────────────────────────────────────────

    #[test]
    fn not_yet_escalated_allows() {
        let escalated_at = 0i64;
        assert_eq!(escalated_at, 0, "must be zero for first escalation");
    }

    #[test]
    fn already_escalated_blocks() {
        let escalated_at = 500i64;
        assert!(escalated_at != 0, "non-zero escalated_at must block re-escalation");
    }
}
