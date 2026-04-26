use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ArbiterDecision {
    None,
    ReleaseToBeneficiary,
    RefundToInitiator,
    SplitFunds { beneficiary_bps: u16 },
}

impl Default for ArbiterDecision {
    fn default() -> Self {
        ArbiterDecision::None
    }
}

#[account]
pub struct DisputeRecord {
    pub schema_version: u8,
    pub bump: u8,
    pub dispute_id: [u8; 32],
    pub escrow: Pubkey,
    pub pact: Pubkey,
    pub raised_by: Pubkey,
    pub evidence_hash: [u8; 32],
    pub evidence_uri: [u8; 128],
    pub arbiter_decision: ArbiterDecision,
    pub arbiter_reasoning_hash: [u8; 32],
    pub resolution_deadline: i64,
    pub resolved_at: i64,
    pub created_at: i64,
    pub escalated_at: i64,
    pub escalation_deadline: i64,
    // MED-F-001: payout destinations committed at raise_dispute time; enforced
    // via has_one at resolve_dispute to prevent arbiter account redirection.
    pub beneficiary_token_account: Pubkey,
    pub initiator_token_account: Pubkey,
}

impl DisputeRecord {
    pub const SCHEMA_VERSION: u8 = 1;

    // 8 (discriminator) + 500 (data with headroom)
    pub const LEN: usize = 8 + 500;

    // Minimum serialized size: 1+1+32+32+32+32+32+128+3+32+8+8+8+8+8+32+32 = 429
    const _DATA_FITS: () = assert!(500 >= 429);
}

const _: () = DisputeRecord::_DATA_FITS;
