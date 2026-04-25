//! Fuzz target: compute_dispute_payouts
//!
//! Tests the dispute payout computation that splits vault funds between the
//! initiator and beneficiary based on the arbiter's decision.
//!
//! Priority paths (CAS-336):
//!   • Overflow guards on escrow_amount + stake sums
//!   • SplitFunds basis-points arithmetic (bps * amount / 10_000)
//!   • Fund-conservation: b_payout + i_payout == total_locked when no overflow
//!
//! Invariants checked:
//!   1. Successful payouts conserve total locked funds exactly
//!   2. SplitFunds with bps > 10_000 always returns an error
//!   3. No panics for any combination of inputs

#![no_main]

use arbitrary::Arbitrary;
use holdfast_escrow::fuzz_helpers::{compute_dispute_payouts, ArbiterDecision};
use libfuzzer_sys::fuzz_target;

#[derive(Arbitrary, Debug)]
struct FuzzInput {
    schema_version: u8,
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
    slash_loser_stake: bool,
    decision: FuzzDecision,
}

#[derive(Arbitrary, Debug)]
enum FuzzDecision {
    ReleaseToBeneficiary,
    RefundToInitiator,
    SplitFunds { beneficiary_bps: u16 },
}

fuzz_target!(|input: FuzzInput| {
    let decision = match &input.decision {
        FuzzDecision::ReleaseToBeneficiary => ArbiterDecision::ReleaseToBeneficiary,
        FuzzDecision::RefundToInitiator => ArbiterDecision::RefundToInitiator,
        FuzzDecision::SplitFunds { beneficiary_bps } => {
            ArbiterDecision::SplitFunds { beneficiary_bps: *beneficiary_bps }
        }
    };

    // Invariant: SplitFunds with bps > 10_000 must always fail
    if let FuzzDecision::SplitFunds { beneficiary_bps } = &input.decision {
        if *beneficiary_bps > 10_000 {
            let result = compute_dispute_payouts(
                input.escrow_amount,
                input.initiator_stake,
                input.beneficiary_stake,
                input.slash_loser_stake,
                &decision,
            );
            assert!(
                result.is_err(),
                "SplitFunds with bps={} > 10_000 must return error",
                beneficiary_bps
            );
            return;
        }
    }

    let result = compute_dispute_payouts(
        input.escrow_amount,
        input.initiator_stake,
        input.beneficiary_stake,
        input.slash_loser_stake,
        &decision,
    );

    if let Ok((b_payout, i_payout)) = result {
        // Invariant: successful payouts conserve total locked funds.
        //
        // total_locked = escrow_amount + initiator_stake + beneficiary_stake
        //
        // When slash_loser_stake is true, the loser's stake moves to the winner,
        // so the sum still equals total_locked (no funds are destroyed or created).
        let total_locked = (input.escrow_amount as u128)
            + (input.initiator_stake as u128)
            + (input.beneficiary_stake as u128);

        let payout_sum = (b_payout as u128) + (i_payout as u128);

        // For SplitFunds, stakes are returned to each party regardless of slash flag.
        // For binary decisions with slash, loser's stake moves to winner.
        // In all cases, the total disbursed must equal total deposited.
        assert_eq!(
            payout_sum, total_locked,
            "fund conservation violated: b={} + i={} = {} != total={}  \
            (escrow={}, i_stake={}, b_stake={}, slash={}, decision={:?})",
            b_payout,
            i_payout,
            payout_sum,
            total_locked,
            input.escrow_amount,
            input.initiator_stake,
            input.beneficiary_stake,
            input.slash_loser_stake,
            &decision,
        );
    }
});
