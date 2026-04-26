# HOL-145 Functional Validation

Date: 2026-04-26  
Scope: QA validation for dashboard hub page (`HOL-142`) at `/dashboard`

## Result

CONDITIONAL PASS (tests/build pass, one functional defect found that should be fixed before security handoff).

## Coverage Added

New test file: `lib/dashboard-hub.test.ts`

New tests:

- `dashboard root is a client-side hub and no longer hard-redirects to /dashboard/reputation`
- `quick actions expose the expected navigation entry points`
- `data loaders are wallet-scoped and preserve active-pact constraints`
- `error path for reputation fetch is surfaced through danger banner`

Invariants validated:

1. `/dashboard` renders the new hub surface directly (no legacy redirect flow).
2. Hub quick actions route to pact creation, dispute-filtered escrow list, and escrow dashboard.
3. Wallet-scoped data wiring remains correct for reputation and active pacts.
4. Reputation fetch failures surface a visible operator error banner.

## Execution Summary

- `npm test`: PASS (`57/57` tests, including new HOL-145 suite)
- `npm run build`: PASS (Next build successful; `/dashboard` and `/dashboard/create-pact` generated)
- `npm run lint`: BLOCKED (interactive Next.js ESLint bootstrap prompt; non-interactive QA lint gate not yet configured)

## Functional Findings

1. **Dispute-rate scale mismatch between hub and create-pact screens**
   - Evidence:
     - `app/dashboard/create-pact/page.tsx:226-227` treats `disputeRate` as fraction (`> 0.1`, displays `* 100`).
     - `app/dashboard/page.tsx:380-381` treats `disputeRate` as percentage (`> 10`, displays raw value with `%`).
   - Impact: The dashboard hub can under-report or miscolor risk indicators, creating operator-facing trust-signal drift.
   - Repro:
     1. Mock or return `disputeRate = 0.2` from indexer reputation API.
     2. Open create-pact reputation preview: shows `20.0%` and red/high-risk coloring.
     3. Open dashboard hub reputation section: shows `0.2%` and low-risk coloring.
   - Recommendation: Normalize to fraction or percentage consistently across both surfaces; add a unit test on formatting/threshold behavior.

## Coverage Gap Snapshot

1. Current HOL-145 coverage is static-contract plus build validation; no browser E2E interaction tests exist yet for rendered data transitions.
2. Lint is still not CI/non-interactive due missing committed ESLint configuration.

## Security-Auditor Notes

Potential security-adjacent concern: inconsistent dispute-rate presentation can mislead risk decisions in trust workflows. This is not a direct on-chain exploit, but it is a reliability/integrity signal issue that should be verified during audit UX/control review.