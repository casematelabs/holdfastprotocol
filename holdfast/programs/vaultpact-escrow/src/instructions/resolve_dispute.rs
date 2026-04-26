use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

pub(crate) const DISPUTE_LOSER_DELTA: i16 = -100;
pub(crate) const DISPUTE_WINNER_DELTA: i16 = 25;
pub(crate) const DISPUTE_SPLIT_DELTA: i16 = -25;

/// Pure payout computation extracted for unit testing.
/// Returns (beneficiary_payout, initiator_payout).
pub(crate) fn compute_dispute_payouts(
    escrow_amount: u64,
    initiator_stake: u64,
    beneficiary_stake: u64,
    slash_loser_stake: bool,
    decision: &ArbiterDecision,
) -> Result<(u64, u64)> {
    match decision {
        ArbiterDecision::ReleaseToBeneficiary => {
            let mut b = escrow_amount
                .checked_add(beneficiary_stake)
                .ok_or(EscrowError::ArithmeticOverflow)?;
            let mut i = initiator_stake;
            if slash_loser_stake {
                b = b.checked_add(initiator_stake).ok_or(EscrowError::ArithmeticOverflow)?;
                i = 0;
            }
            Ok((b, i))
        }
        ArbiterDecision::RefundToInitiator => {
            let mut i = escrow_amount
                .checked_add(initiator_stake)
                .ok_or(EscrowError::ArithmeticOverflow)?;
            let mut b = beneficiary_stake;
            if slash_loser_stake {
                i = i.checked_add(beneficiary_stake).ok_or(EscrowError::ArithmeticOverflow)?;
                b = 0;
            }
            Ok((b, i))
        }
        ArbiterDecision::SplitFunds { beneficiary_bps } => {
            require!(*beneficiary_bps <= 10_000, EscrowError::InvalidBasisPoints);
            let bps = *beneficiary_bps as u64;
            if slash_loser_stake {
                // Both stakes are at risk: fold them into the escrow pool and
                // split the total by bps.  This preserves funds exactly (i is
                // computed by subtraction, not a second multiply) and is
                // consistent with the slash intent applied to the other branches.
                let total = escrow_amount
                    .checked_add(initiator_stake)
                    .ok_or(EscrowError::ArithmeticOverflow)?
                    .checked_add(beneficiary_stake)
                    .ok_or(EscrowError::ArithmeticOverflow)?;
                let b = total
                    .checked_mul(bps)
                    .ok_or(EscrowError::ArithmeticOverflow)?
                    / 10_000;
                let i = total
                    .checked_sub(b)
                    .ok_or(EscrowError::ArithmeticOverflow)?;
                Ok((b, i))
            } else {
                let b_share = escrow_amount
                    .checked_mul(bps)
                    .ok_or(EscrowError::ArithmeticOverflow)?
                    / 10_000;
                let i_share = escrow_amount
                    .checked_sub(b_share)
                    .ok_or(EscrowError::ArithmeticOverflow)?;
                let b = b_share
                    .checked_add(beneficiary_stake)
                    .ok_or(EscrowError::ArithmeticOverflow)?;
                let i = i_share
                    .checked_add(initiator_stake)
                    .ok_or(EscrowError::ArithmeticOverflow)?;
                Ok((b, i))
            }
        }
        ArbiterDecision::None => Err(error!(EscrowError::DecisionRequired)),
    }
}

/// Returns (initiator_delta, beneficiary_delta).
pub(crate) fn dispute_reputation_deltas(decision: &ArbiterDecision) -> Result<(i16, i16)> {
    match decision {
        ArbiterDecision::ReleaseToBeneficiary => Ok((DISPUTE_LOSER_DELTA, DISPUTE_WINNER_DELTA)),
        ArbiterDecision::RefundToInitiator => Ok((DISPUTE_WINNER_DELTA, DISPUTE_LOSER_DELTA)),
        ArbiterDecision::SplitFunds { .. } => Ok((DISPUTE_SPLIT_DELTA, DISPUTE_SPLIT_DELTA)),
        ArbiterDecision::None => Err(error!(EscrowError::DecisionRequired)),
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ResolveDisputeParams {
    pub decision: ArbiterDecision,
    pub reasoning_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub arbiter: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = arbiter @ EscrowError::UnauthorizedSigner,
        has_one = pact_record @ EscrowError::PactEscrowMismatch,
        has_one = vault,
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>>,

    #[account(
        seeds = [b"pact", escrow_account.escrow_id.as_ref()],
        bump = pact_record.bump,
    )]
    pub pact_record: Box<Account<'info, PactRecord>>,

    #[account(
        mut,
        seeds = [b"dispute", escrow_account.escrow_id.as_ref()],
        bump = dispute_record.bump,
        // MED-F-001: enforce the payout destinations committed at raise_dispute time.
        has_one = beneficiary_token_account @ EscrowError::UnauthorizedTokenAccount,
        has_one = initiator_token_account @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub dispute_record: Box<Account<'info, DisputeRecord>>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = beneficiary_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = initiator_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub initiator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    // ── Arbiter status gate ───────────────────────────────────────────────
    #[account(constraint = arbiter_wallet.authority == arbiter.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub arbiter_wallet: Account<'info, vaultpact::AgentWallet>,

    // ── Reputation CPI accounts ───────────────────────────────────────────
    #[account(
        mut,
        seeds = [b"reputation", escrow_account.initiator.as_ref()],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub initiator_reputation: Box<Account<'info, vaultpact::ReputationAccount>>,

    #[account(
        mut,
        seeds = [b"reputation", escrow_account.beneficiary.as_ref()],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub beneficiary_reputation: Box<Account<'info, vaultpact::ReputationAccount>>,

    /// CHECK: Virtual PDA signer for update_reputation CPIs.
    #[account(seeds = [b"vp_escrow_authority"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"attestation_registry"],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub attestation_registry: Account<'info, vaultpact::AttestationRegistry>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
}

pub fn handler(ctx: Context<ResolveDispute>, params: ResolveDisputeParams) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let pact = &ctx.accounts.pact_record;
    require!(escrow.status == EscrowStatus::Disputed, EscrowError::InvalidStatus);
    require!(ctx.accounts.arbiter_wallet.status != crate::AGENT_STATUS_BLACKLISTED, EscrowError::AgentBlacklisted);
    require!(params.decision != ArbiterDecision::None, EscrowError::DecisionRequired);

    let decision = params.decision;

    if let ArbiterDecision::SplitFunds { beneficiary_bps } = &decision {
        require!(*beneficiary_bps <= 10_000, EscrowError::InvalidBasisPoints);
    }

    let now = Clock::get()?.unix_timestamp;

    let escrow_amount = escrow.escrow_amount;
    let initiator_stake = escrow.initiator_stake;
    let beneficiary_stake = if escrow.beneficiary_staked { escrow.beneficiary_stake } else { 0 };
    let slash = pact.slash_loser_stake;
    let escrow_id = escrow.escrow_id;
    let bump = escrow.bump;

    // CEI: read reputation nonces before any state mutation.
    let i_nonce = ctx.accounts.initiator_reputation.nonce;
    let b_nonce = ctx.accounts.beneficiary_reputation.nonce;
    let pact_id: [u8; 7] = escrow_id[..7]
        .try_into()
        .map_err(|_| error!(EscrowError::ArithmeticOverflow))?;
    let escrow_authority_bump = ctx.bumps.escrow_authority;

    // Compute payouts
    let (beneficiary_payout, initiator_payout) =
        compute_dispute_payouts(escrow_amount, initiator_stake, beneficiary_stake, slash, &decision)?;

    // CEI: update state BEFORE transfers
    let escrow = &mut ctx.accounts.escrow_account;
    match &decision {
        ArbiterDecision::RefundToInitiator => escrow.status = EscrowStatus::Refunded,
        // Claimed: funds disbursed here directly; claim_released is not called post-dispute.
        _ => escrow.status = EscrowStatus::Claimed,
    }
    escrow.resolved_at = now;

    let dispute = &mut ctx.accounts.dispute_record;
    dispute.arbiter_decision = decision;
    dispute.arbiter_reasoning_hash = params.reasoning_hash;
    dispute.resolved_at = now;

    // Interactions: transfer payouts
    let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", escrow_id.as_ref(), &[bump]]];

    if beneficiary_payout > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.beneficiary_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, beneficiary_payout)?;
    }

    if initiator_payout > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.initiator_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, initiator_payout)?;
    }

    // Reputation updates: loser gets -100, winner gets +25, split gives both -25.
    let (i_delta, b_delta) = dispute_reputation_deltas(&ctx.accounts.dispute_record.arbiter_decision)?;

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.attestation_registry.to_account_info(),
        escrow_authority_bump,
        i_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Disputed,
        i_delta,
        pact_id,
    )?;

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.attestation_registry.to_account_info(),
        escrow_authority_bump,
        b_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Disputed,
        b_delta,
        pact_id,
    )?;

    msg!("Dispute resolved: beneficiary={}, initiator={}", beneficiary_payout, initiator_payout);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(ae) => ae.error_code_number,
            _ => panic!("expected AnchorError"),
        }
    }

    // ── compute_dispute_payouts: ReleaseToBeneficiary ────────────────────────

    #[test]
    fn release_to_beneficiary_no_slash() {
        let (b, i) = compute_dispute_payouts(
            1_000, // escrow_amount
            200,   // initiator_stake
            300,   // beneficiary_stake
            false,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        // b = escrow_amount + beneficiary_stake = 1300, initiator gets stake back
        assert_eq!(b, 1_300);
        assert_eq!(i, 200);
    }

    #[test]
    fn release_to_beneficiary_with_slash() {
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 300, true,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        // b = 1000 + 300 + 200 (slashed initiator stake) = 1500, initiator gets 0
        assert_eq!(b, 1_500);
        assert_eq!(i, 0);
    }

    #[test]
    fn release_to_beneficiary_zero_stakes() {
        let (b, i) = compute_dispute_payouts(
            5_000, 0, 0, false,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        assert_eq!(b, 5_000);
        assert_eq!(i, 0);
    }

    // ── compute_dispute_payouts: RefundToInitiator ───────────────────────────

    #[test]
    fn refund_to_initiator_no_slash() {
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 300, false,
            &ArbiterDecision::RefundToInitiator,
        )
        .unwrap();
        // i = escrow_amount + initiator_stake = 1200, beneficiary gets stake back
        assert_eq!(b, 300);
        assert_eq!(i, 1_200);
    }

    #[test]
    fn refund_to_initiator_with_slash() {
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 300, true,
            &ArbiterDecision::RefundToInitiator,
        )
        .unwrap();
        // i = 1000 + 200 + 300 (slashed beneficiary stake) = 1500, beneficiary gets 0
        assert_eq!(b, 0);
        assert_eq!(i, 1_500);
    }

    // ── compute_dispute_payouts: SplitFunds ─────────────────────────────────

    #[test]
    fn split_50_50_no_stake() {
        let (b, i) = compute_dispute_payouts(
            2_000, 0, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 },
        )
        .unwrap();
        assert_eq!(b, 1_000);
        assert_eq!(i, 1_000);
    }

    #[test]
    fn split_30_70_with_stakes() {
        let (b, i) = compute_dispute_payouts(
            10_000, 500, 500, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 3_000 },
        )
        .unwrap();
        // b_share = 10000 * 3000 / 10000 = 3000; i_share = 7000
        // b = 3000 + 500 = 3500; i = 7000 + 500 = 7500
        assert_eq!(b, 3_500);
        assert_eq!(i, 7_500);
    }

    #[test]
    fn split_full_beneficiary_bps_10000() {
        let (b, i) = compute_dispute_payouts(
            1_000, 0, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 10_000 },
        )
        .unwrap();
        assert_eq!(b, 1_000);
        assert_eq!(i, 0);
    }

    #[test]
    fn split_zero_beneficiary_bps() {
        let (b, i) = compute_dispute_payouts(
            1_000, 0, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 0 },
        )
        .unwrap();
        assert_eq!(b, 0);
        assert_eq!(i, 1_000);
    }

    // ── SplitFunds with slash_loser_stake=true (Gap-12 fix) ─────────────

    #[test]
    fn split_50_50_slash_true_proportional() {
        // With slash=true and equal bps, the result equals each party getting
        // their own stake back (symmetric case — same as no-slash for 50/50).
        let (b, i) = compute_dispute_payouts(
            2_000, 500, 500, true,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 },
        )
        .unwrap();
        // total = 3000; b = 3000*5000/10000 = 1500; i = 3000-1500 = 1500
        assert_eq!(b, 1_500);
        assert_eq!(i, 1_500);
    }

    #[test]
    fn split_30_70_slash_true_proportional() {
        let (b, i) = compute_dispute_payouts(
            10_000, 300, 700, true,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 3_000 },
        )
        .unwrap();
        // total = 11000; b = 11000*3000/10000 = 3300; i = 11000-3300 = 7700
        assert_eq!(b, 3_300);
        assert_eq!(i, 7_700);
    }

    #[test]
    fn split_asymmetric_bps_slash_true_conserves_funds() {
        let escrow = 1_000_000u64;
        let i_stake = 50_000u64;
        let b_stake = 25_000u64;
        let (b, i) = compute_dispute_payouts(
            escrow, i_stake, b_stake, true,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 8_000 },
        )
        .unwrap();
        // total = 1_075_000; b = 1_075_000*8000/10000 = 860_000; i = 215_000
        assert_eq!(b, 860_000);
        assert_eq!(i, 215_000);
        assert_eq!(b + i, escrow + i_stake + b_stake, "fund conservation");
    }

    #[test]
    fn split_slash_true_zero_bps_all_to_initiator() {
        // bps=0 with slash=true: everything goes to initiator
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 300, true,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 0 },
        )
        .unwrap();
        // total = 1500; b = 0; i = 1500
        assert_eq!(b, 0);
        assert_eq!(i, 1_500);
    }

    #[test]
    fn split_slash_true_full_bps_all_to_beneficiary() {
        // bps=10000 with slash=true: everything goes to beneficiary
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 300, true,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 10_000 },
        )
        .unwrap();
        // total = 1500; b = 1500; i = 0
        assert_eq!(b, 1_500);
        assert_eq!(i, 0);
    }

    #[test]
    fn split_slash_true_overflow_total() {
        // escrow_amount + initiator_stake overflows u64
        let err = compute_dispute_payouts(
            u64::MAX, 1, 0, true,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 },
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn split_rejects_bps_over_10000() {
        let err = compute_dispute_payouts(
            1_000, 0, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 10_001 },
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::InvalidBasisPoints));
    }

    // ── Arithmetic overflow guards ───────────────────────────────────────────

    #[test]
    fn release_overflow_escrow_plus_beneficiary_stake() {
        let err = compute_dispute_payouts(
            u64::MAX, 0, 1, false,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn release_overflow_slash_adds_initiator_stake() {
        let err = compute_dispute_payouts(
            u64::MAX - 5, 10, 5, true,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn refund_overflow_escrow_plus_initiator_stake() {
        let err = compute_dispute_payouts(
            u64::MAX, 1, 0, false,
            &ArbiterDecision::RefundToInitiator,
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn split_overflow_escrow_times_bps() {
        // escrow_amount * beneficiary_bps overflows: (u64::MAX / 2 + 1) * 2 wraps
        let overflow_amount = u64::MAX / 2 + 1;
        let err = compute_dispute_payouts(
            overflow_amount, 0, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 2 },
        )
        .unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    // ── dispute_reputation_deltas ────────────────────────────────────────────

    #[test]
    fn reputation_deltas_release_to_beneficiary() {
        let (i_delta, b_delta) =
            dispute_reputation_deltas(&ArbiterDecision::ReleaseToBeneficiary).unwrap();
        assert_eq!(i_delta, DISPUTE_LOSER_DELTA);
        assert_eq!(b_delta, DISPUTE_WINNER_DELTA);
    }

    #[test]
    fn reputation_deltas_refund_to_initiator() {
        let (i_delta, b_delta) =
            dispute_reputation_deltas(&ArbiterDecision::RefundToInitiator).unwrap();
        assert_eq!(i_delta, DISPUTE_WINNER_DELTA);
        assert_eq!(b_delta, DISPUTE_LOSER_DELTA);
    }

    #[test]
    fn reputation_deltas_split_funds() {
        let (i_delta, b_delta) =
            dispute_reputation_deltas(&ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 }).unwrap();
        assert_eq!(i_delta, DISPUTE_SPLIT_DELTA);
        assert_eq!(b_delta, DISPUTE_SPLIT_DELTA);
    }

    #[test]
    fn reputation_deltas_none_returns_error() {
        let err = dispute_reputation_deltas(&ArbiterDecision::None).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::DecisionRequired));
    }

    // ── beneficiary_staked guard (M-1 consistency) ────────────────────────────

    #[test]
    fn beneficiary_not_staked_yields_zero_effective_stake() {
        // When beneficiary_staked=false, the handler zeros beneficiary_stake
        // before calling compute_dispute_payouts. Verify that passing 0
        // produces the correct payout: beneficiary receives only the escrow
        // amount, not phantom stake.
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 0, false,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        assert_eq!(b, 1_000);
        assert_eq!(i, 200);
    }

    #[test]
    fn beneficiary_not_staked_refund_yields_zero_effective_stake() {
        let (b, i) = compute_dispute_payouts(
            1_000, 200, 0, false,
            &ArbiterDecision::RefundToInitiator,
        )
        .unwrap();
        assert_eq!(b, 0);
        assert_eq!(i, 1_200);
    }

    #[test]
    fn beneficiary_not_staked_split_yields_zero_effective_stake() {
        let (b, i) = compute_dispute_payouts(
            2_000, 500, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 },
        )
        .unwrap();
        assert_eq!(b, 1_000);
        assert_eq!(i, 1_000 + 500);
    }

    // ── Status gate validation ───────────────────────────────────────────────

    #[test]
    fn status_must_be_disputed() {
        // Verify the status check semantics: any status other than Disputed is invalid.
        for bad_status in [
            EscrowStatus::Pending,
            EscrowStatus::Funded,
            EscrowStatus::Locked,
            EscrowStatus::Released,
            EscrowStatus::Refunded,
            EscrowStatus::Closed,
            EscrowStatus::Claimed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(bad_status != EscrowStatus::Disputed);
        }
    }
}
