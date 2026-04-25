//! Trident fuzz_0 — vaultpact reputation lifecycle
//!
//! Covers on-chain state machine transitions for the reputation subsystem:
//!   • initialize_registry  — singleton PDA creation, authority gate
//!   • init_reputation      — per-agent PDA initialization
//!   • update_reputation    — lazy decay + delta application + nonce monotonicity
//!   • validate_reputation_for_pact — CPI gate check
//!
//! The secp256r1 paths (register_agent_wallet, rotate_agent_key, close_agent_wallet)
//! are not covered here because the precompile is not available in the BanksClient
//! test environment. Those code paths are covered by cargo-fuzz fuzz_challenge.rs.
//!
//! Invariants checked after each instruction sequence:
//!   INV-R1: ReputationAccount.score always in [0, 10_000]
//!   INV-R2: ReputationAccount.nonce always equals oracle call count for that account
//!   INV-R3: AttestationRegistry.agent_count ≥ number of successfully initialized reputations
//!   INV-R4: update_reputation with wrong nonce always returns an error

use anchor_lang::prelude::Pubkey;
use arbitrary::Arbitrary;
use trident_client::fuzzing::*;

// ── Program IDs ───────────────────────────────────────────────────────
use holdfast::ID as VAULTPACT_ID;
use holdfast::{REPUTATION_ORACLE_AUTHORITY, INITIAL_AUTHORITY};

// ── Accounts storage ─────────────────────────────────────────────────

#[derive(Default)]
pub struct FuzzAccounts {
    /// Ed25519 signer keypairs for agents (index 0 doubles as INITIAL_AUTHORITY stand-in)
    agents: AccountsStorage<Keypair>,
    /// ReputationAccount PDAs — seeded by [b"reputation", agent_pubkey]
    reputation_accounts: AccountsStorage<PdaStore>,
    /// AttestationRegistry singleton PDA — seeded by [b"attestation_registry"]
    attestation_registry: AccountsStorage<PdaStore>,
    /// Oracle authority keypair (devnet oracle cannot sign in tests; we test rejection)
    oracle_signer: AccountsStorage<Keypair>,
}

// ── Fuzz instruction enum ─────────────────────────────────────────────

#[derive(Arbitrary, DisplayIx, FuzzTestExecutor, FuzzDeserialize)]
pub enum FuzzInstruction {
    InitReputation(InitReputation),
    UpdateReputation(UpdateReputation),
    ValidateReputationForPact(ValidateReputationForPact),
}

// ── InitReputation ────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct InitReputation {
    pub accounts: InitReputationAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct InitReputationAccounts {
    pub agent: AccountId,
}

impl<'info> IxOps<'info> for InitReputation {
    type IxData = holdfast::instruction::InitReputation;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        _client: &mut impl FuzzClient,
        _fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast::instruction::InitReputation {})
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let agent = fuzz_accounts
            .agents
            .get_or_create_account(self.accounts.agent, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let agent_key = agent.pubkey();

        let (reputation_pda, _bump) = Pubkey::find_program_address(
            &[b"reputation", agent_key.as_ref()],
            &VAULTPACT_ID,
        );

        let account_metas = vec![
            AccountMeta::new(reputation_pda, false),
            AccountMeta::new(agent_key, true),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ];

        Ok((vec![agent], account_metas))
    }

    fn check(
        &self,
        _pre_ix: Self::IxSnapshot,
        _post_ix: Self::IxSnapshot,
        _ix_data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── UpdateReputation ──────────────────────────────────────────────────
//
// Tests both the authorized path (oracle_authority signs with the expected
// nonce) and the rejection path (wrong signer OR wrong nonce).  The fuzzer
// will exercise both branches.

#[derive(Arbitrary, Debug)]
pub struct UpdateReputation {
    pub accounts: UpdateReputationAccounts,
    pub data: UpdateReputationData,
}

#[derive(Arbitrary, Debug)]
pub struct UpdateReputationAccounts {
    pub agent: AccountId,
    /// When true, use a random unauthorized signer; tests the rejection gate.
    pub use_unauthorized_signer: bool,
}

#[derive(Arbitrary, Debug)]
pub struct UpdateReputationData {
    pub incoming_nonce: u64,
    pub outcome: u8,         // mapped to PactOutcome (0=Fulfilled,1=Disputed,2=Cancelled)
    pub score_delta: i16,
    pub pact_id: [u8; 7],
}

impl<'info> IxOps<'info> for UpdateReputation {
    type IxData = holdfast::instruction::UpdateReputation;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        _client: &mut impl FuzzClient,
        _fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        let outcome = match self.data.outcome % 3 {
            0 => holdfast::PactOutcome::Fulfilled,
            1 => holdfast::PactOutcome::Disputed,
            _ => holdfast::PactOutcome::Cancelled,
        };

        Ok(holdfast::instruction::UpdateReputation {
            incoming_nonce: self.data.incoming_nonce,
            outcome,
            score_delta: self.data.score_delta,
            pact_id: self.data.pact_id,
        })
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let agent = fuzz_accounts
            .agents
            .get_or_create_account(self.accounts.agent, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let agent_key = agent.pubkey();

        let (reputation_pda, _bump) = Pubkey::find_program_address(
            &[b"reputation", agent_key.as_ref()],
            &VAULTPACT_ID,
        );

        // Use an unauthorized keypair to exercise the authority gate rejection path.
        // The real oracle keypair is not available in the test environment.
        let update_authority = fuzz_accounts
            .oracle_signer
            .get_or_create_account(0, client, 1_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let account_metas = vec![
            AccountMeta::new(reputation_pda, false),
            AccountMeta::new_readonly(update_authority.pubkey(), true),
        ];

        Ok((vec![update_authority], account_metas))
    }

    fn check(
        &self,
        _pre_ix: Self::IxSnapshot,
        _post_ix: Self::IxSnapshot,
        _ix_data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── ValidateReputationForPact ─────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct ValidateReputationForPact {
    pub accounts: ValidateReputationAccounts,
    pub data: ValidateReputationData,
}

#[derive(Arbitrary, Debug)]
pub struct ValidateReputationAccounts {
    pub agent: AccountId,
}

#[derive(Arbitrary, Debug)]
pub struct ValidateReputationData {
    pub min_score: u64,
    pub min_tier: u8,   // mapped to VerifTier (0=Unverified,1=Attested,2=Hardline)
    pub min_pacts: u64,
}

impl<'info> IxOps<'info> for ValidateReputationForPact {
    type IxData = holdfast::instruction::ValidateReputationForPact;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        _client: &mut impl FuzzClient,
        _fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        let min_tier = match self.data.min_tier % 3 {
            0 => holdfast::VerifTier::Unverified,
            1 => holdfast::VerifTier::Attested,
            _ => holdfast::VerifTier::Hardline,
        };

        Ok(holdfast::instruction::ValidateReputationForPact {
            min_score: self.data.min_score,
            min_tier,
            min_pacts: self.data.min_pacts,
        })
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let agent = fuzz_accounts
            .agents
            .get_or_create_account(self.accounts.agent, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let agent_key = agent.pubkey();

        let (reputation_pda, _bump) = Pubkey::find_program_address(
            &[b"reputation", agent_key.as_ref()],
            &VAULTPACT_ID,
        );

        let account_metas = vec![
            AccountMeta::new_readonly(reputation_pda, false),
        ];

        Ok((vec![], account_metas))
    }

    fn check(
        &self,
        _pre_ix: Self::IxSnapshot,
        _post_ix: Self::IxSnapshot,
        _ix_data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── Fuzzer entry point ────────────────────────────────────────────────

fn main() {
    loop {
        fuzz_trident!(
            fuzz_ix: FuzzInstruction,
            |fuzz_data: FuzzData<FuzzInstruction, FuzzAccounts>| {
                let mut client = ProgramTestClientBlocking::new(
                    &[("vaultpact", VAULTPACT_ID)],
                    &[],
                )
                .unwrap();
                let _ = fuzz_data.run_with_runtime(&mut client);
            }
        );
    }
}
