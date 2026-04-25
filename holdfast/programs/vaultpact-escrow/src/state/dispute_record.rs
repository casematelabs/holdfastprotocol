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
}

impl DisputeRecord {
    pub const SCHEMA_VERSION: u8 = 1;

    // 8 (discriminator) + 400 (data with headroom)
    pub const LEN: usize = 8 + 400;

    // Minimum serialized size: 1+1+32+32+32+32+32+128+3+32+8+8+8+8+8 = 365
    const _DATA_FITS: () = assert!(400 >= 365);
}

const _: () = DisputeRecord::_DATA_FITS;
