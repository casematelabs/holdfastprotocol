# Holdfast Protocol — Security Audit Report

**Date:** 2026-04-26  
**Auditor:** Smart Contract Security Auditor  
**Scope:** `vaultpact` + `vaultpact_escrow` (Anchor 0.31.1, Solana, Rust)  
**Files Reviewed:** 20+ source files across both programs  

---

## Executive Summary

**Zero critical or high-severity vulnerabilities.** The codebase demonstrates strong security practices: checked arithmetic throughout, CEI (Checks-Effects-Interactions) pattern consistently used, PDA seed canonicalization enforced via Anchor constraints, proper `has_one` validation on state-mutating instructions, and defense-in-depth via reputation CPI re-validation.

Three **medium-severity** observations and several **low-severity / defense-in-depth** suggestions are described below.

---

## Finding Register

### MED-F-001: Arbiter Redirect Wallet Not Committed On-Chain

**Severity:** Medium  
**File:** `programs/vaultpact_escrow/src/instructions/resolve_dispute.rs:83-160`  
**Status:** Fixed (2026-04-26)

**Description:**  
The `ResolveDispute` instruction accepts `beneficiary_token_account` and `initiator_token_account` as pass-by-account parameters. The arbiter can redirect beneficiary or initiator payouts to *any* token account they own (owner checked via constraint), rather than being bound to a specific wallet committed at dispute creation time. While the `owner` constraint limits redirects to accounts belonging to the legitimate beneficiary/initiator, this creates surface for:

1. Arbiter sending funds to a different token account than the beneficiary intended at dispute raise time.
2. Potential confusion or front-running if the beneficiary has multiple token accounts for the same mint.

**Recommendation:**  
Store the intended `beneficiary_token_account` and `initiator_token_account` in the `DisputeRecord` at `raise_dispute` time, and add `has_one` constraints at `resolve_dispute` time to enforce them. This binds the arbiter's payout destination at dispute creation.

---

### MED-F-002: `cancel_pending_escrow` Missing Reputation CPI

**Severity:** Medium  
**File:** `programs/vaultpact_escrow/src/instructions/cancel_pending_escrow.rs`  
**Status:** Fixed (2026-04-26)

**Description:**  
`cancel_pending_escrow` (initiator-only cancellation of a funded-but-not-locked escrow after time lock expiry) does **not** call `cpi_update_reputation`. Compare with `auto_release.rs` which calls reputation updates with `AUTO_REFUND_UNRESOLVED_DELTA (-10)` on the auto-refund (non-`auto_release_on_expiry`) path.

A strategic initiator could use `cancel_pending_escrow` to avoid reputation penalties associated with the auto-refund path, even when both paths reach the same terminal state (Refunded).

**Recommendation:**  
Either:
- Add reputation updates with an appropriate negative delta (e.g., `-10` matching the auto-refund path), OR  
- Document explicitly that pending cancellation is a deliberate no-op for reputation because the pact was never formally locked.

---

### MED-F-003: Zero-Stake Beneficiary Can Lock Without Financial Commitment

**Severity:** Medium (Informational)  
**File:** `programs/vaultpact_escrow/src/instructions/stake_beneficiary.rs`  
**Status:** By-design / Informational

**Description:**  
`stake_beneficiary` sets `beneficiary_staked = true` even when `beneficiary_stake == 0` (the `if stake_amount > 0` guard skips the token transfer). `lock_escrow` requires `beneficiary_staked == true`. This means a beneficiary with `beneficiary_stake = 0` can participate in locking without any token commitment.

The `slash_loser_stake` path in `resolve_dispute` correctly handles this via `let beneficiary_stake = if escrow.beneficiary_staked { escrow.beneficiary_stake } else { 0 }`, so no funds are incorrectly slashed.

**Recommendation:**  
If the protocol wants to require skin-in-the-game for locking, enforce a minimum non-zero beneficiary stake at `initialize_escrow`. Current behavior is valid if zero-stake participation is intentional.

---

## Low Severity / Defense-in-Depth

### LOW-F-004: Missing `has_one = vault` on Non-Transfer Instructions

**Files:**
- `raise_dispute.rs` — missing `has_one = vault`
- `escalate_dispute.rs` — missing `has_one = vault` (and all has_one constraints)
- `release_escrow.rs` — missing `has_one = vault`

**Status:** Fixed (2026-04-26)

**Recommendation:**  
Add `has_one = vault` to all escrow_account constraints for defense-in-depth, even for instructions that don't touch the vault. This prevents a vault-account-confusion attack if the instruction is later modified to include token operations.

---

### LOW-F-005: `pact_id` Truncated to 7 Bytes

**Files:** `claim_released.rs:113`, `resolve_dispute.rs:187`, `auto_release.rs:125`, `refund.rs:110`, `protocol_freeze_pact.rs:194`, `mutual_cancel_escrow.rs:126`

The `pact_id: [u8; 7]` is derived from `escrow_id[..7]`. This 56-bit identifier is used as a display-only pact reference in reputation history entries. While collision is practically impossible at scale (`2^56` space), the truncation should be documented as a display-only field — not a unique lookup key.

---

## Code Quality & Hardening Notes

### ✅ Strong Patterns Observed

| Pattern | Where |
|---|---|
| Checked arithmetic (`checked_add`, `checked_sub`, `checked_mul`) | Every instruction with math |
| CEI pattern (state before CPI) | `deposit_funds`, `stake_beneficiary`, `claim_released`, `resolve_dispute`, etc. |
| PDA seed canonicalization | Every `#[account(seeds = [...], bump)]` constraint |
| Cross-program ID verification | `has_one` constraints on escrow_account linking vault, initiator, beneficiary, arbiter, pact_record |
| CPI privilege separation | `vp_escrow_authority` PDA used as signer for reputation updates; escrow_account PDA used as signer for token transfers |
| Re-validation of reputation at lock time | Lock verifies reputation hasn't decayed below minimums between init and lock |
| Agent wallet status checks at commitment | `initialize_escrow`, `lock_escrow` check all three parties are Active |
| Nonce-based replay protection | `update_reputation` requires `incoming_nonce == rep.nonce + 1` |
| Compile-time type size assertions | `const _: () = assert!(...)` for struct sizes |
| Devnet/mainnet constant separation | Feature-gated `INITIAL_AUTHORITY`, `VAULTPACT_ESCROW_AUTHORITY`, `REPUTATION_ORACLE_AUTHORITY` |

### 🔶 Observations

1. **Unstaked beneficiary and `slash_loser_stake`** — The `validate_init_params` rejects `slash_loser_stake=true` when either stake is zero. This prevents an impossible configuration at init time. Good.

2. **`has_one` coverage** — The `has_one` constraints vary per instruction:
   - `deposit_funds`: `has_one = initiator`, `has_one = vault` ✓
   - `stake_beneficiary`: `has_one = beneficiary`, `has_one = pact_record`, `has_one = vault` ✓
   - `lock_escrow`: `has_one = initiator`, `has_one = beneficiary`, `has_one = pact_record`, `has_one = vault` ✓ (most comprehensive)
   - `release_escrow`: `has_one = initiator`, `has_one = pact_record` — missing vault (LOW)
   - `claim_released`: `has_one = beneficiary`, `has_one = vault` — pact_record not needed (no slash reads)
   - `raise_dispute`: `has_one = pact_record` — missing initiator/beneficiary (handled in handler since either can raise)
   - `escalate_dispute`: none — participant check in handler
   - `resolve_dispute`: `has_one = arbiter`, `has_one = pact_record`, `has_one = vault` ✓
   - `refund`: `has_one = vault` — crank-based, no specific party required
   - `close_escrow`: `has_one = initiator`, `has_one = pact_record`, `has_one = vault` ✓
   - `protocol_freeze_pact`: `has_one = vault` — authority validated via registry

3. **`vp_escrow_authority` PDA** — The PDA is derived from the escrow program ID (`seeds = [b"vp_escrow_authority"]`). This is validated at `initialize_registry` time to ensure the hardcoded constant matches. If the escrow program is redeployed, `VAULTPACT_ESCROW_AUTHORITY` constant must be updated in `vaultpact/src/lib.rs`.

4. **secp256r1 precompile validation** — `verify_secp256r1_precompile` validates all three instruction-source indices are `0xFFFF` (H-2), CPI rejection via program ID check (M-SOL-6), and supports both compressed/uncompressed key formats. Ported from audited Hardline codebase.

---

## Coverage Gaps

The test file `tests/coverage-gaps.ts` lists uncovered scenarios. Key gaps from review:

- **Direct vault instructions on non-terminal statuses** — Missing tests for calling pump/drain on wrong status codes
- **Auto-release dispute window + raise_dispute race** — What happens if a dispute is raised moments before `auto_release_on_expiry=true` triggers? Status check handles this (Locked only, and dispute transitions to Disputed).
- **Escalation deadline boundary** — `now > dispute.escalation_deadline` is strict greater-than. A crank must call refund after the deadline, not at it.
- **`protocol_freeze_pact` — second_blacklisted_wallet=None when both blacklisted** — Handler correctly handles single wallet and multi-wallet paths.

---

## Conclusion

The Holdfast Protocol escrow and vault programs are **well-architected** with consistent security patterns throughout. The separation of signing authority between `escrow_account` PDA (token operations) and `vp_escrow_authority` PDA (reputation operations) is a strong defense-in-depth design.

**Medium-severity items** (MED-F-001, MED-F-002) should be addressed before mainnet. **Low-severity items** are defense-in-depth improvements. No blockers to devnet deployment.

---

*End of report. 20+ source files reviewed across `vaultpact` and `vaultpact_escrow` programs.*
