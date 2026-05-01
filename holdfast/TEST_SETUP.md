# Holdfast Protocol Test Setup Guide

How to set up, run, and understand the Holdfast Protocol test suite.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | [rustup.rs](https://rustup.rs) |
| Solana CLI (Agave) | 3.1.12+ | `sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.12/install)"` |
| Anchor CLI | 0.31.x | `cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.31.0 && avm use 0.31.0` |
| Node.js | 20+ (CI uses 22) | [nodejs.org](https://nodejs.org) |
| Yarn | 1.x | `npm install -g yarn` |

Verify your installation:

```bash
solana --version        # solana-cli 3.1.12 or later
anchor --version        # anchor-cli 0.31.0
node --version          # v20.x or v22.x
yarn --version          # 1.22.x
```

## Wallet & Keypair Setup

### 1. Default wallet (test authority)

```bash
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json
solana config set --url localhost
```

This wallet acts as the test payer and authority for most instructions.

### 2. Oracle keypair

Some reputation tests require a dedicated oracle signer:

```bash
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/oracle-devnet.json
```

The oracle keypair is loaded by tests that call `update_reputation` to simulate off-chain oracle writes.

### 3. Devnet configuration (optional)

If you need to run the demo scripts against devnet:

```bash
solana config set --url devnet
solana airdrop 2
```

## Running Tests

### Full integration suite

```bash
cd holdfast
yarn install --frozen-lockfile
anchor build
anchor test
```

Or equivalently:

```bash
yarn test
```

This runs `ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts` which discovers all `.ts` files under `tests/`.

`anchor test` spins up a local validator, deploys both programs, runs the suite, then shuts down. The `--skip-build` flag can be passed if you've already run `anchor build`.

### Single test file

```bash
anchor test -- --grep "initialize_escrow"
```

Or run a specific file directly (requires a running validator):

```bash
solana-test-validator &
anchor deploy
yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/vaultpact-escrow.ts
```

### Indexer tests

```bash
cd holdfast/indexer
npm install
npm test
```

Indexer tests use Node.js native `test` module (no mocha). They validate account layout byte-size calculations and ring buffer offset math — no validator required.

### Running the indexer service locally (with SQLite DB)

The indexer uses SQLite via `better-sqlite3`. No external database service is required.

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `reputation.db` | Path to SQLite file (created automatically) |
| `PORT` | `3001` | HTTP port for the REST API |
| `PROGRAM_ID` | devnet program ID | Holdfast Protocol reputation program address |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `SOLANA_WS_URL` | derived from RPC URL | WebSocket endpoint (optional, auto-derived) |

**Start locally against devnet:**

```bash
cd holdfast/indexer
npm install
DB_PATH=./reputation.db npm run dev
```

**Verify:**

```bash
# Health check (reports DB connection status)
curl http://localhost:3001/health
# Expected: {"status":"ok","db":"connected"}

# Query reputation history for an agent
curl "http://localhost:3001/v1/agents/<AGENT_PUBKEY>/reputation/history"
```

**On restart**, the indexer reads the last indexed signature from the DB and requests only newer transactions from the RPC — covering up to 1000 missed signatures. For production deployments the SQLite file lives at `/data/reputation.db` on a Fly.io persistent volume (configured in `fly.toml`).

## Test Suite Overview

| File | Lines | Coverage Area |
|------|-------|---------------|
| `vaultpact.ts` | 2,783 | Reputation program: registry init, agent wallet registration, P-256 signature verification (SIMD-48), reputation updates, ring buffer history, time-based decay |
| `vaultpact-escrow.ts` | 3,187 | Escrow lifecycle: initialize → deposit → stake → lock → release → claim → close. Disputes, resolution outcomes, slash behavior, CPI validation, protocol freeze |
| `coverage-gaps.ts` | 1,593 | Edge cases: set_agent_status boundaries, nonce gap attacks, ring buffer overwrite at cap, double escalation idempotency |
| `dispute-deadline.ts` | 905 | Dispute deadline validation: minimum/maximum bounds, escalation timing boundaries |
| `spl-token-errors.ts` | 1,660 | Token account error paths: owner/mint mismatch, frozen accounts during deposit/stake/claim/refund |
| `security-regression.ts` | 1,310 | Security regressions: P-256 edge cases, token handling, state transition guards |
| `indexer/src/subscriber.test.ts` | 272 | Account layout validation, history entry byte sizes, ring buffer bounds |

## Bankrun (Time-Warp Testing)

Several suites use [solana-bankrun](https://github.com/kevinheavey/solana-bankrun) to simulate clock advancement without a live validator. This enables testing time-dependent logic like:

- Reputation decay over elapsed slots
- Dispute window expiry (`dispute_deadline_secs`)
- Lock expiry and auto-release
- `escalate_dispute` resolution deadline enforcement

Bankrun tests are conditionally loaded:

```typescript
let bankrunMod: any = null;
try {
  bankrunMod = require("solana-bankrun");
} catch (_e) {
  // unavailable on this platform — suites skip gracefully
}
```

### Windows Limitations

**Bankrun does not ship native binaries for Windows.** On Windows, bankrun-dependent suites are skipped automatically.

**Recommended:** Use WSL2 (Ubuntu) for full test coverage on Windows machines. The CI pipeline runs on Linux where all bankrun suites execute.

```bash
# Inside WSL2
wsl
cd /mnt/g/projects/active/new_proto/holdfast
anchor build && anchor test
```

## CI Workflow

The GitHub Actions workflow (`.github/workflows/test.yml`) runs on every push/PR to `main`:

1. **Environment:** Ubuntu, Rust stable, Solana 3.1.12, Anchor 0.31.0, Node.js 22
2. **Caching:** Cargo registry, Solana CLI, AVM/Anchor, yarn dependencies — all cached by lockfile hash
3. **Steps:**
   - Generate ephemeral test wallet (`solana-keygen new`)
   - Build programs (`anchor build`)
   - Run full suite (`anchor test --skip-build`)

Tests must pass in CI before merge. The 15-second `startup_wait` in `Anchor.toml` gives the validator time to initialize.

## Configuration Reference

**Anchor.toml** key settings:

```toml
[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"

[test]
startup_wait = 15000

[programs.localnet]
vaultpact = "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg"
vaultpact_escrow = "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi"
```

**tsconfig.json** — Tests compile with `ts-mocha` using `transpileOnly` mode (no type-checking at test time). Types are provided by `@types/mocha`, `@types/chai`, and `@types/node`.

## Troubleshooting

**"account not found" errors on first run** — Run `anchor build` before `anchor test`. The program keypairs in `target/deploy/` must exist for deployment.

**Validator fails to start** — Check if another `solana-test-validator` process is already running on port 8899. Kill it: `pkill solana-test-validator`.

**Bankrun tests skipped** — You're on Windows without WSL2. Install WSL2 or accept that bankrun suites will be skipped locally (CI covers them).

**Timeout on large suites** — The 1,000,000ms timeout is intentional. Some P-256 verification tests and full lifecycle tests are slow. Do not reduce it.

**Oracle tests fail with "unauthorized"** — Ensure `~/.config/solana/oracle-devnet.json` exists and matches the expected oracle pubkey hardcoded in test fixtures.
