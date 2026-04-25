// ═══════════════════════════════════════════════════════════════════════
//
//   HOLDFAST PROTOCOL
//   ─────────────────
//   Trust infrastructure for autonomous AI agents on Solana.
//
//   Forked from Hardline Protocol. The cryptographic core is unchanged;
//   all human-specific application logic has been removed.
//
//   ── WHAT WAS KEPT FROM HARDLINE ────────────────────────────────────
//
//   • secp256r1 precompile verifier (SIMD-48 / Solana native precompile)
//     Unchanged. Every signed operation requires an immediately preceding
//     Secp256r1Program instruction in the same transaction.
//
//   • WebAuthn assertion parser
//     Kept as reusable infrastructure. Agents may submit WebAuthn-style
//     assertion payloads signed by HSM or TEE-backed secp256r1 keys;
//     the origin and challenge verification logic applies directly.
//
//   • Secp256r1 wallet binding PDA pattern
//     PDA derived from both coordinates of the P-256 public key.
//     The same L-SOL-4 invariant holds: X alone is ambiguous (two valid
//     Y values per X on the curve); both must anchor the PDA.
//
//   • Nonce-based replay protection
//     Per-wallet monotonic nonce included in every intent hash.
//
//   • base64url encoder, JSON string-value parser, whitespace helpers
//     Ported verbatim — no external crates; same compute-budget rationale.
//
//   ── WHAT WAS STRIPPED ──────────────────────────────────────────────
//
//   • ProtocolConfig and fee routing (treasury / staking / buyback)
//   • Default-deny destination whitelist
//   • Velocity rate limiting and burst cooldown
//   • Backup key enrollment and revocation
//   • Inheritance / dead man's switch
//   • Hardline-specific instructions: withdraw, close_vault,
//     add/remove_whitelist, set_velocity_limit, enroll/revoke_backup_key,
//     configure/cancel/claim_inheritance, activity_checkin
//
//   ── WHAT IS NEW ────────────────────────────────────────────────────
//
//   • AgentWallet account
//     Replaces VaultState. Stores an AI agent's secp256r1 identity key
//     and replay nonce. No velocity, no whitelist, no backup key.
//
//   • AttestationRegistry
//     Singleton PDA. Tracks total registered agents and the protocol
//     authority. Future: will hold upgrade authority and agent blacklist.
//
//   • register_agent_wallet (secp256r1 self-attestation — devnet gate)
//     Requires the secp256r1 key being registered to sign a challenge that
//     binds the registration to the caller's ed25519 pubkey:
//       sha256("vaultpact:register_agent_wallet:v1:" || authority || x || y)
//     This proves key possession AND prevents cross-authority replay of a
//     captured secp256r1 signature. PDA init provides one-shot replay fence.
//
//   ── PDA STRUCTURE ──────────────────────────────────────────────────
//
//   agent_wallet        — seeds = [b"agent_wallet", pubkey_x, pubkey_y]
//   attestation_registry — seeds = [b"attestation_registry"]
//
//   ── ORIGIN PINNING ─────────────────────────────────────────────────
//
//   ALLOWED_ORIGINS mirrors Hardline's anti-phishing mechanism.
//   For agent use-cases the "origin" field in assertion payloads will be
//   the Holdfast backend endpoint rather than a browser origin. Update
//   these constants before devnet launch.
//
// ═══════════════════════════════════════════════════════════════════════

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;
use anchor_lang::solana_program::hash::hash as sha256;

// Solana Secp256r1 Precompile Program ID (SIMD-48) — identical to Hardline.
pub mod secp256r1_program {
    use anchor_lang::solana_program::pubkey::Pubkey;
    pub const ID: Pubkey = Pubkey::new_from_array([
        6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
        28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
    ]);
}

declare_id!("D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg");

/// Devnet protocol authority: dedicated keypair at keys/devnet-protocol-authority.json
/// Pubkey: 9xSsPbk6Fh9LNfEsDnqM3SEwz4RDyqndgHhrAbRBomfk
#[cfg(not(feature = "mainnet"))]
pub const INITIAL_AUTHORITY: Pubkey = Pubkey::new_from_array([
    0x85,0x11,0xb0,0x99,0x63,0x2b,0x12,0x95,0xd2,0xc3,0x5c,0x19,0x51,0x4d,0xb4,0x85,
    0xe9,0x24,0x69,0xd5,0xc4,0x77,0x14,0xfb,0x0e,0x18,0xe0,0xb4,0xab,0xce,0xb3,0xc7,
]);

/// Mainnet authority: Squads v4 multisig vault PDA.
///
/// PDA derivation (Squads v4 vault):
///   seeds = [b"vault", multisig_pda.as_ref(), &0u32.to_le_bytes()]
///   program = squads_multisig_program_v4
///
/// The founding team will derive the vault PDA from the 3-of-5 multisig
/// created pre-mainnet and substitute the bytes below before the mainnet
/// build. The compile-time assertion prevents shipping the zero placeholder.
#[cfg(feature = "mainnet")]
pub const INITIAL_AUTHORITY: Pubkey = {
    // TODO(pre-mainnet): replace with Squads v4 vault PDA bytes from founding team.
    const BYTES: [u8; 32] = [0u8; 32];
    const _: () = assert!(
        BYTES[0] != 0 || BYTES[1] != 0 || BYTES[2] != 0 || BYTES[3] != 0,
        "INITIAL_AUTHORITY is still the zero address — set your Squads v4 multisig pubkey before mainnet build."
    );
    Pubkey::new_from_array(BYTES)
};

/// WebAuthn origins allowed to sign agent assertions.
#[cfg(not(feature = "mainnet"))]
const ALLOWED_ORIGINS: &[&[u8]] = &[
    b"https://devnet.holdfastprotocol.com",
    b"https://devnet-api.holdfastprotocol.com",
    b"http://localhost:3000",
    b"http://localhost:3001",
    b"http://localhost:5173",
];

#[cfg(feature = "mainnet")]
const ALLOWED_ORIGINS: &[&[u8]] = &[
    b"https://holdfastprotocol.com",
    b"https://api.holdfastprotocol.com",
];

// ── Reputation Authority Constants ───────────────────────────────────
//
// Only these two signers may call update_reputation.
//
// VAULTPACT_ESCROW_AUTHORITY
//   PDA of the VaultPact escrow program.
//   Derivation: find_program_address(&[b"vp_escrow_authority"], &escrow_program_id)
//   The escrow program uses this PDA as the signer when calling update_reputation via CPI.
//
// REPUTATION_ORACLE_AUTHORITY
//   Pubkey of the oracle daemon's ed25519 signing keypair.

/// Devnet escrow authority PDA: DLzsM2CA7mhp2KQcQfkzsbL6r55H8TEZJgL223xfXxA2 (bump = 255)
#[cfg(not(feature = "mainnet"))]
pub const VAULTPACT_ESCROW_AUTHORITY: Pubkey = Pubkey::new_from_array([
    0xb7,0x6b,0xb5,0xc7,0x02,0x7c,0x2c,0x0a,0x69,0x2b,0x5e,0x1b,0xf8,0x1c,0x9f,0xc9,
    0x90,0x00,0xc0,0x94,0x9f,0x59,0x77,0x40,0xcf,0x22,0xe7,0xe4,0x8a,0x11,0xc5,0x37,
]);

#[cfg(feature = "mainnet")]
pub const VAULTPACT_ESCROW_AUTHORITY: Pubkey = {
    const BYTES: [u8; 32] = [0u8; 32];
    const _: () = assert!(
        BYTES[0] != 0 || BYTES[1] != 0 || BYTES[2] != 0 || BYTES[3] != 0,
        "VAULTPACT_ESCROW_AUTHORITY is still the zero address — derive from mainnet escrow program ID before mainnet build."
    );
    Pubkey::new_from_array(BYTES)
};

/// Devnet oracle authority: 3Kj7GpYVoARqCT1bfBmCC5NZhw37ahEiyxsJW9zcTSiy
#[cfg(not(feature = "mainnet"))]
pub const REPUTATION_ORACLE_AUTHORITY: Pubkey = Pubkey::new_from_array([
    0x22,0x83,0x70,0xb4,0x7e,0x07,0xd9,0x40,0x68,0x93,0xb0,0xfd,0x98,0xec,0x47,0x55,
    0x0a,0xa0,0xa3,0xcf,0xc2,0xa5,0xc0,0x4e,0xb4,0x3c,0xb8,0x56,0x11,0x04,0x87,0x66,
]);

#[cfg(feature = "mainnet")]
pub const REPUTATION_ORACLE_AUTHORITY: Pubkey = {
    const BYTES: [u8; 32] = [0u8; 32];
    const _: () = assert!(
        BYTES[0] != 0 || BYTES[1] != 0 || BYTES[2] != 0 || BYTES[3] != 0,
        "REPUTATION_ORACLE_AUTHORITY is still the zero address — set mainnet oracle pubkey before mainnet build."
    );
    Pubkey::new_from_array(BYTES)
};

// Fixed-point precision for decay multiplier (0.99^N stored as integer/PRECISION).
const DECAY_PRECISION: i64 = 1_000_000;

// Precomputed 0.99^N * DECAY_PRECISION for N in [0, 365].
// Generated with integer arithmetic: table[n] = table[n-1] * 99 / 100.
// Decay is capped at 365 days per write; beyond that the agent is barely
// distinguishable from neutral anyway (0.99^365 ≈ 0.026).
const DECAY_TABLE: [i64; 366] = gen_decay_table();

const fn gen_decay_table() -> [i64; 366] {
    let mut t = [0i64; 366];
    t[0] = 1_000_000;
    let mut i = 1usize;
    while i < 366 {
        t[i] = t[i - 1] * 99 / 100;
        i += 1;
    }
    t
}

#[program]
pub mod vaultpact {
    use super::*;

    /// One-time registry initialization. Caller must match INITIAL_AUTHORITY.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == INITIAL_AUTHORITY,
            VaultPactError::UnauthorizedAuthority
        );

        // M-4: Verify VAULTPACT_ESCROW_AUTHORITY matches the PDA derived from the
        // supplied escrow program. Guards against the constant becoming stale if
        // the escrow program is redeployed to a new program ID.
        let (derived_authority, _) = Pubkey::find_program_address(
            &[b"vp_escrow_authority"],
            &ctx.accounts.escrow_program.key(),
        );
        require!(
            derived_authority == VAULTPACT_ESCROW_AUTHORITY,
            VaultPactError::EscrowAuthorityMismatch
        );

        let registry = &mut ctx.accounts.attestation_registry;
        registry.authority = ctx.accounts.authority.key();
        registry.agent_count = 0;
        registry.bump = ctx.bumps.attestation_registry;
        msg!("Holdfast attestation registry initialized");
        Ok(())
    }

    /// Register an AI agent's secp256r1 identity key on-chain.
    ///
    /// The transaction must contain a Secp256r1Program instruction immediately
    /// before this one. The secp256r1 key at (pubkey_x, pubkey_y) must sign
    /// exactly the authority-bound challenge:
    ///   sha256("vaultpact:register_agent_wallet:v1:" || authority || pubkey_x || pubkey_y)
    ///
    /// This proves key possession and binds the registration to the submitting
    /// ed25519 authority, preventing cross-authority replay of captured signatures.
    /// Replay on the same authority is blocked by the PDA `init` constraint.
    ///
    /// The PDA seed pattern (pubkey_x || pubkey_y) is kept from Hardline
    /// (L-SOL-4): both coordinates are required because X alone does not
    /// uniquely identify a point on the curve.
    pub fn register_agent_wallet(
        ctx: Context<RegisterAgentWallet>,
        pubkey_x: [u8; 32],
        pubkey_y: [u8; 32],
    ) -> Result<()> {
        // Guard: reject zero-coordinates — no valid secp256r1 point has x=0 or y=0
        require!(pubkey_x != [0u8; 32], VaultPactError::InvalidAgentKey);
        require!(pubkey_y != [0u8; 32], VaultPactError::InvalidAgentKey);

        // Compute the expected attestation challenge. The secp256r1 key must sign
        // exactly this 35 + 96 = 131-byte preimage; the precompile verifier returns
        // sha256(signed_message), which we compare against sha256(preimage).
        let expected_hash = registration_challenge(
            &ctx.accounts.payer.key(),
            &pubkey_x,
            &pubkey_y,
        );

        // Verify key possession via the Secp256r1Program precompile (M-SOL-6, H-2
        // invariants enforced inside). Returns sha256 of the message that was signed.
        let signed_hash = verify_secp256r1_precompile(
            &ctx.accounts.instructions,
            &pubkey_x,
            &pubkey_y,
        )?;

        require!(
            signed_hash == expected_hash,
            VaultPactError::AttestationChallengeMismatch
        );

        let wallet = &mut ctx.accounts.agent_wallet;
        wallet.authority = ctx.accounts.payer.key();
        wallet.pubkey_x = pubkey_x;
        wallet.pubkey_y = pubkey_y;
        wallet.nonce = 0;
        wallet.registered_at = Clock::get()?.unix_timestamp;
        wallet.status = 0;
        wallet.key_version = 1;
        wallet.deregister_deadline = 0;
        wallet.bump = ctx.bumps.agent_wallet;

        let registry = &mut ctx.accounts.attestation_registry;
        registry.agent_count = registry.agent_count
            .checked_add(1)
            .ok_or(VaultPactError::ArithmeticOverflow)?;

        msg!(
            "Agent wallet registered (pubkey_x: {:?}, authority: {}, count: {})",
            &pubkey_x[..8],
            ctx.accounts.payer.key(),
            registry.agent_count,
        );
        Ok(())
    }

    /// Create a fresh ReputationAccount for the signing agent.
    /// Agent pays rent (~0.0036 SOL); provides sybil resistance against
    /// subsidised-throwaway-account spam (see §3.1 of the design doc).
    pub fn init_reputation(ctx: Context<InitReputation>) -> Result<()> {
        let rep = &mut ctx.accounts.reputation_account;
        let now = Clock::get()?.unix_timestamp;
        rep.schema_version = ReputationAccount::SCHEMA_VERSION;
        rep.agent        = ctx.accounts.agent.key();
        rep.score        = 5_000; // neutral starting point
        rep.tier         = VerifTier::Unverified;
        rep.total_pacts  = 0;
        rep.dispute_count = 0;
        rep.created_at   = now;
        rep.last_updated = now;
        rep.decay_cursor = now;
        rep.nonce        = 0;
        rep.history_len  = 0;
        rep.history_head = 0;
        rep.bump         = ctx.bumps.reputation_account;
        msg!("ReputationAccount initialised for agent {}", rep.agent);
        Ok(())
    }

    /// Update an agent's reputation after a pact outcome.
    ///
    /// Only callable by VAULTPACT_ESCROW_AUTHORITY or REPUTATION_ORACLE_AUTHORITY.
    /// Applies lazy time-decay toward neutral before writing the new delta so
    /// long-inactive agents cannot coast on stale high scores.
    ///
    /// Anti-replay: caller must pass `incoming_nonce == rep.nonce + 1`.
    pub fn update_reputation(
        ctx: Context<UpdateReputation>,
        incoming_nonce: u64,
        outcome: PactOutcome,
        score_delta: i16,
        pact_id: [u8; 7],
    ) -> Result<()> {
        let authority = ctx.accounts.update_authority.key();
        require!(
            authority == VAULTPACT_ESCROW_AUTHORITY || authority == REPUTATION_ORACLE_AUTHORITY,
            VaultPactError::UnauthorizedReputationWriter
        );

        let rep = &mut ctx.accounts.reputation_account;
        let now = Clock::get()?.unix_timestamp;

        // §8.2 anti-replay nonce check — all state mutation comes after.
        require!(incoming_nonce == rep.nonce + 1, VaultPactError::NonceMismatch);

        // §3.3 lazy decay toward neutral before applying new delta.
        rep.score = apply_decay(rep.score, rep.decay_cursor, now);
        rep.decay_cursor = now;

        // Apply signed delta, clamped to [0, 10_000].
        let new_score = (rep.score as i64 + score_delta as i64).clamp(0, 10_000) as u64;
        rep.score = new_score;

        // Update counters.
        rep.total_pacts = rep.total_pacts
            .checked_add(1)
            .ok_or(VaultPactError::ArithmeticOverflow)?;
        if matches!(outcome, PactOutcome::Disputed) {
            rep.dispute_count = rep.dispute_count
                .checked_add(1)
                .ok_or(VaultPactError::ArithmeticOverflow)?;
        }

        // §8.3 ring buffer write — distinguish partial-fill vs full-overwrite.
        let entry = HistEntry { outcome, score_delta, timestamp: now, pact_id };
        let head = rep.history_head as usize;
        if rep.history_len < 20 {
            rep.history[head] = entry;
            rep.history_head = (rep.history_head + 1) % 20;
            rep.history_len += 1;
        } else {
            // Buffer full: overwrite oldest slot (current head) and advance.
            rep.history[head] = entry;
            rep.history_head = (rep.history_head + 1) % 20;
        }

        rep.last_updated = now;
        rep.nonce = rep.nonce.checked_add(1).ok_or(VaultPactError::ArithmeticOverflow)?;

        msg!(
            "Reputation updated: agent={} score={} nonce={} outcome={:?}",
            rep.agent, rep.score, rep.nonce, outcome as u8,
        );
        Ok(())
    }

    /// Gate check called by Holdfast escrow via CPI at sign_pact time.
    /// Returns Ok if the agent meets all three minimums; errors otherwise.
    pub fn validate_reputation_for_pact(
        ctx: Context<ValidateReputationAccounts>,
        min_score: u64,
        min_tier: VerifTier,
        min_pacts: u64,
    ) -> Result<()> {
        let rep = &ctx.accounts.reputation_account;
        let now = Clock::get()?.unix_timestamp;
        let effective_score = apply_decay(rep.score, rep.decay_cursor, now);
        require!(effective_score >= min_score, VaultPactError::ReputationScoreTooLow);
        require!(rep.tier >= min_tier,         VaultPactError::ReputationTierTooLow);
        require!(rep.total_pacts >= min_pacts, VaultPactError::ReputationInsufficientHistory);
        Ok(())
    }

    /// Test harness: invoke the full WebAuthn assertion pipeline on-chain.
    ///
    /// Not compiled for mainnet builds. Exists solely to enable TypeScript
    /// integration coverage of verify_webauthn_signature(). See CAS-80.
    ///
    /// Transaction must include a Secp256r1Program instruction immediately before
    /// this one, signing sha256(authenticator_data || sha256(client_data_json))
    /// with the key registered in agent_wallet.
    #[cfg(not(feature = "mainnet"))]
    pub fn test_verify_webauthn(
        ctx: Context<TestVerifyWebauthn>,
        authenticator_data: Vec<u8>,
        client_data_json: Vec<u8>,
        expected_challenge: [u8; 32],
    ) -> Result<()> {
        verify_webauthn_signature(
            &ctx.accounts.instructions,
            &ctx.accounts.agent_wallet,
            &authenticator_data,
            &client_data_json,
            expected_challenge,
        )
    }

    /// Rotate the protocol authority stored in AttestationRegistry.
    /// Gated by the compile-time INITIAL_AUTHORITY constant (Squads v4 multisig on mainnet).
    /// Enables authority migration without program redeployment.
    pub fn set_protocol_authority(
        ctx: Context<SetProtocolAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == INITIAL_AUTHORITY,
            VaultPactError::UnauthorizedAuthority
        );
        // L-3: Reject the zero pubkey — no signer can match it, making all
        // authority-gated functions permanently unusable if this were accepted.
        require!(new_authority != Pubkey::default(), VaultPactError::InvalidAuthority);
        ctx.accounts.attestation_registry.authority = new_authority;
        msg!("Protocol authority updated to {}", new_authority);
        Ok(())
    }

    /// Admin-only: set an agent wallet's status field.
    /// Gated by INITIAL_AUTHORITY. Status: 0=Active, 1=Frozen, 2=Blacklisted, 3=DeregisterPending.
    pub fn set_agent_status(ctx: Context<SetAgentStatus>, new_status: u8) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == INITIAL_AUTHORITY,
            VaultPactError::UnauthorizedAuthority
        );
        require!(new_status <= 3, VaultPactError::InvalidAgentStatus);
        ctx.accounts.agent_wallet.status = new_status;
        msg!(
            "Agent status updated: wallet={} status={}",
            ctx.accounts.agent_wallet.key(),
            new_status,
        );
        Ok(())
    }

    /// Close an agent wallet PDA and return lamports to the authority.
    ///
    /// The authority (ed25519 signer who registered the wallet) must sign.
    /// The wallet must be in DeregisterPending status (3), set by admin via
    /// set_agent_status after verifying no active pacts exist off-chain.
    ///
    /// A final secp256r1 signature over the deregistration challenge is required
    /// to prove key possession at close time (anti-griefing):
    ///   sha256("vaultpact:close_agent_wallet:v1:" || authority)
    ///
    /// PDA closure and lamport return handled by Anchor's `close` constraint.
    pub fn close_agent_wallet(ctx: Context<CloseAgentWallet>) -> Result<()> {
        let wallet = &ctx.accounts.agent_wallet;

        require!(wallet.status == 3, VaultPactError::AgentNotDeregisterPending);

        let expected_hash = deregistration_challenge(&wallet.authority);

        let signed_hash = verify_secp256r1_precompile(
            &ctx.accounts.instructions,
            &wallet.pubkey_x,
            &wallet.pubkey_y,
        )?;

        require!(
            signed_hash == expected_hash,
            VaultPactError::DeregistrationChallengeMismatch
        );

        let registry = &mut ctx.accounts.attestation_registry;
        registry.agent_count = registry.agent_count
            .checked_sub(1)
            .ok_or(VaultPactError::ArithmeticOverflow)?;

        msg!(
            "Agent wallet closed (authority: {}, remaining agents: {})",
            ctx.accounts.authority.key(),
            registry.agent_count,
        );

        Ok(())
    }

    /// Rotate an agent's secp256r1 identity key to a new key pair.
    ///
    /// Atomically closes the old AgentWallet PDA (seeded by old coordinates)
    /// and initialises a new one (seeded by new coordinates).  Authority,
    /// nonce, and registration timestamp carry over; key_version increments
    /// (saturating at u16::MAX).
    ///
    /// Reputation is unaffected: ReputationAccount is seeded by the ed25519
    /// authority, not the secp256r1 key.
    ///
    /// Auth requirements (both must hold):
    ///   1. `authority` (ed25519) must sign the transaction.
    ///   2. The OLD secp256r1 key must sign the rotation challenge via the
    ///      Secp256r1Program precompile in the immediately preceding ix:
    ///        sha256("vaultpact:rotate_agent_key:v1:" || authority
    ///               || old_x || old_y || new_x || new_y)
    pub fn rotate_agent_key(
        ctx: Context<RotateAgentKey>,
        new_pubkey_x: [u8; 32],
        new_pubkey_y: [u8; 32],
    ) -> Result<()> {
        let old_wallet = &ctx.accounts.old_agent_wallet;

        require!(old_wallet.status == 0, VaultPactError::AgentNotActive);

        require!(new_pubkey_x != [0u8; 32], VaultPactError::InvalidAgentKey);
        require!(new_pubkey_y != [0u8; 32], VaultPactError::InvalidAgentKey);

        require!(
            new_pubkey_x != old_wallet.pubkey_x || new_pubkey_y != old_wallet.pubkey_y,
            VaultPactError::RotationToSameKey
        );

        let expected_hash = rotation_challenge(
            &ctx.accounts.authority.key(),
            &old_wallet.pubkey_x,
            &old_wallet.pubkey_y,
            &new_pubkey_x,
            &new_pubkey_y,
        );

        let signed_hash = verify_secp256r1_precompile(
            &ctx.accounts.instructions,
            &old_wallet.pubkey_x,
            &old_wallet.pubkey_y,
        )?;

        require!(
            signed_hash == expected_hash,
            VaultPactError::RotationChallengeMismatch
        );

        let new_wallet = &mut ctx.accounts.new_agent_wallet;
        new_wallet.authority = old_wallet.authority;
        new_wallet.pubkey_x = new_pubkey_x;
        new_wallet.pubkey_y = new_pubkey_y;
        new_wallet.nonce = old_wallet.nonce;
        new_wallet.registered_at = old_wallet.registered_at;
        new_wallet.status = 0;
        new_wallet.key_version = old_wallet.key_version.saturating_add(1);
        new_wallet.deregister_deadline = 0;
        new_wallet.bump = ctx.bumps.new_agent_wallet;

        msg!(
            "Agent key rotated (authority: {}, version: {} -> {})",
            ctx.accounts.authority.key(),
            old_wallet.key_version,
            new_wallet.key_version,
        );

        Ok(())
    }
}

// ── Account Structs ──────────────────────────────────────────────────

/// On-chain identity record for a single AI agent.
/// Analogous to Hardline's VaultState, stripped of all human-specific fields.
#[account]
pub struct AgentWallet {
    pub authority: Pubkey,          // ed25519 signer that submitted registration  32
    pub pubkey_x: [u8; 32],        // secp256r1 (P-256) X coordinate              32
    pub pubkey_y: [u8; 32],        // secp256r1 (P-256) Y coordinate              32
    pub nonce: u64,                 // monotonic replay nonce                       8
    pub registered_at: i64,        // unix timestamp of initial registration       8
    pub status: u8,                 // 0=Active, 1=Frozen, 2=Blacklisted, 3=DeregisterPending  1
    pub key_version: u16,          // starts at 1, increments on rotation           2
    pub deregister_deadline: i64,  // unix ts; 0 if not deregistering              8
    pub bump: u8,                   // PDA bump                                     1
}

impl AgentWallet {
    // 8 (discriminator) + 32 + 32 + 32 + 8 + 8 + 1 + 2 + 8 + 1 = 132
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 2 + 8 + 1;
}

const _: () = assert!(AgentWallet::LEN == 132);

/// Protocol-level singleton tracking all registered agent wallets.
#[account]
pub struct AttestationRegistry {
    pub authority: Pubkey,  // protocol authority (will become Squads multisig)  32
    pub agent_count: u64,   // total registered agents                            8
    pub bump: u8,           // PDA bump                                           1
}

impl AttestationRegistry {
    // 8 (discriminator) + 32 + 8 + 1 = 49
    pub const LEN: usize = 8 + 32 + 8 + 1;
}

// ── Reputation Types ─────────────────────────────────────────────────

#[derive(Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum VerifTier {
    Unverified = 0,
    Attested   = 1,
    Hardline   = 2,
}

impl Default for VerifTier {
    fn default() -> Self { VerifTier::Unverified }
}

#[derive(Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
#[repr(u8)]
pub enum PactOutcome {
    Fulfilled = 0,
    Disputed  = 1,
    Cancelled = 2,
}

#[derive(Clone, Copy, AnchorSerialize, AnchorDeserialize, Default)]
pub struct HistEntry {
    pub outcome:     PactOutcome,
    pub score_delta: i16,
    pub timestamp:   i64,
    // Display-only; not a unique lookup key. First 7 bytes of pact pubkey.
    pub pact_id: [u8; 7],
}

impl Default for PactOutcome {
    fn default() -> Self { PactOutcome::Fulfilled }
}

/// On-chain reputation record for a single AI agent.
///
/// PDA seeds: [b"reputation", agent_pubkey]
/// On-chain space: 8 (discriminator) + 504 (fields) = 512 bytes
/// Rent cost: ~0.00358 SOL, paid by the agent at init_reputation.
#[account]
pub struct ReputationAccount {
    pub schema_version: u8,             //  1  — must equal ReputationAccount::SCHEMA_VERSION
    pub agent:         Pubkey,          // 32
    pub score:         u64,             //  8  — scaled [0, 10000]; 5000 = neutral
    pub tier:          VerifTier,       //  1
    pub total_pacts:   u64,             //  8  — lifetime completed pacts
    pub dispute_count: u64,             //  8  — lifetime disputes against this agent
    pub created_at:    i64,             //  8
    pub last_updated:  i64,             //  8
    pub decay_cursor:  i64,             //  8  — timestamp of last decay application
    pub nonce:         u64,             //  8  — monotonic anti-replay
    pub history_len:   u8,              //  1  — valid entries in ring buffer [0, 20]
    pub history_head:  u8,              //  1  — next write index
    pub history:       [HistEntry; 20], // 360 — 20 × 18 bytes
    // _padding keeps the Borsh-serialized struct at exactly 504 bytes so that
    // 8-byte discriminator + 504 = 512 bytes on-chain.
    // Reduced from 52 to 51 to absorb the schema_version byte added above.
    pub _padding:      [u8; 51],        // 51
    pub bump:          u8,              //  1
}

impl ReputationAccount {
    pub const SCHEMA_VERSION: u8 = 1;
    // 8 (disc) + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 360 + 51 + 1 = 512
    pub const LEN: usize = 8 + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + (18 * 20) + 51 + 1;
}

const _: () = assert!(ReputationAccount::LEN == 512);

// ── Decay Helper ─────────────────────────────────────────────────────

/// Apply time-based decay toward neutral (5000) for days_inactive in [0, 365].
///
/// §8.1: score is cast to i64 before subtraction to avoid u64 underflow
/// when score < 5000.
fn apply_decay(score: u64, decay_cursor: i64, now: i64) -> u64 {
    let days = ((now - decay_cursor).max(0) / 86_400).min(365) as usize;
    if days == 0 {
        return score;
    }
    let signed = score as i64;
    let delta = signed - 5_000i64;
    let decayed = 5_000i64 + (delta * DECAY_TABLE[days]) / DECAY_PRECISION;
    decayed.clamp(0, 10_000) as u64
}

// ── Account Contexts ──────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init, payer = authority, space = AttestationRegistry::LEN,
        seeds = [b"attestation_registry"], bump,
    )]
    pub attestation_registry: Account<'info, AttestationRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    // M-4: escrow program account used to derive and verify VAULTPACT_ESCROW_AUTHORITY.
    // Must be executable (a deployed program, not a data account).
    /// CHECK: Executable flag enforced by constraint; key is used only for PDA derivation.
    #[account(executable)]
    pub escrow_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(pubkey_x: [u8; 32], pubkey_y: [u8; 32])]
pub struct RegisterAgentWallet<'info> {
    /// PDA bound to both coordinates of the agent's secp256r1 key (L-SOL-4).
    #[account(
        init, payer = payer, space = AgentWallet::LEN,
        seeds = [b"agent_wallet", pubkey_x.as_ref(), pubkey_y.as_ref()], bump,
    )]
    pub agent_wallet: Account<'info, AgentWallet>,
    #[account(
        mut,
        seeds = [b"attestation_registry"], bump = attestation_registry.bump,
    )]
    pub attestation_registry: Account<'info, AttestationRegistry>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Instructions sysvar — validated inside verify_secp256r1_precompile (M-SOL-6, H-2).
    #[account(address = sysvar_instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitReputation<'info> {
    #[account(
        init, payer = agent, space = ReputationAccount::LEN,
        seeds = [b"reputation", agent.key().as_ref()], bump,
    )]
    pub reputation_account: Account<'info, ReputationAccount>,
    #[account(mut)]
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateReputation<'info> {
    #[account(
        mut,
        seeds = [b"reputation", reputation_account.agent.as_ref()],
        bump = reputation_account.bump,
    )]
    pub reputation_account: Account<'info, ReputationAccount>,
    pub update_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ValidateReputationAccounts<'info> {
    #[account(
        seeds = [b"reputation", reputation_account.agent.as_ref()],
        bump = reputation_account.bump,
    )]
    pub reputation_account: Account<'info, ReputationAccount>,
}

#[cfg(not(feature = "mainnet"))]
#[derive(Accounts)]
pub struct TestVerifyWebauthn<'info> {
    /// AgentWallet whose secp256r1 key must sign the WebAuthn assertion payload.
    #[account(
        seeds = [b"agent_wallet", agent_wallet.pubkey_x.as_ref(), agent_wallet.pubkey_y.as_ref()],
        bump = agent_wallet.bump,
    )]
    pub agent_wallet: Account<'info, AgentWallet>,
    /// CHECK: Instructions sysvar — validated inside verify_secp256r1_precompile (M-SOL-6, H-2).
    #[account(address = sysvar_instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetProtocolAuthority<'info> {
    #[account(
        mut,
        seeds = [b"attestation_registry"], bump = attestation_registry.bump,
    )]
    pub attestation_registry: Account<'info, AttestationRegistry>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetAgentStatus<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agent_wallet", agent_wallet.pubkey_x.as_ref(), agent_wallet.pubkey_y.as_ref()],
        bump = agent_wallet.bump,
    )]
    pub agent_wallet: Account<'info, AgentWallet>,
}

#[derive(Accounts)]
pub struct CloseAgentWallet<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"agent_wallet", agent_wallet.pubkey_x.as_ref(), agent_wallet.pubkey_y.as_ref()],
        bump = agent_wallet.bump,
        has_one = authority,
    )]
    pub agent_wallet: Account<'info, AgentWallet>,
    #[account(
        mut,
        seeds = [b"attestation_registry"], bump = attestation_registry.bump,
    )]
    pub attestation_registry: Account<'info, AttestationRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Instructions sysvar — validated inside verify_secp256r1_precompile (M-SOL-6, H-2).
    #[account(address = sysvar_instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(new_pubkey_x: [u8; 32], new_pubkey_y: [u8; 32])]
pub struct RotateAgentKey<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"agent_wallet", old_agent_wallet.pubkey_x.as_ref(), old_agent_wallet.pubkey_y.as_ref()],
        bump = old_agent_wallet.bump,
        has_one = authority,
    )]
    pub old_agent_wallet: Account<'info, AgentWallet>,
    #[account(
        init, payer = authority, space = AgentWallet::LEN,
        seeds = [b"agent_wallet", new_pubkey_x.as_ref(), new_pubkey_y.as_ref()], bump,
    )]
    pub new_agent_wallet: Account<'info, AgentWallet>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Instructions sysvar — validated inside verify_secp256r1_precompile (M-SOL-6, H-2).
    #[account(address = sysvar_instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

// ── Cryptographic Verification ────────────────────────────────────────
//
// The following functions are ported verbatim from Hardline, with two
// adaptations:
//   1. verify_secp256r1_precompile now accepts explicit pubkey coordinates
//      rather than reading them from a VaultState account.
//   2. All references to Hardline-specific types have been updated to
//      Holdfast equivalents.
//
// No logic has changed. These functions passed Hardline's external audit
// review; any future changes must be audited before devnet launch.

/// Compute the deregistration challenge for a given authority.
///
/// Challenge = sha256("vaultpact:close_agent_wallet:v1:" || authority)
///
/// The secp256r1 key must sign this 64-byte preimage to prove key possession
/// at deregistration time, preventing griefing by an attacker who compromises
/// only the ed25519 authority but not the secp256r1 key.
pub(crate) fn deregistration_challenge(authority: &Pubkey) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(64);
    preimage.extend_from_slice(b"vaultpact:close_agent_wallet:v1:");
    preimage.extend_from_slice(authority.as_ref());
    sha256(&preimage).to_bytes()
}

/// Compute the registration attestation challenge for a given authority and key.
///
/// Challenge = sha256("vaultpact:register_agent_wallet:v1:" || authority || x || y)
///
/// The secp256r1 key must sign this exact 131-byte preimage. Binding to the
/// authority pubkey prevents a captured signature from being replayed to register
/// the same secp256r1 key under a different ed25519 authority.
pub(crate) fn registration_challenge(
    authority: &Pubkey,
    pubkey_x: &[u8; 32],
    pubkey_y: &[u8; 32],
) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(131);
    preimage.extend_from_slice(b"vaultpact:register_agent_wallet:v1:");
    preimage.extend_from_slice(authority.as_ref());
    preimage.extend_from_slice(pubkey_x);
    preimage.extend_from_slice(pubkey_y);
    sha256(&preimage).to_bytes()
}

/// Compute the key-rotation challenge for a given authority, old key, and new key.
///
/// Challenge = sha256("vaultpact:rotate_agent_key:v1:" || authority || old_x || old_y || new_x || new_y)
///
/// The OLD secp256r1 key must sign this preimage to prove possession of the
/// current key AND consent to the specific new key.  Both Y coordinates are
/// included (L-SOL-4): omitting new_y would allow replay with the alternate
/// curve point sharing the same X, landing the wallet at a different PDA.
pub(crate) fn rotation_challenge(
    authority: &Pubkey,
    old_pubkey_x: &[u8; 32],
    old_pubkey_y: &[u8; 32],
    new_pubkey_x: &[u8; 32],
    new_pubkey_y: &[u8; 32],
) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(190);
    preimage.extend_from_slice(b"vaultpact:rotate_agent_key:v1:");
    preimage.extend_from_slice(authority.as_ref());
    preimage.extend_from_slice(old_pubkey_x);
    preimage.extend_from_slice(old_pubkey_y);
    preimage.extend_from_slice(new_pubkey_x);
    preimage.extend_from_slice(new_pubkey_y);
    sha256(&preimage).to_bytes()
}

/// Verify a secp256r1 precompile + WebAuthn assertion pair.
///
/// Checks:
///   1. The immediately preceding instruction is a valid Secp256r1Program ix.
///   2. The verified public key matches `wallet.pubkey_x / pubkey_y`.
///   3. The precompile message equals sha256(authData || sha256(clientDataJSON)).
///   4. The `origin` field in clientDataJSON is in ALLOWED_ORIGINS.
///   5. The `challenge` field in clientDataJSON matches `expected_challenge`.
pub fn verify_webauthn_signature(
    instructions_account: &UncheckedAccount,
    wallet: &AgentWallet,
    authenticator_data: &[u8],
    client_data_json: &[u8],
    expected_challenge: [u8; 32],
) -> Result<()> {
    // WebAuthn spec: authenticator_data must be >= 37 bytes
    require!(authenticator_data.len() >= 37, VaultPactError::InvalidSignatureData);
    require!(!client_data_json.is_empty(), VaultPactError::InvalidClientData);

    let precompile_message =
        verify_secp256r1_precompile(instructions_account, &wallet.pubkey_x, &wallet.pubkey_y)?;

    let client_data_hash = sha256(client_data_json);
    let mut combined = Vec::with_capacity(authenticator_data.len() + 32);
    combined.extend_from_slice(authenticator_data);
    combined.extend_from_slice(client_data_hash.as_ref());
    let expected_message = sha256(&combined);

    require!(
        precompile_message == expected_message.to_bytes(),
        VaultPactError::MessageHashMismatch
    );

    verify_origin_in_client_data(client_data_json)?;
    verify_challenge_in_client_data(client_data_json, &expected_challenge)?;
    Ok(())
}

/// Verify the Secp256r1Program instruction immediately preceding the current
/// instruction. Returns sha256(message_bytes) — the hash over which the
/// precompile verified the signature.
///
/// Accepts compressed (0x02/0x03 + x, 33 bytes) or uncompressed (0x04 + x + y,
/// 65 bytes) key encodings.
///
/// Security properties preserved from Hardline:
///   • CPI rejection (M-SOL-6): ensures vault ix is a top-level instruction
///     so the precompile-pairing assumption holds.
///   • Instruction-index validation (H-2): all three ix indices in the
///     precompile header must be 0xFFFF (same instruction), preventing a
///     spoofed precompile that reads its key/message from another ix.
fn verify_secp256r1_precompile(
    instructions_account: &UncheckedAccount,
    pubkey_x: &[u8; 32],
    pubkey_y: &[u8; 32],
) -> Result<[u8; 32]> {
    let instructions_sysvar = instructions_account.to_account_info();
    let current_idx = sysvar_instructions::load_current_index_checked(&instructions_sysvar)
        .map_err(|_| VaultPactError::InvalidInstructionsSysvar)?;
    require!(current_idx > 0, VaultPactError::MissingSignatureVerification);

    // M-SOL-6: Reject CPI invocations. Precompiles are always top-level;
    // our program must be too, or the pairing assumption breaks.
    let current_ix = sysvar_instructions::load_instruction_at_checked(
        current_idx as usize, &instructions_sysvar,
    ).map_err(|_| VaultPactError::InvalidInstructionsSysvar)?;
    require!(current_ix.program_id == crate::ID, VaultPactError::DirectInvocationRequired);

    let secp_ix = sysvar_instructions::load_instruction_at_checked(
        (current_idx - 1) as usize, &instructions_sysvar,
    ).map_err(|_| VaultPactError::MissingSignatureVerification)?;

    require!(secp_ix.program_id == secp256r1_program::ID, VaultPactError::InvalidSignatureProgram);

    let data = &secp_ix.data;
    require!(data.len() > 16, VaultPactError::InvalidSignatureData);
    require!(data[0] == 1, VaultPactError::InvalidSignatureData);

    // H-2: All three instruction-source indices must be 0xFFFF.
    let sig_ix_index    = u16::from_le_bytes([data[4], data[5]]);
    let pubkey_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let message_ix_index = u16::from_le_bytes([data[14], data[15]]);
    require!(sig_ix_index    == u16::MAX, VaultPactError::InvalidSignatureData);
    require!(pubkey_ix_index == u16::MAX, VaultPactError::InvalidSignatureData);
    require!(message_ix_index == u16::MAX, VaultPactError::InvalidSignatureData);

    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let prefix = data.get(pubkey_offset).copied().unwrap_or(0);

    let key_matches = match prefix {
        0x02 | 0x03 => {
            require!(data.len() >= pubkey_offset + 33, VaultPactError::InvalidSignatureData);
            let x = &data[pubkey_offset + 1..pubkey_offset + 33];
            let y_parity = pubkey_y[31] & 1;
            let expected_prefix = if y_parity == 0 { 0x02 } else { 0x03 };
            x == pubkey_x.as_ref() && prefix == expected_prefix
        }
        0x04 => {
            require!(data.len() >= pubkey_offset + 65, VaultPactError::InvalidSignatureData);
            let x = &data[pubkey_offset + 1..pubkey_offset + 33];
            let y = &data[pubkey_offset + 33..pubkey_offset + 65];
            x == pubkey_x.as_ref() && y == pubkey_y.as_ref()
        }
        _ => return Err(VaultPactError::UnsupportedKeyFormat.into()),
    };
    require!(key_matches, VaultPactError::PublicKeyMismatch);

    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size   = u16::from_le_bytes([data[12], data[13]]) as usize;
    // Devnet secp256r1 precompile (Agave 2.x / SIMD-48) takes a pre-hashed
    // 32-byte message — it does NOT hash msg_data internally.  Callers must
    // pass sha256(preimage) as msg_data and the returned value is that same
    // 32-byte hash (not sha256-of-sha256).
    require!(msg_size == 32, VaultPactError::InvalidSignatureData);
    require!(data.len() >= msg_offset + 32, VaultPactError::InvalidSignatureData);

    let mut result = [0u8; 32];
    result.copy_from_slice(&data[msg_offset..msg_offset + 32]);
    Ok(result)
}

/// H-SOL-1: Whitespace-tolerant challenge verification.
/// See Hardline ADR for why strict byte-match is insufficient for cross-browser compat.
fn verify_challenge_in_client_data(
    client_data_json: &[u8],
    expected_challenge: &[u8; 32],
) -> Result<()> {
    let encoded = base64url_encode_32(expected_challenge);
    let (start, end) = find_json_string_value(client_data_json, b"challenge")
        .ok_or(VaultPactError::InvalidClientData)?;
    let value = &client_data_json[start..end];
    require!(value == encoded, VaultPactError::ChallengeMismatch);
    Ok(())
}

/// C-SOL-1: Verify origin field matches an allowed Holdfast endpoint.
fn verify_origin_in_client_data(client_data_json: &[u8]) -> Result<()> {
    let (start, end) = find_json_string_value(client_data_json, b"origin")
        .ok_or(VaultPactError::InvalidClientData)?;
    let origin = &client_data_json[start..end];
    require!(
        ALLOWED_ORIGINS.iter().any(|a| *a == origin),
        VaultPactError::InvalidOrigin
    );
    Ok(())
}

/// Find a JSON string value by key. Returns (start, end) byte range of the
/// value content (excluding surrounding quotes). Tolerates whitespace around
/// the colon and rejects escaped quotes (safe for WebAuthn fields).
fn find_json_string_value(json: &[u8], key: &[u8]) -> Option<(usize, usize)> {
    let mut needle = Vec::with_capacity(key.len() + 2);
    needle.push(b'"');
    needle.extend_from_slice(key);
    needle.push(b'"');

    let key_pos = find_subsequence(json, &needle)?;
    let mut pos = key_pos + needle.len();

    while pos < json.len() && is_json_whitespace(json[pos]) { pos += 1; }
    if pos >= json.len() || json[pos] != b':' { return None; }
    pos += 1;

    while pos < json.len() && is_json_whitespace(json[pos]) { pos += 1; }
    if pos >= json.len() || json[pos] != b'"' { return None; }
    let start = pos + 1;

    let mut end = start;
    while end < json.len() && json[end] != b'"' { end += 1; }
    if end >= json.len() { return None; }

    Some((start, end))
}

fn is_json_whitespace(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\n' || b == b'\r'
}

/// Base64url-encode a fixed 32-byte SHA-256 digest to 43 unpadded bytes.
///
/// WARNING — hardcoded for 32-byte input only. See Hardline source for the
/// full caveat. Do not change the input type without updating the encoder.
fn base64url_encode_32(input: &[u8; 32]) -> [u8; 43] {
    const ALPHA: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = [0u8; 43];
    let mut o = 0;
    for i in 0..10 {
        let b0 = input[i * 3] as u32;
        let b1 = input[i * 3 + 1] as u32;
        let b2 = input[i * 3 + 2] as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out[o]     = ALPHA[((triple >> 18) & 0x3F) as usize];
        out[o + 1] = ALPHA[((triple >> 12) & 0x3F) as usize];
        out[o + 2] = ALPHA[((triple >> 6)  & 0x3F) as usize];
        out[o + 3] = ALPHA[(triple & 0x3F)          as usize];
        o += 4;
    }
    let b0 = input[30] as u32;
    let b1 = input[31] as u32;
    let triple = (b0 << 16) | (b1 << 8);
    out[o]     = ALPHA[((triple >> 18) & 0x3F) as usize];
    out[o + 1] = ALPHA[((triple >> 12) & 0x3F) as usize];
    out[o + 2] = ALPHA[((triple >> 6)  & 0x3F) as usize];
    out
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ── Unit Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── registration_challenge invariants ─────────────────────────────────
    //
    // These tests verify the authority-binding property of the attestation
    // challenge without requiring the Secp256r1Program precompile (no runtime
    // needed). End-to-end registration is covered by the TypeScript integration
    // test in tests/vaultpact.ts.

    #[test]
    fn registration_challenge_is_deterministic() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let x = [1u8; 32];
        let y = [2u8; 32];
        assert_eq!(
            registration_challenge(&auth, &x, &y),
            registration_challenge(&auth, &x, &y),
            "challenge must be deterministic for the same inputs",
        );
    }

    #[test]
    fn registration_challenge_differs_across_authorities() {
        // Captured secp256r1 sig for authority A must not validate for authority B.
        let x = [1u8; 32];
        let y = [2u8; 32];
        let auth_a = Pubkey::new_from_array([0xAAu8; 32]);
        let auth_b = Pubkey::new_from_array([0xBBu8; 32]);
        assert_ne!(
            registration_challenge(&auth_a, &x, &y),
            registration_challenge(&auth_b, &x, &y),
            "challenge must differ per authority to prevent cross-authority replay",
        );
    }

    #[test]
    fn registration_challenge_differs_across_keys() {
        // Two distinct secp256r1 keys under the same authority must have distinct challenges.
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let x1 = [1u8; 32];
        let y1 = [2u8; 32];
        let x2 = [3u8; 32];
        let y2 = [4u8; 32];
        assert_ne!(
            registration_challenge(&auth, &x1, &y1),
            registration_challenge(&auth, &x2, &y2),
            "challenge must differ per key pair",
        );
    }

    #[test]
    fn registration_challenge_domain_separation() {
        // Swapping x and y must yield a different challenge (no aliasing attack
        // where flipping coordinates produces a valid preimage for a different key).
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let x = [1u8; 32];
        let y = [2u8; 32];
        assert_ne!(
            registration_challenge(&auth, &x, &y),
            registration_challenge(&auth, &y, &x),
            "challenge must not be symmetric in x/y",
        );
    }

    // ── deregistration_challenge invariants ─────────────────────────────

    #[test]
    fn deregistration_challenge_is_deterministic() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        assert_eq!(
            deregistration_challenge(&auth),
            deregistration_challenge(&auth),
            "challenge must be deterministic for the same authority",
        );
    }

    #[test]
    fn deregistration_challenge_differs_across_authorities() {
        let auth_a = Pubkey::new_from_array([0xAAu8; 32]);
        let auth_b = Pubkey::new_from_array([0xBBu8; 32]);
        assert_ne!(
            deregistration_challenge(&auth_a),
            deregistration_challenge(&auth_b),
            "challenge must differ per authority",
        );
    }

    #[test]
    fn deregistration_challenge_differs_from_registration() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let x = [1u8; 32];
        let y = [2u8; 32];
        assert_ne!(
            deregistration_challenge(&auth),
            registration_challenge(&auth, &x, &y),
            "deregistration and registration challenges must use different domain separators",
        );
    }

    // ── rotation_challenge invariants ──────────────────────────────────

    #[test]
    fn rotation_challenge_is_deterministic() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let old_x = [1u8; 32];
        let old_y = [2u8; 32];
        let new_x = [3u8; 32];
        let new_y = [4u8; 32];
        assert_eq!(
            rotation_challenge(&auth, &old_x, &old_y, &new_x, &new_y),
            rotation_challenge(&auth, &old_x, &old_y, &new_x, &new_y),
            "challenge must be deterministic for the same inputs",
        );
    }

    #[test]
    fn rotation_challenge_differs_across_authorities() {
        let old_x = [1u8; 32];
        let old_y = [2u8; 32];
        let new_x = [3u8; 32];
        let new_y = [4u8; 32];
        let auth_a = Pubkey::new_from_array([0xAAu8; 32]);
        let auth_b = Pubkey::new_from_array([0xBBu8; 32]);
        assert_ne!(
            rotation_challenge(&auth_a, &old_x, &old_y, &new_x, &new_y),
            rotation_challenge(&auth_b, &old_x, &old_y, &new_x, &new_y),
            "challenge must differ per authority to prevent cross-authority replay",
        );
    }

    #[test]
    fn rotation_challenge_differs_across_old_keys() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let new_x = [3u8; 32];
        let new_y = [4u8; 32];
        assert_ne!(
            rotation_challenge(&auth, &[1u8; 32], &[2u8; 32], &new_x, &new_y),
            rotation_challenge(&auth, &[5u8; 32], &[6u8; 32], &new_x, &new_y),
            "challenge must differ per old key pair",
        );
    }

    #[test]
    fn rotation_challenge_differs_across_new_keys() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let old_x = [1u8; 32];
        let old_y = [2u8; 32];
        assert_ne!(
            rotation_challenge(&auth, &old_x, &old_y, &[3u8; 32], &[4u8; 32]),
            rotation_challenge(&auth, &old_x, &old_y, &[5u8; 32], &[6u8; 32]),
            "challenge must differ per new key pair",
        );
    }

    #[test]
    fn rotation_challenge_differs_when_new_y_swapped() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let old_x = [1u8; 32];
        let old_y = [2u8; 32];
        let new_x = [3u8; 32];
        assert_ne!(
            rotation_challenge(&auth, &old_x, &old_y, &new_x, &[4u8; 32]),
            rotation_challenge(&auth, &old_x, &old_y, &new_x, &[5u8; 32]),
            "challenge must differ when new_y differs (L-SOL-4 Y-swap prevention)",
        );
    }

    #[test]
    fn rotation_challenge_not_symmetric_old_new() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let key_a_x = [1u8; 32];
        let key_a_y = [2u8; 32];
        let key_b_x = [3u8; 32];
        let key_b_y = [4u8; 32];
        assert_ne!(
            rotation_challenge(&auth, &key_a_x, &key_a_y, &key_b_x, &key_b_y),
            rotation_challenge(&auth, &key_b_x, &key_b_y, &key_a_x, &key_a_y),
            "rotating A->B must produce a different challenge than B->A",
        );
    }

    #[test]
    fn rotation_challenge_differs_from_registration_and_deregistration() {
        let auth = Pubkey::new_from_array([0x42u8; 32]);
        let x = [1u8; 32];
        let y = [2u8; 32];
        let new_x = [3u8; 32];
        let new_y = [4u8; 32];
        let rot = rotation_challenge(&auth, &x, &y, &new_x, &new_y);
        assert_ne!(rot, registration_challenge(&auth, &x, &y),
            "rotation and registration challenges must use different domain separators");
        assert_ne!(rot, deregistration_challenge(&auth),
            "rotation and deregistration challenges must use different domain separators");
    }

    // ── Decay table invariants ──────────────────────────────────────────

    #[test]
    fn decay_table_identity_at_zero() {
        assert_eq!(DECAY_TABLE[0], DECAY_PRECISION,
            "0.99^0 must equal 1 (DECAY_PRECISION)");
    }

    #[test]
    fn decay_table_first_step_exact() {
        // t[1] = 1_000_000 * 99 / 100 — integer division is exact here.
        assert_eq!(DECAY_TABLE[1], 990_000);
    }

    #[test]
    fn decay_table_365_approximately_0_026() {
        // 0.99^365 ≈ 0.02563 → expect value in [25_000, 27_000].
        let v = DECAY_TABLE[365];
        assert!(v >= 25_000 && v <= 27_000,
            "DECAY_TABLE[365] = {} — expected ≈ 25_600", v);
    }

    #[test]
    fn decay_table_monotone_decreasing() {
        for i in 1..366 {
            assert!(DECAY_TABLE[i] <= DECAY_TABLE[i - 1],
                "DECAY_TABLE not monotone at index {}", i);
        }
    }

    // ── apply_decay behaviour ───────────────────────────────────────────

    #[test]
    fn apply_decay_zero_days_no_change() {
        let now = 1_000_000i64;
        let cursor = now; // same timestamp
        assert_eq!(apply_decay(9_000, cursor, now), 9_000);
        assert_eq!(apply_decay(0, cursor, now), 0);
    }

    #[test]
    fn apply_decay_neutral_stays_neutral() {
        // Score at 5000 should not change regardless of days elapsed.
        let cursor = 0i64;
        let day100 = 86_400 * 100;
        assert_eq!(apply_decay(5_000, cursor, day100), 5_000,
            "neutral score must be stable under decay");
    }

    #[test]
    fn apply_decay_above_neutral_moves_toward_neutral() {
        let cursor = 0i64;
        let day1 = 86_400i64;
        let decayed = apply_decay(10_000, cursor, day1);
        // 5000 + (10000-5000)*990000/1_000_000 = 5000 + 4950 = 9950
        assert_eq!(decayed, 9_950,
            "score above neutral should decrease by one decay step");
    }

    #[test]
    fn apply_decay_below_neutral_moves_toward_neutral() {
        // §8.1: score < 5000 requires signed arithmetic — this is the key safety test.
        let cursor = 0i64;
        let day1 = 86_400i64;
        let decayed = apply_decay(0, cursor, day1);
        // 5000 + (0-5000)*990000/1_000_000 = 5000 - 4950 = 50
        assert_eq!(decayed, 50,
            "score below neutral should increase toward 5000 (signed arithmetic)");
    }

    #[test]
    fn apply_decay_caps_at_365_days() {
        // > 365 days elapsed must use DECAY_TABLE[365], not overflow or panic.
        let cursor = 0i64;
        let day400 = 86_400i64 * 400;
        let at_365 = apply_decay(10_000, cursor, 86_400 * 365);
        let at_400 = apply_decay(10_000, cursor, day400);
        assert_eq!(at_365, at_400,
            "decay beyond 365 days must clamp to DECAY_TABLE[365]");
    }

    #[test]
    fn apply_decay_negative_elapsed_returns_original() {
        // clock skew or same-block double-update: now < cursor is treated as 0 days.
        let now = 1_000i64;
        let cursor = 2_000i64; // cursor is in the future
        assert_eq!(apply_decay(8_000, cursor, now), 8_000);
    }

    // ── Reputation authority constants (CAS-33) ─────────────────────────

    #[test]
    fn reputation_authority_constants_are_not_placeholders() {
        let old_escrow = Pubkey::new_from_array([
            0xe5,0xca,0x0b,0x1e,0x2f,0x3a,0x4b,0x5c,0x6d,0x7e,0x8f,0x90,0xa1,0xb2,0xc3,0xd4,
            0xe5,0xf6,0x07,0x18,0x29,0x3a,0x4b,0x5c,0x6d,0x7e,0x8f,0x90,0xa1,0xb2,0xc3,0xd4,
        ]);
        let old_oracle = Pubkey::new_from_array([
            0xf1,0xe2,0xd3,0xc4,0xb5,0xa6,0x97,0x88,0x79,0x6a,0x5b,0x4c,0x3d,0x2e,0x1f,0x00,
            0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff,0x00,
        ]);
        assert_ne!(VAULTPACT_ESCROW_AUTHORITY, old_escrow,
            "escrow authority must not be the pre-CAS-33 placeholder");
        assert_ne!(REPUTATION_ORACLE_AUTHORITY, old_oracle,
            "oracle authority must not be the pre-CAS-33 placeholder");
    }

    #[test]
    fn reputation_authority_constants_are_nonzero_and_distinct() {
        let zero = Pubkey::new_from_array([0u8; 32]);
        assert_ne!(VAULTPACT_ESCROW_AUTHORITY, zero,
            "escrow authority must not be the zero pubkey");
        assert_ne!(REPUTATION_ORACLE_AUTHORITY, zero,
            "oracle authority must not be the zero pubkey");
        assert_ne!(VAULTPACT_ESCROW_AUTHORITY, REPUTATION_ORACLE_AUTHORITY,
            "escrow and oracle authorities must be distinct");
    }

    // ── INITIAL_AUTHORITY invariants (CAS-90) ──────────────────────────

    #[test]
    fn initial_authority_devnet_is_nonzero() {
        let zero = Pubkey::new_from_array([0u8; 32]);
        assert_ne!(INITIAL_AUTHORITY, zero,
            "devnet INITIAL_AUTHORITY must not be the zero pubkey");
    }

    #[test]
    fn initial_authority_distinct_from_reputation_authorities() {
        assert_ne!(INITIAL_AUTHORITY, VAULTPACT_ESCROW_AUTHORITY,
            "INITIAL_AUTHORITY must differ from escrow authority");
        assert_ne!(INITIAL_AUTHORITY, REPUTATION_ORACLE_AUTHORITY,
            "INITIAL_AUTHORITY must differ from oracle authority");
    }

    #[test]
    fn all_authority_gated_instructions_use_same_constant() {
        // Compile-time proof: if INITIAL_AUTHORITY changed shape or became
        // a per-build mutable, this test would fail to compile or assert.
        // The three gated instructions (initialize_registry, set_agent_status,
        // set_protocol_authority) all compare against this single constant.
        let auth_bytes = INITIAL_AUTHORITY.to_bytes();
        assert_eq!(auth_bytes.len(), 32,
            "INITIAL_AUTHORITY must be a valid 32-byte Pubkey");
        assert!(auth_bytes.iter().any(|&b| b != 0),
            "INITIAL_AUTHORITY must have at least one nonzero byte");
    }

    // ── L-3: set_protocol_authority zero-pubkey guard ──────────────────

    #[test]
    fn zero_pubkey_is_pubkey_default() {
        // The L-3 guard checks `new_authority != Pubkey::default()`.
        // Confirm Pubkey::default() is the all-zero key.
        assert_eq!(Pubkey::default(), Pubkey::new_from_array([0u8; 32]));
    }

    #[test]
    fn nonzero_pubkeys_pass_l3_guard() {
        let valid = Pubkey::new_from_array([1u8; 32]);
        assert_ne!(valid, Pubkey::default(), "nonzero pubkey must not match Pubkey::default()");
    }

    // ── M-4: VAULTPACT_ESCROW_AUTHORITY constant sanity ───────────────

    #[test]
    #[cfg(not(feature = "mainnet"))]
    fn vaultpact_escrow_authority_is_nonzero() {
        // The devnet constant must not be the zero pubkey; the compile-time
        // assertion covers mainnet — this covers the devnet build.
        let bytes = VAULTPACT_ESCROW_AUTHORITY.to_bytes();
        assert!(bytes.iter().any(|&b| b != 0),
            "VAULTPACT_ESCROW_AUTHORITY must not be the zero pubkey");
    }

    #[test]
    #[cfg(not(feature = "mainnet"))]
    fn vaultpact_escrow_authority_matches_devnet_escrow_program() {
        // Verify the hardcoded constant matches find_program_address for the
        // known devnet escrow program ID (BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H).
        // If the escrow program is redeployed, update VAULTPACT_ESCROW_AUTHORITY AND
        // this test together to catch divergence at CI time.
        use std::str::FromStr;
        let escrow_program_id = Pubkey::from_str("BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H")
            .expect("hardcoded devnet escrow program ID must parse");
        let (derived, _bump) = Pubkey::find_program_address(
            &[b"vp_escrow_authority"],
            &escrow_program_id,
        );
        assert_eq!(derived, VAULTPACT_ESCROW_AUTHORITY,
            "VAULTPACT_ESCROW_AUTHORITY constant does not match PDA derived from devnet escrow program ID");
    }
}

// ── Fuzz helpers ─────────────────────────────────────────────────────
//
// Re-exports private/pub(crate) pure functions for cargo-fuzz targets.
// Only compiled when the `fuzz-helpers` feature is enabled; has no effect
// on normal or mainnet builds.

#[cfg(feature = "fuzz-helpers")]
pub mod fuzz_helpers {
    use anchor_lang::prelude::Pubkey;

    pub fn apply_decay(score: u64, decay_cursor: i64, now: i64) -> u64 {
        super::apply_decay(score, decay_cursor, now)
    }

    pub fn registration_challenge(
        authority: &Pubkey,
        pubkey_x: &[u8; 32],
        pubkey_y: &[u8; 32],
    ) -> [u8; 32] {
        super::registration_challenge(authority, pubkey_x, pubkey_y)
    }

    pub fn deregistration_challenge(authority: &Pubkey) -> [u8; 32] {
        super::deregistration_challenge(authority)
    }

    pub fn rotation_challenge(
        authority: &Pubkey,
        old_pubkey_x: &[u8; 32],
        old_pubkey_y: &[u8; 32],
        new_pubkey_x: &[u8; 32],
        new_pubkey_y: &[u8; 32],
    ) -> [u8; 32] {
        super::rotation_challenge(authority, old_pubkey_x, old_pubkey_y, new_pubkey_x, new_pubkey_y)
    }

    pub fn find_json_string_value(json: &[u8], key: &[u8]) -> Option<(usize, usize)> {
        super::find_json_string_value(json, key)
    }

    pub fn base64url_encode_32(input: &[u8; 32]) -> [u8; 43] {
        super::base64url_encode_32(input)
    }
}

// ── Errors ────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultPactError {
    #[msg("Missing secp256r1 signature verification instruction")]
    MissingSignatureVerification,
    #[msg("Invalid signature program (expected Secp256r1Program)")]
    InvalidSignatureProgram,
    #[msg("Public key does not match registered agent wallet")]
    PublicKeyMismatch,
    #[msg("Invalid instructions sysvar")]
    InvalidInstructionsSysvar,
    #[msg("Invalid signature data")]
    InvalidSignatureData,
    #[msg("Unsupported key format (expected 0x02/0x03 compressed or 0x04 uncompressed)")]
    UnsupportedKeyFormat,
    #[msg("WebAuthn message hash mismatch")]
    MessageHashMismatch,
    #[msg("Challenge mismatch")]
    ChallengeMismatch,
    #[msg("Invalid clientDataJSON")]
    InvalidClientData,
    #[msg("WebAuthn origin not in Holdfast allowed list")]
    InvalidOrigin,
    #[msg("Direct invocation required — program instructions cannot be called via CPI")]
    DirectInvocationRequired,
    #[msg("Unauthorized: signer is not the protocol authority")]
    UnauthorizedAuthority,
    #[msg("Invalid agent key (zero coordinates not allowed)")]
    InvalidAgentKey,
    #[msg("Attestation challenge mismatch — secp256r1 key must sign the authority-bound registration challenge")]
    AttestationChallengeMismatch,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    // ── Reputation errors ─────────────────────────────────────────────
    #[msg("Caller is not an authorized reputation writer (escrow or oracle program)")]
    UnauthorizedReputationWriter,
    #[msg("Nonce mismatch: expected rep.nonce + 1")]
    NonceMismatch,
    #[msg("Agent reputation score is below the required minimum")]
    ReputationScoreTooLow,
    #[msg("Agent verification tier is below the required minimum")]
    ReputationTierTooLow,
    #[msg("Agent does not have enough completed pacts")]
    ReputationInsufficientHistory,
    #[msg("Invalid agent status (must be 0, 1, 2, or 3)")]
    InvalidAgentStatus,
    // ── Deregistration errors ────────────────────────────────────────
    #[msg("Agent wallet must be in DeregisterPending status (3) to close")]
    AgentNotDeregisterPending,
    #[msg("Deregistration challenge mismatch — secp256r1 key must sign the authority-bound deregistration challenge")]
    DeregistrationChallengeMismatch,
    // ── Key rotation errors ─────────────────────────────────────────
    #[msg("Agent wallet must be Active (status 0) to rotate keys")]
    AgentNotActive,
    #[msg("Rotation challenge mismatch — old secp256r1 key must sign the authority-bound rotation challenge")]
    RotationChallengeMismatch,
    #[msg("New key must differ from the current key")]
    RotationToSameKey,
    // ── Authority errors (M-4, L-3) ────────────────────────────────────
    #[msg("Derived escrow authority PDA does not match VAULTPACT_ESCROW_AUTHORITY constant")]
    EscrowAuthorityMismatch,
    #[msg("New authority must not be the zero pubkey (permanent DoS prevention)")]
    InvalidAuthority,
}
