# Holdfast Protocol — Quickstart Example App

A fork-ready Node.js app that runs a complete pact lifecycle on Solana devnet in under 15 minutes.

> **DEVNET ONLY.** Holdfast programs have not been formally audited. Do not use on mainnet.

## Canonical onboarding sources

This example app is a runnable mirror of the canonical SDK onboarding path:

- `holdfast/sdk/docs/quickstart.md` (canonical narrative guide — also published in the public SDK repo)
- `holdfast/sdk/examples/quickstart.ts` (canonical minimal runnable script)
- `holdfast/sdk/README.md` (SDK API and quickstart entry point)

When onboarding flow details change, update those canonical sources first.

## What this demonstrates

Running `npm start` walks through every stage of a Holdfast pact:

| Step | Action | SDK call |
|------|--------|----------|
| 1 | Register an AgentWallet on-chain (idempotent) | `registerAgentWallet()` |
| 2 | Verify reputation account readiness (explicit init required) | `client.reputation.meetsRequirements()` |
| 3 | Create an escrow pact (wSOL, task-release) | `client.escrow.createPact()` |
| 4 | Deposit funds into the escrow vault | `client.escrow.depositEscrow()` |
| 5 | Stake the beneficiary (required before lock) | `client.escrow.stakeBeneficiary()` |
| 6 | Lock the escrow — both parties commit | `client.escrow.lockEscrow()` |
| 7 | Release — initiator confirms delivery | `client.escrow.releasePact()` |

Each step prints the Solana Explorer link for the transaction so you can follow along on-chain.

## Prerequisites

Install the [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) and [spl-token CLI](https://spl.solana.com/token) first, then:

```bash
# 1. Generate a devnet keypair (skip if you already have one)
solana-keygen new -o ~/.config/solana/devnet.json

# 2. Airdrop devnet SOL to cover transaction fees
solana airdrop 2 --url devnet

# 3. Wrap SOL into wSOL — the escrow token used in this example
spl-token wrap 0.1 --fee-payer ~/.config/solana/devnet.json
```

You need Node.js ≥ 18 and npm ≥ 9.

## Quick start

```bash
git clone https://github.com/holdfastprotocol/holdfast-quickstart
cd holdfast-quickstart

npm install

cp .env.example .env
# Edit .env and set KEYPAIR_PATH (defaults to ~/.config/solana/devnet.json)

npm start
```

## Configuration

All options live in `.env`. Copy `.env.example` to get started.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KEYPAIR_PATH` | No | `~/.config/solana/devnet.json` | Path to your Solana keypair JSON |
| `COUNTERPARTY_KEYPAIR_PATH` | No | Same as initiator | Second keypair for a two-party pact (omit for self-pact demo) |
| `RPC_URL` | No | `https://api.devnet.solana.com` | Solana RPC endpoint |

### Self-pact vs two-party

By default the example runs a **self-pact** — the same keypair acts as both initiator and beneficiary. This is fine for exploring the API and exercises the complete flow.

To simulate a genuine two-party pact, generate a second keypair and set `COUNTERPARTY_KEYPAIR_PATH`:

```bash
solana-keygen new -o ~/.config/solana/devnet-counterparty.json
solana airdrop 2 --url devnet --keypair ~/.config/solana/devnet-counterparty.json
```

Then add to `.env`:

```
COUNTERPARTY_KEYPAIR_PATH=~/.config/solana/devnet-counterparty.json
```

## Expected output

```
╔══════════════════════════════════════════════════════════════╗
║   Holdfast Protocol — Quickstart Example App                ║
║   DEVNET ONLY · Pre-audit release · Not for production      ║
╚══════════════════════════════════════════════════════════════╝

Initiator:    AbCd...1234
Counterparty: AbCd...1234  (self-pact)
RPC:          https://api.devnet.solana.com

── Step 1: Register AgentWallet ──────────────────────────────
  ✓ Already registered: XyZw...5678
    https://explorer.solana.com/address/XyZw...5678?cluster=devnet

── Step 2: Read Reputation ───────────────────────────────────
  No ReputationAccount yet — run explicit `init_reputation` before reading scores.
  Requirements check (minScore: 0): PASS ✓

── Step 3: Create Pact ───────────────────────────────────────
  ...
  ✓ Escrow PDA: MnOp...9012
  ✓ Status:     Pending

── Step 4: Deposit — initiator funds vault ───────────────────
  ✓ Tx: https://explorer.solana.com/tx/...?cluster=devnet
  ✓ Status: Funded

── Step 5: Stake Beneficiary — required before lock ──────────
  ✓ Tx: https://explorer.solana.com/tx/...?cluster=devnet

── Step 6: Lock Escrow — both parties commit ─────────────────
  ✓ Tx: https://explorer.solana.com/tx/...?cluster=devnet
  ✓ Status: Locked

── Step 7: Release Pact — initiator confirms delivery ────────
  ✓ Tx: https://explorer.solana.com/tx/...?cluster=devnet
  ✓ Status:              Released
  ✓ Dispute window ends: <date 7 days from now>

╔══════════════════════════════════════════════════════════════╗
║   Full pact lifecycle complete ✓                            ║
╚══════════════════════════════════════════════════════════════╝
```

## Next steps

After the 7-day dispute window closes, call `claimReleased()` to finalise:

```typescript
await client.escrow.claimReleased(escrowId, initiatorPubkey);
```

If you switch to timed release conditions, run the reference keeper so expired
timed pacts are auto-released on-chain:

```bash
KEEPER_KEYPAIR_PATH=~/.config/solana/devnet.json \
KEEPER_AGENT_WALLET=<your-agent-wallet-pda> \
npx ts-node --transpile-only holdfast/scripts/auto-release-keeper.ts
```

See the [SDK reference](https://docs.holdfastprotocol.com/sdk) for:
- `openDispute()` — raise a dispute during the dispute window
- `listPacts()` — paginate your pact history via the off-chain indexer
- `reputation.getHistory()` — fetch full reputation history
- ElizaOS integration — wire Holdfast actions into an AI agent

## Devnet program addresses

| Program | Address |
|---------|---------|
| Holdfast Identity | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| Holdfast Escrow | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

## Troubleshooting

**`Error: keypair not found`** — Run `solana-keygen new` and update `KEYPAIR_PATH` in `.env`.

**Deposit fails with token error** — Make sure you have wSOL: `spl-token wrap 0.1 --fee-payer ~/.config/solana/devnet.json`. Confirm the balance with `spl-token accounts`.

**Airdrop fails** — Devnet faucet rate-limits. Try `solana airdrop 1` or use a [web faucet](https://faucet.solana.com).

**`PREAUDIT_WARNING` in console** — Expected. The SDK emits this on every instantiation until the external audit completes.

For more help see [holdfast/docs/troubleshooting.md](../../holdfast/docs/troubleshooting.md) or open an issue.

