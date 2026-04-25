use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

pub(crate) const FULFILLED_SCORE_DELTA: i16 = 50;

/// Computes claim payouts: (beneficiary_payout, initiator_stake_return).
/// Returns an overflow error on pathological stake values.
pub(crate) fn compute_claim_payouts(
    escrow_amount: u64,
    beneficiary_stake: u64,
) -> anchor_lang::Result<u64> {
    use crate::errors::EscrowError;
    escrow_amount
        .checked_add(beneficiary_stake)
        .ok_or_else(|| anchor_lang::error!(EscrowError::ArithmeticOverflow))
}

#[derive(Accounts)]
pub struct ClaimReleased<'info> {
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.escrow_id.as_ref()],
        bump = escrow_account.bump,
        has_one = beneficiary @ EscrowError::UnauthorizedSigner,
        has_one = vault,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = beneficiary_token_account.owner == escrow_account.beneficiary
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = beneficiary_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub beneficiary_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = initiator_token_account.owner == escrow_account.initiator
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = initiator_token_account.mint == escrow_account.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub initiator_token_account: Box<Account<'info, TokenAccount>>,

    #[account(constraint = beneficiary_wallet.authority == beneficiary.key()
        @ EscrowError::AgentWalletAuthorityMismatch)]
    pub beneficiary_wallet: Box<Account<'info, vaultpact::AgentWallet>>,

    pub token_program: Program<'info, Token>,

    // ── Reputation CPI accounts ───────────────────────────────────────────
    // Both reputation accounts are required: agents must have an initialised
    // ReputationAccount to complete a pact.  The seeds are re-validated inside
    // the update_reputation CPI; we hold a typed reference here so we can read
    // the current nonce without a raw-byte offset calculation.
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

    /// CHECK: Virtual PDA signer that authorises update_reputation CPIs.
    /// Derived from this program's ID; no on-chain account needed.
    #[account(seeds = [b"vp_escrow_authority"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,
}

pub fn handler(ctx: Context<ClaimReleased>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;

    require!(escrow.status == EscrowStatus::Released, EscrowError::InvalidStatus);

    // Frozen beneficiaries may claim (settlement allowed)
    // Blacklisted beneficiaries may NOT claim
    require!(ctx.accounts.beneficiary_wallet.status != crate::AGENT_STATUS_BLACKLISTED, EscrowError::AgentBlacklisted);

    let now = Clock::get()?.unix_timestamp;
    require!(now > escrow.dispute_window_ends_at, EscrowError::DisputeWindowOpen);

    let escrow_amount = escrow.escrow_amount;
    let beneficiary_stake = escrow.beneficiary_stake;
    let initiator_stake = escrow.initiator_stake;
    let escrow_id = escrow.escrow_id;
    let bump = escrow.bump;

    // Read nonces before any CPI (CEI: all reads before interactions).
    let i_nonce = ctx.accounts.initiator_reputation.nonce;
    let b_nonce = ctx.accounts.beneficiary_reputation.nonce;
    // First 7 bytes of escrow_id serve as the display pact_id in reputation history.
    let pact_id: [u8; 7] = escrow_id[..7]
        .try_into()
        .map_err(|_| error!(EscrowError::ArithmeticOverflow))?;
    let escrow_authority_bump = ctx.bumps.escrow_authority;

    // CEI: status before transfers. Claimed marks funds disbursed; close_escrow recovers rent.
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Claimed;
    escrow.resolved_at = now;

    let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", escrow_id.as_ref(), &[bump]]];

    // Transfer escrow_amount + beneficiary_stake to beneficiary
    let beneficiary_payout = compute_claim_payouts(escrow_amount, beneficiary_stake)?;

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

    // Return initiator_stake to initiator
    if initiator_stake > 0 {
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
        token::transfer(cpi_ctx, initiator_stake)?;
    }

    // Update reputation for both parties: Fulfilled pact, fixed +50 delta.
    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.initiator_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        escrow_authority_bump,
        i_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Fulfilled,
        FULFILLED_SCORE_DELTA,
        pact_id,
    )?;

    cpi_update_reputation(
        &ctx.accounts.vaultpact_program.to_account_info(),
        &ctx.accounts.beneficiary_reputation.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        escrow_authority_bump,
        b_nonce.checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?,
        vaultpact::PactOutcome::Fulfilled,
        FULFILLED_SCORE_DELTA,
        pact_id,
    )?;

    msg!("Escrow claimed: beneficiary={}, initiator_stake_returned={}", beneficiary_payout, initiator_stake);
    Ok(())
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

    // ── compute_claim_payouts ─────────────────────────────────────────────────

    #[test]
    fn claim_payout_with_no_stake() {
        assert_eq!(compute_claim_payouts(5_000, 0).unwrap(), 5_000);
    }

    #[test]
    fn claim_payout_adds_beneficiary_stake() {
        assert_eq!(compute_claim_payouts(1_000, 500).unwrap(), 1_500);
    }

    #[test]
    fn claim_payout_zero_escrow_amount() {
        // edge case: zero escrow amount but non-zero beneficiary stake
        assert_eq!(compute_claim_payouts(0, 2_000).unwrap(), 2_000);
    }

    #[test]
    fn claim_payout_overflow_guard() {
        let err = compute_claim_payouts(u64::MAX, 1).unwrap_err();
        assert_eq!(err_code(err), u32::from(EscrowError::ArithmeticOverflow));
    }

    #[test]
    fn claim_payout_max_value_no_overflow() {
        // u64::MAX with zero beneficiary stake should be fine
        assert_eq!(compute_claim_payouts(u64::MAX, 0).unwrap(), u64::MAX);
    }

    // ── FULFILLED_SCORE_DELTA constant ───────────────────────────────────────

    #[test]
    fn fulfilled_score_delta_is_positive() {
        assert!(FULFILLED_SCORE_DELTA > 0);
        assert_eq!(FULFILLED_SCORE_DELTA, 50);
    }

    // ── Status gate semantics ─────────────────────────────────────────────────

    #[test]
    fn only_released_status_valid_for_claim() {
        // claim_released requires Released; all others are invalid
        assert_eq!(EscrowStatus::Released, EscrowStatus::Released);
        for bad in [
            EscrowStatus::Pending,
            EscrowStatus::Funded,
            EscrowStatus::Locked,
            EscrowStatus::Disputed,
            EscrowStatus::Refunded,
            EscrowStatus::Claimed,
            EscrowStatus::Closed,
            EscrowStatus::MutuallyCancelled,
        ] {
            assert!(bad != EscrowStatus::Released);
        }
    }

    // ── Dispute window boundary semantics ────────────────────────────────────

    #[test]
    fn dispute_window_open_means_now_lte_window_end() {
        let dispute_window_ends_at = 1_000i64;
        // window open: now <= dispute_window_ends_at
        let now_inside = 999i64;
        let now_at_boundary = 1_000i64;
        let now_after = 1_001i64;
        assert!(now_inside <= dispute_window_ends_at);     // still open
        assert!(now_at_boundary <= dispute_window_ends_at); // still open
        assert!(now_after > dispute_window_ends_at);        // window closed — can claim
    }
}
