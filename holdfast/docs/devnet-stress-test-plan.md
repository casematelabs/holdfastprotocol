# Holdfast Protocol — Devnet Stress Test Plan

## Objective

Establish performance baselines and validate protocol stability under sustained
load on Solana devnet before mainnet deployment. The test suite targets the two
on-chain programs (`vaultpact` and `vaultpact_escrow`) across their critical
instruction paths.

## Prerequisites

| Requirement | Detail |
|---|---|
| Funded devnet wallet | `~/.config/solana/devnet.json` with >= 2 SOL |
| Oracle keypair | `~/.config/solana/oracle-devnet.json` |
| Programs deployed | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` (vaultpact), `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` (escrow) |
| Attestation registry | Initialized on devnet (via `scripts/init-registry-devnet.ts`) |
| Node.js | >= 18 |

## Test Scenarios

### Scenario 1: Escrow Lifecycle Under Load

**Goal:** Validate that the full escrow lifecycle (init -> deposit -> stake ->
lock -> release) can sustain N concurrent pacts without instruction failures or
CU exhaustion.

**Instruction sequence per cycle:**
1. `initialize_escrow`
2. `deposit_funds`
3. `stake_beneficiary`
4. `lock_escrow`
5. `release_escrow`

**Parameters:**
- Concurrency: 1, 5, 10, 20 simultaneous pacts
- Escrow amount: 1_000_000 lamports (SPL token, 6 decimals)
- Stake amounts: 100_000 each side
- Time lock: +3600s from test start

**Success criteria:**
- >= 95% of cycles complete without error
- p99 confirmation latency < 30s on devnet
- No CU overflows (budget limit: 200k CU per instruction)

### Scenario 2: Reputation Stake/Slash Throughput

**Goal:** Measure oracle-driven reputation update throughput and verify account
contention does not cause excessive retries.

**Instruction sequence per cycle:**
1. `register_agent_wallet` (one-time setup, with secp256r1 attestation)
2. `init_reputation`
3. `update_reputation` (score bump)
4. `update_reputation` (slash)
5. `validate_reputation_for_pact`

**Parameters:**
- Agent wallets: 10, 25, 50 unique agents
- Updates per agent: 5 score bumps + 2 slashes
- Oracle authority: single signer (matches devnet config)

**Success criteria:**
- All reputation PDAs created and updated without double-init errors
- Slash reduces score correctly (verify on-chain)
- No contention-related failures at 50 agents

### Scenario 3: Concurrent Pact Submissions

**Goal:** Stress-test PDA derivation and vault creation under concurrent
`initialize_escrow` calls to confirm unique escrow IDs don't collide and the
ATA creation path handles parallel requests.

**Instruction sequence:**
- N simultaneous `initialize_escrow` transactions with unique escrow IDs

**Parameters:**
- Batch sizes: 5, 10, 25, 50 concurrent inits
- All use the same mint but distinct escrow IDs
- Initiator/beneficiary pairs are pre-funded and pre-registered

**Success criteria:**
- 100% unique PDA derivation (no collisions)
- ATA creation succeeds for all vault accounts
- Error rate < 5% (expected: transient blockhash/retry errors only)

## Metrics Captured

Each test run produces a structured JSON log and a CSV summary.

### Per-Transaction Metrics

| Metric | Description |
|---|---|
| `txSignature` | Solana transaction signature |
| `instruction` | Instruction name (e.g. `initialize_escrow`) |
| `status` | `success` or `error` |
| `errorCode` | Anchor error code (if applicable) |
| `sendTimestamp` | ISO timestamp when tx was sent |
| `confirmTimestamp` | ISO timestamp when tx was confirmed |
| `latencyMs` | Confirmation latency in milliseconds |
| `computeUnits` | CU consumed (from tx meta) |
| `slot` | Slot number of confirmation |

### Aggregate Metrics (per scenario run)

| Metric | Description |
|---|---|
| `totalTransactions` | Total txs sent |
| `successCount` | Txs confirmed successfully |
| `errorCount` | Txs that failed |
| `successRate` | `successCount / totalTransactions` |
| `avgLatencyMs` | Mean confirmation latency |
| `p50LatencyMs` | Median latency |
| `p95LatencyMs` | 95th percentile latency |
| `p99LatencyMs` | 99th percentile latency |
| `avgComputeUnits` | Mean CU per instruction |
| `maxComputeUnits` | Peak CU observed |
| `tps` | Effective transactions per second |
| `durationMs` | Total test duration |

## Directory Structure

```
holdfast/stress-tests/
  lib/
    metrics.ts       — Metrics collector, JSON/CSV export
    setup.ts         — Shared devnet connection, keypair loading, helpers
  escrow-lifecycle.ts  — Scenario 1
  reputation-load.ts   — Scenario 2
  concurrent-pacts.ts  — Scenario 3
```

## Running

```bash
cd holdfast

# Run a single scenario
npx ts-node --transpile-only -P tsconfig.json stress-tests/escrow-lifecycle.ts

# Override concurrency
STRESS_CONCURRENCY=20 npx ts-node --transpile-only -P tsconfig.json stress-tests/escrow-lifecycle.ts

# Output directory (default: ./stress-tests/results/)
STRESS_OUTPUT_DIR=./my-results npx ts-node --transpile-only -P tsconfig.json stress-tests/escrow-lifecycle.ts
```

## Output

Results are written to `stress-tests/results/<scenario>-<timestamp>/`:
- `metrics.json` — Full per-transaction log
- `summary.json` — Aggregate metrics
- `summary.csv` — CSV one-liner for spreadsheet import

## Baseline Targets

These targets represent the initial pass/fail thresholds. They will be refined
after the first devnet run.

| Metric | Target |
|---|---|
| Escrow lifecycle success rate | >= 95% |
| Concurrent init success rate | >= 95% |
| Reputation update success rate | >= 98% |
| p99 latency (any instruction) | < 30s |
| Max CU (any instruction) | < 200,000 |

## Dependencies

- [CAS-327](/CAS/issues/CAS-327) Devnet wallet funding — required before live runs
- [CAS-120](/CAS/issues/CAS-120) SDK publish — scripts use direct Anchor calls as fallback
