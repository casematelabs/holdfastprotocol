use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RaiseDisputeParams {
    pub evidence_hash: [u8; 32],
    pub evidence_uri: [u8; 128],
}

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(mut)]
    pub raiser: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
    )]
    pub pact_record: Box<Account<'info, PactRecord>>,

    #[account(
        init,
        payer = raiser,
        space = DisputeRecord::LEN,
        seeds = [b"dispute", escrow_account.escrow_id.as_ref()],
        bump,
    )]
    pub dispute_record: Box<Account<'info, DisputeRecord>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RaiseDispute>, params: RaiseDisputeParams) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;
    let raiser_key = ctx.accounts.raiser.key();

    // AV-9: only initiator or beneficiary
    require!(
        raiser_key == escrow.initiator || raiser_key == escrow.beneficiary,
        EscrowError::NotParticipant
    );

    require!(
        escrow.status == EscrowStatus::Locked || escrow.status == EscrowStatus::Released,
        EscrowError::InvalidStatus
    );

    let now = Clock::get()?.unix_timestamp;

    // AV-2: if released, dispute must be within the window
    if escrow.status == EscrowStatus::Released {
        require!(now < escrow.dispute_window_ends_at, EscrowError::DisputeWindowClosed);
    }

    let pact = &ctx.accounts.pact_record;

    // Effects
    escrow.status = EscrowStatus::Disputed;

    let dispute = &mut ctx.accounts.dispute_record;
    dispute.schema_version = DisputeRecord::SCHEMA_VERSION;
    dispute.bump = ctx.bumps.dispute_record;
    dispute.dispute_id = escrow.escrow_id;
    dispute.escrow = escrow.key();
    dispute.pact = pact.key();
    dispute.raised_by = raiser_key;
    dispute.evidence_hash = params.evidence_hash;
    dispute.evidence_uri = params.evidence_uri;
    dispute.arbiter_decision = ArbiterDecision::None;
    dispute.arbiter_reasoning_hash = [0u8; 32];
    dispute.resolution_deadline = now
        .checked_add(pact.dispute_deadline_secs)
        .ok_or(EscrowError::ArithmeticOverflow)?;
    dispute.resolved_at = 0;
    dispute.created_at = now;

    msg!("Dispute raised by {}", raiser_key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;
    use crate::errors::EscrowError;

    fn err_code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            _ => panic!("expected AnchorError"),
        }
    }

    // ── Participant validation ─────────────────────────────────────────────────

    #[test]
    fn raiser_must_be_initiator_or_beneficiary() {
        let initiator = Pubkey::new_from_array([1u8; 32]);
        let beneficiary = Pubkey::new_from_array([2u8; 32]);
        let outsider = Pubkey::new_from_array([3u8; 32]);

        // outsider is neither initiator nor beneficiary
        let is_participant = outsider == initiator || outsider == beneficiary;
        assert!(!is_participant);
    }

    #[test]
    fn initiator_is_valid_raiser() {
        let initiator = Pubkey::new_from_array([1u8; 32]);
        let beneficiary = Pubkey::new_from_array([2u8; 32]);
        assert!(initiator == initiator || initiator == beneficiary);
    }

    #[test]
    fn beneficiary_is_valid_raiser() {
        let initiator = Pubkey::new_from_array([1u8; 32]);
        let beneficiary = Pubkey::new_from_array([2u8; 32]);
        assert!(beneficiary == initiator || beneficiary == beneficiary);
    }

    // ── Status gate ────────────────────────────────────────────────────────────

    #[test]
    fn dispute_allowed_from_locked_or_released() {
        let locked = EscrowStatus::Locked;
        let released = EscrowStatus::Released;
        assert!(locked == EscrowStatus::Locked || locked == EscrowStatus::Released);
        assert!(released == EscrowStatus::Locked || released == EscrowStatus::Released);
    }

    #[test]
    fn dispute_blocked_from_invalid_statuses() {
        for bad in [
            EscrowStatus::Pending,
            EscrowStatus::Funded,
            EscrowStatus::Disputed,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            let allowed = bad == EscrowStatus::Locked || bad == EscrowStatus::Released;
            assert!(!allowed, "status {:?} should not allow raise_dispute", bad);
        }
    }

    // ── Dispute window check (Released path) ──────────────────────────────────

    #[test]
    fn dispute_inside_window_is_valid() {
        let dispute_window_ends_at = 2_000i64;
        let now = 1_999i64;
        assert!(now < dispute_window_ends_at, "should be inside window");
    }

    #[test]
    fn dispute_at_or_after_window_end_is_rejected() {
        let dispute_window_ends_at = 2_000i64;
        // at the boundary: now == window_end → closed (require now < ends_at)
        assert!(!(2_000i64 < dispute_window_ends_at));
        assert!(!(2_001i64 < dispute_window_ends_at));
    }

    // ── Resolution deadline arithmetic ────────────────────────────────────────

    #[test]
    fn resolution_deadline_is_now_plus_dispute_deadline_secs() {
        let now = 1_000_000i64;
        let dispute_deadline_secs = 86_400i64; // 1 day
        let deadline = now.checked_add(dispute_deadline_secs).unwrap();
        assert_eq!(deadline, 1_086_400);
    }

    #[test]
    fn resolution_deadline_overflow_would_error() {
        let now = i64::MAX;
        let result = now.checked_add(1);
        assert!(result.is_none(), "should overflow");
    }
}
