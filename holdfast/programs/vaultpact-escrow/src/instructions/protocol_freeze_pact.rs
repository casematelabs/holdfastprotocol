use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi_helpers::cpi_update_reputation;
use crate::errors::EscrowError;
use crate::state::*;

/// Determines the freeze decision based on which parties are blacklisted.
pub(crate) fn determine_freeze_decision(
    initiator_blacklisted: bool,
    beneficiary_blacklisted: bool,
) -> ArbiterDecision {
    if initiator_blacklisted && beneficiary_blacklisted {
        ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 }
    } else if initiator_blacklisted {
        ArbiterDecision::ReleaseToBeneficiary
    } else {
        ArbiterDecision::RefundToInitiator
    }
}

/// Valid escrow statuses for a protocol freeze operation.
pub(crate) fn status_allows_freeze(status: &EscrowStatus) -> bool {
    matches!(
        status,
        EscrowStatus::Locked
            | EscrowStatus::Funded
            | EscrowStatus::Released
            | EscrowStatus::Disputed
    )
}

#[derive(Accounts)]
pub struct ProtocolFreezePact<'info> {
    #[account(mut)]
    pub protocol_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.escrow_id.as_ref()],
        bump = escrow.bump,
        has_one = vault,
    )]
    pub escrow: Box<Account<'info, EscrowAccount>>,

    #[account(
        seeds = [b"pact", escrow.escrow_id.as_ref()],
        bump = pact.bump,
        constraint = escrow.pact_record == pact.key() @ EscrowError::PactEscrowMismatch,
    )]
    pub pact: Box<Account<'info, PactRecord>>,

    #[account(
        init_if_needed,
        payer = protocol_authority,
        space = DisputeRecord::LEN,
        seeds = [b"dispute", escrow.escrow_id.as_ref()],
        bump,
    )]
    pub dispute_record: Box<Account<'info, DisputeRecord>>,

    // M-1: PDA seed constraints ensure the caller cannot supply an arbitrary AgentWallet
    // that passes status checks — only a wallet at the correct PDA (bound to its own
    // secp256r1 coordinates in the vaultpact program) is accepted.
    #[account(
        seeds = [b"agent_wallet", blacklisted_wallet.pubkey_x.as_ref(), blacklisted_wallet.pubkey_y.as_ref()],
        bump = blacklisted_wallet.bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub blacklisted_wallet: Account<'info, vaultpact::AgentWallet>,

    #[account(
        seeds = [b"agent_wallet", second_blacklisted_wallet.pubkey_x.as_ref(), second_blacklisted_wallet.pubkey_y.as_ref()],
        bump = second_blacklisted_wallet.bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub second_blacklisted_wallet: Option<Account<'info, vaultpact::AgentWallet>>,

    #[account(constraint = attestation_registry.authority == protocol_authority.key()
        @ EscrowError::UnauthorizedProtocolAuthority)]
    pub attestation_registry: Account<'info, vaultpact::AttestationRegistry>,

    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = beneficiary_token_account.owner == escrow.beneficiary
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = beneficiary_token_account.mint == escrow.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub beneficiary_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = initiator_token_account.owner == escrow.initiator
            @ EscrowError::UnauthorizedTokenAccount,
        constraint = initiator_token_account.mint == escrow.mint
            @ EscrowError::UnauthorizedTokenAccount,
    )]
    pub initiator_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,

    // ── Reputation CPI accounts ───────────────────────────────────────────
    #[account(
        mut,
        seeds = [b"reputation", escrow.initiator.as_ref()],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub initiator_reputation: Box<Account<'info, vaultpact::ReputationAccount>>,

    #[account(
        mut,
        seeds = [b"reputation", escrow.beneficiary.as_ref()],
        bump,
        seeds::program = vaultpact_program.key(),
    )]
    pub beneficiary_reputation: Box<Account<'info, vaultpact::ReputationAccount>>,

    /// CHECK: Virtual PDA signer for update_reputation CPIs.
    #[account(seeds = [b"vp_escrow_authority"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub vaultpact_program: Program<'info, vaultpact::program::Vaultpact>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct PactFrozenByProtocol {
    pub escrow: Pubkey,
    pub blacklisted_wallet: Pubkey,
    pub decision: u8,
    pub timestamp: i64,
}

pub fn handler(ctx: Context<ProtocolFreezePact>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let pact = &ctx.accounts.pact;
    let wallet = &ctx.accounts.blacklisted_wallet;

    require!(status_allows_freeze(&escrow.status), EscrowError::InvalidStatus);

    require!(wallet.status == crate::AGENT_STATUS_BLACKLISTED, EscrowError::AgentNotBlacklisted);

    let wallet_authority = wallet.authority;
    let initiator_blacklisted = wallet_authority == escrow.initiator;
    let beneficiary_blacklisted = wallet_authority == escrow.beneficiary;

    require!(
        initiator_blacklisted || beneficiary_blacklisted,
        EscrowError::WalletNotPactParty
    );

    let (initiator_blacklisted, beneficiary_blacklisted) =
        if let Some(second_wallet) = &ctx.accounts.second_blacklisted_wallet {
            require!(second_wallet.status == crate::AGENT_STATUS_BLACKLISTED, EscrowError::AgentNotBlacklisted);
            let second_authority = second_wallet.authority;
            require!(
                second_authority != wallet_authority,
                EscrowError::DuplicateParticipants
            );
            let second_is_initiator = second_authority == escrow.initiator;
            let second_is_beneficiary = second_authority == escrow.beneficiary;
            require!(
                second_is_initiator || second_is_beneficiary,
                EscrowError::WalletNotPactParty
            );
            (
                initiator_blacklisted || second_is_initiator,
                beneficiary_blacklisted || second_is_beneficiary,
            )
        } else {
            (initiator_blacklisted, beneficiary_blacklisted)
        };

    let now = Clock::get()?.unix_timestamp;

    let decision = determine_freeze_decision(initiator_blacklisted, beneficiary_blacklisted);

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

    let (beneficiary_payout, initiator_payout) =
        crate::instructions::resolve_dispute::compute_dispute_payouts(
            escrow_amount, initiator_stake, beneficiary_stake, slash, &decision,
        )?;

    let decision_code = match &decision {
        ArbiterDecision::ReleaseToBeneficiary => 1u8,
        ArbiterDecision::RefundToInitiator => 2,
        ArbiterDecision::SplitFunds { .. } => 3,
        ArbiterDecision::None => 0,
    };
    let (i_delta, b_delta) =
        crate::instructions::resolve_dispute::dispute_reputation_deltas(&decision)?;

    // CEI: update state BEFORE transfers
    let escrow_key = ctx.accounts.escrow.key();
    let pact_key = ctx.accounts.pact.key();
    let authority_key = ctx.accounts.protocol_authority.key();

    {
        let escrow = &mut ctx.accounts.escrow;
        match &decision {
            ArbiterDecision::RefundToInitiator => escrow.status = EscrowStatus::Refunded,
            _ => escrow.status = EscrowStatus::Claimed,
        }
        escrow.resolved_at = now;
    }

    let dispute = &mut ctx.accounts.dispute_record;
    let freshly_created = dispute.created_at == 0;

    if freshly_created {
        dispute.bump = ctx.bumps.dispute_record;
        dispute.dispute_id = escrow_id;
        dispute.escrow = escrow_key;
        dispute.pact = pact_key;
        dispute.raised_by = authority_key;
        dispute.evidence_hash = [0u8; 32];
        dispute.evidence_uri = [0u8; 128];
        dispute.resolution_deadline = now;
        dispute.created_at = now;
    }

    dispute.arbiter_decision = decision;
    dispute.arbiter_reasoning_hash = [0u8; 32];
    dispute.resolved_at = now;

    // Interactions: transfer payouts from vault
    let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", escrow_id.as_ref(), &[bump]]];

    if beneficiary_payout > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.beneficiary_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
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
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, initiator_payout)?;
    }

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

    emit!(PactFrozenByProtocol {
        escrow: escrow_key,
        blacklisted_wallet: wallet_authority,
        decision: decision_code,
        timestamp: now,
    });

    msg!("Protocol freeze: escrow frozen and funds transferred, decision={}", decision_code);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── determine_freeze_decision ────────────────────────────────────────────

    #[test]
    fn both_blacklisted_yields_split_5050() {
        let decision = determine_freeze_decision(true, true);
        assert_eq!(decision, ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 });
    }

    #[test]
    fn only_initiator_blacklisted_releases_to_beneficiary() {
        let decision = determine_freeze_decision(true, false);
        assert_eq!(decision, ArbiterDecision::ReleaseToBeneficiary);
    }

    #[test]
    fn only_beneficiary_blacklisted_refunds_to_initiator() {
        let decision = determine_freeze_decision(false, true);
        assert_eq!(decision, ArbiterDecision::RefundToInitiator);
    }

    // ── status_allows_freeze ─────────────────────────────────────────────────

    #[test]
    fn freeze_allowed_in_locked_funded_released_disputed() {
        assert!(status_allows_freeze(&EscrowStatus::Locked));
        assert!(status_allows_freeze(&EscrowStatus::Funded));
        assert!(status_allows_freeze(&EscrowStatus::Released));
        assert!(status_allows_freeze(&EscrowStatus::Disputed));
    }

    #[test]
    fn freeze_blocked_in_terminal_and_pending_states() {
        assert!(!status_allows_freeze(&EscrowStatus::Pending));
        assert!(!status_allows_freeze(&EscrowStatus::Refunded));
        assert!(!status_allows_freeze(&EscrowStatus::Claimed));
        assert!(!status_allows_freeze(&EscrowStatus::Closed));
        assert!(!status_allows_freeze(&EscrowStatus::MutuallyCancelled));
    }

    // ── decision_code mapping ────────────────────────────────────────────────

    #[test]
    fn decision_code_release_is_1() {
        let decision = ArbiterDecision::ReleaseToBeneficiary;
        let code = match &decision {
            ArbiterDecision::ReleaseToBeneficiary => 1u8,
            ArbiterDecision::RefundToInitiator => 2,
            ArbiterDecision::SplitFunds { .. } => 3,
            ArbiterDecision::None => 0,
        };
        assert_eq!(code, 1);
    }

    #[test]
    fn decision_code_refund_is_2() {
        let decision = ArbiterDecision::RefundToInitiator;
        let code = match &decision {
            ArbiterDecision::ReleaseToBeneficiary => 1u8,
            ArbiterDecision::RefundToInitiator => 2,
            ArbiterDecision::SplitFunds { .. } => 3,
            ArbiterDecision::None => 0,
        };
        assert_eq!(code, 2);
    }

    #[test]
    fn decision_code_split_is_3() {
        let decision = ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 };
        let code = match &decision {
            ArbiterDecision::ReleaseToBeneficiary => 1u8,
            ArbiterDecision::RefundToInitiator => 2,
            ArbiterDecision::SplitFunds { .. } => 3,
            ArbiterDecision::None => 0,
        };
        assert_eq!(code, 3);
    }

    // ── split payout via shared helper (5000 bps = 50/50) ───────────────────

    #[test]
    fn freeze_split_payout_both_blacklisted() {
        use crate::instructions::resolve_dispute::compute_dispute_payouts;
        let (b, i) = compute_dispute_payouts(
            2_000, 0, 0, false,
            &ArbiterDecision::SplitFunds { beneficiary_bps: 5_000 },
        )
        .unwrap();
        assert_eq!(b, 1_000);
        assert_eq!(i, 1_000);
    }

    #[test]
    fn freeze_release_payout_slash_enabled() {
        use crate::instructions::resolve_dispute::compute_dispute_payouts;
        let (b, i) = compute_dispute_payouts(
            1_000, 500, 300, true,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        // b = 1000 + 300 + 500 (slashed) = 1800; i = 0
        assert_eq!(b, 1_800);
        assert_eq!(i, 0);
    }

    // ── M-1: un-staked beneficiary yields zero beneficiary_stake ────────────

    #[test]
    fn unstaked_beneficiary_gets_zero_stake_in_payout() {
        use crate::instructions::resolve_dispute::compute_dispute_payouts;
        let beneficiary_staked = false;
        let recorded_stake = 500u64;
        let effective_stake = if beneficiary_staked { recorded_stake } else { 0 };
        let (b, i) = compute_dispute_payouts(
            1_000, 200, effective_stake, true,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        assert_eq!(b, 1_200);
        assert_eq!(i, 0);
    }

    #[test]
    fn staked_beneficiary_includes_stake_in_payout() {
        use crate::instructions::resolve_dispute::compute_dispute_payouts;
        let beneficiary_staked = true;
        let recorded_stake = 500u64;
        let effective_stake = if beneficiary_staked { recorded_stake } else { 0 };
        let (b, i) = compute_dispute_payouts(
            1_000, 200, effective_stake, true,
            &ArbiterDecision::ReleaseToBeneficiary,
        )
        .unwrap();
        assert_eq!(b, 1_700);
        assert_eq!(i, 0);
    }
}
