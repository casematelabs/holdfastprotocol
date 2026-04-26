# HOL-131 QA Coverage Review

Date: 2026-04-26  
Scope: Code-level test coverage review for audit remediation findings `MED-F-001`, `MED-F-002`, `LOW-F-004`

## Summary

This review maps each finding to current code behavior and executable test coverage in `tests/vaultpact-escrow.ts`.

## Coverage Matrix

| Finding | Code status (current checkout) | Test coverage status | Evidence |
|---|---|---|---|
| `MED-F-001` Arbiter redirect wallet not committed on-chain | Remediated. `raise_dispute` commits payout token accounts; `resolve_dispute` enforces with `has_one` on `dispute_record` | Covered in integration + code-review tests | `MED-F-001 coverage: resolve_dispute rejects payout redirection away from dispute-committed token account`; `tests/hol131-code-review.ts` |
| `MED-F-002` `cancel_pending_escrow` missing reputation CPI | Remediated. `cancel_pending_escrow` performs `cpi_update_reputation` for both parties | Covered in integration + code-review tests | `MED-F-002 coverage: cancel_pending_escrow updates both reputation nonces`; `tests/hol131-code-review.ts` |
| `LOW-F-004` Missing `has_one = vault` on non-transfer instructions | Remediated in `raise_dispute`, `release_escrow`, `escalate_dispute` | Covered via executable code-review test | `tests/hol131-code-review.ts` |

## Notes for Remediation Verification

1. Runtime Anchor integration tests still require a provisioned Anchor toolchain (`anchor` CLI + generated `target/types`).
2. `tests/hol131-code-review.ts` is designed as an executable fallback in constrained environments and should stay aligned with instruction-level invariants.
