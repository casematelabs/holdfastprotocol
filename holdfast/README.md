# Holdfast Protocol

[![Holdfast CI](https://github.com/meanstackofdoom/vaultpack/actions/workflows/ci.yml/badge.svg)](https://github.com/meanstackofdoom/vaultpack/actions/workflows/ci.yml)

Trust infrastructure for autonomous AI agents on Solana.

> **Security notice:** Holdfast Protocol is currently in devnet. The on-chain programs have not yet undergone a third-party security audit. Do not use devnet program addresses in production. Funds locked in devnet escrow accounts are at risk. An external audit is in progress; this notice will be updated when the audit is complete.
>
> **Found a vulnerability?** See [`SECURITY.md`](./SECURITY.md) for our disclosure process.

---

## Overview

Holdfast Protocol is trust infrastructure for autonomous AI agents on Solana.

It provides on-chain identity, reputation, and programmable escrow so agents, users, and applications can form verifiable agreements called pacts.

Use Holdfast to:
- Register trusted agent identities
- Create programmable agent-to-agent pacts
- Lock and release escrowed funds
- Track reputation over time
- Build safer autonomous agent workflows

> Devnet only. External audit in progress. Do not use in production.

### Core primitives

- **Reputation** — per-agent score (basis points, 0–10 000; 5 000 = neutral) with lazy time-decay. TEE-backed attestation is on the post-audit roadmap.
- **Escrow** — time-locked vaults with a 7-day dispute window; released by mutual settlement or arbiter resolution.
- **Pacts** — verifiable agreements that atomically bind a reputation check, a funded vault, and an outcome record.

---

## Repository layout

```
holdfast/
├── programs/
│   ├── vaultpact/          # Core reputation program (Anchor / Rust)
│   └── vaultpact-escrow/   # Escrow program (Anchor / Rust)
├── sdk/                    # TypeScript SDK (@holdfastprotocol/sdk)
├── indexer/                # Off-chain indexer service (Node.js)
├── oracle/                 # Oracle service (Node.js)
├── tests/                  # Integration test suite (ts-mocha + bankrun)
├── scripts/                # Utility scripts
├── docs/                   # Architecture Decision Records
├── Anchor.toml
├── Cargo.toml
├── package.json
└── SECURITY.md          # Vulnerability disclosure process
```

### programs/vaultpact (Holdfast Identity)

Anchor program that owns the `ReputationAccount` PDA. Exposes instructions for registering agents, recording pact outcomes, and cross-program calls (`validate_reputation_for_pact` CPI).

### programs/vaultpact-escrow (Holdfast Escrow)

Anchor program that manages `EscrowAccount` PDAs. Lifecycle: `Pending → Funded → Locked → Released / Disputed`. Calls `validate_reputation_for_pact` via CPI before initialising escrow.

### sdk/

TypeScript SDK with two modules — `reputation` (read/check on-chain accounts) and `escrow` (create, fund, release, dispute pacts). See [`sdk/README.md`](./sdk/README.md) for the full API reference.

### indexer/

Off-chain service that subscribes to program logs and indexes pact history for paginated dashboard queries. Required only for `reputation.getHistory` and `escrow.listPacts`.

### oracle/

Oracle service used for arbiter resolution during disputed escrows.

### tests/

Integration tests using `ts-mocha`, `anchor-bankrun`, and `solana-bankrun`. Run against a local validator or bankrun simulation.

### docs/

Architecture Decision Records (ADRs) and design notes, including `adr-001-crypto-fork.md`.

---

## Program IDs (devnet / localnet)

Holdfast Protocol is deployed as **two programs** on Solana devnet. Both `AgentWallet` and `ReputationAccount` PDAs live inside the `vaultpact` program; `vaultpact-escrow` is a separate program that CPIs into it.

| Program | Address | Contains |
|---|---|---|
| `vaultpact` | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` | `AgentWallet` PDA, `ReputationAccount` PDA, `AttestationRegistry` |
| `vaultpact-escrow` | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` | `EscrowAccount` PDA, vault token accounts |

**Upgrade authority (devnet):** `2TH4VxNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd`  
Last verified deployed: 2026-04-20. See `docs/integration-guide.md` for full deployment details.

SDK constants (importable from `@holdfastprotocol/sdk`):
```typescript
import { HOLDFAST_PROGRAM_ID, HOLDFAST_ESCROW_PROGRAM_ID } from '@holdfastprotocol/sdk';
```

---

## Prerequisites

| Tool | Version |
|---|---|
| Rust | stable (≥ 1.79) |
| Solana CLI | ≥ 1.18 |
| Anchor CLI | ≥ 0.31 |
| Node.js | ≥ 20 |
| Yarn | ≥ 1.22 |

---

## Local dev setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd holdfast

# 2. Install JS dependencies
yarn install

# 3. Build Anchor programs
anchor build

# 4. Start a local validator (separate terminal)
solana-test-validator --reset

# 5. Run the integration test suite
anchor test --skip-local-validator
# or with bankrun (no validator needed):
yarn test
```

The `yarn demo` script runs `scripts/hackathon-demo.ts` — a walkthrough of the full pact lifecycle against devnet.

### CAS-5 Devnet Ops

Use these helper scripts when reproducing/following CAS-5 MED devnet runs:

```bash
# Print environment flags and usage
yarn cas5:help

# Print top-up shortfalls + commands + live payer balance
yarn cas5:status

# Write a status artifact file (tmp-cas5-status.txt)
yarn cas5:status:file

# Run full baseline only when payer balance is high enough (>= 0.02 SOL)
yarn cas5:run-if-funded

# Combined heartbeat: run funding gate, then refresh status artifact
yarn cas5:ops:heartbeat

# Print concise top-up hints only
yarn cas5:topup:hint

# Print human-readable dry-run funding requirements
yarn cas5:funding:dry

# Emit machine-readable funding JSON (stdout / file)
yarn cas5:funding:json
yarn cas5:funding:json:file

# Attempt staged devnet airdrops to payer
yarn cas5:airdrop

# Sweep saved participant keypairs back to payer
yarn cas5:recover

# Remove local CAS-5 temp artifacts
yarn cas5:clean-temp
```

---

## SDK quick start

```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js
```

The `devnet` dist-tag points to the current devnet SDK release. `latest` currently mirrors `devnet` — pin to `@devnet` explicitly so future stable releases (post-audit) don't silently shift your install.

```typescript
import { createHoldfastClient } from '@holdfastprotocol/sdk';

const client = createHoldfastClient(); // defaults to devnet

const rep = await client.reputation.get('YourAgentPubkeyBase58...');
console.log('Score:', rep.score); // 5000 = neutral
console.log('Tier:', rep.tier);
```

Full SDK documentation: [`sdk/README.md`](./sdk/README.md)

---

## License

Apache-2.0
