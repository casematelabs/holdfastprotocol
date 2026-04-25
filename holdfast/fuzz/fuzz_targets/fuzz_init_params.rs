//! Fuzz target: validate_init_params (escrow initialization parameter validation)
//!
//! Tests the pure parameter validation function extracted from initialize_escrow.
//! This function is the primary gate for all new pact creation; bugs here could
//! allow under-collateralised pacts, duplicate-participant bypasses, or invalid
//! time-lock creation.
//!
//! Priority paths (CAS-336):
//!   • Participant-uniqueness check (initiator ≠ beneficiary ≠ arbiter)
//!   • Time-lock expiry must be strictly in the future relative to `now`
//!   • Dispute deadline range [3_600, 315_360_000] seconds
//!   • slash_loser_stake requires both stakes to be non-zero
//!   • Non-zero stakes must meet MINIMUM_STAKE (1_000)
//!
//! Invariants checked:
//!   1. Successful validation implies all safety properties
//!   2. No panics for any combination of inputs

#![no_main]

use anchor_lang::prelude::Pubkey;
use arbitrary::Arbitrary;
use holdfast_escrow::fuzz_helpers::validate_init_params;
use libfuzzer_sys::fuzz_target;

const MINIMUM_STAKE: u64 = 1_000;
const MIN_DISPUTE_DEADLINE: i64 = 3_600;
const MAX_DISPUTE_DEADLINE: i64 = 365 * 24 * 3_600 * 10;

#[derive(Arbitrary, Debug)]
struct FuzzInput {
    initiator: [u8; 32],
    beneficiary: [u8; 32],
    arbiter: [u8; 32],
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
    time_lock_expires_at: i64,
    now: i64,
    slash_loser_stake: bool,
    dispute_deadline_secs: i64,
}

fuzz_target!(|input: FuzzInput| {
    let initiator = Pubkey::new_from_array(input.initiator);
    let beneficiary = Pubkey::new_from_array(input.beneficiary);
    let arbiter = Pubkey::new_from_array(input.arbiter);

    let result = validate_init_params(
        &initiator,
        &beneficiary,
        &arbiter,
        input.escrow_amount,
        input.initiator_stake,
        input.beneficiary_stake,
        input.time_lock_expires_at,
        input.now,
        input.slash_loser_stake,
        input.dispute_deadline_secs,
    );

    // Invariant: when validation succeeds every safety predicate must hold
    if result.is_ok() {
        // Participant uniqueness
        assert_ne!(initiator, beneficiary, "ok with initiator == beneficiary");
        assert_ne!(initiator, arbiter, "ok with initiator == arbiter");
        assert_ne!(beneficiary, arbiter, "ok with beneficiary == arbiter");

        // Non-zero escrow amount
        assert!(input.escrow_amount > 0, "ok with zero escrow amount");

        // Time-lock must be in the future
        assert!(
            input.time_lock_expires_at > input.now,
            "ok with time_lock_expires_at ({}) <= now ({})",
            input.time_lock_expires_at,
            input.now,
        );

        // Dispute deadline within bounds
        assert!(
            input.dispute_deadline_secs >= MIN_DISPUTE_DEADLINE,
            "ok with dispute_deadline_secs ({}) < minimum ({})",
            input.dispute_deadline_secs,
            MIN_DISPUTE_DEADLINE,
        );
        assert!(
            input.dispute_deadline_secs <= MAX_DISPUTE_DEADLINE,
            "ok with dispute_deadline_secs ({}) > maximum ({})",
            input.dispute_deadline_secs,
            MAX_DISPUTE_DEADLINE,
        );

        // Slash requires both stakes
        if input.slash_loser_stake {
            assert!(
                input.initiator_stake > 0 && input.beneficiary_stake > 0,
                "ok with slash but missing stake"
            );
        }

        // Non-zero stakes meet the minimum
        if input.initiator_stake > 0 {
            assert!(
                input.initiator_stake >= MINIMUM_STAKE,
                "ok with initiator_stake ({}) below minimum ({})",
                input.initiator_stake,
                MINIMUM_STAKE,
            );
        }
        if input.beneficiary_stake > 0 {
            assert!(
                input.beneficiary_stake >= MINIMUM_STAKE,
                "ok with beneficiary_stake ({}) below minimum ({})",
                input.beneficiary_stake,
                MINIMUM_STAKE,
            );
        }
    }
});
