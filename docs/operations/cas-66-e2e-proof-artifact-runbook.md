# CAS-66 End-to-End Proof Artifact Runbook

This runbook defines one reproducible launch-evidence artifact for [CAS-66](/CAS/issues/CAS-66):

on-chain transaction -> indexer ingestion -> dashboard-visible trace.

## Goal

- working end-to-end Holdfast flow
- integration readiness

## Proving Scenario (single canonical flow)

Use one escrow lifecycle slice that is already exercised by the devnet smoke script:

1. Agent wallet registration (secp256r1) and reputation account initialization.
2. Escrow creation (`initialize_escrow`) and funding (`deposit_funds`).
3. Observable downstream record in the indexer (`initialized` and `funded` events for same escrow id).
4. Matching dashboard-visible event row in `/status` activity feed with same tx signature.

This covers the required chain with one artifact id set:

- `escrow_id_hex`
- `pact_address`
- `deposit_tx_signature`

## Preconditions

- Solana CLI configured for devnet.
- `~/.config/solana/devnet.json` funded payer keypair.
- `~/.config/solana/oracle-devnet.json` funded oracle keypair.
- Indexer endpoint reachable (default: `https://holdfast-indexer.fly.dev`).
- Dashboard running locally (`app`) or deployed status page reachable.

## Canonical Command Sequence

Run from repo root.

```powershell
cd holdfast
$env:TS_NODE_TRANSPILE_ONLY='1'
$env:ANCHOR_PROVIDER_URL='https://api.devnet.solana.com'
$env:INDEXER_URL='https://holdfast-indexer.fly.dev'
$env:HOLDFAST_PROGRAM_ID='2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq'
npx ts-node --transpile-only -P tsconfig.json scripts/devnet-smoke-test.ts | Tee-Object -FilePath ..\tmp\cas66-smoke-output.log
```

Parse required values from output:

- `1. createEscrow (init + deposit)` tx line (deposit tx signature)
- `6b. Escrow events (escrow #1)` pass/fail and event kinds
- `6c. Reputation history (indexer)` pass/fail

Optional helper to extract tx signatures quickly:

```powershell
Select-String -Path .\tmp\cas66-smoke-output.log -Pattern 'https://explorer.solana.com/tx/'
```

## Required Artifact Bundle

Save under `tmp/cas66-proof/` (or attach equivalent outputs in issue thread).

1. `run-metadata.json`
- timestamp (UTC)
- git commit sha
- RPC URL
- indexer URL
- smoke command used

2. `tx-signatures.json`
- `create_or_deposit_tx`
- `reputation_update_tx`
- explorer links for both

3. `indexer-snapshots.json`
- `/health` response snapshot
- `/v1/escrows/{escrowIdHex}/events?limit=20` snapshot
- `/v1/agents/{agentPubkey}/reputation/history?limit=5` snapshot

4. `dashboard-evidence`
- screenshot or structured output from `/status` showing the same `txSignature` in Recent Pact Activity.
- include capture timestamp and URL used.

## Evidence Matching Rules

PASS only if all are true:

- Explorer link resolves for the captured tx signature.
- Indexer events include at least `initialized` and `funded` for the same escrow id.
- Dashboard activity feed contains a row with the same tx signature (prefix/suffix match is acceptable if UI truncates).
- Timestamps are coherent (dashboard/indexer not older than smoke run by more than 10 minutes).

## Automation vs Manual Boundary

Automatable now:

- devnet smoke execution
- tx signature capture from logs
- indexer HTTP snapshot capture

Manual until blockers clear:

- dashboard screenshot capture and human visual confirmation of same tx row
- final launch-readiness signoff comment in issue thread

## Known Current Blocker (2026-04-30)

- Indexer host resolution failed from this environment for both:
  - `https://holdfast-indexer.fly.dev/health`
  - `https://indexer.devnet.holdfastprotocol.com/health`
- Result: on-chain tx evidence can be captured, but indexer and dashboard trace correlation cannot be completed until indexer DNS/service is restored or a reachable endpoint is provided.

## QA Reproduction Contract

[@QA](agent://60f41f63-51d9-4119-810f-9de0300eec75) should validate exactly:

- command sequence matches this runbook
- tx signature and explorer link integrity
- indexer payload contains matching record
- dashboard-visible trace matches the same tx

Output format in issue comment:

- Expected vs actual
- PASS/FAIL per artifact item
- blocker owner/action if any item fails

## Launch-Readiness Usage

This artifact is launch evidence for [CAS-119](/CAS/issues/CAS-119), not marketing collateral. It proves traceability across protocol, indexer, and dashboard for one real devnet flow.
