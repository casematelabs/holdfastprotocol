# Holdfast Protocol — Formal Threat Model

**Version:** 1.0
**Date:** 2026-04-22
**Prepared by:** Head of Security, Casemate Labs
**Prepared for:** External Security Audit Engagement
**Classification:** Confidential — Audit Handoff

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [System Overview](#2-system-overview)
3. [Asset Inventory](#3-asset-inventory)
4. [Threat Actors](#4-threat-actors)
5. [Trust Boundaries](#5-trust-boundaries)
6. [Attack Surface Analysis](#6-attack-surface-analysis)
7. [Threat Catalogue](#7-threat-catalogue)
8. [Residual Risks and Known Gaps](#8-residual-risks-and-known-gaps)
9. [Key Management Assumptions](#9-key-management-assumptions)
10. [Deployment and Operational Risks](#10-deployment-and-operational-risks)
11. [Related Documents](#11-related-documents)

---

## 1. Purpose and Scope

This document provides a structured threat model for the Holdfast Protocol (formerly VaultPact), an on-chain system for autonomous AI agent identity, reputation, and programmable escrow on Solana. It is intended as the primary security reference for external audit firms evaluating the protocol prior to mainnet launch.

### In Scope

| Component | Type | Location |
|---|---|---|
| Holdfast Identity & Reputation program (`vaultpact`) | On-chain (Solana BPF) | `programs/vaultpact/src/` |
| Holdfast Escrow program (`vaultpact-escrow`) | On-chain (Solana BPF) | `programs/vaultpact-escrow/src/` |
| Cross-program invocation (CPI) interface | On-chain | Both programs |
| Reputation oracle daemon | Off-chain (Node.js) | `oracle/src/` |
| Escrow event indexer | Off-chain (Node.js) | `indexer/src/` |
| ElizaOS agent plugin | Off-chain (TypeScript) | `eliza-plugin/src/` |

### Out of Scope

- Frontend web application (docs site)
- CI/CD pipeline infrastructure
- Solana validator/runtime security
- SPL Token program internals

### Program Identifiers (Devnet)

| Program | ID |
|---|---|
| Holdfast Identity & Reputation | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| Holdfast Escrow | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

**Anchor version:** 0.31.1

---

## 2. System Overview

Holdfast Protocol is a three-layer stack for autonomous AI agent commerce:

```
┌──────────────────────────────────────────────────────┐
│                   AI Agent Clients                    │
│  (ElizaOS plugin, SDK consumers, direct RPC callers) │
└───────────────┬──────────────────────┬───────────────┘
                │                      │
       ┌────────▼────────┐    ┌────────▼────────┐
       │  Reputation     │    │  Escrow Event   │
       │  Oracle Daemon  │    │  Indexer         │
       └────────┬────────┘    └────────┬────────┘
                │ (signs tx)           │ (reads events)
    ┌───────────▼───────────────────────▼──────────┐
    │              Solana Runtime                    │
    │  ┌─────────────────┐  ┌────────────────────┐  │
    │  │   vaultpact      │◄─┤  vaultpact-escrow   │  │
    │  │   (identity +    │  │  (escrow lifecycle) │  │
    │  │    reputation)   │  │                    │  │
    │  └────────┬────────┘  └────────────────────┘  │
    │           │                                    │
    │  ┌────────▼────────┐                          │
    │  │ Secp256r1       │                          │
    │  │ Precompile      │                          │
    │  │ (SIMD-48)       │                          │
    │  └─────────────────┘                          │
    └───────────────────────────────────────────────┘
```

**Layer 1 — Attested Agent Custody:** Secp256r1/FIDO2-derived identity binding. Agents register on-chain by proving possession of a P-256 private key via the Solana native precompile. Forked from Hardline Protocol (post-audit); see ADR-001.

**Layer 2 — Reputation Engine:** Per-agent reputation scores `[0, 10,000]` with exponential decay toward neutral (5,000). Writable only by two compile-time authorities: the escrow program PDA and an off-chain oracle daemon.

**Layer 3 — Programmable Escrow:** Three-party (initiator, beneficiary, arbiter) escrow lifecycle with time-locks, dispute resolution, reputation-gated participation, and protocol-level blacklist enforcement.

---

## 3. Asset Inventory

### On-Chain Assets (High Value)

| Asset | Description | Maximum Exposure |
|---|---|---|
| Escrow vault token accounts | SPL token accounts holding escrowed funds | Per-pact: `escrow_amount + initiator_stake + beneficiary_stake` |
| Agent reputation scores | Determines escrow participation eligibility | Score manipulation can enable/block commerce |
| AgentWallet PDAs | On-chain identity binding (secp256r1 key → Solana pubkey) | Identity theft enables impersonation |
| AttestationRegistry singleton | Protocol authority pointer, agent count | Authority compromise = full protocol control |

### Off-Chain Assets

| Asset | Description | Impact if Compromised |
|---|---|---|
| `REPUTATION_ORACLE_AUTHORITY` keypair | Signs all off-chain reputation updates | Arbitrary reputation manipulation |
| `INITIAL_AUTHORITY` keypair (devnet) | Protocol admin operations | Agent freeze/blacklist, authority rotation |
| Oracle daemon process | Evaluates and submits reputation transactions | Reputation DoS or manipulation |
| Indexer database/state | Tracks escrow events for client queries | Stale/incorrect escrow state shown to agents |
| Eliza plugin signer key | Agent's Solana keypair for on-chain transactions | Unauthorized pact creation, fund movement |

---

## 4. Threat Actors

### TA-1: Malicious Agent (External)

A registered AI agent (or its operator) that has a valid AgentWallet PDA and attempts to exploit the protocol for financial gain or to harm other participants.

**Capabilities:** Submit arbitrary Solana transactions, craft custom instruction data, create multiple agent identities (Sybil), manipulate timing of transaction submission.

**Goals:** Steal escrowed funds, manipulate reputation to bypass thresholds, grief counterparties, avoid legitimate obligations.

### TA-2: Compromised Arbiter

An arbiter who colludes with one escrow party or whose signing key is compromised.

**Capabilities:** Call `resolve_dispute` with any `ArbiterDecision` variant, delay resolution past deadline to enable escalation/refund paths.

**Goals:** Redirect escrowed funds to a favored party, extract value via collusion.

### TA-3: Compromised Oracle Operator

An attacker who gains control of the `REPUTATION_ORACLE_AUTHORITY` keypair or the oracle daemon process.

**Capabilities:** Submit `update_reputation` transactions with arbitrary score deltas for any agent.

**Goals:** Inflate reputation of colluding agents, zero-out reputation of legitimate agents, disrupt escrow participation.

### TA-4: Protocol Authority Compromise

An attacker who gains control of the `INITIAL_AUTHORITY` key (devnet: single keypair; mainnet: 3-of-5 multisig).

**Capabilities:** `set_agent_status` (freeze/blacklist any agent), `set_protocol_authority` (rotate authority to attacker-controlled key), `protocol_freeze_pact` (force-resolve any active escrow).

**Goals:** Full protocol takeover, mass fund extraction via protocol_freeze_pact, permanent DoS via agent blacklisting.

### TA-5: External Attacker (No Registration)

An attacker without a registered AgentWallet who interacts with the protocol at the transaction level.

**Capabilities:** Submit crafted transactions, attempt CPI-based attacks, race conditions, front-running.

**Goals:** Exploit signature verification bypass, drain funds via unchecked accounts, manipulate transaction ordering.

### TA-6: Malicious Client/SDK Consumer

A developer building on the Holdfast SDK or ElizaOS plugin who submits malformed or adversarial parameters.

**Capabilities:** Supply extreme parameter values (zero stakes, maximum time-locks, boundary-condition inputs), pass incorrect account addresses.

**Goals:** Create escrows with broken incentive structures, bypass validation through edge cases.

---

## 5. Trust Boundaries

### TB-1: Secp256r1 Precompile Boundary

```
[Agent's P-256 Private Key] ──sign──► [Solana Secp256r1 Precompile] ──verify──► [vaultpact program]
```

**Trust assumption:** The Solana native Secp256r1 precompile (SIMD-48) correctly verifies P-256 ECDSA signatures. The vaultpact program trusts the precompile output and validates that:
- The precompile instruction precedes the vaultpact instruction in the same transaction (VP-1)
- The vaultpact instruction was invoked directly, not via CPI (VP-1)
- All three instruction-source indices are `0xFFFF` to prevent cross-instruction data injection (VP-2)
- The verified message matches the domain-separated challenge hash (VP-4)

**Boundary violation impact:** Identity spoofing — attacker registers or deregisters AgentWallets without key possession.

### TB-2: Reputation Oracle Boundary

```
[Off-chain Oracle Daemon] ──sign tx──► [Solana] ──update_reputation──► [vaultpact program]
```

**Trust assumption:** The `REPUTATION_ORACLE_AUTHORITY` ed25519 keypair is held exclusively by the legitimate oracle daemon. The on-chain program trusts any signed `update_reputation` call from this key without validating the business logic of the score delta.

**Boundary violation impact:** Arbitrary reputation manipulation for all agents.

**Mitigations:**
- Nonce monotonicity (VP-5) prevents replay of stale updates
- Score bounds [0, 10,000] (VP-6) limit the range of any single manipulation
- Mainnet plan: HSM-stored keypair, future multi-sig oracle quorum

### TB-3: Escrow → Holdfast CPI Boundary

```
[vaultpact-escrow] ──CPI──► [vaultpact::validate_reputation_for_pact]
[vaultpact-escrow] ──CPI──► [vaultpact::update_reputation] (PDA signer)
```

**Trust assumption:** The escrow program passes reputation accounts as `UncheckedAccount` and delegates all ownership/threshold validation to the Holdfast program. The escrow program trusts that:
- `validate_reputation_for_pact` correctly validates PDA derivation and score thresholds
- `update_reputation` correctly accepts the `VAULTPACT_ESCROW_AUTHORITY` PDA signer
- `AgentWallet.status` and `AttestationRegistry.authority` fields are accurate

**Boundary violation impact:** If `validate_reputation_for_pact` has a vulnerability allowing arbitrary accounts to pass validation, the reputation gate (ES-5) can be bypassed. Agents with insufficient reputation could participate in escrows.

**Critical note for auditors:** The `UncheckedAccount` pattern is the primary cross-program trust surface. The Holdfast program must validate that passed accounts are correctly derived PDAs owned by itself.

### TB-4: Protocol Authority Boundary

```
[INITIAL_AUTHORITY signer] ──► [initialize_registry, set_protocol_authority, set_agent_status]
[AttestationRegistry.authority] ──► [protocol_freeze_pact]
```

**Trust assumption:** The protocol authority key is held by authorized operators (devnet: single developer; mainnet: 3-of-5 Squads multisig). Protocol-level operations are irreversible at the escrow level — `protocol_freeze_pact` atomically resolves escrows with a deterministic, non-overridable decision.

**Boundary violation impact:** Complete protocol takeover. Mass agent blacklisting, arbitrary escrow resolution, authority rotation to attacker key.

**Mitigations:**
- Compile-time zero-address guard prevents shipping with placeholder authority
- `set_protocol_authority` gated by `INITIAL_AUTHORITY` (compile-time), not on-chain `authority` field — prevents chain of rotation attacks
- Mainnet: Squads v4 requires 3-of-5 hardware wallet signatures

### TB-5: Off-Chain ↔ On-Chain Data Boundary

```
[Indexer] ──reads──► [Solana RPC] (event logs, account state)
[Eliza Plugin] ──reads──► [Indexer HTTP API] (pact discovery)
[Eliza Plugin] ──submits──► [Solana RPC] (transactions)
```

**Trust assumption:** The indexer accurately reflects on-chain state. AI agent clients trust the indexer for pact discovery and status queries. On-chain programs have NO dependency on the indexer — all validation is self-contained.

**Boundary violation impact:** A compromised or stale indexer could cause agents to make decisions based on incorrect data (e.g., entering pacts with blacklisted counterparties). However, on-chain guards will reject invalid transactions regardless of indexer state.

### TB-6: Token Program Boundary

```
[vaultpact-escrow] ──CPI──► [SPL Token Program] (transfer, close_account)
```

**Trust assumption:** The SPL Token program correctly executes transfers and account closures. Token-2022 is explicitly rejected (ES-15) because its features (transfer hooks, confidential transfers, mint close authority) could break vault assumptions.

**Boundary violation impact:** If a Token-2022 mint were accepted, transfer hooks could introduce reentrancy vectors or fund interception. The explicit rejection mitigates this.

---

## 6. Attack Surface Analysis

### 6.1 Identity Program (`vaultpact`)

| Instruction | Entry Point | Attack Surface | Key Threats |
|---|---|---|---|
| `register_agent_wallet` | External tx (+ precompile) | Signature verification, PDA derivation | Identity spoofing (VP-1, VP-2), PDA collision (VP-3) |
| `close_agent_wallet` | External tx (+ precompile) | Signature verification, refund of lamports | Unauthorized deregistration, lamport theft |
| `rotate_agent_key` | External tx (+ precompile) | Old/new key validation, PDA migration | Key rotation replay, PDA orphaning |
| `init_reputation` | External tx | Account initialization | Duplicate reputation accounts (prevented by PDA uniqueness) |
| `update_reputation` | External tx (oracle or CPI) | Authority validation, nonce check, score bounds | Unauthorized writes (VP-8), replay (VP-5), score overflow |
| `validate_reputation_for_pact` | CPI only | Threshold comparison, account ownership | Account substitution if caller passes wrong accounts |
| `initialize_registry` | External tx (authority) | One-time init | Re-initialization (prevented by Anchor `init`) |
| `set_protocol_authority` | External tx (authority) | Authority rotation | Unauthorized rotation (gated by compile-time constant) |
| `set_agent_status` | External tx (authority) | Status change (Active/Frozen/Blacklisted) | Mass blacklisting if authority compromised |

### 6.2 Escrow Program (`vaultpact-escrow`)

| Instruction | Entry Point | Attack Surface | Key Threats |
|---|---|---|---|
| `initialize_escrow` | External tx | Parameter validation, reputation CPI, participant uniqueness | Extreme parameters (TA-6), identity spoofing (ES-4), reputation bypass |
| `deposit_funds` | External tx | Token transfer, status transition | Double-deposit (prevented by status gate), wrong token account |
| `stake_beneficiary` | External tx | Token transfer, idempotency | Double-stake (ES-14), blacklisted beneficiary (ES-9) |
| `lock_escrow` | External tx | Balance verification, reputation re-check, time-lock | Vault manipulation (AV-5), stale reputation (ES-5) |
| `release_escrow` | External tx | Blacklist check, status transition | Blacklisted initiator release (ES-10) |
| `claim_released` | External tx | Dispute window timing, token transfer | Premature claim (ES-3), blacklisted beneficiary (ES-10) |
| `auto_release` | External tx (permissionless) | Time-lock expiry, dual-path logic | Timing manipulation (AV-2) |
| `raise_dispute` | External tx (participant) | Participant check, dispute window, PDA init | Unauthorized dispute (AV-9), PDA re-init |
| `escalate_dispute` | External tx (participant) | Deadline check, idempotency | Re-escalation griefing (ES-13, fixed) |
| `resolve_dispute` | External tx (arbiter) | Decision application, fund distribution | Arbiter collusion (TA-2), protocol decision override (ES-6) |
| `refund` | External tx (permissionless) | Time-lock/escalation expiry | Premature refund (ES-11) |
| `protocol_freeze_pact` | External tx (authority) | Blacklist verification, atomic payout | Authority impersonation (AV-8), wrong blacklist target |
| `mutual_cancel_escrow` | External tx (dual-sign) | Both parties sign, no dispute, no blacklist | Unilateral cancel attempt (ES-17) |
| `close_escrow` | External tx | Vault empty check, terminal status | Premature close with non-empty vault (ES-7) |
| `cancel_pending_escrow` | External tx (initiator) | Status = Pending only | Cancel after funding |

### 6.3 Off-Chain Components

| Component | Attack Surface | Key Threats |
|---|---|---|
| Reputation Oracle Daemon | Keypair storage, RPC connection, evaluation logic | Key theft, logic manipulation, DoS |
| Escrow Indexer | RPC subscription, HTTP API, state store | Data poisoning (stale state), API abuse, state corruption |
| ElizaOS Plugin | Signer key management, RPC/indexer URLs, action validation | Key exposure via env var, connecting to malicious indexer |

---

## 7. Threat Catalogue

### T-1: Secp256r1 Signature Replay Across Instructions

**STRIDE:** Spoofing
**Actors:** TA-1, TA-5
**Target:** TB-1

A signature captured from a `register_agent_wallet` transaction could be replayed in a `close_agent_wallet` or `rotate_agent_key` transaction.

**Mitigation:** Domain-separated challenge prefixes (VP-4). Each instruction type hashes a unique prefix into the challenge: `"vaultpact:register_agent_wallet:v1:"`, `"vaultpact:close_agent_wallet:v1:"`, `"vaultpact:rotate_agent_key:v1:"`. Cross-instruction replay produces a challenge mismatch. Additionally, each challenge binds the `authority` pubkey, preventing cross-authority replay.

**Status:** Mitigated.

### T-2: CPI-Based Precompile Verification Bypass

**STRIDE:** Spoofing
**Actors:** TA-5
**Target:** TB-1

An attacker constructs a malicious program that CPIs into vaultpact, attempting to use a precompile instruction from a different position in the transaction to satisfy the verification check.

**Mitigation:** VP-1 enforces `current_ix.program_id == crate::ID` — the vaultpact instruction must be top-level, not invoked via CPI. VP-2 enforces all three instruction-source indices are `0xFFFF`, preventing the precompile from reading data from an attacker-controlled instruction.

**Status:** Mitigated (inherited from Hardline audit: M-SOL-6, H-2).

### T-3: PDA Collision via Ambiguous Secp256r1 Key

**STRIDE:** Spoofing
**Actors:** TA-1
**Target:** TB-1

For any X coordinate on the P-256 curve, two valid Y values exist. If PDA seeds used only X, two different public keys would map to the same AgentWallet PDA.

**Mitigation:** VP-3 seeds PDAs with both `pubkey_x` and `pubkey_y` (64 bytes). Zero-key rejection prevents degenerate cases. Inherited from Hardline audit: L-SOL-4.

**Status:** Mitigated.

### T-4: Oracle Reputation Manipulation

**STRIDE:** Tampering, Elevation of Privilege
**Actors:** TA-3
**Target:** TB-2

A compromised oracle keypair allows the attacker to set any agent's reputation to any value in [0, 10,000], enabling:
- Inflating colluding agents' scores to bypass escrow thresholds
- Zeroing legitimate agents' scores to block their participation
- Manipulating scores to influence which agents can enter high-value pacts

**Mitigations:**
- Score bounds [0, 10,000] limit damage per update (VP-6)
- Nonce monotonicity prevents replay (VP-5)
- Mainnet: HSM-stored keypair, planned multi-sig oracle quorum
- The escrow program's PDA signer (`VAULTPACT_ESCROW_AUTHORITY`) is independent — oracle compromise does not affect post-resolution reputation updates

**Residual risk:** The oracle has unilateral signing power. Until multi-sig oracle quorum is implemented, this is a single point of failure for reputation integrity. See [Section 8](#8-residual-risks-and-known-gaps).

### T-5: Arbiter Collusion in Dispute Resolution

**STRIDE:** Tampering
**Actors:** TA-2
**Target:** Escrow funds

A colluding arbiter calls `resolve_dispute` with a decision favoring their co-conspirator (e.g., `ReleaseToBeneficiary` with slash when the initiator should win).

**Mitigations:**
- Arbiter is nominated by the initiator at pact creation and visible to all parties — reputation serves as a trust signal
- `protocol_freeze_pact` can override an arbiter's decision if a party is subsequently blacklisted (ES-6)
- Irrevocability: a protocol-set decision from `protocol_freeze_pact` cannot be overridden by the arbiter
- Escalation path: if the arbiter fails to act within `dispute_deadline_secs`, either party can escalate (ES-13)
- Reputation deltas: arbiter reputation is not currently affected by their decisions (potential future improvement)

**Residual risk:** Within the resolution deadline, a colluding arbiter can make an unfavorable but technically valid decision. The protocol cannot distinguish collusion from legitimate adjudication.

### T-6: Reentrancy via Token Transfer CPI

**STRIDE:** Tampering
**Actors:** TA-5
**Target:** Escrow vault

A malicious CPI callback during `token::transfer` re-enters an escrow instruction to extract funds twice.

**Mitigations:**
- Strict CEI ordering: status written to terminal state BEFORE any token transfer (see invariants.md CEI table)
- Solana runtime prevents self-CPI (a program cannot call itself within the same transaction)
- No callback surface: SPL Token program does not invoke callbacks into the calling program
- Token-2022 rejection (ES-15) prevents transfer hooks from introducing callback vectors

**Status:** Mitigated (defense in depth: CEI + runtime guarantee + Token-2022 rejection).

### T-7: Front-Running and Transaction Ordering Attacks

**STRIDE:** Tampering
**Actors:** TA-1, TA-5
**Target:** Escrow state transitions

An attacker observes a pending `release_escrow` transaction and front-runs with `raise_dispute` to block the release.

**Mitigations:**
- `release_escrow` atomically transitions status to `Released` — if it lands first, the dispute window starts
- `raise_dispute` from `Released` status is valid only within the 7-day post-release window — this is by design, not a vulnerability
- Time-lock expiry paths (`auto_release`, `refund`) use permissionless cranks with strict temporal guards
- No MEV-style extraction: fund amounts are fixed at initialization and cannot be manipulated by transaction ordering

**Residual risk:** In Solana's leader-based block production, transaction ordering within a slot is not guaranteed. However, all state transitions are gated by status checks, so ordering cannot cause an invalid transition — at worst, one party's transaction lands before another's in the same slot.

### T-8: Protocol Authority Takeover

**STRIDE:** Elevation of Privilege
**Actors:** TA-4
**Target:** TB-4

Compromise of the `INITIAL_AUTHORITY` key grants:
- Mass agent blacklisting via `set_agent_status`
- Forced escrow resolution via `protocol_freeze_pact` (with deterministic but potentially unfavorable payouts)
- Authority rotation via `set_protocol_authority` to an attacker-controlled key

**Mitigations:**
- `set_protocol_authority` is gated by the compile-time `INITIAL_AUTHORITY`, not the on-chain `authority` field — even if the attacker rotates the on-chain authority, they cannot re-rotate via `set_protocol_authority` without the original key
- Mainnet: Squads v4 3-of-5 multisig requires compromising 3 hardware wallets
- Compile-time zero-address guard prevents mainnet deployment with placeholder

**Residual risk (devnet):** Single keypair authority. Keypair compromise is equivalent to full protocol takeover.

### T-9: UncheckedAccount Substitution in CPI

**STRIDE:** Tampering
**Actors:** TA-1, TA-5
**Target:** TB-3

The escrow program passes reputation accounts as `UncheckedAccount` to the Holdfast program. An attacker could attempt to pass a crafted account that satisfies the Holdfast program's validation incorrectly.

**Mitigations:**
- The Holdfast program's `validate_reputation_for_pact` validates PDA derivation (`seeds = [b"reputation", agent_pubkey]`) and checks account ownership
- Account data is deserialized by the callee (Holdfast program), not the caller (escrow program)
- The CPI crosses program boundaries — the callee validates against its own program ID as owner

**Auditor note:** This is the highest-priority cross-program review area. Verify that `validate_reputation_for_pact` cannot accept an account that is not a legitimate `ReputationAccount` PDA owned by the vaultpact program.

### T-10: Sybil Attack via Multiple Agent Registrations

**STRIDE:** Spoofing
**Actors:** TA-1
**Target:** Reputation system

An attacker registers many AgentWallet PDAs with different secp256r1 keys, each starting at the neutral reputation score (5,000), to flood the system with fresh identities and bypass reputation thresholds.

**Mitigations:**
- Each registration requires a valid secp256r1 signature (hardware cost per identity)
- Reputation thresholds at escrow initialization can require minimum completed pacts (`min_pacts` parameter), not just minimum score
- `min_tier` parameter can require attestation level (Attested or Hardline), raising the bar beyond key-generation
- Off-chain oracle can implement Sybil detection heuristics

**Residual risk:** The on-chain program cannot prevent Sybil registration at the identity layer. Defense relies on reputation thresholds and off-chain detection.

### T-11: Denial of Service via Escrow Griefing

**STRIDE:** Denial of Service
**Actors:** TA-1
**Target:** Specific agents

An attacker creates many escrows naming a target as beneficiary or arbiter, then abandons them, tying up the target in pending obligations.

**Mitigations:**
- `cancel_pending_escrow` allows the initiator to cancel before deposit (no fund lock-up)
- Escrows in `Pending` status require no action from beneficiary/arbiter
- The beneficiary must explicitly opt in via `stake_beneficiary`
- Time-lock expiry enables permissionless refund for abandoned locked escrows

**Residual risk:** A flood of `initialize_escrow` calls naming a target could create noise. No on-chain rate limiting exists; this is an off-chain/client filtering concern.

### T-12: Time-Lock Boundary Condition Exploitation

**STRIDE:** Tampering
**Actors:** TA-1, TA-6
**Target:** Escrow timing

An attacker sets `time_lock_expires_at` to a value barely in the future, or sets `dispute_deadline_secs` to an extremely large value relative to the time-lock.

**Mitigations:**
- `time_lock_expires_at > now` at initialization and lock (ES-11)
- `dispute_deadline_secs >= 3600` minimum (ES-3)
- Strict `>` boundary semantics prevent exact-boundary exploitation (AV-2)

**Residual risk (Gap 1):** No upper bound on `dispute_deadline_secs` relative to `time_lock_expires_at`. An arbiter resolution window could exceed the escrow lifetime. Clients should validate this off-chain.

**Design note (INV-T12):** All time boundary comparisons use strict `<` / `>` (never `<=` / `>=`). At exactly `now == boundary`, neither the pre-boundary nor post-boundary action is permitted, creating a 1-second dead zone that prevents race conditions. See §10.5 for the full boundary semantics table.

### T-13: Integer Division Rounding Exploitation

**STRIDE:** Tampering
**Actors:** TA-6
**Target:** SplitFunds payout fairness

For `SplitFunds` disputes: `b_share = escrow_amount * bps / 10_000` uses integer truncation. With very small `escrow_amount` values, the beneficiary receives disproportionately less.

**Mitigation:** Remainder accrues to initiator (deterministic, not exploitable for additional extraction). Payout conservation (ES-2) ensures total equals vault balance.

**Residual risk (Gap 4):** Unfairness for micro-escrows. Not a fund-loss risk, but a fairness concern for auditor awareness.

### T-14: Eliza Plugin Key Exposure

**STRIDE:** Information Disclosure
**Actors:** TA-5 (server compromise)
**Target:** TB-5

The ElizaOS plugin accepts a `privateKeyBase58` configuration parameter. If the hosting environment is compromised, the agent's signing key is exposed.

**Mitigations:**
- Plugin supports HSM/KMS signer pattern (Pattern B in integration docs) as alternative
- Read-only mode (Pattern C) requires no signing key
- Environment variable storage (not hardcoded)

**Recommendation:** Mainnet deployments must use HSM/KMS signing, not raw private keys.

### T-15: Indexer State Poisoning

**STRIDE:** Tampering, Information Disclosure
**Actors:** TA-5 (infrastructure compromise)
**Target:** TB-5

A compromised indexer returns incorrect escrow state to agent clients, causing them to enter pacts with blacklisted counterparties or miss active disputes.

**Mitigations:**
- On-chain programs validate all state independently — a stale indexer cannot cause an invalid on-chain transaction to succeed
- Agents can verify indexer data against on-chain state via direct RPC queries
- Indexer is read-only (subscribes to events, does not submit transactions)

**Residual risk:** Agents relying solely on the indexer for decision-making could be misled. Defense requires client-side verification of critical data before high-value transactions.

---

## 8. Residual Risks and Known Gaps

### Critical Residual Risks

| ID | Risk | Severity | Mitigation Status |
|---|---|---|---|
| RR-1 | Oracle centralization — single keypair has unilateral reputation write power | High | Accepted for devnet. Mainnet requires multi-sig oracle quorum (not yet implemented) |
| RR-2 | Devnet authority is single keypair (not multisig) | High | Accepted for devnet. Mainnet requires Squads v4 3-of-5 |
| RR-3 | `UncheckedAccount` CPI pattern requires callee-side validation correctness | Medium | Validation exists; requires audit verification |

### Known Gaps (from invariants.md v1.6)

| Gap | Description | Severity | Status |
|---|---|---|---|
| Gap 1 | Arbiter window upper bound not enforced vs. time-lock | Low | Open — client-side validation recommended |
| Gap 3 | `EscrowStatus::Closed` variant unreachable | Informational | Open — dead code, no security impact |
| Gap 4 | Integer division rounding in SplitFunds | Low | Open — fairness concern for micro-escrows |
| Gap 5 | Nonce overflow at u64::MAX | Informational | Open — theoretical only (2^64 calls) |
| Gap 12 | `SplitFunds` ignores `slash_loser_stake` flag | Low | Resolved — intentional by design, documented (CAS-397) |

### Audit Disposition Decisions (2026-04-23)

The following findings from QA review (CAS-379) were evaluated for fix vs. disclose. Both are accepted as known trade-offs and will be documented in the audit scope submission.

| ID | Finding | Severity | Disposition | Rationale |
|---|---|---|---|---|
| M-2 | No minimum delay between dispute creation and arbiter resolution | Medium | Disclose | Trust assumption on arbiter role. Arbiter is nominated by initiator and accepted by beneficiary at pact entry. Minimum delay does not prevent collusion — attacker simply waits. Existing safeguards: escalation path (ES-13), protocol freeze override (ES-6), 1-hour minimum arbiter window. |
| M-3 | DisputeRecord PDA persists after resolution until `close_escrow` is called | Low | Disclose | Cleanup path exists via `close_escrow` (Anchor `close = initiator`). Orphan scenario requires initiator to never call close — economically irrational (~0.003 SOL rent recovery). Standard Solana initiator-gated cleanup pattern. No security impact. |

### Invariant: `beneficiary_staked` guard on all payout paths

**INV-M1:** Every instruction that reads `escrow.beneficiary_stake` for payout computation MUST gate it behind the `beneficiary_staked` boolean:

```rust
let beneficiary_stake = if escrow.beneficiary_staked { escrow.beneficiary_stake } else { 0 };
```

This prevents phantom beneficiary stake from inflating payouts when the beneficiary has not actually deposited funds. The guard is applied in:

- `protocol_freeze_pact.rs` (line 177) — freeze/slash payout path
- `resolve_dispute.rs` (line 179) — arbiter dispute resolution payout path

M-1 finding (CAS-417): the guard was initially missing in `resolve_dispute.rs`, creating an inconsistency between payout paths. Fixed in CAS-426.

### Previously Fixed Gaps

Gaps 2, 6, 7, 8, 9, 10, 11, 13 have been fixed and verified in source. See `invariants.md` v1.6 for details. Gap 7 (unconstrained `beneficiary_token_account`) and Gap 8 (re-escalation griefing) were HIGH severity.

---

## 9. Key Management Assumptions

### Devnet Key Inventory

| Key | Type | Storage | Rotation Procedure |
|---|---|---|---|
| `INITIAL_AUTHORITY` | ed25519 keypair | `keys/devnet-protocol-authority.json` (gitignored, 1Password) | Generate new keypair, update `lib.rs` constant, redeploy |
| `REPUTATION_ORACLE_AUTHORITY` | ed25519 keypair | `~/.config/solana/oracle-devnet.json` | Generate new keypair, update `lib.rs` constant, redeploy |
| `VAULTPACT_ESCROW_AUTHORITY` | PDA (off-curve) | Derived from escrow program ID | Changes automatically if escrow program ID changes |
| Escrow program deploy key | ed25519 keypair | `~/.config/solana/escrow-program-devnet.json` | Standard Solana program upgrade authority |
| Identity program deploy key | ed25519 keypair | `~/.config/solana/id-program-devnet.json` | Standard Solana program upgrade authority |

### Mainnet Key Requirements

| Key | Required Change | Blocker |
|---|---|---|
| `INITIAL_AUTHORITY` | Squads v4 3-of-5 multisig vault PDA | Squads program setup, signer hardware procurement |
| `REPUTATION_ORACLE_AUTHORITY` | HSM-stored keypair | HSM vendor selection, key ceremony |
| Program upgrade authorities | Squads v4 multisig (same or different from INITIAL_AUTHORITY) | Governance design decision |
| Oracle daemon signer | HSM or hardware wallet integration | Runtime integration work |

### Key Rotation Constraints

- `REPUTATION_ORACLE_AUTHORITY` and `VAULTPACT_ESCROW_AUTHORITY` are compile-time constants. Rotation requires program redeployment.
- `set_protocol_authority` rotates the on-chain `AttestationRegistry.authority` field but is gated by the compile-time `INITIAL_AUTHORITY` — a chain of rotations is not possible without the original key.
- Program upgrade authority can upgrade the program (changing constants) — this is gated separately and must also be under multisig for mainnet.

---

## 10. Deployment and Operational Risks

### 10.1 Program Upgrade Path

Both programs are currently upgradeable (standard Solana BPF Loader). The program upgrade authority can deploy new code, which could change any behavior including authority constants.

**Mainnet requirement:** Program upgrade authority must be under multisig control or the program must be made immutable post-audit.

### 10.2 WebAuthn Origin Pinning

The `ALLOWED_ORIGINS` constant restricts which origins can produce valid WebAuthn assertions. If this list includes overly broad origins (e.g., `localhost` in production), an attacker on a local network could forge origin-valid assertions.

**Mainnet requirement:** Remove all localhost/development origins from `ALLOWED_ORIGINS` in the mainnet build.

### 10.3 Oracle Daemon Availability

If the oracle daemon goes offline, no off-chain reputation updates are processed. Agents retain their last-known scores, which decay toward neutral (5,000) over time per the decay function (VP-7). The escrow program's CPI-based reputation updates (post-dispute) continue functioning independently since they use the PDA signer.

**Impact:** Temporary oracle outage degrades reputation freshness but does not halt escrow operations.

### 10.4 Indexer Availability

If the indexer goes offline, agent clients lose pact discovery and status query capabilities. On-chain operations are unaffected.

**Impact:** Agents cannot discover new pacts or query escrow status via the API. Direct RPC queries remain available as a fallback.

### 10.5 Clock Manipulation

All time-based logic uses `Clock::get()?.unix_timestamp` (Solana sysvar). Solana's clock is maintained by validators and is approximate (typically within a few seconds). Precise boundary attacks at exactly `time_lock_expires_at` or `dispute_window_ends_at` are mitigated by strict `>` / `<` comparisons (no `>=` / `<=`).

**Boundary semantics table (INV-T12):**

| Instruction | Condition | Semantics |
|---|---|---|
| `raise_dispute` | `now < dispute_window_ends_at` | Dispute open while strictly before end |
| `claim_released` | `now > dispute_window_ends_at` | Claim allowed strictly after end |
| `auto_release` | `now > time_lock_expires_at` | Release after strict expiry |
| `refund` | `now > time_lock_expires_at` | Refund after strict expiry |
| `cancel_pending_escrow` | `now > time_lock_expires_at` | Cancel after strict expiry |

At `now == boundary`, neither the pre-boundary action (dispute) nor the post-boundary action (claim) is permitted. This 1-second dead zone is intentional: it eliminates race conditions where both actions could succeed in the same slot. Because Solana slot times (~400ms) are shorter than the 1-second gap, no valid transaction can fall through both checks simultaneously.

---

## 11. Related Documents

| Document | Path | Description |
|---|---|---|
| Formal Invariants Specification v1.6 | `docs/invariants.md` | Per-invariant enforcement evidence with line references |
| Escrow Engine Threat Model | `holdfast/docs/tm_escrow_engine.md` | Attack vector analysis for escrow instructions |
| ADR-001: Cryptographic Fork | `holdfast/docs/adr-001-crypto-fork.md` | What was kept/removed from Hardline Protocol |
| Governance — Devnet Authority | `holdfast/docs/governance-devnet.md` | Devnet authority setup, rotation plan |
| Integration Guide | `holdfast/docs/integration-guide.md` | PDA derivations, IDL reference, SDK quickstart |
| ElizaOS Integration Guide | `holdfast/docs/elizaos-integration-guide.md` | Plugin setup, signer patterns |

---

*This document should be reviewed and updated before each audit engagement. All line references correspond to the codebase as of 2026-04-22.*
