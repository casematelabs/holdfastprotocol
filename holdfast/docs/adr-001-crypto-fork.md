# ADR-001: Holdfast Cryptographic Fork from Hardline

**Status:** Accepted  
**Date:** 2026-04-19  
**Author:** CTO (CAS-9)

---

## Context

Holdfast Protocol requires a Solana on-chain program as its trust anchor for autonomous AI agent identity. Rather than starting from scratch, the decision was made to fork the Hardline Protocol codebase and strip it to its cryptographic primitives. This ADR records what was kept, what was removed, and why.

The source is `copy/solana/hardline_vault/programs/hardline_vault/src/lib.rs` (Hardline v0.1, post-audit).

---

## What Was Kept

### 1. `secp256r1_program` module (Secp256r1 Precompile ID)

The Solana native Secp256r1Program (SIMD-48) is the only way to verify P-256 signatures on-chain at acceptable compute cost. The program ID constant is unchanged — it is a runtime constant, not a deployment artifact.

### 2. `verify_secp256r1_precompile` function

**Kept verbatim**, with one structural change: the function signature now accepts `(pubkey_x, pubkey_y)` as explicit parameters instead of reading them from a `VaultState` account. This decouples the verifier from the Hardline account layout without touching any of the verification logic.

All security fixes from the Hardline audit are preserved:
- **M-SOL-6** (CPI rejection): direct-invocation-only guard via `current_ix.program_id == crate::ID`.
- **H-2** (instruction-index validation): all three indices in the precompile header must be `0xFFFF`.
- Compressed and uncompressed key formats both accepted (0x02/0x03/0x04 prefix handling).

### 3. WebAuthn assertion parser

`verify_webauthn_signature`, `verify_challenge_in_client_data`, `verify_origin_in_client_data`, `find_json_string_value`, `is_json_whitespace`, `find_subsequence`.

**Rationale:** AI agents may submit assertion payloads signed by HSM-backed or TEE-backed secp256r1 keys using the same `authData || sha256(clientDataJSON)` message-binding scheme. Retaining the parser means Holdfast can verify these without reinventing the binding logic. The Hardline audit review of this code applies directly.

The `ALLOWED_ORIGINS` constant has been updated to Holdfast Protocol endpoints. These must be finalised before devnet launch.

### 4. Secp256r1 wallet binding PDA pattern

Seeds: `[b"agent_wallet", pubkey_x, pubkey_y]`.

The **L-SOL-4** invariant from Hardline is preserved: both X and Y coordinates seed the PDA because a single X coordinate is ambiguous on secp256r1 (two valid Y values per X). Using both ensures the on-chain address is bound to the canonical, unambiguous public key.

### 5. Nonce-based replay protection

Per-wallet `u64` nonce included in every intent hash. Unchanged from Hardline. Future Holdfast instructions must include the nonce in the intent payload before calling `verify_webauthn_signature`.

### 6. `base64url_encode_32`

32-byte SHA-256 → 43-byte unpadded base64url. No external crates; same compute-budget rationale as Hardline. The function is tightly coupled to 32-byte inputs — see the warning comment. Do not change input size without updating the implementation.

---

## What Was Removed

| Removed component | Reason |
|---|---|
| `ProtocolConfig` (fee routing, fee_bps) | Holdfast Protocol has no token fee model at this stage |
| `WhitelistEntry` + whitelist instructions | AI agents do not use default-deny destination whitelists |
| Velocity rate limiting + burst cooldown | Agent operation rate limits belong at the escrow contract layer, not the identity layer |
| Backup key (enroll/revoke) | Agent key rotation is a protocol-level concern handled separately |
| Inheritance / dead man's switch | Human-specific concept with no AI agent analogue |
| `activity_checkin` instruction | No inactivity tracking at identity layer |
| `close_vault` instruction | Agent deregistration pattern TBD |
| All withdrawal logic | Holdfast Protocol does not move funds at this program level |
| `INITIAL_AUTHORITY` zero-byte check for mainnet | Kept — the compile-time guard is valid for both protocols |

---

## What Is New

### `AgentWallet` account

Replaces `VaultState`. Contains:
- `authority: Pubkey` — ed25519 signer that submitted registration
- `pubkey_x / pubkey_y: [u8; 32]` — secp256r1 identity key
- `nonce: u64` — replay protection
- `registered_at: i64` — timestamp for auditability

No velocity, no whitelist slots, no backup key fields.

### `AttestationRegistry` singleton

Protocol-level PDA tracking `agent_count` and `authority`. Future use: agent blacklist, upgrade authority, schema versioning.

### `register_agent_wallet` (STUB)

Currently open-access. **Must be gated on attestation proof before devnet launch.** Candidate approaches:

1. **Secp256r1 self-attestation**: require a preceding `Secp256r1Program` instruction signed by the key being registered. Proves key possession at registration time.
2. **TEE attestation report**: verify a trusted execution environment attestation that binds the secp256r1 key to a specific agent binary hash.
3. **MPC operator quorum**: trusted operator set co-signs the registration.

Option 1 is the lowest-friction path and reuses the existing precompile infrastructure. Recommend targeting option 1 for devnet.

---

## Invariants to Preserve in Future Development

1. **CPI rejection must remain.** Any Holdfast instruction that reads the Instructions sysvar must keep the `current_ix.program_id == crate::ID` guard.
2. **Instruction-index validation must remain.** The `0xFFFF` check on all three precompile header indices must not be removed.
3. **Both PDA seed coordinates must remain.** Never seed an `AgentWallet` PDA from `pubkey_x` alone.
4. **Nonce must be included in every intent hash.** Any new signed instruction must append `vault.nonce.to_le_bytes()` to the intent before hashing.
5. **`base64url_encode_32` input size is fixed.** If the intent hash ever changes from SHA-256, the encoder must be updated or replaced.

---

## Reputation Authority Derivation

Resolved in [CAS-33](/CAS/issues/CAS-33) on 2026-04-19. The two constants that gate `update_reputation` are now real, derivable values.

### VAULTPACT_ESCROW_AUTHORITY

| Field | Value |
|---|---|
| Canonical address | `DLzsM2CA7mhp2KQcQfkzsbL6r55H8TEZJgL223xfXxA2` |
| Type | Program-Derived Address (off-curve) |
| Program | Holdfast Protocol escrow program, devnet ID `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |
| Seeds | `[b"vp_escrow_authority"]` |
| Bump | 255 |
| Program keypair | `~/.config/solana/escrow-program-devnet.json` (do not commit) |

Derivation command:
```
solana find-program-derived-address CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi string:vp_escrow_authority
```

When the escrow program is implemented, it **must** use the same seeds (`[b"vp_escrow_authority", &[255u8]]`) as its CPI signer when calling `update_reputation`, or derivation will produce a different address and all reputation writes will be rejected.

### REPUTATION_ORACLE_AUTHORITY

| Field | Value |
|---|---|
| Canonical address | `3Kj7GpYVoARqCT1bfBmCC5NZhw37ahEiyxsJW9zcTSiy` |
| Type | Regular ed25519 keypair pubkey (oracle daemon signing key) |
| Keypair file | `~/.config/solana/oracle-devnet.json` (do not commit) |
| Generated | 2026-04-19 via `solana-keygen new --no-passphrase` |

The oracle daemon loads this keypair at startup via `ORACLE_KEYPAIR_PATH` or `ORACLE_KEYPAIR_JSON` (see `oracle/src/config.ts`). Any reputation update transaction signed by a key other than this one will be rejected with `UnauthorizedReputationWriter`.

### Mainnet key rotation

Before mainnet launch, both constants must be regenerated:
- `VAULTPACT_ESCROW_AUTHORITY`: re-derive from the mainnet escrow program ID.
- `REPUTATION_ORACLE_AUTHORITY`: generate a new keypair stored in HSM or hardware wallet; update constant and redeploy.

---

## Open Questions

- ~~**Deregistration**: How should an `AgentWallet` PDA be closed? Options: authority-only, self-with-attestation, time-locked.~~
  **Resolved in [CAS-86](/CAS/issues/CAS-86) on 2026-04-19.** Authority-only self-deregistration with secp256r1 attestation. Admin sets `DeregisterPending` status (3) after verifying no active pacts off-chain, then the authority closes the PDA with a final secp256r1 signature over `sha256("vaultpact:close_agent_wallet:v1:" || authority)`. Anchor `close` constraint zeroes the PDA and returns lamports; `agent_count` is decremented with `checked_sub`.
- **Key rotation**: What happens when an agent rotates its secp256r1 key? New PDA at new coordinates? Migration instruction?
- **Agent blacklist**: Should the `AttestationRegistry` maintain an on-chain blacklist, or is that an off-chain concern?
- **ALLOWED_ORIGINS finalisation**: Confirm Holdfast API endpoint domains before devnet build.

These are tracked in CAS-9 follow-up issues.
