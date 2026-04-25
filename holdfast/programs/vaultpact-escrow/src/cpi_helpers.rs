use anchor_lang::prelude::*;

use crate::errors::EscrowError;

pub fn cpi_validate_reputation<'info>(
    program: &AccountInfo<'info>,
    reputation_account: &AccountInfo<'info>,
    expected_agent: &Pubkey,
    min_score: u64,
    min_tier: u8,
    min_pacts: u64,
) -> Result<()> {
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[b"reputation", expected_agent.as_ref()],
        program.key,
    );
    require!(
        reputation_account.key() == expected_pda,
        EscrowError::ReputationAccountMismatch
    );

    let tier = match min_tier {
        0 => vaultpact::VerifTier::Unverified,
        1 => vaultpact::VerifTier::Attested,
        2 => vaultpact::VerifTier::Hardline,
        _ => return Err(error!(EscrowError::InvalidVerifTier)),
    };
    let cpi_accounts = vaultpact::cpi::accounts::ValidateReputationAccounts {
        reputation_account: reputation_account.clone(),
    };
    let cpi_ctx = CpiContext::new(program.clone(), cpi_accounts);
    vaultpact::cpi::validate_reputation_for_pact(
        cpi_ctx,
        min_score,
        tier,
        min_pacts,
    )
}

/// CPI to vaultpact::update_reputation, signed by the VAULTPACT_ESCROW_AUTHORITY PDA.
///
/// The escrow program owns the PDA at seeds = [b"vp_escrow_authority"]; Solana allows it
/// to sign for that PDA in CPIs via the signer_seeds mechanism.
pub fn cpi_update_reputation<'info>(
    vaultpact_program: &AccountInfo<'info>,
    reputation_account: &AccountInfo<'info>,
    escrow_authority: &AccountInfo<'info>,
    escrow_authority_bump: u8,
    incoming_nonce: u64,
    outcome: vaultpact::PactOutcome,
    score_delta: i16,
    pact_id: [u8; 7],
) -> Result<()> {
    let cpi_accounts = vaultpact::cpi::accounts::UpdateReputation {
        reputation_account: reputation_account.clone(),
        update_authority: escrow_authority.clone(),
    };
    let seeds: &[&[u8]] = &[b"vp_escrow_authority", &[escrow_authority_bump]];
    let signer_seeds = &[seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        vaultpact_program.clone(),
        cpi_accounts,
        signer_seeds,
    );
    vaultpact::cpi::update_reputation(cpi_ctx, incoming_nonce, outcome, score_delta, pact_id)
}
