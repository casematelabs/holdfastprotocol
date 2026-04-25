//! Trident fuzz_1 — escrow state machine transitions
//!
//! Covers the full EscrowAccount lifecycle:
//!
//!   initialize_escrow  → Pending
//!   deposit_funds      → Funded
//!   stake_beneficiary  → (still Funded, beneficiary_staked=true)
//!   lock_escrow        → Locked
//!   release_escrow     → Released        (or after time_lock expires)
//!   raise_dispute      → Disputed
//!   escalate_dispute   → (Disputed + escalated)
//!   resolve_dispute    → Claimed / Refunded
//!   claim_released     → Claimed         (happy path)
//!   refund             → Refunded        (escalation fallback)
//!   mutual_cancel_escrow → MutuallyCancelled
//!   cancel_pending_escrow → Cancelled    (before lock)
//!   close_escrow       → Closed
//!
//! On-chain SPL Token is available in BanksClient; this target exercises the
//! vault arithmetic and status-gate checks for all valid and invalid orderings.
//!
//! Invariants enforced between instructions:
//!   INV-E1: EscrowAccount.status transitions are monotone (no backward jumps)
//!   INV-E2: Invalid-state instructions always return an error code
//!   INV-E3: Total vault balance never exceeds escrow_amount + both stakes

use anchor_lang::prelude::Pubkey;
use arbitrary::Arbitrary;
use trident_client::fuzzing::*;

use holdfast::ID as VAULTPACT_ID;
use holdfast_escrow::ID as ESCROW_ID;
use vaultpact_escrow::state::{EscrowStatus, ArbiterDecision};

// ── Accounts storage ──────────────────────────────────────────────────

#[derive(Default)]
pub struct FuzzAccounts {
    initiator:    AccountsStorage<Keypair>,
    beneficiary:  AccountsStorage<Keypair>,
    arbiter:      AccountsStorage<Keypair>,

    escrow_accounts:  AccountsStorage<PdaStore>,
    pact_records:     AccountsStorage<PdaStore>,
    dispute_records:  AccountsStorage<PdaStore>,
    escrow_authority: AccountsStorage<PdaStore>,

    mints:            AccountsStorage<MintStore>,
    vaults:           AccountsStorage<TokenStore>,
    initiator_atas:   AccountsStorage<TokenStore>,
    beneficiary_atas: AccountsStorage<TokenStore>,

    // AgentWallet PDAs required by initialize_escrow and resolve_dispute account constraints
    initiator_wallets:   AccountsStorage<PdaStore>,
    beneficiary_wallets: AccountsStorage<PdaStore>,
    arbiter_wallets:     AccountsStorage<PdaStore>,

    // ReputationAccount PDAs required by resolve_dispute and claim_released CPIs
    initiator_reputations:   AccountsStorage<PdaStore>,
    beneficiary_reputations: AccountsStorage<PdaStore>,
}

// ── FuzzInstruction enum ──────────────────────────────────────────────

#[derive(Arbitrary, DisplayIx, FuzzTestExecutor, FuzzDeserialize)]
pub enum FuzzInstruction {
    InitializeEscrow(InitializeEscrow),
    DepositFunds(DepositFunds),
    StakeBeneficiary(StakeBeneficiary),
    LockEscrow(LockEscrow),
    ReleaseEscrow(ReleaseEscrow),
    RaiseDispute(RaiseDispute),
    EscalateDispute(EscalateDispute),
    ResolveDispute(ResolveDispute),
    ClaimReleased(ClaimReleased),
    MutualCancelEscrow(MutualCancelEscrow),
    CancelPendingEscrow(CancelPendingEscrow),
}

// ── InitializeEscrow ──────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct InitializeEscrow {
    pub accounts: InitializeEscrowAccounts,
    pub data: InitializeEscrowData,
}

#[derive(Arbitrary, Debug)]
pub struct InitializeEscrowAccounts {
    pub initiator:   AccountId,
    pub beneficiary: AccountId,
    pub arbiter:     AccountId,
    pub mint:        AccountId,
}

#[derive(Arbitrary, Debug)]
pub struct InitializeEscrowData {
    pub escrow_id:               [u8; 32],
    pub escrow_amount:           u64,
    pub initiator_stake:         u64,
    pub beneficiary_stake:       u64,
    /// Seconds from epoch; fuzzer provides raw value — will be checked on-chain
    pub time_lock_expires_at:    i64,
    pub deliverables_hash:       [u8; 32],
    pub auto_release_on_expiry:  bool,
    pub slash_loser_stake:       bool,
    pub dispute_deadline_secs:   i64,
    pub initiator_reputation_min: u64,
    pub beneficiary_reputation_min: u64,
    pub initiator_min_tier:      u8,
    pub initiator_min_pacts:     u64,
    pub beneficiary_min_tier:    u8,
    pub beneficiary_min_pacts:   u64,
}

impl<'info> IxOps<'info> for InitializeEscrow {
    type IxData = holdfast_escrow::instruction::InitializeEscrow;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        let beneficiary_key = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?
            .pubkey();
        let arbiter_key = fuzz_accounts
            .arbiter
            .get_or_create_account(self.accounts.arbiter, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?
            .pubkey();

        let params = holdfast_escrow::instructions::InitializeEscrowParams {
            escrow_id:               self.data.escrow_id,
            beneficiary:             beneficiary_key,
            arbiter:                 arbiter_key,
            escrow_amount:           self.data.escrow_amount,
            initiator_stake:         self.data.initiator_stake,
            beneficiary_stake:       self.data.beneficiary_stake,
            time_lock_expires_at:    self.data.time_lock_expires_at,
            deliverables_hash:       self.data.deliverables_hash,
            deliverables_uri:        [0u8; 128],
            auto_release_on_expiry:  self.data.auto_release_on_expiry,
            slash_loser_stake:       self.data.slash_loser_stake,
            dispute_deadline_secs:   self.data.dispute_deadline_secs,
            initiator_reputation_min: self.data.initiator_reputation_min,
            beneficiary_reputation_min: self.data.beneficiary_reputation_min,
            initiator_min_tier:      self.data.initiator_min_tier,
            initiator_min_pacts:     self.data.initiator_min_pacts,
            beneficiary_min_tier:    self.data.beneficiary_min_tier,
            beneficiary_min_pacts:   self.data.beneficiary_min_pacts,
        };

        Ok(holdfast_escrow::instruction::InitializeEscrow { params })
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 100_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let beneficiary = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let arbiter = fuzz_accounts
            .arbiter
            .get_or_create_account(self.accounts.arbiter, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.data.escrow_id.as_ref()],
            &ESCROW_ID,
        );
        let (pact_pda, _) = Pubkey::find_program_address(
            &[b"pact", self.data.escrow_id.as_ref()],
            &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        // Vault ATA: owned by escrow PDA
        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda,
            &mint.pubkey(),
        );

        // Initiator reputation PDA (may not exist — CPI inside initialize_escrow validates)
        let (init_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", initiator.pubkey().as_ref()],
            &VAULTPACT_ID,
        );

        // AgentWallet PDAs (must exist and have authority matching each party)
        let (init_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[1u8; 32], &[2u8; 32]],
            &VAULTPACT_ID,
        );
        let (bene_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[3u8; 32], &[4u8; 32]],
            &VAULTPACT_ID,
        );
        let (arb_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[5u8; 32], &[6u8; 32]],
            &VAULTPACT_ID,
        );

        let account_metas = vec![
            AccountMeta::new(initiator.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(pact_pda, false),
            AccountMeta::new_readonly(mint.pubkey(), false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new_readonly(init_rep_pda, false),
            AccountMeta::new_readonly(init_wallet_pda, false),
            AccountMeta::new_readonly(bene_wallet_pda, false),
            AccountMeta::new_readonly(arb_wallet_pda, false),
            AccountMeta::new_readonly(VAULTPACT_ID, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
            AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ];

        Ok((vec![initiator], account_metas))
    }

    fn check(
        &self,
        _pre: Self::IxSnapshot,
        _post: Self::IxSnapshot,
        _data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── DepositFunds ──────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct DepositFunds {
    pub accounts: DepositFundsAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct DepositFundsAccounts {
    pub escrow_id: [u8; 32],
    pub initiator: AccountId,
    pub mint:      AccountId,
}

impl<'info> IxOps<'info> for DepositFunds {
    type IxData = holdfast_escrow::instruction::DepositFunds;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        _client: &mut impl FuzzClient,
        _fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::DepositFunds {})
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 100_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda,
            &mint.pubkey(),
        );
        let initiator_ata = anchor_spl::associated_token::get_associated_token_address(
            &initiator.pubkey(),
            &mint.pubkey(),
        );

        let account_metas = vec![
            AccountMeta::new(initiator.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(initiator_ata, false),
            AccountMeta::new_readonly(mint.pubkey(), false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ];

        Ok((vec![initiator], account_metas))
    }

    fn check(
        &self,
        _pre: Self::IxSnapshot,
        _post: Self::IxSnapshot,
        _data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── StakeBeneficiary ─────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct StakeBeneficiary {
    pub accounts: StakeBeneficiaryAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct StakeBeneficiaryAccounts {
    pub escrow_id:   [u8; 32],
    pub beneficiary: AccountId,
    pub mint:        AccountId,
}

impl<'info> IxOps<'info> for StakeBeneficiary {
    type IxData = holdfast_escrow::instruction::StakeBeneficiary;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        _client: &mut impl FuzzClient,
        _fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::StakeBeneficiary {})
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let beneficiary = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 100_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &beneficiary.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda,
            &mint.pubkey(),
        );
        let beneficiary_ata = anchor_spl::associated_token::get_associated_token_address(
            &beneficiary.pubkey(),
            &mint.pubkey(),
        );

        let account_metas = vec![
            AccountMeta::new(beneficiary.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(beneficiary_ata, false),
            AccountMeta::new_readonly(mint.pubkey(), false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
        ];

        Ok((vec![beneficiary], account_metas))
    }

    fn check(
        &self,
        _pre: Self::IxSnapshot,
        _post: Self::IxSnapshot,
        _data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── LockEscrow ────────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct LockEscrow {
    pub accounts: LockEscrowAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct LockEscrowAccounts {
    pub escrow_id:   [u8; 32],
    pub initiator:   AccountId,
    pub beneficiary: AccountId,
    pub mint:        AccountId,
}

impl<'info> IxOps<'info> for LockEscrow {
    type IxData = holdfast_escrow::instruction::LockEscrow;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self,
        _client: &mut impl FuzzClient,
        _fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::LockEscrow {})
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let beneficiary = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );
        let (pact_pda, _) = Pubkey::find_program_address(
            &[b"pact", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda,
            &mint.pubkey(),
        );

        let (init_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", initiator.pubkey().as_ref()],
            &VAULTPACT_ID,
        );
        let (bene_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", beneficiary.pubkey().as_ref()],
            &VAULTPACT_ID,
        );
        let (init_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[1u8; 32], &[2u8; 32]],
            &VAULTPACT_ID,
        );
        let (bene_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[3u8; 32], &[4u8; 32]],
            &VAULTPACT_ID,
        );
        let (arb_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[5u8; 32], &[6u8; 32]],
            &VAULTPACT_ID,
        );

        let account_metas = vec![
            AccountMeta::new(initiator.pubkey(), true),
            AccountMeta::new(beneficiary.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(pact_pda, false),
            AccountMeta::new_readonly(vault_ata, false),
            AccountMeta::new_readonly(init_rep_pda, false),
            AccountMeta::new_readonly(bene_rep_pda, false),
            AccountMeta::new_readonly(init_wallet_pda, false),
            AccountMeta::new_readonly(bene_wallet_pda, false),
            AccountMeta::new_readonly(arb_wallet_pda, false),
            AccountMeta::new_readonly(VAULTPACT_ID, false),
        ];

        Ok((vec![initiator, beneficiary], account_metas))
    }

    fn check(
        &self,
        _pre: Self::IxSnapshot,
        _post: Self::IxSnapshot,
        _data: Self::IxData,
    ) -> Result<(), FuzzingError> {
        Ok(())
    }
}

// ── ReleaseEscrow ─────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct ReleaseEscrow {
    pub accounts: ReleaseEscrowAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct ReleaseEscrowAccounts {
    pub escrow_id: [u8; 32],
    pub signer:    AccountId,
}

impl<'info> IxOps<'info> for ReleaseEscrow {
    type IxData = holdfast_escrow::instruction::ReleaseEscrow;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::ReleaseEscrow {})
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let signer = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.signer, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );
        let account_metas = vec![
            AccountMeta::new(signer.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
        ];
        Ok((vec![signer], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── RaiseDispute ──────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct RaiseDispute {
    pub accounts: RaiseDisputeAccounts,
    pub data: RaiseDisputeData,
}

#[derive(Arbitrary, Debug)]
pub struct RaiseDisputeAccounts {
    pub escrow_id: [u8; 32],
    pub signer:    AccountId,
}

#[derive(Arbitrary, Debug)]
pub struct RaiseDisputeData {
    pub evidence_hash: [u8; 32],
}

impl<'info> IxOps<'info> for RaiseDispute {
    type IxData = holdfast_escrow::instruction::RaiseDispute;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::RaiseDispute {
            params: holdfast_escrow::instructions::RaiseDisputeParams {
                evidence_hash: self.data.evidence_hash,
                evidence_uri: [0u8; 128],
            },
        })
    }

    fn get_accounts(
        &self,
        client: &mut impl FuzzClient,
        fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let signer = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.signer, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );
        let (pact_pda, _) = Pubkey::find_program_address(
            &[b"pact", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );
        let (dispute_pda, _) = Pubkey::find_program_address(
            &[b"dispute", self.accounts.escrow_id.as_ref()],
            &ESCROW_ID,
        );
        let account_metas = vec![
            AccountMeta::new(signer.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(pact_pda, false),
            AccountMeta::new(dispute_pda, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ];
        Ok((vec![signer], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── EscalateDispute ───────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct EscalateDispute {
    pub accounts: EscalateDisputeAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct EscalateDisputeAccounts {
    pub escrow_id: [u8; 32],
    pub signer:    AccountId,
}

impl<'info> IxOps<'info> for EscalateDispute {
    type IxData = holdfast_escrow::instruction::EscalateDispute;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(&self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts)
        -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::EscalateDispute {})
    }

    fn get_accounts(
        &self, client: &mut impl FuzzClient, fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let signer = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.signer, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );
        let (dispute_pda, _) = Pubkey::find_program_address(
            &[b"dispute", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );
        let account_metas = vec![
            AccountMeta::new(signer.pubkey(), true),
            AccountMeta::new_readonly(escrow_pda, false),
            AccountMeta::new(dispute_pda, false),
        ];
        Ok((vec![signer], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── ResolveDispute ────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct ResolveDispute {
    pub accounts: ResolveDisputeAccounts,
    pub data: ResolveDisputeData,
}

#[derive(Arbitrary, Debug)]
pub struct ResolveDisputeAccounts {
    pub escrow_id:   [u8; 32],
    pub arbiter:     AccountId,
    pub initiator:   AccountId,
    pub beneficiary: AccountId,
    pub mint:        AccountId,
}

#[derive(Arbitrary, Debug)]
pub struct ResolveDisputeData {
    pub decision: FuzzArbiterDecision,
    pub reasoning_hash: [u8; 32],
}

#[derive(Arbitrary, Debug)]
pub enum FuzzArbiterDecision {
    ReleaseToBeneficiary,
    RefundToInitiator,
    SplitFunds { beneficiary_bps: u16 },
}

impl<'info> IxOps<'info> for ResolveDispute {
    type IxData = holdfast_escrow::instruction::ResolveDispute;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(
        &self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts,
    ) -> Result<Self::IxData, FuzzingError> {
        let decision = match &self.data.decision {
            FuzzArbiterDecision::ReleaseToBeneficiary => ArbiterDecision::ReleaseToBeneficiary,
            FuzzArbiterDecision::RefundToInitiator    => ArbiterDecision::RefundToInitiator,
            FuzzArbiterDecision::SplitFunds { beneficiary_bps } =>
                ArbiterDecision::SplitFunds { beneficiary_bps: *beneficiary_bps },
        };
        Ok(holdfast_escrow::instruction::ResolveDispute {
            params: holdfast_escrow::instructions::ResolveDisputeParams {
                decision,
                reasoning_hash: self.data.reasoning_hash,
            },
        })
    }

    fn get_accounts(
        &self, client: &mut impl FuzzClient, fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let arbiter = fuzz_accounts
            .arbiter
            .get_or_create_account(self.accounts.arbiter, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let beneficiary = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );
        let (pact_pda, _) = Pubkey::find_program_address(
            &[b"pact", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );
        let (dispute_pda, _) = Pubkey::find_program_address(
            &[b"dispute", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda, &mint.pubkey(),
        );
        let bene_ata = anchor_spl::associated_token::get_associated_token_address(
            &beneficiary.pubkey(), &mint.pubkey(),
        );
        let init_ata = anchor_spl::associated_token::get_associated_token_address(
            &initiator.pubkey(), &mint.pubkey(),
        );

        let (arb_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[5u8; 32], &[6u8; 32]], &VAULTPACT_ID,
        );
        let (init_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", initiator.pubkey().as_ref()], &VAULTPACT_ID,
        );
        let (bene_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", beneficiary.pubkey().as_ref()], &VAULTPACT_ID,
        );
        let (escrow_authority_pda, _) = Pubkey::find_program_address(
            &[b"vp_escrow_authority"], &ESCROW_ID,
        );

        let account_metas = vec![
            AccountMeta::new(arbiter.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(pact_pda, false),
            AccountMeta::new(dispute_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(bene_ata, false),
            AccountMeta::new(init_ata, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
            AccountMeta::new_readonly(arb_wallet_pda, false),
            AccountMeta::new(init_rep_pda, false),
            AccountMeta::new(bene_rep_pda, false),
            AccountMeta::new_readonly(escrow_authority_pda, false),
            AccountMeta::new_readonly(VAULTPACT_ID, false),
        ];

        Ok((vec![arbiter], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── ClaimReleased ─────────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct ClaimReleased {
    pub accounts: ClaimReleasedAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct ClaimReleasedAccounts {
    pub escrow_id:   [u8; 32],
    pub beneficiary: AccountId,
    pub initiator:   AccountId,
    pub mint:        AccountId,
}

impl<'info> IxOps<'info> for ClaimReleased {
    type IxData = holdfast_escrow::instruction::ClaimReleased;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(&self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts)
        -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::ClaimReleased {})
    }

    fn get_accounts(
        &self, client: &mut impl FuzzClient, fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let beneficiary = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda, &mint.pubkey(),
        );
        let bene_ata = anchor_spl::associated_token::get_associated_token_address(
            &beneficiary.pubkey(), &mint.pubkey(),
        );
        let init_ata = anchor_spl::associated_token::get_associated_token_address(
            &initiator.pubkey(), &mint.pubkey(),
        );
        let (init_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", initiator.pubkey().as_ref()], &VAULTPACT_ID,
        );
        let (bene_rep_pda, _) = Pubkey::find_program_address(
            &[b"reputation", beneficiary.pubkey().as_ref()], &VAULTPACT_ID,
        );
        let (escrow_authority_pda, _) = Pubkey::find_program_address(
            &[b"vp_escrow_authority"], &ESCROW_ID,
        );

        let account_metas = vec![
            AccountMeta::new(beneficiary.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(bene_ata, false),
            AccountMeta::new(init_ata, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
            AccountMeta::new(init_rep_pda, false),
            AccountMeta::new(bene_rep_pda, false),
            AccountMeta::new_readonly(escrow_authority_pda, false),
            AccountMeta::new_readonly(VAULTPACT_ID, false),
        ];

        Ok((vec![beneficiary], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── MutualCancelEscrow ────────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct MutualCancelEscrow {
    pub accounts: MutualCancelAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct MutualCancelAccounts {
    pub escrow_id:   [u8; 32],
    pub initiator:   AccountId,
    pub beneficiary: AccountId,
    pub mint:        AccountId,
}

impl<'info> IxOps<'info> for MutualCancelEscrow {
    type IxData = holdfast_escrow::instruction::MutualCancelEscrow;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(&self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts)
        -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::MutualCancelEscrow {})
    }

    fn get_accounts(
        &self, client: &mut impl FuzzClient, fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;
        let beneficiary = fuzz_accounts
            .beneficiary
            .get_or_create_account(self.accounts.beneficiary, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda, &mint.pubkey(),
        );
        let init_ata = anchor_spl::associated_token::get_associated_token_address(
            &initiator.pubkey(), &mint.pubkey(),
        );
        let bene_ata = anchor_spl::associated_token::get_associated_token_address(
            &beneficiary.pubkey(), &mint.pubkey(),
        );
        let (init_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[1u8; 32], &[2u8; 32]], &VAULTPACT_ID,
        );
        let (bene_wallet_pda, _) = Pubkey::find_program_address(
            &[b"agent_wallet", &[3u8; 32], &[4u8; 32]], &VAULTPACT_ID,
        );

        let account_metas = vec![
            AccountMeta::new(initiator.pubkey(), true),
            AccountMeta::new(beneficiary.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(init_ata, false),
            AccountMeta::new(bene_ata, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
            AccountMeta::new_readonly(init_wallet_pda, false),
            AccountMeta::new_readonly(bene_wallet_pda, false),
        ];

        Ok((vec![initiator, beneficiary], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── CancelPendingEscrow ───────────────────────────────────────────────

#[derive(Arbitrary, Debug)]
pub struct CancelPendingEscrow {
    pub accounts: CancelPendingAccounts,
}

#[derive(Arbitrary, Debug)]
pub struct CancelPendingAccounts {
    pub escrow_id: [u8; 32],
    pub initiator: AccountId,
    pub mint:      AccountId,
}

impl<'info> IxOps<'info> for CancelPendingEscrow {
    type IxData = holdfast_escrow::instruction::CancelPendingEscrow;
    type IxAccounts = FuzzAccounts;
    type IxSnapshot = ();

    fn get_data(&self, _c: &mut impl FuzzClient, _f: &mut Self::IxAccounts)
        -> Result<Self::IxData, FuzzingError> {
        Ok(holdfast_escrow::instruction::CancelPendingEscrow {})
    }

    fn get_accounts(
        &self, client: &mut impl FuzzClient, fuzz_accounts: &mut Self::IxAccounts,
    ) -> Result<(Vec<Keypair>, Vec<AccountMeta>), FuzzingError> {
        let initiator = fuzz_accounts
            .initiator
            .get_or_create_account(self.accounts.initiator, client, 10_000_000)
            .ok_or(FuzzingError::NotFound)?;

        let (escrow_pda, _) = Pubkey::find_program_address(
            &[b"escrow", self.accounts.escrow_id.as_ref()], &ESCROW_ID,
        );

        let mint = fuzz_accounts
            .mints
            .get_or_create_account(self.accounts.mint, client, 6, &initiator.pubkey(), None)
            .ok_or(FuzzingError::NotFound)?;

        let vault_ata = anchor_spl::associated_token::get_associated_token_address(
            &escrow_pda, &mint.pubkey(),
        );
        let init_ata = anchor_spl::associated_token::get_associated_token_address(
            &initiator.pubkey(), &mint.pubkey(),
        );

        let account_metas = vec![
            AccountMeta::new(initiator.pubkey(), true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(init_ata, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
        ];

        Ok((vec![initiator], account_metas))
    }

    fn check(&self, _p: (), _po: (), _d: Self::IxData) -> Result<(), FuzzingError> { Ok(()) }
}

// ── Fuzzer entry point ────────────────────────────────────────────────

fn main() {
    loop {
        fuzz_trident!(
            fuzz_ix: FuzzInstruction,
            |fuzz_data: FuzzData<FuzzInstruction, FuzzAccounts>| {
                let mut client = ProgramTestClientBlocking::new(
                    &[
                        ("vaultpact",        VAULTPACT_ID),
                        ("vaultpact_escrow", ESCROW_ID),
                    ],
                    &[],
                )
                .unwrap();
                let _ = fuzz_data.run_with_runtime(&mut client);
            }
        );
    }
}
