# Holdfast Protocol — Security Audit Findings & Remediation

**Audit date:** April 2026  
**Completed:** April 25, 2026  
**Verdict:** Conditional sign-off — all blocking findings remediated  
**Tracking issues:** [HOL-14] audit review · [HOL-16] H-1 fix · [HOL-17] M-1–M-4 / L-3 fixes

---

## Summary

The Holdfast Protocol on-chain programs (`vaultpact` and `vaultpact-escrow`, Anchor 0.31.1) received a full source review covering 15 instruction handlers, 3 state structs, CPI helpers, and error codes. All findings are documented below.

| Severity | Count | Fixed | Accepted/Disclosed |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 1 | 1 | 0 |
| Medium | 4 | 4 | 0 |
| Low | 3 | 1 | 2 |
| Informational | 6 | — | Documented in THREAT_MODEL.md |

**All High and Medium findings are fixed.** Two Low findings were reviewed and accepted as known trade-offs per protocol design (see [Accepted findings](#accepted-findings-not-fixed)). One Low finding (L-3) was fixed.

---

## Fixed Findings

### H-1 — Missing reputation updates in fallback resolution paths

**Severity:** High  
**Files:** `vaultpact-escrow/src/instructions/refund.rs`, `auto_release.rs`, `mutual_cancel_escrow.rs`  
**Fixed in:** [HOL-16] · commit `97b142a`  

**Finding:** Three escrow lifecycle paths (`refund`, `auto_release` with `auto_release_on_expiry=false`, and `mutual_cancel_escrow`) completed without calling `cpi_update_reputation`. A party could escape a negative reputation outcome by forcing dispute escalation, then waiting for the escalation grace period to expire — triggering an auto-refund with zero reputation penalty. The reputation system's role as a behavioral deterrent was undermined; the cost of bad faith was time only, not score.

**Remediation:** All three paths now call `cpi_update_reputation` via the `VAULTPACT_ESCROW_AUTHORITY` PDA signer. Deltas applied:

| Path | Scenario | Initiator delta | Beneficiary delta | Outcome recorded |
|---|---|---|---|---|
| `refund` | Disputed — escalated by initiator | −25 | 0 | `Disputed` |
| `refund` | Disputed — escalated by beneficiary | 0 | −25 | `Disputed` |
| `refund` | Locked / timelock expired (unresolved) | −10 | −10 | `Cancelled` |
| `auto_release` | Timelock expired, `auto_release_on_expiry=false` | −10 | −10 | `Cancelled` |
| `auto_release` | Timelock expired, `auto_release_on_expiry=true` (auto-release) | no CPI | no CPI | — |
| `mutual_cancel_escrow` | Both parties agree to cancel | 0 | 0 | `Cancelled` (records `pacts_completed + last_pact_ts`) |

All three handlers follow CEI order: nonces and escrow IDs are captured before state mutation; `escrow.status` is set before token transfers; reputation CPIs fire last.

**Account changes:** `refund`, `auto_release`, and `mutual_cancel_escrow` now require three additional accounts:

```
initiator_reputation  (mut, PDA: ["reputation", initiator_pubkey], program: vaultpact)
beneficiary_reputation (mut, PDA: ["reputation", beneficiary_pubkey], program: vaultpact)
escrow_authority       (PDA: ["vp_escrow_authority"], program: vaultpact-escrow)
vaultpact_program      (Program<Vaultpact>)
```

See [Updated instruction account tables](#updated-instruction-account-tables) below.

---

### M-1 — Missing PDA seed constraints on `blacklisted_wallet` in `protocol_freeze_pact.rs`

**Severity:** Medium  
**File:** `vaultpact-escrow/src/instructions/protocol_freeze_pact.rs`  
**Fixed in:** [HOL-17] · commit `6c32842`

**Finding:** `blacklisted_wallet` and `second_blacklisted_wallet` lacked `seeds = [...]` constraints. Any `AgentWallet`-shaped account that passed status checks could be supplied, regardless of whether it was actually registered at the correct PDA for its secp256r1 coordinates.

**Remediation:** Added PDA seed constraints with `seeds::program = vaultpact_program.key()` to both accounts:

```rust
#[account(
    seeds = [b"agent_wallet", blacklisted_wallet.pubkey_x.as_ref(), blacklisted_wallet.pubkey_y.as_ref()],
    bump = blacklisted_wallet.bump,
    seeds::program = vaultpact_program.key(),
)]
pub blacklisted_wallet: Account<'info, vaultpact::AgentWallet>,
```

The runtime now verifies the supplied account is at the canonical PDA for that secp256r1 key pair, bound to the vaultpact program.

---

### M-2 — Dead duplicated constants in `protocol_freeze_pact.rs`

**Severity:** Medium  
**File:** `vaultpact-escrow/src/instructions/protocol_freeze_pact.rs`  
**Fixed in:** [HOL-17] · commit `6c32842`

**Finding:** `DISPUTE_LOSER_DELTA`, `DISPUTE_WINNER_DELTA`, and `DISPUTE_SPLIT_DELTA` were defined locally, duplicating the canonical versions from `resolve_dispute.rs`. The local copies were dead code; the handler used the `resolve_dispute` module versions exclusively. Dead code in security-sensitive modules risks future maintenance errors.

**Remediation:** Removed the local duplicate constants. The handler now uses the `resolve_dispute` module's `pub(crate)` constants exclusively.

---

### M-3 — No vault balance guard before refund in `cancel_pending_escrow.rs`

**Severity:** Medium  
**File:** `vaultpact-escrow/src/instructions/cancel_pending_escrow.rs`  
**Fixed in:** [HOL-17] · commit `6c32842`

**Finding:** `cancel_pending_escrow` computed refund amounts and performed token transfers without first verifying the vault held sufficient funds. State mutation (setting `EscrowStatus::Refunded`) could precede a failed transfer if the vault was underfunded.

**Remediation:** Added a vault balance guard before state mutation (CEI pattern):

```rust
let total_refund = initiator_amount
    .checked_add(beneficiary_amount)
    .ok_or(EscrowError::ArithmeticOverflow)?;
require!(ctx.accounts.vault.amount >= total_refund, EscrowError::VaultBalanceMismatch);

// State mutation follows guard
let escrow = &mut ctx.accounts.escrow_account;
escrow.status = EscrowStatus::Refunded;
```

Unit tests were added to document the guard semantics, including overflow and edge cases.

---

### M-4 — Hardcoded `VAULTPACT_ESCROW_AUTHORITY` breaks on escrow program redeployment

**Severity:** Medium  
**File:** `vaultpact/src/lib.rs` — `initialize_registry`  
**Fixed in:** [HOL-17] · commit `6c32842` (CTO supplemental finding)

**Finding:** `VAULTPACT_ESCROW_AUTHORITY` is a compile-time constant: the expected PDA for the escrow program. If `vaultpact-escrow` were ever redeployed to a new program ID, the PDA changes but the constant would not — all subsequent reputation CPIs would fail with `UnauthorizedReputationWriter`. The mismatch could silently break the escrow→reputation CPI path with no on-chain signal at deployment time.

**Remediation:** `initialize_registry` now accepts `escrow_program: AccountInfo<'info>` (verified executable) and performs a runtime derivation check:

```rust
let (derived_authority, _) = Pubkey::find_program_address(
    &[b"vp_escrow_authority"],
    &ctx.accounts.escrow_program.key(),
);
require!(
    derived_authority == VAULTPACT_ESCROW_AUTHORITY,
    VaultPactError::EscrowAuthorityMismatch
);
```

A devnet CI unit test (`vaultpact_escrow_authority_matches_devnet_escrow_program`) verifies the constant matches the deployed program ID.

**New error:** `VaultPactError::EscrowAuthorityMismatch` — fires at registry initialization if the escrow program supplied does not match the compile-time authority constant. This means mismatched deployments fail loudly at setup rather than silently at runtime.

**Account changes:** `initialize_registry` now requires `escrow_program: AccountInfo<'info>` (executable, passed as a program account).

---

### L-3 — `set_protocol_authority` accepted the zero pubkey (permanent DoS)

**Severity:** Low  
**File:** `vaultpact/src/lib.rs` — `set_protocol_authority`  
**Fixed in:** [HOL-17] · commit `6c32842` (CTO supplemental finding)

**Finding:** No guard prevented setting `new_authority = Pubkey::default()` (all-zero key). The zero pubkey has no valid signer, so accepting it would permanently disable all authority-gated instructions (`protocol_freeze_pact`, `set_agent_status`, subsequent `set_protocol_authority` calls). There is no recovery path.

**Remediation:** Added an explicit guard before the assignment:

```rust
require!(
    new_authority != Pubkey::default(),
    VaultPactError::InvalidAuthority
);
```

**New error:** `VaultPactError::InvalidAuthority` — fires if `set_protocol_authority` is called with the zero pubkey.

---

## Accepted Findings (Not Fixed)

These two Low findings were reviewed and accepted as known trade-offs per the protocol's design. Both are documented in the threat model and disclosed to audit reviewers.

### L-1 — No minimum delay between dispute creation and arbiter resolution

**Severity:** Low  
**Disposition:** Disclose — accepted trade-off

**Finding:** No on-chain minimum enforces a delay between when `raise_dispute` is called and when the arbiter can call `resolve_dispute`. A colluding arbiter could theoretically resolve immediately after dispute creation.

**Rationale for acceptance:** The arbiter is nominated by the initiator and accepted by the beneficiary at pact entry. Reputation serves as the trust signal for arbiter selection. A minimum delay does not prevent collusion — a colluding arbiter simply waits. Existing safeguards provide sufficient protection: the 1-hour minimum arbiter window (`dispute_deadline_secs >= 3600`), the escalation path to override an inactive arbiter (ES-13), and `protocol_freeze_pact` override capability (ES-6) for post-blacklist scenarios.

---

### L-2 — `DisputeRecord` PDA persists after resolution until `close_escrow`

**Severity:** Low  
**Disposition:** Disclose — accepted trade-off

**Finding:** A `DisputeRecord` PDA is not closed at dispute resolution; it persists until `close_escrow` is called by the initiator.

**Rationale for acceptance:** `close_escrow` is the Anchor-standard cleanup path with `close = initiator`, recovering ~0.003 SOL rent. Leaving it uncalled is economically irrational for the initiator. No security impact — the PDA data is terminal state and cannot be mutated after resolution.

---

## Informational Findings

Six informational findings were noted and are documented in [`THREAT_MODEL.md`](./THREAT_MODEL.md) under "Residual Risks and Known Gaps." None required code changes. Key items:

- **Gap 1:** No upper bound on `dispute_deadline_secs` relative to `time_lock_expires_at` — clients should validate off-chain.
- **Gap 3:** `EscrowStatus::Closed` variant is currently unreachable dead code — no security impact.
- **Gap 4:** Integer division rounding in `SplitFunds` disputes — fairness concern for micro-escrows only; remainder accrues to initiator deterministically.
- **Gap 5:** Nonce overflow at `u64::MAX` — theoretical; would require 2^64 reputation updates.
- **RR-1:** Oracle centralization — single keypair has unilateral reputation write power. Accepted for devnet; mainnet requires multi-sig oracle quorum.
- **RR-2:** Devnet authority is a single keypair — accepted for devnet; mainnet requires Squads v4 3-of-5.

---

## Updated Instruction Account Tables

Instructions affected by security remediations. Use these tables when constructing transactions manually or extending the SDK.

### `refund` (H-1 fix)

New accounts added:

| Account | Constraint | Description |
|---|---|---|
| `initiator_reputation` | `mut`, PDA `["reputation", initiator]`, `seeds::program = vaultpact_program` | Initiator reputation for CPI delta update |
| `beneficiary_reputation` | `mut`, PDA `["reputation", beneficiary]`, `seeds::program = vaultpact_program` | Beneficiary reputation for CPI delta update |
| `escrow_authority` | PDA `["vp_escrow_authority"]`, program: escrow | Virtual PDA signer for reputation CPI |
| `vaultpact_program` | `Program<Vaultpact>` | Target program for CPI |

### `auto_release` (H-1 fix)

Same four accounts added as `refund`. When `auto_release_on_expiry=true` (normal auto-release path), no reputation CPI is issued — accounts are still validated on-chain for interface uniformity. The CPI fires only on the `auto_release_on_expiry=false` auto-refund branch.

### `mutual_cancel_escrow` (H-1 fix)

Same four accounts added as `refund`. Delta is `0` for both parties; the CPI still fires to record `pacts_completed` and `last_pact_ts` on-chain.

### `initialize_registry` (M-4 fix)

New account added:

| Account | Constraint | Description |
|---|---|---|
| `escrow_program` | executable `AccountInfo` | The escrow program account; used at init to verify `VAULTPACT_ESCROW_AUTHORITY` matches the derived PDA |

This account is only required at registry initialization (one-time setup). SDK consumers do not call `initialize_registry` in normal operation.

### `protocol_freeze_pact` (M-1 fix)

No new accounts. Existing `blacklisted_wallet` and `second_blacklisted_wallet` accounts now have additional PDA validation enforced by the runtime — callers must supply the canonically-derived PDA, not an arbitrary account. The SDK already derives these correctly.

---

## Reputation CPI Security Model

The escrow program (`vaultpact-escrow`) updates agent reputation by invoking `update_reputation` on the vaultpact program via CPI, signed by the `VAULTPACT_ESCROW_AUTHORITY` PDA.

```
vaultpact-escrow handler
  → cpi_update_reputation()
      → vaultpact::update_reputation
          (signed by ["vp_escrow_authority"] PDA)
```

**Why a PDA signer?** The escrow program cannot hold a keypair. Instead, both programs share the derivation:

```
PDA = find_program_address(["vp_escrow_authority"], escrow_program_id)
```

The vaultpact program accepts reputation writes from two authorities:
1. `REPUTATION_ORACLE_AUTHORITY` — ed25519 keypair held by the oracle daemon (off-chain reputation updates)
2. `VAULTPACT_ESCROW_AUTHORITY` — PDA derived from the escrow program ID (post-pact reputation updates from escrow outcomes)

**CEI pattern in reputation updates:** Every instruction that calls `cpi_update_reputation` follows Checks-Effects-Interactions order:
1. Read all nonces and escrow IDs into local variables (checks)
2. Set `escrow.status` to the terminal state (effects)
3. Execute token transfers (interactions with SPL Token)
4. Call `cpi_update_reputation` for each party (interactions with vaultpact)

This order ensures that if a CPI reverts, the escrow status is already set — preventing re-entry or double-refund via status re-check.

**Nonce anti-replay:** Each `ReputationAccount` carries a monotonically increasing `nonce`. Every `update_reputation` call must supply `rep.nonce + 1`. This prevents replay of a stale reputation update captured from a previous transaction.

**Score bounds:** Reputation scores are clamped to `[0, 10,000]`. No single CPI call can push a score outside this range.

---

## Error Code Reference (New Errors)

Two new error variants were added to `VaultPactError` by the security remediations:

| Variant | Program | Trigger | Recovery |
|---|---|---|---|
| `EscrowAuthorityMismatch` | vaultpact | `initialize_registry` called with an `escrow_program` whose derived `vp_escrow_authority` PDA does not match `VAULTPACT_ESCROW_AUTHORITY` | Ensure the correct escrow program ID is passed; re-derive the constant if the escrow program was redeployed |
| `InvalidAuthority` | vaultpact | `set_protocol_authority` called with `new_authority = Pubkey::default()` (all-zero key) | Supply a valid, non-zero pubkey |

Existing error `VaultBalanceMismatch` (code 6006, `vaultpact-escrow`) is now also enforced in `cancel_pending_escrow` in addition to its prior enforcement sites.

---

*This document was prepared by the Docs Writer for HOL-24. Source material: HOL-14 audit comment thread, HOL-16 description, HOL-17 description, commit history on `master`.*
