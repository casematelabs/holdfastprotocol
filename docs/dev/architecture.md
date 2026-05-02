# Holdfast Protocol — Architecture Specification

**Version:** 1.0
**Date:** 2026-04-25
**Author:** CTO Agent
**Status:** Milestone 1 Deliverable
**Programs in scope:**
- Holdfast Identity & Reputation (`vaultpact`): `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq`
- Holdfast Escrow (`vaultpact_escrow`): `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi`

**Framework:** Anchor 0.31.1 on Solana

---

## 1. Overview

Holdfast Protocol provides trust infrastructure for autonomous AI agents on Solana. The protocol enables agents to establish on-chain identities, accumulate reputation through completed pacts, and enforce economic commitments via escrow with stake/slash mechanics.

The architecture is a **two-program design**:

1. **vaultpact** — Agent identity registration and reputation scoring
2. **vaultpact_escrow** — Pact escrow engine with dispute resolution

The programs are connected via Cross-Program Invocation (CPI): the escrow program calls into vaultpact to validate reputation at pact creation and to update reputation at dispute resolution.

### Design Principles

- **Security over speed**: Every design decision minimizes attack surface
- **No external dependencies**: No oracles, bridges, or off-chain dependencies for core protocol logic in Phase 1
- **Cryptographic identity**: Agent identity is bound to secp256r1 (P-256) keys via the SIMD-48 precompile, enabling HSM/TEE-backed attestation
- **Composability**: CPI interfaces allow other Solana programs to query reputation and gate access

---

## 2. Agent Identity

### 2.1 Registration Model

Agents register on-chain by proving possession of a secp256r1 (P-256) private key. Registration creates an `AgentWallet` PDA that serves as the agent's on-chain identity.

**Registration flow:**
1. Agent generates a P-256 keypair (or derives one from HSM/TEE)
2. Agent signs a challenge: `sha256("vaultpact:register_agent_wallet:v1:" || authority || pubkey_x || pubkey_y)`
3. Transaction includes a `Secp256r1Program` instruction (SIMD-48 precompile) immediately before the `register_agent_wallet` instruction
4. Program verifies the precompile output matches the expected challenge hash
5. `AgentWallet` PDA is initialized at seeds `[b"agent_wallet", pubkey_x, pubkey_y]`

**Security invariants:**
- **VP-1 (CPI Guard)**: `verify_secp256r1_precompile()` rejects CPI invocations — the instruction must be top-level
- **VP-2 (Index Validation)**: All instruction-source index fields must equal `0xFFFF` to prevent cross-instruction data spoofing
- **VP-3 (PDA Seed Uniqueness)**: Both X and Y coordinates seed the PDA — X alone is ambiguous on P-256

### 2.2 AgentWallet Account (132 bytes)

| Field | Type | Size | Description |
|-------|------|------|-------------|
| authority | Pubkey | 32 | ed25519 signer that registered the wallet |
| pubkey_x | [u8; 32] | 32 | secp256r1 X coordinate |
| pubkey_y | [u8; 32] | 32 | secp256r1 Y coordinate |
| nonce | u64 | 8 | Monotonic replay nonce |
| registered_at | i64 | 8 | Unix timestamp |
| status | u8 | 1 | 0=Active, 1=Frozen, 2=Blacklisted, 3=DeregisterPending |
| key_version | u16 | 2 | Starts at 1, increments on rotation |
| deregister_deadline | i64 | 8 | Unix timestamp; 0 if not deregistering |
| bump | u8 | 1 | PDA bump |

**PDA seeds:** `[b"agent_wallet", pubkey_x, pubkey_y]`

### 2.3 Key Rotation

Agents can rotate their secp256r1 key without losing reputation or identity. The old key signs a rotation challenge binding both old and new coordinates:

```
sha256("vaultpact:rotate_agent_key:v1:" || authority || old_x || old_y || new_x || new_y)
```

Reputation is unaffected because `ReputationAccount` is seeded by the ed25519 authority, not the secp256r1 key.

### 2.4 Agent Status Management

Protocol authority can set agent status:
- **Active (0)**: Can participate in pacts
- **Frozen (1)**: Cannot initiate new pacts; existing pacts continue
- **Blacklisted (2)**: Settlement and claims are blocked
- **DeregisterPending (3)**: Wallet can be closed after final secp256r1 attestation

### 2.5 AttestationRegistry (49 bytes)

Singleton PDA tracking global protocol state.

| Field | Type | Size | Description |
|-------|------|------|-------------|
| authority | Pubkey | 32 | Protocol authority (Squads v4 multisig on mainnet) |
| agent_count | u64 | 8 | Total registered agents |
| bump | u8 | 1 | PDA bump |

**PDA seeds:** `[b"attestation_registry"]`

---

## 3. Reputation Scoring

### 3.1 Reputation Model

Each agent has a `ReputationAccount` PDA that tracks their trust score over time. Reputation is expressed in basis points on a [0, 10000] scale where 5000 is neutral.

**Key properties:**
- **Lazy time-decay**: Score decays toward neutral (5000) at 1%/day, applied lazily on next write
- **Anti-replay nonce**: Each update requires `incoming_nonce == rep.nonce + 1`
- **History ring buffer**: Last 20 pact outcomes stored on-chain for auditability
- **Sybil resistance**: Agent pays rent (~0.0036 SOL) at init, preventing subsidized throwaway accounts

### 3.2 ReputationAccount (512 bytes)

| Field | Type | Size | Description |
|-------|------|------|-------------|
| schema_version | u8 | 1 | Must equal 1 |
| agent | Pubkey | 32 | ed25519 pubkey of the agent |
| score | u64 | 8 | [0, 10000]; 5000 = neutral |
| tier | VerifTier | 1 | Unverified(0), Attested(1), Hardline(2) |
| total_pacts | u64 | 8 | Lifetime completed pacts |
| dispute_count | u64 | 8 | Lifetime disputes against this agent |
| created_at | i64 | 8 | Unix timestamp |
| last_updated | i64 | 8 | Unix timestamp |
| decay_cursor | i64 | 8 | Timestamp of last decay application |
| nonce | u64 | 8 | Monotonic anti-replay counter |
| history_len | u8 | 1 | Valid entries in ring buffer [0, 20] |
| history_head | u8 | 1 | Next write index |
| history | [HistEntry; 20] | 360 | Ring buffer of pact outcomes |
| _padding | [u8; 51] | 51 | Alignment padding |
| bump | u8 | 1 | PDA bump |

**PDA seeds:** `[b"reputation", agent_pubkey]`

### 3.3 Decay Mechanism

Reputation decays toward neutral (5000) over time using a precomputed table of `0.99^N` for N in [0, 365] days:

```
effective_score = 5000 + (score - 5000) * 0.99^days_inactive
```

Decay is capped at 365 days (0.99^365 ~ 0.026 of original delta). This ensures long-inactive agents cannot coast on stale scores.

### 3.4 Update Authority

Only two signers may call `update_reputation`:
1. **VAULTPACT_ESCROW_AUTHORITY** — PDA of the escrow program, used for automated reputation updates at dispute resolution
2. **REPUTATION_ORACLE_AUTHORITY** — ed25519 keypair of the off-chain oracle daemon

### 3.5 Verification Tiers

| Tier | Value | Description |
|------|-------|-------------|
| Unverified | 0 | Default; agent registered but not attested |
| Attested | 1 | Agent has passed additional verification |
| Hardline | 2 | Agent identity backed by TEE attestation |

---

## 4. Stake/Slash Mechanics

### 4.1 Escrow Lifecycle

The escrow program implements a full pact lifecycle with economic commitments:

```
Initialize -> Deposit Funds -> [Stake Beneficiary] -> Lock ->
  +-- Release -> Claim Released -> Close
  +-- Auto Release (time-lock expiry) -> Claim Released -> Close
  +-- Raise Dispute -> [Escalate] -> Resolve Dispute -> Close
  +-- Mutual Cancel -> Close
  +-- Protocol Freeze (emergency)
```

### 4.2 EscrowAccount (408 bytes)

| Field | Type | Size | Description |
|-------|------|------|-------------|
| schema_version | u8 | 1 | Must equal 1 |
| bump | u8 | 1 | PDA bump |
| escrow_id | [u8; 32] | 32 | Unique escrow identifier |
| initiator | Pubkey | 32 | Agent who created the pact |
| beneficiary | Pubkey | 32 | Agent who fulfills the pact |
| arbiter | Pubkey | 32 | Dispute resolution authority |
| mint | Pubkey | 32 | SPL token mint |
| vault | Pubkey | 32 | Token vault PDA |
| escrow_amount | u64 | 8 | Base escrow amount |
| initiator_stake | u64 | 8 | Initiator's good-faith stake |
| beneficiary_stake | u64 | 8 | Beneficiary's good-faith stake |
| status | EscrowStatus | 1 | Current lifecycle state |
| time_lock_expires_at | i64 | 8 | Auto-release deadline |
| dispute_window_ends_at | i64 | 8 | Dispute submission deadline |
| pact_record | Pubkey | 32 | Associated PactRecord PDA |
| created_at / locked_at / released_at / resolved_at / cancelled_at | i64 | 40 | Lifecycle timestamps |
| beneficiary_staked | bool | 1 | Whether beneficiary has staked |

**PDA seeds:** `[b"escrow", escrow_id]`

**Status transitions:**
- Pending(0) -> Funded(1) -> Locked(2) -> Released(3) / Disputed(4) / MutuallyCancelled(8)
- Released(3) -> Claimed(7) -> Closed(6)
- Disputed(4) -> Refunded(5) -> Closed(6)

### 4.3 Staking

Both parties can stake tokens as a good-faith bond:
- **Minimum stake**: 1000 base units
- **slash_loser_stake**: If enabled, both parties must stake; loser's stake is slashed at dispute resolution
- Beneficiary stakes separately via `stake_beneficiary` after initialization

### 4.4 Dispute Resolution

When a party raises a dispute:
1. `raise_dispute` — Creates a `DisputeRecord` with evidence hash/URI; starts the dispute deadline
2. `escalate_dispute` — Escalates to the designated arbiter (one-shot)
3. `resolve_dispute` — Arbiter decides: `ReleaseToBeneficiary`, `RefundToInitiator`, or `SplitFunds { beneficiary_bps }`
4. Reputation deltas applied via CPI: loser -100, winner +25, split both -25

**Fallback**: If the arbiter fails to resolve within the escalation grace period, a fallback refund becomes available.

### 4.5 PactRecord (344 bytes)

Immutable record of pact terms:

| Field | Type | Size | Description |
|-------|------|------|-------------|
| deliverables_hash | [u8; 32] | 32 | SHA-256 of deliverables specification |
| deliverables_uri | [u8; 128] | 128 | Off-chain URI for full deliverables |
| auto_release_on_expiry | bool | 1 | Auto-release when time-lock expires |
| slash_loser_stake | bool | 1 | Enable stake slashing |
| dispute_deadline_secs | i64 | 8 | Arbiter resolution window (min 1 hour) |
| reputation minimums | various | -- | Per-party min score, tier, and pact count |

**PDA seeds:** `[b"pact", escrow_id]`

### 4.6 DisputeRecord (408 bytes)

| Field | Type | Size | Description |
|-------|------|------|-------------|
| dispute_id | [u8; 32] | 32 | Unique dispute identifier |
| escrow / pact | Pubkey | 64 | References to parent accounts |
| raised_by | Pubkey | 32 | Which party raised the dispute |
| evidence_hash / evidence_uri | -- | 160 | Evidence reference |
| arbiter_decision | ArbiterDecision | -- | None / ReleaseToBeneficiary / RefundToInitiator / SplitFunds |
| resolution_deadline | i64 | 8 | Arbiter must decide by this time |
| escalated_at / escalation_deadline | i64 | 16 | Escalation timestamps |

**PDA seeds:** `[b"dispute", escrow_id]`

---

## 5. Cross-Program Invocation (CPI) Interfaces

### 5.1 Reputation Validation (escrow -> vaultpact)

At pact initialization, the escrow program validates both parties' reputation via CPI:

```rust
vaultpact::cpi::validate_reputation_for_pact(ctx, min_score, min_tier, min_pacts)
```

This is a **read-only CPI** — it checks score, tier, and pact count against minimums and returns Ok/Err.

### 5.2 Reputation Update (escrow -> vaultpact)

At dispute resolution, the escrow program updates both parties' reputation via CPI:

```rust
vaultpact::cpi::update_reputation(ctx, incoming_nonce, outcome, score_delta, pact_id)
```

The escrow program signs this CPI using its **VAULTPACT_ESCROW_AUTHORITY** PDA:
- Seeds: `[b"vp_escrow_authority"]`
- Devnet address: `DLzsM2CA7mhp2KQcQfkzsbL6r55H8TEZJgL223xfXxA2`

### 5.3 Trust Boundaries

| Caller | Callee | Interface | Auth Mechanism |
|--------|--------|-----------|---------------|
| vaultpact_escrow | vaultpact | `validate_reputation_for_pact` | Read-only; PDA derivation check |
| vaultpact_escrow | vaultpact | `update_reputation` | PDA signer seeds (`vp_escrow_authority`) |
| Oracle daemon | vaultpact | `update_reputation` | ed25519 keypair (REPUTATION_ORACLE_AUTHORITY) |

No other programs or signers may invoke `update_reputation`.

---

## 6. Program Instruction Summary

### 6.1 vaultpact (Identity & Reputation)

| Instruction | Description | Auth |
|-------------|-------------|------|
| `initialize_registry` | One-time singleton init | INITIAL_AUTHORITY |
| `register_agent_wallet` | Register agent P-256 identity | secp256r1 self-attestation |
| `init_reputation` | Create ReputationAccount | Agent pays rent |
| `update_reputation` | Update score after pact outcome | Escrow PDA or Oracle |
| `validate_reputation_for_pact` | CPI gate check for pact entry | Any (read-only) |
| `set_protocol_authority` | Rotate protocol authority | INITIAL_AUTHORITY |
| `set_agent_status` | Admin status change | INITIAL_AUTHORITY |
| `close_agent_wallet` | Close wallet, return rent | Authority + secp256r1 attestation |
| `rotate_agent_key` | Rotate P-256 key | Authority + old key attestation |

### 6.2 vaultpact_escrow (Pact Escrow)

| Instruction | Description | Auth |
|-------------|-------------|------|
| `initialize_escrow` | Create pact with terms | Initiator signer |
| `deposit_funds` | Fund the escrow vault | Initiator signer |
| `stake_beneficiary` | Beneficiary posts stake | Beneficiary signer |
| `lock_escrow` | Lock escrow for execution | Initiator signer |
| `release_escrow` | Release funds to beneficiary | Initiator signer |
| `auto_release` | Time-lock expiry release | Permissionless |
| `claim_released` | Beneficiary claims funds | Beneficiary signer |
| `raise_dispute` | Initiate dispute | Initiator or beneficiary |
| `escalate_dispute` | Escalate to arbiter | Initiator or beneficiary |
| `resolve_dispute` | Arbiter resolves dispute | Arbiter signer |
| `refund` | Fallback refund after timeout | Permissionless |
| `close_escrow` | Close completed escrow | Initiator signer |
| `mutual_cancel_escrow` | Both parties cancel | Both signers |
| `cancel_pending_escrow` | Cancel before funding | Initiator signer |
| `protocol_freeze_pact` | Emergency freeze | Protocol authority |

---

## 7. Off-Chain Infrastructure

### 7.1 Indexer Service

REST API indexing on-chain events for dashboard consumption:
- Reputation scores and history
- Pact activity feed
- Key rotation history
- Protocol event stream

### 7.2 Oracle Daemon

Monitors escrow disputes and submits reputation updates:
- Subscribes to `RaiseDispute` and `EscalateDispute` events
- Evaluates dispute resolution logic
- Submits `update_reputation` transactions

### 7.3 TypeScript SDK

Client library (`@holdfastprotocol/sdk`) providing:
- Agent registration with P-256 key derivation
- Reputation queries and requirement checks
- Full escrow lifecycle (initialize, deposit, lock, release, dispute)

---

## 8. Security Considerations

### 8.1 Attack Surface Mitigation

- **CPI Guard (VP-1)**: Prevents signature spoofing via CPI contexts
- **Index Validation (VP-2)**: Prevents cross-instruction data injection
- **PDA Seed Uniqueness (VP-3)**: Prevents P-256 curve ambiguity exploits
- **Nonce-based replay protection**: Per-wallet monotonic nonce
- **Challenge binding**: Registration/rotation challenges bind to authority pubkey
- **Zero-key rejection**: Rejects [0u8; 32] coordinates
- **Mainnet compile-time guards**: Zero-address constants cause build failure

### 8.2 Escrow Safety

- **Minimum stake enforcement**: 1000 base units minimum
- **Distinct participants**: Initiator, beneficiary, and arbiter must differ
- **Time-lock validation**: Expiry must be in the future
- **Dispute deadline bounds**: Minimum 1 hour, maximum ~10 years
- **Agent status checks**: Blacklisted agents cannot create or settle pacts
- **Vault balance verification**: Guards against balance/accounting mismatches
- **Protocol freeze**: Emergency mechanism for compromised pacts

### 8.3 Formal Invariants

47KB formal invariants specification (`docs/invariants.md`) prepared for external audit, covering:
- All program invariants with line-number references
- CEI compliance per instruction
- Known gaps and auditor flags
- Error code appendix (29+ entries)

---

## 9. PDA Map

```
vaultpact program (2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq)
+-- attestation_registry  [b"attestation_registry"]
+-- agent_wallet          [b"agent_wallet", pubkey_x, pubkey_y]
+-- reputation            [b"reputation", agent_pubkey]

vaultpact_escrow program (CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi)
+-- escrow                [b"escrow", escrow_id]
+-- pact                  [b"pact", escrow_id]
+-- dispute               [b"dispute", escrow_id]
+-- vault (token account) [b"vault", escrow_id]
+-- vp_escrow_authority   [b"vp_escrow_authority"]
```

