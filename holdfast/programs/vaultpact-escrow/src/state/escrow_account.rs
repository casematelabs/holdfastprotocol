use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum EscrowStatus {
    Pending          = 0,
    Funded           = 1,
    Locked           = 2,
    Released         = 3,
    Disputed         = 4,
    Refunded         = 5,
    Closed           = 6,
    Claimed          = 7,
    MutuallyCancelled = 8,
}

impl Default for EscrowStatus {
    fn default() -> Self {
        EscrowStatus::Pending
    }
}

#[account]
pub struct EscrowAccount {
    pub schema_version: u8,
    pub bump: u8,
    pub escrow_id: [u8; 32],
    pub initiator: Pubkey,
    pub beneficiary: Pubkey,
    pub arbiter: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub escrow_amount: u64,
    pub initiator_stake: u64,
    pub beneficiary_stake: u64,
    pub status: EscrowStatus,
    pub time_lock_expires_at: i64,
    pub dispute_window_ends_at: i64,
    pub pact_record: Pubkey,
    pub created_at: i64,
    pub locked_at: i64,
    pub released_at: i64,
    pub resolved_at: i64,
    pub beneficiary_staked: bool,
    pub cancelled_at: i64,
}

impl EscrowAccount {
    pub const SCHEMA_VERSION: u8 = 1;

    // 8 (discriminator) + 400 (data with headroom)
    pub const LEN: usize = 8 + 400;

    // Minimum serialized size: 1+1+32+32+32+32+32+32+8+8+8+1+8+8+32+8+8+8+8+1+8 = 310
    const _DATA_FITS: () = assert!(400 >= 310);
}

const _: () = EscrowAccount::_DATA_FITS;
