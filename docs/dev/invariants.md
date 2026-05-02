# Holdfast Protocol (formerly VaultPact) — Formal Invariants Specification

**Version:** 1.6  
**Date:** 2026-04-22  
**Prepared for:** External Security Audit  
**Security Review:** Head of Security — verified all invariants against source, added ES-9 through ES-16 and Gaps 7–13  
**CTO Sign-off:** Confirmed both HIGH severity gaps (7, 8) fixed in source; ES-13 updated with idempotency constraint; error code appendix completed (29 entries). Document approved for submission to audit firm.  
**v1.3 Update:** Added ES-17 (Mutual Cancellation), updated ES-1/ES-2/ES-7 for `MutuallyCancelled` status, resolved Gap 10, added 5 error codes to appendix.  
**v1.4 Update:** Added comprehensive CEI compliance section with per-instruction ordering table, reentrancy mitigations, and read-only CPI classification.  
**v1.5 Update:** `resolve_dispute` now applies reputation deltas via CPI: loser -100, winner +25, split both -25. Added 3 dispute delta constants to appendix.  
**v1.6 Update:** Marked Gaps 2, 9, 11, 13 as FIXED after deep audit verified source matches. Updated ES-5 to include initiator re-check at lock. Updated ES-9 to include arbiter re-check at lock.  
**Programs in scope:**
- Holdfast Protocol (identity + reputation): `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` (on-chain module: `vaultpact`)
- Holdfast Protocol Escrow: `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` (on-chain module: `vaultpact_escrow`)

**Anchor version:** 0.31.1  
**Related documents:** [ADR-001: Cryptographic Fork from Hardline](../holdfast/docs/adr-001-crypto-fork.md)

---

## Table of Contents

1. [Holdfast Program Invariants](#holdfast-program-invariants)
2. [Holdfast Escrow Program Invariants](#holdfast-escrow-program-invariants)
3. [Oracle Trust Model](#oracle-trust-model)
4. [Cross-Program Trust Boundaries](#cross-program-trust-boundaries)
5. [CEI (Checks-Effects-Interactions) Compliance](#cei-checks-effects-interactions-compliance)
6. [Known Gaps and Auditor Flags](#known-gaps-and-auditor-flags)

---

## Holdfast Program Invariants

Source: `holdfast/programs/vaultpact/src/lib.rs`

### VP-1: Secp256r1 CPI Guard (M-SOL-6)

**Statement:** `verify_secp256r1_precompile()` rejects CPI invocations by enforcing that the currently-executing instruction's program ID equals `crate::ID`.

**Enforcement (lines 943–952):**

```rust
let current_idx = sysvar_instructions::load_current_index_checked(&instructions_sysvar)
    .map_err(|_| VaultPactError::InvalidInstructionsSysvar)?;
require!(current_idx > 0, VaultPactError::MissingSignatureVerification);

let current_ix = sysvar_instructions::load_instruction_at_checked(
    current_idx as usize, &instructions_sysvar,
).map_err(|_| VaultPactError::InvalidInstructionsSysvar)?;
require!(current_ix.program_id == crate::ID, VaultPactError::DirectInvocationRequired);
```

**Rationale:** The Secp256r1 precompile is always a top-level instruction. The Holdfast instruction paired with it must also be top-level; otherwise an attacker could construct a CPI context where the adjacent-instruction assumption does not hold.

**Error:** `DirectInvocationRequired` (line 1464)

---

### VP-2: Instruction-Index Validation (H-2)

**Statement:** All three instruction-source index fields in the Secp256r1Program header must equal `0xFFFF` (same-instruction data source requirement).

**Enforcement (lines 964–970):**

```rust
let sig_ix_index     = u16::from_le_bytes([data[4], data[5]]);
let pubkey_ix_index  = u16::from_le_bytes([data[8], data[9]]);
let message_ix_index = u16::from_le_bytes([data[14], data[15]]);
require!(sig_ix_index    == u16::MAX, VaultPactError::InvalidSignatureData);
require!(pubkey_ix_index == u16::MAX, VaultPactError::InvalidSignatureData);
require!(message_ix_index == u16::MAX, VaultPactError::InvalidSignatureData);
```

**Rationale:** An index other than `0xFFFF` would allow the precompile to read signature, public key, or message data from an attacker-controlled instruction elsewhere in the transaction, spoofing attestation verification.

**Error:** `InvalidSignatureData`

---

### VP-3: PDA Seed Uniqueness (L-SOL-4)

**Statement:** `AgentWallet` PDAs are seeded with both the X and Y coordinates of the secp256r1 public key. X alone is ambiguous — two valid Y values exist per X on the P-256 curve.

**Enforcement (line 688–692, init constraint):**

```rust
seeds = [b"agent_wallet", pubkey_x.as_ref(), pubkey_y.as_ref()], bump,
```

**Consistent in all access contexts:**
- `CloseAgentWallet` (lines 774–776)
- `RotateAgentKey` old wallet (lines 797–799)
- `RotateAgentKey` new wallet (lines 803–805)

**Zero-key rejection (lines 217–218):**

```rust
require!(pubkey_x != [0u8; 32], VaultPactError::InvalidAgentKey);
require!(pubkey_y != [0u8; 32], VaultPactError::InvalidAgentKey);
```

---

### VP-4: Challenge Binding (Domain Separation)

**Statement:** Each instruction type that requires a secp256r1 signature uses a unique, domain-separated challenge prefix. A signature captured for one operation cannot be replayed for another.

**Challenge prefixes:**

| Instruction | Prefix | Lines |
|---|---|---|
| `register_agent_wallet` | `"vaultpact:register_agent_wallet:v1:"` | 848–859 |
| `close_agent_wallet` | `"vaultpact:close_agent_wallet:v1:"` | 834–839 |
| `rotate_agent_key` | `"vaultpact:rotate_agent_key:v1:"` | 869–884 |

**Additional binding:** Each challenge includes the `authority` pubkey (ed25519 signer), preventing cross-authority replay even within the same instruction type.

**Preimage construction:**
- Registration: `prefix || authority || pubkey_x || pubkey_y` (131 bytes)
- Deregistration: `prefix || authority` (64 bytes)
- Rotation: `prefix || authority || old_x || old_y || new_x || new_y` (190 bytes)

All three preimages are SHA-256 hashed before comparison with the message verified by the precompile.

---

### VP-5: Nonce Monotonicity

**Statement:** `update_reputation` requires `incoming_nonce == rep.nonce + 1`. No replay, no skip.

**Enforcement (line 314):**

```rust
require!(incoming_nonce == rep.nonce + 1, VaultPactError::NonceMismatch);
```

**Commit (line 348):** `rep.nonce += 1;`

**Properties:**
- Initial nonce is `0` (set at `init_reputation`, line 282). First valid update must pass `incoming_nonce = 1`.
- Replay of prior nonce fails (nonce already incremented).
- Skip of future nonce fails (strict equality check).

**Error:** `NonceMismatch` (line 1477)

**Note:** No overflow guard on the `rep.nonce + 1` comparison at u64::MAX. At 2^64 calls per account this is theoretical only.

---

### VP-6: Score Bounds

**Statement:** `reputation_score` is always in the closed interval `[0, 10_000]`.

**Enforcement — delta application (lines 321–322):**

```rust
let new_score = (rep.score as i64 + score_delta as i64).clamp(0, 10_000) as u64;
rep.score = new_score;
```

**Enforcement — decay application (line 667):**

```rust
let decayed = 5_000i64 + (delta * DECAY_TABLE[days]) / DECAY_PRECISION;
decayed.clamp(0, 10_000) as u64
```

**Initial value:** `5_000` (line 275), within bounds.

Both paths use Rust's `.clamp()` which guarantees the result is within `[min, max]` inclusive.

---

### VP-7: Decay Invariant

**Statement:** The decay function moves score strictly toward `NEUTRAL_SCORE` (5000) and never diverges from it.

**Enforcement — `apply_decay` function (lines 659–668):**

```rust
fn apply_decay(score: u64, decay_cursor: i64, now: i64) -> u64 {
    let days = ((now - decay_cursor).max(0) / 86_400).min(365) as usize;
    if days == 0 { return score; }
    let signed = score as i64;
    let delta = signed - 5_000i64;
    let decayed = 5_000i64 + (delta * DECAY_TABLE[days]) / DECAY_PRECISION;
    decayed.clamp(0, 10_000) as u64
}
```

**Mathematical form:** `new_score = 5000 + (old_score - 5000) * 0.99^days`

**Properties:**
- `DECAY_TABLE[days]` is in `(0, DECAY_PRECISION]` for all `days ∈ [1, 365]`.
- If `score > 5000`: delta is positive, new_score < score (decreases toward 5000).
- If `score < 5000`: delta is negative, new_score > score (increases toward 5000).
- If `score == 5000`: delta is zero, new_score == 5000 (stable fixed point).
- Days capped at 365 (prevents `DECAY_TABLE` OOB access).
- Negative elapsed time treated as 0 days (no backward decay).

---

### VP-8: Authority Gate on `update_reputation`

**Statement:** Only two compile-time authorities may call `update_reputation`.

**Enforcement (lines 304–308):**

```rust
let authority = ctx.accounts.update_authority.key();
require!(
    authority == VAULTPACT_ESCROW_AUTHORITY || authority == REPUTATION_ORACLE_AUTHORITY,
    VaultPactError::UnauthorizedReputationWriter
);
```

**Permitted authorities:**

| Authority | Type | Base58 | Purpose |
|---|---|---|---|
| `VAULTPACT_ESCROW_AUTHORITY` | PDA (off-curve) | `DLzsM2CA7mhp2KQcQfkzsbL6r55H8TEZJgL223xfXxA2` | Escrow program CPI signer |
| `REPUTATION_ORACLE_AUTHORITY` | ed25519 keypair | `3Kj7GpYVoARqCT1bfBmCC5NZhw37ahEiyxsJW9zcTSiy` | Off-chain oracle daemon |

**Derivation of `VAULTPACT_ESCROW_AUTHORITY`:**
- Seeds: `[b"vp_escrow_authority"]`
- Program: `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` (escrow program)
- Bump: 255

The `UpdateReputation` context (lines 718–727) declares `update_authority: Signer<'info>`, so Anchor enforces that the account signed the transaction before the instruction body runs.

**Error:** `UnauthorizedReputationWriter` (line 1475)

---

### VP-9: Registry Singleton

**Statement:** `AttestationRegistry` is a single PDA; only one instance can exist. `initialize_registry` is gated by `INITIAL_AUTHORITY`.

**Singleton enforcement (lines 674–678):**

```rust
#[account(
    init, payer = authority, space = AttestationRegistry::LEN,
    seeds = [b"attestation_registry"], bump,
)]
pub attestation_registry: Account<'info, AttestationRegistry>,
```

Seeds are fixed (`b"attestation_registry"`) with no variable component. Anchor's `init` calls `create_account` which fails if the account already exists. Therefore exactly one `AttestationRegistry` can exist per program deployment.

**Authority gate (lines 185–188):**

```rust
require!(
    ctx.accounts.authority.key() == INITIAL_AUTHORITY,
    VaultPactError::UnauthorizedAuthority
);
```

**`INITIAL_AUTHORITY` on mainnet:** Squads v4 multisig vault PDA, with a compile-time assertion (lines 109–112) that prevents shipping a zero placeholder:

```rust
const _: () = assert!(
    BYTES[0] != 0 || BYTES[1] != 0 || BYTES[2] != 0 || BYTES[3] != 0,
    "INITIAL_AUTHORITY is still the zero address ..."
);
```

The same `INITIAL_AUTHORITY` gates `set_protocol_authority` (lines 403–406) and `set_agent_status` (lines 415–418).

**Error:** `UnauthorizedAuthority` (line 1466)

---

## Holdfast Escrow Program Invariants

Source: `holdfast/programs/vaultpact-escrow/src/`

### ES-1: State Machine Transitions

**Statement:** `EscrowStatus` transitions follow a strict directed graph. Each instruction asserts a specific pre-condition status before writing the post-condition status.

**Enum definition** (`state/escrow_account.rs`, lines 3–14):

```rust
#[repr(u8)]
pub enum EscrowStatus {
    Pending           = 0,
    Funded            = 1,
    Locked            = 2,
    Released          = 3,
    Disputed          = 4,
    Refunded          = 5,
    Closed            = 6,
    Claimed           = 7,
    MutuallyCancelled = 8,
}
```

**Valid transitions:**

```
Pending ──[deposit_funds]──► Funded
Funded  ──[lock_escrow]───► Locked       (requires beneficiary_staked = true)
Locked  ──[release_escrow]──► Released
Locked  ──[auto_release, auto=true]──► Released
Locked  ──[auto_release, auto=false]─► Refunded
Locked  ──[raise_dispute]──► Disputed
Locked  ──[mutual_cancel]─► MutuallyCancelled  (both parties sign)
Locked  ──[refund]─────────► Refunded    (time-lock expired)
Released──[claim_released]──► Claimed
Released──[raise_dispute]───► Disputed   (within 7-day post-release window)
Disputed──[resolve_dispute]─► Claimed    (ReleaseToBeneficiary or SplitFunds)
Disputed──[resolve_dispute]─► Refunded   (RefundToInitiator)
Disputed──[refund]──────────► Refunded   (escalation timeout path)
*       ──[protocol_freeze]─► Disputed   (from Funded/Locked/Released/Disputed)
Released/Refunded/Claimed/MutuallyCancelled──[close_escrow]──► (account deleted)
```

**Forbidden transitions:** Any instruction called on a status not listed in its `require!` guard returns `EscrowError::InvalidStatus`. Terminal states (`Refunded`, `Claimed`) have no outgoing transitions except `close_escrow`.

**Mutual exclusion at Released:** `claim_released` requires `now > dispute_window_ends_at`; `raise_dispute` from Released requires `now < dispute_window_ends_at`. These are mutually exclusive by clock.

---

### ES-2: Payout Conservation

**Statement:** Every resolution path distributes exactly 100% of the vault balance (`escrow_amount + initiator_stake + beneficiary_stake`). No funds are created or destroyed.

**Vault balance pinned at lock time** (`lock_escrow.rs`, lines 65–74):

```rust
vault.amount == escrow_amount + initiator_stake + beneficiary_stake
```

**Resolution paths:**

| Path | Beneficiary receives | Initiator receives | Sum |
|---|---|---|---|
| `claim_released` (happy path) | `escrow_amount + beneficiary_stake` | `initiator_stake` | 100% |
| `resolve_dispute` → `ReleaseToBeneficiary` (no slash) | `escrow_amount + beneficiary_stake` | `initiator_stake` | 100% |
| `resolve_dispute` → `ReleaseToBeneficiary` (slash) | `escrow_amount + beneficiary_stake + initiator_stake` | `0` | 100% |
| `resolve_dispute` → `RefundToInitiator` (no slash) | `beneficiary_stake` | `escrow_amount + initiator_stake` | 100% |
| `resolve_dispute` → `RefundToInitiator` (slash) | `0` | `escrow_amount + beneficiary_stake + initiator_stake` | 100% |
| `resolve_dispute` → `SplitFunds { bps }` | `escrow_amount * bps / 10_000 + beneficiary_stake` | `escrow_amount - b_share + initiator_stake` | 100% |
| `auto_release` (refund branch) | `beneficiary_stake` | `escrow_amount + initiator_stake` | 100% |
| `refund` | `beneficiary_stake` | `escrow_amount + initiator_stake` | 100% |
| `mutual_cancel_escrow` | `beneficiary_stake` | `escrow_amount + initiator_stake` | 100% |

**SplitFunds integer division:** `b_share = escrow_amount * bps / 10_000` uses integer division. The truncated remainder accrues to `i_share` (initiator). `checked_sub` at line 126 prevents underflow. Total is conserved exactly.

---

### ES-3: Dispute Window

**Statement:** `dispute_deadline_secs` must be at least 3600 seconds (1 hour). The post-release dispute window is 7 days.

**Minimum arbiter window enforcement** (`initialize_escrow.rs`, lines 107–110):

```rust
require!(
    params.dispute_deadline_secs >= 3600,
    EscrowError::InvalidDisputeDeadline
);
```

**Post-release dispute window:** Hard-coded as `7 * 24 * 3600` (604,800 seconds) in:
- `release_escrow.rs` line 47 (sets `dispute_window_ends_at = now + 7 days`)
- `auto_release.rs` line 66 (same calculation)

**Arbiter resolution deadline:** `dispute_record.resolution_deadline = now + dispute_deadline_secs` (set at `raise_dispute`, lines 80–82).

**Note:** There is no enforced upper bound on `dispute_deadline_secs` relative to `time_lock_expires_at`. See [Known Gaps](#known-gaps-and-auditor-flags).

---

### ES-4: Participant Uniqueness

**Statement:** Initiator, beneficiary, and arbiter must be three distinct pubkeys.

**Enforcement** (`initialize_escrow.rs`, lines 94–100):

```rust
require!(
    initiator_key != params.beneficiary
        && initiator_key != params.arbiter
        && params.beneficiary != params.arbiter,
    EscrowError::DuplicateParticipants
);
```

All three pairwise comparisons are checked. Additionally, each participant must supply a correctly-owned `AgentWallet` account (lines 73–83):
- `initiator_wallet.authority == initiator.key()`
- `beneficiary_wallet.authority == params.beneficiary`
- `arbiter_wallet.authority == params.arbiter`

**Immutability:** Participant keys are written at initialization and only read via Anchor `has_one` constraints thereafter. The uniqueness property is established at creation and cannot change.

**Error:** `EscrowError::DuplicateParticipants`

---

### ES-5: Reputation Gate

**Statement:** Reputation CPI validation is required for the initiator at `initialize_escrow` and `lock_escrow`, and for the beneficiary at `stake_beneficiary` and `lock_escrow`.

**Initiator check** (`initialize_escrow.rs`, lines 126–133):
CPI to `vaultpact::cpi::validate_reputation_for_pact` with `initiator_reputation_min`, `initiator_min_tier`, `initiator_min_pacts`.

**Initiator re-check — lock (Gap-2 / SEC-10)** (`lock_escrow.rs`, lines 65–72):
Initiator reputation re-validated at lock time to defend against reputation decay between initialization and lock.

**Beneficiary check — stake** (`stake_beneficiary.rs`, lines 61–67):
CPI with `pact_record.beneficiary_reputation_min`, `pact_record.beneficiary_min_tier`, `pact_record.beneficiary_min_pacts`.

**Beneficiary check — lock (C-1 re-check / SEC-10)** (`lock_escrow.rs`, lines 75–82):
Beneficiary reputation re-validated at lock time to defend against reputation decay between stake and lock.

**CPI helper** (`cpi_helpers.rs`, lines 5–28):
Maps `min_tier` to `vaultpact::VerifTier` enum (`0=Unverified`, `1=Attested`, `2=Hardline`).

---

### ES-6: Blacklist Enforcement (`protocol_freeze_pact`)

**Statement:** Only the protocol authority (via `AttestationRegistry.authority`) can call `protocol_freeze_pact`. Once the decision is set, the arbiter cannot override it.

**Authority check** (`protocol_freeze_pact.rs`, lines 36–38):

```rust
#[account(constraint = attestation_registry.authority == protocol_authority.key()
    @ EscrowError::UnauthorizedProtocolAuthority)]
```

**Blacklist status check** (line 65): `require!(wallet.status == 2, EscrowError::AgentNotBlacklisted)` where status `2` means blacklisted.

**Dual-wallet support** (lines 76–96): An optional `second_blacklisted_wallet` account allows the protocol authority to indicate both parties are blacklisted in a single call. When provided, the second wallet must also be blacklisted (`status == 2`), must belong to the other escrow party, and must differ from the first wallet (`DuplicateParticipants` guard).

**Decision logic (deterministic, not caller-supplied, lines 100–106):**
- Both parties blacklisted (requires both wallets): `SplitFunds { beneficiary_bps: 5000 }` (50/50 split)
- Only initiator blacklisted: `ReleaseToBeneficiary`
- Only beneficiary blacklisted: `RefundToInitiator`

**Irrevocability** (`resolve_dispute.rs`, lines 74–79):

```rust
let decision = if existing_decision != ArbiterDecision::None {
    existing_decision  // protocol-set decision takes precedence
} else { ... params.decision ... };
```

A compromised arbiter cannot override a protocol-set decision.

**Error:** `EscrowError::UnauthorizedProtocolAuthority`

---

### ES-7: Vault Integrity at Close

**Statement:** `close_escrow` rejects if the vault token account holds any balance.

**Enforcement** (`close_escrow.rs`, line 55):

```rust
require!(ctx.accounts.vault.amount == 0, EscrowError::VaultNotEmpty);
```

**Terminal status requirement** (lines 48–53):

```rust
require!(
    escrow.status == EscrowStatus::Released
        || escrow.status == EscrowStatus::Refunded
        || escrow.status == EscrowStatus::Claimed
        || escrow.status == EscrowStatus::MutuallyCancelled,
    EscrowError::InvalidStatus
);
```

Both checks must pass. An escrow in `Released` status with a non-empty vault (pre-`claim_released`) cannot be closed. `MutuallyCancelled` escrows have an empty vault (funds returned to both parties) so they pass both guards.

After checks pass, the vault token account is closed via `token::close_account` (lines 62–72) and all PDAs are closed via Anchor's `close` attribute.

**Error:** `EscrowError::VaultNotEmpty`

---

### ES-8: Oracle Trust Boundary

**Statement:** The escrow program itself contains no external oracle. The reputation oracle is a privileged off-chain signer in the Holdfast program that the escrow program trusts via CPI.

**Trust model:**
- The escrow program calls `vaultpact::cpi::validate_reputation_for_pact` as its reputation oracle.
- It passes `UncheckedAccount` for reputation accounts and relies entirely on the Holdfast program to validate ownership and thresholds.
- The escrow program calls `vaultpact::cpi::update_reputation` post-resolution using the `VAULTPACT_ESCROW_AUTHORITY` PDA as signer.
- All time-based logic uses `Clock::get()?.unix_timestamp` (Solana-native sysvar), not external price feeds or data oracles.

---

### ES-9: Active-Status Gates

**Statement:** All three participants (initiator, beneficiary, arbiter) must have `AgentWallet.status == 0` (Active) at escrow initialization. All three are re-checked at `lock_escrow`, and the beneficiary is additionally checked at `stake_beneficiary`. Frozen (status=1) or Blacklisted (status=2) agents are rejected.

**Enforcement — initialization** (`initialize_escrow.rs`, lines 112–114):

```rust
require!(ctx.accounts.initiator_wallet.status == 0, EscrowError::AgentNotActive);
require!(ctx.accounts.beneficiary_wallet.status == 0, EscrowError::AgentNotActive);
require!(ctx.accounts.arbiter_wallet.status == 0, EscrowError::AgentNotActive);
```

**Re-check at lock** (`lock_escrow.rs`, lines 60–62):

```rust
require!(ctx.accounts.initiator_wallet.status == 0, EscrowError::AgentNotActive);
require!(ctx.accounts.beneficiary_wallet.status == 0, EscrowError::AgentNotActive);
require!(ctx.accounts.arbiter_wallet.status == 0, EscrowError::AgentNotActive);
```

**Re-check at stake** (`stake_beneficiary.rs`, line 58):

```rust
require!(ctx.accounts.beneficiary_wallet.status == 0, EscrowError::AgentNotActive);
```

**Error:** `EscrowError::AgentNotActive`

---

### ES-10: Blacklist Settlement Gates

**Statement:** A blacklisted initiator cannot voluntarily release; a blacklisted beneficiary cannot claim. Frozen agents (status=1) CAN release and claim — this is an intentional asymmetry allowing settlement.

**Initiator release block** (`release_escrow.rs`, line 37):

```rust
require!(ctx.accounts.initiator_wallet.status != 2, EscrowError::AgentBlacklisted);
```

**Beneficiary claim block** (`claim_released.rs`, line 81):

```rust
require!(ctx.accounts.beneficiary_wallet.status != 2, EscrowError::AgentBlacklisted);
```

**Design note:** `status != 2` allows both Active (0) and Frozen (1). The Frozen state permits existing settlements to complete while blocking new pact participation (ES-9). Blacklisted agents (status=2) are blocked entirely; they must be handled via `protocol_freeze_pact` (ES-6).

**Error:** `EscrowError::AgentBlacklisted`

---

### ES-11: Time-Lock Validation

**Statement:** `time_lock_expires_at` must be strictly in the future at both escrow initialization and lock. Time-lock expiry checks use strict `>` (calling exactly at the deadline is blocked).

**Creation-time check** (`initialize_escrow.rs`, line 104):

```rust
require!(params.time_lock_expires_at > now, EscrowError::TimeLockInPast);
```

**Lock-time re-check** (`lock_escrow.rs`, line 77):

```rust
require!(escrow.time_lock_expires_at > now, EscrowError::TimeLockInPast);
```

**Expiry boundary** (`auto_release.rs`, line 59; `refund.rs`, line 56):

```rust
require!(now > escrow.time_lock_expires_at, EscrowError::TimeLockNotExpired);
```

Strict `>` in both directions means there is no single slot where the time-lock is simultaneously "valid" and "expired."

**Error:** `EscrowError::TimeLockInPast`, `EscrowError::TimeLockNotExpired`

---

### ES-12: Deposit Amount Binding

**Statement:** The deposit amount in `deposit_funds` is derived on-chain from stored values, not caller-supplied. The initiator deposits exactly `escrow_amount + initiator_stake`.

**Enforcement** (`deposit_funds.rs`, lines 40–42):

```rust
let deposit_amount = escrow.escrow_amount
    .checked_add(escrow.initiator_stake)
    .ok_or(EscrowError::ArithmeticOverflow)?;
```

The caller cannot supply a partial or inflated deposit. This guarantees the vault balance is correct when combined with the beneficiary stake at lock time (ES-2).

**Error:** `EscrowError::ArithmeticOverflow`

---

### ES-13: Escalation Protocol

**Statement:** Only the initiator or beneficiary may escalate a dispute. Escalation requires the arbiter's resolution deadline to have passed.

**Participant restriction** (`escalate_dispute.rs`, lines 43–46):

```rust
require!(
    escalator_key == escrow.initiator || escalator_key == escrow.beneficiary,
    EscrowError::NotParticipant
);
```

**Deadline guard** (`escalate_dispute.rs`, line 49):

```rust
require!(now > dispute.resolution_deadline, EscrowError::ResolutionDeadlineNotPassed);
```

**Idempotency guard** (`escalate_dispute.rs`, line 50):

```rust
require!(dispute.escalated_at == 0, EscrowError::DisputeAlreadyEscalated);
```

The arbiter cannot escalate their own unresolved dispute. Escalation is a **one-shot operation**: once `dispute.escalated_at` is set, the deadline is permanently pinned. A participant cannot re-escalate after the grace period expires to indefinitely defer the fallback refund. After escalation, `dispute.escalation_deadline = now + ESCALATION_GRACE_SECS` is set, enabling the fallback `refund` path from `Disputed` status.

**Error:** `EscrowError::NotParticipant`, `EscrowError::ResolutionDeadlineNotPassed`, `EscrowError::DisputeAlreadyEscalated`

---

### ES-14: Beneficiary Stake Idempotency

**Statement:** The beneficiary can only stake once per escrow. The stake amount is fixed at initialization by the initiator.

**Idempotency guard** (`stake_beneficiary.rs`, line 55):

```rust
require!(!escrow.beneficiary_staked, EscrowError::BeneficiaryAlreadyStaked);
```

**Amount binding** (`stake_beneficiary.rs`, line 69):

```rust
let stake_amount = escrow.beneficiary_stake;
```

The beneficiary cannot choose a different stake amount. They accept or reject the initiator-defined terms.

**Error:** `EscrowError::BeneficiaryAlreadyStaked`

---

### ES-15: Token-2022 Rejection

**Statement:** The escrow program only supports mints owned by the SPL Token program. Token-2022 mints are explicitly rejected.

**Enforcement** (`initialize_escrow.rs`, lines 117–119):

```rust
require!(
    *ctx.accounts.mint.to_account_info().owner == spl_token::id(),
    EscrowError::UnsupportedMintVersion
);
```

**Rationale:** Token-2022 features (transfer hooks, confidential transfers, mint close authority) could break vault assumptions. This is a v0.1 scope restriction.

**Error:** `EscrowError::UnsupportedMintVersion`

---

### ES-16: Token Account Ownership Constraints

**Statement:** Caller-supplied token accounts are validated for correct owner and mint in most instruction contexts.

**Standard pattern** (e.g., `deposit_funds.rs`, lines 22–26):

```rust
constraint = initiator_token_account.owner == initiator.key()
    @ EscrowError::UnauthorizedTokenAccount,
constraint = initiator_token_account.mint == escrow_account.mint
    @ EscrowError::UnauthorizedTokenAccount,
```

This pattern is consistently applied in `deposit_funds`, `auto_release`, `refund`, `resolve_dispute`, and `claim_released` for all participant token accounts. The previous exception for `claim_released` was resolved as part of the Gap 7 fix.

**Error:** `EscrowError::UnauthorizedTokenAccount`

---

### ES-17: Mutual Cancellation

**Statement:** Both the initiator and beneficiary must sign to mutually cancel a locked escrow. The escrow must be in `Locked` status with no active dispute, and neither party may be blacklisted. Funds are returned to their original depositors: initiator receives `escrow_amount + initiator_stake`, beneficiary receives `beneficiary_stake`.

**Dual-signature requirement** (`mutual_cancel_escrow.rs`, lines 10–11):

```rust
pub initiator: Signer<'info>,
pub beneficiary: Signer<'info>,
```

Both Anchor `Signer` constraints enforce that neither party can unilaterally cancel.

**Status restriction** (line 66):

```rust
require!(escrow.status == EscrowStatus::Locked, EscrowError::InvalidStatus);
```

Only `Locked` escrows can be mutually cancelled. Funded (pre-lock), Released, Disputed, and terminal states are excluded.

**Dispute guard** (line 69):

```rust
require!(ctx.accounts.dispute_record.is_none(), EscrowError::DisputeInProgress);
```

Belt-and-suspenders alongside the status check. If a dispute PDA exists, mutual cancel is blocked. Note: this is defense-in-depth — the status check is the primary guard since `raise_dispute` atomically transitions status to `Disputed`.

**Blacklist guard** (lines 72–73):

```rust
require!(ctx.accounts.initiator_wallet.status != 2, EscrowError::BlacklistedSigner);
require!(ctx.accounts.beneficiary_wallet.status != 2, EscrowError::BlacklistedSigner);
```

Blacklisted agents must be handled via `protocol_freeze_pact` (ES-6), not mutual cancellation.

**CEI pattern** (lines 86–87): Status set to `MutuallyCancelled` and `cancelled_at` written before any token transfers.

**Error:** `EscrowError::InvalidStatus`, `EscrowError::DisputeInProgress`, `EscrowError::BlacklistedSigner`

---

## Oracle Trust Model

The Holdfast reputation system has an explicit off-chain oracle component with the following trust assumptions:

### Unilateral Signing Power

The `REPUTATION_ORACLE_AUTHORITY` keypair (`3Kj7GpYVoARqCT1bfBmCC5NZhw37ahEiyxsJW9zcTSiy`) can:
- Set any agent's reputation to any value in `[0, 10_000]`
- Update reputation scores without consent of the agent
- Effectively blacklist an agent by setting score to 0

### Compromise Scenario

If the oracle keypair is compromised, an attacker could:
- Set all agent reputations to 0, blocking escrow participation
- Inflate a malicious agent's reputation to bypass minimum thresholds
- Manipulate reputation to influence dispute resolution outcomes

### Mainnet Mitigations (Planned)

Per ADR-001:
- Oracle keypair stored in HSM or hardware wallet
- Key rotation requires program redeployment (constant is compile-time)
- `VAULTPACT_ESCROW_AUTHORITY` is a PDA (cannot be compromised independently of the program)
- Future: multi-sig oracle quorum (not yet implemented)

### System Boundary

The oracle daemon is the ONLY path to reputation writes outside of the escrow program's CPI path. The two-authority gate (VP-8) ensures no third party can write reputation, but either authority acting alone has full write power within its scope.


---

## Cross-Program Trust Boundaries

| Caller | Callee | Trust Assumption |
|---|---|---|
| Escrow → Holdfast | `validate_reputation_for_pact` | Holdfast correctly validates that the reputation account belongs to the expected party and meets thresholds |
| Escrow → Holdfast | `update_reputation` | Holdfast correctly accepts the escrow PDA signer |
| Escrow → Holdfast | `AttestationRegistry` (read) | `authority` field accurately reflects the current protocol authority |
| Escrow → Holdfast | `AgentWallet` (read) | `status` field accurately reflects blacklist state |

**Critical dependency:** Reputation accounts are passed as `UncheckedAccount` to the escrow program. The escrow program does NOT verify PDA derivation or ownership — it delegates all validation to the Holdfast program via CPI. If `validate_reputation_for_pact` has a vulnerability allowing arbitrary accounts to pass, the reputation gate (ES-5) can be bypassed.

---

## CEI (Checks-Effects-Interactions) Compliance

All escrow instructions follow the CEI pattern to prevent reentrancy and ensure consistent state. This section documents the ordering discipline for the external audit.

### Terminology

| Phase | Definition | Examples |
|---|---|---|
| **Checks** | Validate preconditions; revert on failure | `require!`, Anchor `constraint`, read-only validation CPIs |
| **Effects** | Mutate program-owned account state | Writing `escrow.status`, `dispute.resolved_at`, etc. |
| **Interactions** | External calls that transfer value or modify foreign state | `token::transfer`, `cpi_update_reputation`, `token::close_account` |

### Design Decision: Read-Only Validation CPIs as Checks

`cpi_validate_reputation` calls into the Holdfast program to assert that a reputation account meets thresholds. It is **read-only**: it either succeeds (returning `Ok(())`) or reverts. It does not modify any account data. Auditors should treat these calls as part of the **Checks** phase, not the Interactions phase. The call cannot trigger reentrancy because:
1. The Holdfast program does not invoke any callback into the escrow program.
2. The call reads existing state and validates — it has no write effects.
3. Anchor's account deserialization occurs before the handler body; accounts are already borrowed.

### Per-Instruction CEI Table

| Instruction | Checks (last line) | Effects (first line) | Interactions (first line) | Strict CEI | Notes |
|---|---|---|---|---|---|
| `initialize_escrow` | L145 (reputation CPI) | L148 (`escrow.bump = ...`) | None | ✓ | No token transfers; account init is via Anchor decorator |
| `deposit_funds` | L38 (status check) | L45 (`escrow.status = Funded`) | L57 (`token::transfer`) | ✓ | |
| `stake_beneficiary` | L68 (reputation CPI) | L73 (`escrow.beneficiary_staked = true`) | L85 (`token::transfer`) | ✓ | |
| `lock_escrow` | L96 (time-lock check) | L98 (`escrow.status = Locked`) | None | ✓ | Reputation CPIs at L65–82 are checks |
| `release_escrow` | L37 (blacklist check) | L42 (`escrow.status = Released`) | None | ✓ | Pure state mutation |
| `auto_release` | L59 (time-lock expiry) | L62/L80 (status write) | L96 (`token::transfer`) | ✓ | Refund branch only |
| `raise_dispute` | L63 (temporal check) | L68 (`escrow.status = Disputed`) | None | ✓ | Dispute PDA init is via decorator |
| `claim_released` | L90 (dispute window) | L107 (`escrow.status = Claimed`) | L128 (`token::transfer`) | ✓ | Nonces pre-read at L99–100 |
| `resolve_dispute` | L83 (bps validation) | L140 (status write) | L167 (`token::transfer`) | ✓ | Nonces pre-read at L123–124; reputation CPI after transfers |
| `refund` | L65 (temporal check) | L77 (`escrow.status = Refunded`) | L93 (`token::transfer`) | ✓ | |
| `escalate_dispute` | L50 (idempotency) | L57 (`dispute.escalated_at = now`) | None | ✓ | Pure state mutation |
| `protocol_freeze_pact` | L72 (blacklist validation) | L220 (status write) | L256 (`token::transfer`) | ✓ | Nonces pre-read; reputation CPI after transfers |
| `mutual_cancel_escrow` | L73 (blacklist check) | L86 (status write) | L102 (`token::transfer`) | ✓ | |
| `close_escrow` | L56 (vault empty) | None | L73 (`token::close_account`) | ✓ | No escrow state written; PDAs closed via Anchor |

### Detailed CEI Ordering: Instructions with Token Transfers

**`claim_released`** (most complex — transfers + reputation CPI):

```
CHECKS   L80–L90   status, blacklist, dispute-window
         L99–L103  pre-read nonces and escrow_id (read-only snapshot)
EFFECTS  L106–L108 escrow.status = Claimed, resolved_at = now
INTERACT L117–L144 token::transfer (beneficiary payout, initiator stake return)
         L147–L167 cpi_update_reputation (initiator +50, beneficiary +50)
```

Nonces are read from typed accounts BEFORE any CPI, preventing a stale-nonce race if `update_reputation` were to modify the account mid-instruction.

**`resolve_dispute`** (transfers + reputation CPI):

```
CHECKS   L69–L83   status, decision precedence, bps bounds
         L122–L126 pre-read nonces and pact_id (read-only snapshot)
         L129–L171 payout computation (pure arithmetic, no state writes)
EFFECTS  L173–L185 escrow.status, dispute.arbiter_decision, resolved_at
INTERACT L188–L216 token::transfer (beneficiary payout, initiator payout)
         L218–L246 cpi_update_reputation (loser -100, winner +25, or split -25/-25)
```

Nonces are read from typed accounts BEFORE any state mutation or CPI. Reputation deltas are decision-dependent: `ReleaseToBeneficiary` penalises the initiator, `RefundToInitiator` penalises the beneficiary, `SplitFunds` gives both a mild negative.

**`refund`**:

```
CHECKS   L41–L65   status, temporal guards (time-lock or escalation)
EFFECTS  L77–L78   escrow.status = Refunded, resolved_at = now
INTERACT L93–L107  token::transfer (initiator amount, beneficiary stake)
```

**`mutual_cancel_escrow`**:

```
CHECKS   L62–L73   status, dispute guard, blacklist
EFFECTS  L86–L87   escrow.status = MutuallyCancelled, cancelled_at = now
INTERACT L102–L116 token::transfer (initiator refund, beneficiary stake)
```

### Reentrancy Mitigations

1. **No callback surface:** The escrow program exposes no instruction that the SPL Token program or Holdfast program could call back into during a transfer or CPI.
2. **PDA authority:** Vault transfers use the escrow account PDA as authority. The PDA signer seeds are derived from immutable data (`escrow_id`, `bump`), so no instruction can alter them mid-execution.
3. **Status written before transfer:** In all payout instructions, `escrow.status` is set to a terminal state (`Claimed`, `Refunded`, `MutuallyCancelled`) BEFORE any `token::transfer`. Even if a hypothetical reentrancy occurred, the status guard at the top of every instruction would reject the re-entrant call.
4. **Single-program execution model:** Solana's runtime does not support reentrancy within a single transaction for the same program — a program cannot CPI into itself. This is a runtime-level guarantee independent of the CEI discipline.

---

## Known Gaps and Auditor Flags

### Gap 1: Arbiter Window Upper Bound Not Enforced

The issue spec states "arbiter window must not exceed escrow lock duration." The code enforces only the lower bound (`dispute_deadline_secs >= 3600`). No `require!` compares `dispute_deadline_secs` against `time_lock_expires_at - now`. A caller could set an arbiter resolution window exceeding the escrow's total lifetime.

### Gap 2: Initiator Reputation Not Re-checked at Lock — FIXED ✅

~~Only the beneficiary receives a C-1 reputation re-check at `lock_escrow`. The initiator's reputation is checked only once at `initialize_escrow`.~~ **Fixed:** `lock_escrow.rs` lines 65–72 now calls `cpi_validate_reputation` for the initiator at lock time. Comment in source references "Gap-2 / SEC-10". Both initiator and beneficiary are now re-validated at lock.

### Gap 3: `EscrowStatus::Closed` Variant Unreachable

Discriminant `6` (`Closed`) is declared in the enum but no instruction ever writes it to the account field. The account is deleted by Anchor's `close` attribute. This creates a declared-but-unreachable variant.

### Gap 4: Integer Division Rounding in SplitFunds

`b_share = escrow_amount * bps / 10_000` truncates. The remainder accrues to the initiator. For very small `escrow_amount` values relative to 10,000, the beneficiary may receive materially less than the nominal percentage. Conservation is maintained; fairness may not be.

### Gap 5: Nonce Overflow at u64::MAX

No overflow guard on `rep.nonce + 1` in the comparison. At u64::MAX this would wrap to 0 in release mode, potentially allowing a single replay. Theoretical only (requires 2^64 calls per account).

### Gap 6: `protocol_freeze_pact` Does Not Transfer Funds — FIXED ✅

~~The protocol authority sets the decision but cannot force a payout. The arbiter must still call `resolve_dispute` (which will honor the locked decision), or the escalation timeout path via `refund` must be used.~~ **Fixed:** `protocol_freeze_pact` now atomically computes the decision, transfers funds from the vault to the correct parties, and updates reputation scores via CPI. The escrow transitions directly to a terminal state (`Claimed` or `Refunded`), eliminating any dependency on arbiter cooperation. A second call on an already-resolved escrow is rejected (`InvalidStatus`).

### Gap 7: `beneficiary_token_account` in `claim_released` Unconstrained — FIXED ✅

**Severity: HIGH.** ~~In `claim_released.rs` (lines 27–29), the `beneficiary_token_account` is declared as `#[account(mut)]` with NO `constraint` checks on `owner` or `mint`.~~ **Fixed:** Added `owner == escrow_account.beneficiary` and `mint == escrow_account.mint` constraints matching the pattern used for `initiator_token_account`. Also boxed large accounts to resolve BPF stack overflow. Security regression tests cover both wrong-owner and wrong-mint cases (`UnauthorizedTokenAccount`). Pending CTO review before audit submission.

### Gap 8: Re-Escalation Resets Deadline (Potential Griefing) — FIXED ✅

**Severity: HIGH.** ~~`escalate_dispute.rs` has no guard checking `dispute.escalated_at == 0` before allowing escalation.~~ **Fixed:** Added `require!(dispute.escalated_at == 0, EscrowError::DisputeAlreadyEscalated)` idempotency guard. Escalation is now a one-shot operation — the fallback refund deadline is permanently pinned on first escalation. Security regression test (bankrun) verifies second call is rejected. Pending CTO review before audit submission.

### Gap 9: Zero Stake Amounts Bypass Slash Incentive — FIXED ✅

~~`initiator_stake` and `beneficiary_stake` have no non-zero lower bound. A pact initialized with zero stakes makes the slash mechanic in `resolve_dispute` a no-op.~~ **Fixed:** `initialize_escrow.rs` lines 114–125 now enforce: (a) if `slash_loser_stake` is enabled, both stakes must be > 0 (`SlashRequiresStake`); (b) any non-zero stake must be >= `MINIMUM_STAKE` (1000 units, `StakeBelowMinimum`). Zero-stake pacts are still allowed when slashing is disabled (by design).

### Gap 10: Dead `require_arbiter_stake` Field — RESOLVED ✅

~~`PactRecord.require_arbiter_stake` is stored at initialization but is never read or enforced by any instruction.~~ **Resolved:** Field removed from `PactRecord` along with `x402_payment_ref` and `x402_channel_authority` (v0.1 stubs). `PactRecord::LEN` reduced from 408 to 344. `X402NotSupported` error code also removed.

### Gap 11: Nonce Overflow in Escrow CPI Calls — FIXED ✅

~~`claim_released.rs` passes `i_nonce + 1` and `b_nonce + 1` to the Holdfast `update_reputation` CPI using bare addition with no `checked_add`.~~ **Fixed:** Both `claim_released.rs` (lines 152, 163) and `resolve_dispute.rs` (lines 231, 242) now use `checked_add(1).ok_or(EscrowError::ArithmeticOverflow)?` for nonce increment before CPI calls.

### Gap 12: `SplitFunds` Ignores Slash Flag — RESOLVED (By Design) ✅

The `resolve_dispute` `SplitFunds` arm intentionally does not apply `pact.slash_loser_stake`. Unlike `ReleaseToBeneficiary` and `RefundToInitiator` which have a clear winner/loser, a `SplitFunds` decision is a compromise with no designated loser. Rationale:

1. **No loser to slash.** The `slash_loser_stake` flag semantics are "penalise the party at fault." A split indicates shared responsibility — neither party is solely at fault.
2. **Reputation system consistency.** `SplitFunds` assigns both parties `DISPUTE_SPLIT_DELTA` (−25), not the −100 loser penalty. Slashing would contradict this equal-blame signal.
3. **Cliff-effect avoidance.** Applying the slash flag would create a discontinuity: a 51/49 split would cause the minority party to lose their entire stake, while 50/50 would not.
4. **Fund conservation holds.** `b_payout + i_payout == escrow_amount + initiator_stake + beneficiary_stake` in all cases (verified by fuzz target `fuzz_payout`).

Code comment added at `resolve_dispute.rs:45`. Unit tests added for `SplitFunds + slash_loser_stake=true` (symmetric 50/50, asymmetric 30/70, and asymmetric bps with unequal stakes).

### Gap 13: Arbiter Status Not Re-checked at Lock — FIXED ✅

~~ES-9 documents that initiator and beneficiary wallet statuses are re-checked at `lock_escrow`, but the arbiter's status is NOT.~~ **Fixed:** `lock_escrow.rs` line 62 now checks `require!(ctx.accounts.arbiter_wallet.status == 0, EscrowError::AgentNotActive)`. All three participants (initiator, beneficiary, arbiter) are re-validated at lock time. ES-9 updated accordingly.

---

## Appendix: Error Code Reference

| Error | Code Context | Invariant |
|---|---|---|
| `DirectInvocationRequired` | VP-1 | CPI guard |
| `InvalidSignatureData` | VP-2 | Index validation |
| `InvalidAgentKey` | VP-3 | PDA seed uniqueness |
| `AttestationChallengeMismatch` | VP-4 | Challenge binding |
| `NonceMismatch` | VP-5 | Nonce monotonicity |
| `UnauthorizedReputationWriter` | VP-8 | Authority gate |
| `UnauthorizedAuthority` | VP-9 | Registry singleton |
| `InvalidStatus` | ES-1 | State machine |
| `DuplicateParticipants` | ES-4 | Participant uniqueness |
| `InvalidDisputeDeadline` | ES-3 | Dispute window |
| `VaultNotEmpty` | ES-7 | Vault integrity |
| `UnauthorizedProtocolAuthority` | ES-6 | Blacklist enforcement |
| `AgentNotBlacklisted` | ES-6 | Blacklist enforcement |
| `WalletNotPactParty` | ES-6 | Blacklist enforcement |
| `AgentNotActive` | ES-9 | Active-status gates |
| `AgentBlacklisted` | ES-10 | Settlement gates |
| `TimeLockInPast` | ES-11 | Time-lock validation |
| `TimeLockNotExpired` | ES-11 | Time-lock expiry |
| `ArithmeticOverflow` | ES-12 | Deposit amount binding |
| `NotParticipant` | ES-13 | Escalation access |
| `ResolutionDeadlineNotPassed` | ES-13 | Escalation timing |
| `BeneficiaryAlreadyStaked` | ES-14 | Stake idempotency |
| `UnsupportedMintVersion` | ES-15 | Token-2022 rejection |
| `UnauthorizedTokenAccount` | ES-16 | Token account ownership |
| `ZeroEscrowAmount` | ES-12 | Non-zero escrow amount |
| `VaultBalanceMismatch` | ES-2 | Vault balance at lock |
| `DisputeWindowOpen` | ES-1/ES-3 | Claim timing |
| `DisputeWindowClosed` | ES-1/ES-3 | Dispute timing |
| `DisputeNotEscalated` | ES-13 | Escalation required |
| `EscalationGracePeriodNotPassed` | ES-13 | Escalation grace |
| `DisputeAlreadyEscalated` | ES-13 | Escalation idempotency |
| `PactEscrowMismatch` | ES-1 | Pact-escrow binding |
| `InvalidVerifTier` | ES-5 | CPI reputation tier |
| `DisputeInProgress` | ES-17 | Mutual cancel dispute guard |
| `BlacklistedSigner` | ES-17 | Mutual cancel blacklist guard |
| `ReputationAccountMismatch` | ES-5 | Reputation CPI binding |
| `StakeBelowMinimum` | ES-14 | Minimum stake enforcement |
| `SlashRequiresStake` | ES-2 | Slash precondition |

---

## Appendix: Constants

| Constant | Value | Location |
|---|---|---|
| `NEUTRAL_SCORE` | `5_000` | `lib.rs` |
| `MAX_SCORE` | `10_000` | `lib.rs` |
| `FULFILLED_SCORE_DELTA` | `+50` | `claim_released.rs` |
| `DISPUTE_LOSER_DELTA` | `-100` | `resolve_dispute.rs` |
| `DISPUTE_WINNER_DELTA` | `+25` | `resolve_dispute.rs` |
| `DISPUTE_SPLIT_DELTA` | `-25` | `resolve_dispute.rs` |
| `ESCALATION_GRACE_SECS` | `604_800` (7 days) | `escalate_dispute.rs` |
| Post-release dispute window | `604_800` (7 days) | `release_escrow.rs`, `auto_release.rs` |
| Minimum `dispute_deadline_secs` | `3_600` (1 hour) | `initialize_escrow.rs` |
| Basis-points denominator | `10_000` | `resolve_dispute.rs` |
| Protocol freeze split (both blacklisted) | `5_000 bps` (50/50) | `protocol_freeze_pact.rs` |
| Decay precision | Table-based, 365 entries | `lib.rs` |

