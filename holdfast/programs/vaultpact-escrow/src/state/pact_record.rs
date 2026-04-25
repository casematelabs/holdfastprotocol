use anchor_lang::prelude::*;

#[account]
pub struct PactRecord {
    pub schema_version: u8,
    pub bump: u8,
    pub pact_id: [u8; 32],
    pub escrow: Pubkey,
    pub initiator_reputation_min: u64,
    pub beneficiary_reputation_min: u64,
    pub deliverables_hash: [u8; 32],
    pub deliverables_uri: [u8; 128],
    pub auto_release_on_expiry: bool,
    pub slash_loser_stake: bool,
    pub dispute_deadline_secs: i64,
    pub created_at: i64,
    pub initiator_min_tier: u8,
    pub initiator_min_pacts: u64,
    pub beneficiary_min_tier: u8,
    pub beneficiary_min_pacts: u64,
}

impl PactRecord {
    pub const SCHEMA_VERSION: u8 = 1;

    // 8 (discriminator) + 336 (data with headroom)
    pub const LEN: usize = 8 + 336;

    // Minimum serialized size: 1+1+32+32+8+8+32+128+1+1+8+8 + 1+8+1+8 = 278
    const _DATA_FITS: () = assert!(336 >= 278);
}

const _: () = PactRecord::_DATA_FITS;
