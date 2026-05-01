# CAS-61 Website Messaging Correctness Audit

Date: 2026-04-30
Scope: Public website messaging correctness for network status, SDK availability, security/audit posture.
Reviewer: QA / Test Engineer

## Goal
Verify that public claims match the repository's current protocol and SDK reality (devnet-only, pre-audit, TypeScript SDK surface).

## Steps Run
1. Enumerated public claim surfaces.
```powershell
rg -n "Mainnet|mainnet|devnet|Node.js, Python, and Rust|Available for|audit|pre-audit|production|live|SDK" app/page.tsx app/status/page.tsx app/onboarding/page.tsx app/docs/quickstart/page.tsx app/docs/security/page.tsx holdfast/README.md holdfast/sdk/README.md -S
```
2. Inspected homepage claim copy.
```powershell
Get-Content app/page.tsx | Select-Object -First 320
```
3. Verified canonical protocol/SDK state in repository docs.
```powershell
Get-Content holdfast/README.md | Select-Object -First 220
Get-Content holdfast/sdk/README.md | Select-Object -First 260
```
4. Inspected homepage code preview API claims.
```powershell
Get-Content app/components/CodePreview.tsx | Select-Object -First 220
```

## Expected vs Actual

### Claim 1
- Location: `app/page.tsx:69`
- Current claim: `Solana Mainnet Beta Live`
- Expected: Website must state devnet-only while protocol is pre-audit and docs declare devnet-only.
- Actual evidence:
  - `holdfast/README.md:7` states protocol is currently in devnet and not yet third-party audited.
  - `holdfast/sdk/README.md:17` states devnet and pre-audit.
- Classification: Misleading / incorrect.
- Exact replacement copy:
  - `Solana Devnet Live (Pre-Audit)`

### Claim 2
- Location: `app/page.tsx:233`
- Current claim: `Available for Node.js, Python, and Rust.`
- Expected: Public SDK language claim should match implemented/published SDK surface in this repo.
- Actual evidence:
  - `holdfast/sdk/README.md:3` identifies TypeScript SDK.
  - `holdfast/sdk/package.json:2` package is `@holdfastprotocol/sdk` (TypeScript SDK project).
  - No maintained Python SDK package/docs found in repository.
  - No maintained Rust SDK package/docs found in repository.
- Classification: Unsupported / misleading.
- Exact replacement copy:
  - `TypeScript SDK available today (Node.js 18+). Python and Rust SDKs are planned.`

### Claim 3
- Location: `app/components/CodePreview.tsx:5`
- Current claim-by-example: imports `Vault`, `Pact`, `Trust` classes and methods (`Vault.attest`, `Pact.create`, `Trust.queryScore`) from `@holdfastprotocol/sdk`.
- Expected: Public example code should map to actual callable SDK surface.
- Actual evidence:
  - Canonical quickstart uses `createHoldfastClient` and `registerAgentWallet` (`holdfast/sdk/README.md:38`, `holdfast/sdk/README.md:86`).
  - No direct evidence of exported `Vault/Pact/Trust` class API in docs.
- Classification: Likely unsupported / misleading developer UX.
- Exact replacement copy:
  - Replace the snippet with a real quickstart-based example using `createHoldfastClient` + `registerAgentWallet` from docs.

## Correct Claims Confirmed
- `app/status/page.tsx` consistently labels network as devnet and audit as pre-audit.
- `app/onboarding/page.tsx` includes pre-audit + devnet-only warnings.
- `app/docs/quickstart/page.tsx` and `app/docs/security/page.tsx` are aligned with devnet/pre-audit posture.

## Board-Ready Correction List
1. Replace homepage hero badge text (`app/page.tsx:69`) with `Solana Devnet Live (Pre-Audit)`.
2. Replace SDK availability line (`app/page.tsx:233`) with TypeScript-only current state and optional planned-language note.
3. Replace homepage `CodePreview` snippet (`app/components/CodePreview.tsx`) with a repository-valid quickstart snippet.
4. Add a short homepage disclaimer near CTA linking to `/docs/security`: `Devnet only. External audit in progress. Not for production funds.`

## QA Decision
- Website Messaging Correctness: FAIL
- Reason: Public homepage currently overstates mainnet status and multi-language SDK availability; example code likely mismatches current SDK API.

## Goal Impact
- Goal: Public trust and release readiness through accurate protocol/network/security messaging.
- Improves progress: YES
- Reason: Delivers a precise defect inventory and exact replacements required to remove high-risk public misstatements.
