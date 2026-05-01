# @holdfastprotocol/eliza-plugin

[![npm version](https://img.shields.io/npm/v/@holdfastprotocol/eliza-plugin?tag=devnet)](https://www.npmjs.com/package/@holdfastprotocol/eliza-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Network: Devnet](https://img.shields.io/badge/network-devnet-orange)](#devnet-program-addresses)

> **Pre-audit devnet release — do not use in production.**
> The on-chain programs and this plugin have not undergone a third-party security audit.
> Funds in devnet escrow accounts are at risk. Publish with `--tag devnet`, never `latest`.

## What is Holdfast Protocol?

Holdfast Protocol is **trust infrastructure for autonomous AI agents on Solana**. It gives agents the ability to build verifiable reputation, enter programmable escrow agreements (pacts), and resolve disputes on-chain — all without a centralized intermediary.

The protocol is built on two Anchor programs:

- **vaultpact** — identity, reputation tracking, and verification tiers
- **vaultpact_escrow** — programmable escrow with time-locks, milestone releases, and dispute resolution

This plugin integrates the full protocol into [ElizaOS](https://elizaos.ai) agents via natural-language actions, context providers, and background event monitoring.

## How it fits together

```
ElizaOS Agent Runtime
  └── holdfastPlugin
        ├── Actions ──────────────► Holdfast SDK ──► Solana RPC ──► vaultpact program
        │   (5 actions)                                              vaultpact_escrow program
        ├── Providers ─────────────────────────────► Holdfast Indexer ──► Context Window
        │   (reputation, active pacts)
        └── Event Listener ────────────────────────► Holdfast Indexer (polls every 30 s)
              (emits HOLDFAST_PACT_STATE events)
```

The plugin delegates all on-chain and indexer interactions to `@holdfastprotocol/sdk`. You configure three things: a Solana RPC endpoint, a signer for write operations, and your agent's registered wallet PDA.

## Install

```bash
npm install @holdfastprotocol/eliza-plugin
```

Peer dependency — install separately if not already present:

```bash
npm install @elizaos/core
```

## Quick start

### 1. Register an agent wallet

Before your agent can create pacts it needs an on-chain identity — an **AgentWallet PDA**. The call is idempotent; run it on every agent startup.

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { registerAgentWallet } from "@holdfastprotocol/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR_PATH!, "utf-8")))
);

const IDENTITY_PATH = "./agent-identity.json";
let p256PrivateKey: Uint8Array | undefined;

// Reload the saved P-256 key on restarts — ensures every boot resolves to the same PDA
if (existsSync(IDENTITY_PATH)) {
  const saved = JSON.parse(readFileSync(IDENTITY_PATH, "utf-8"));
  p256PrivateKey = Buffer.from(saved.p256PrivateKey, "hex");
}

const { agentWallet, p256PrivateKey: activeKey, signature } =
  await registerAgentWallet({ connection, signer, p256PrivateKey });

if (signature) {
  writeFileSync(
    IDENTITY_PATH,
    JSON.stringify({
      agentWallet: agentWallet.toBase58(),
      p256PrivateKey: Buffer.from(activeKey).toString("hex"),
    }),
    { mode: 0o600 }
  );
  console.log("Registered AgentWallet:", agentWallet.toBase58());
} else {
  console.log("Resumed AgentWallet:", agentWallet.toBase58());
}
```

**Important:** always reload and pass the same `p256PrivateKey` on subsequent calls. Omitting it generates a fresh P-256 key and a different PDA, orphaning the original identity.

Add `agent-identity.json` to `.gitignore` — the P-256 key is your on-chain identity.

### 2. Configure the plugin

```typescript
import { createHoldfastPlugin } from '@holdfastprotocol/eliza-plugin';

const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: 'https://api.devnet.solana.com',
  signer: myKeypair,                          // Solana Keypair, HSM, or KMS signer
  agentWallet: 'YOUR_AGENT_WALLET_PDA',       // base58 public key from registerAgentWallet()
});
```

### 3. Register with your agent

```typescript
import { AgentRuntime } from '@elizaos/core';

const agent = new AgentRuntime({
  // ...your agent config
  plugins: [holdfastPlugin],
});
```

### 4. Talk to your agent

Once registered, your agent responds to natural-language instructions:

```
User:  "Check the reputation for 7xKpF...abc"
Agent: Reputation for 7xKpF...abc:
         Tier: Attested | Score: 9200 bp | Pacts completed: 14 | Disputed: 0

User:  "Create an escrow pact with 9mBv...xyz for 2 SOL"
Agent: Pact created. Escrow ID: Esc3f...def
       Deposit to activate: DEPOSIT_ESCROW Esc3f...def

User:  "Release pact Esc3f...def"
Agent: Funds released to counterparty. Pact complete.
```

## Configuration reference

All fields are optional. An empty config `{}` initializes the plugin in read-only mode.

| Field | Type | Default | Description |
|---|---|---|---|
| `rpcUrl` | `string` | SDK default | Solana RPC endpoint URL (devnet only) |
| `indexerUrl` | `string` | SDK default | Holdfast indexer endpoint for pact queries |
| `signer` | `Signer` | `undefined` | Solana signer — required for write operations. Accepts `Keypair`, HSM, or KMS signers |
| `agentWallet` | `string` | `undefined` | Base58 public key of the agent's registered wallet PDA. Required for reputation and active pact context |

**Read-only mode:** Omit `signer` to use the plugin for reputation lookups only. Write actions (`CREATE_PACT`, `DEPOSIT_ESCROW`, `RELEASE_PACT`, `OPEN_DISPUTE`) will return a friendly error.

**Signer patterns:**

```typescript
// Environment variable (Keypair)
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const signer = Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY_BASE58!));
createHoldfastPlugin({ signer, rpcUrl: '...', agentWallet: '...' });

// Read-only (no signer)
createHoldfastPlugin({ rpcUrl: '...' });
```

## Live devnet integration test setup

The integration test (`src/tests/integration.devnet.test.ts`) is intentionally skipped unless required `HF_DEVNET_*` variables are present.

### 1. Create the env file

From `holdfast/eliza-plugin/`:

```powershell
Copy-Item .env.devnet.integration.example .env.devnet.integration
```

Fill these required values in `.env.devnet.integration`:

- `HF_DEVNET_SIGNER_PRIVATE_KEY_BASE58`
- `HF_DEVNET_AGENT_WALLET`
- `HF_DEVNET_COUNTERPARTY`
- `HF_DEVNET_MINT`
- `HF_DEVNET_AMOUNT_BASE_UNITS`

Optional:

- `HF_DEVNET_COUNTERPARTY_WALLET` (defaults to `HF_DEVNET_AGENT_WALLET` in the test path)
- `HF_DEVNET_RPC_URL` (default: `https://api.devnet.solana.com`)
- `HF_DEVNET_INDEXER_URL`

### 2. Run the integration test

```powershell
npm run test:integration:devnet:ps1
```

This command loads `.env.devnet.integration`, validates required vars, and runs the full 5-action test against devnet.

Optional preflight check (env only, no test execution):

```powershell
npm run test:integration:devnet:status
```

Optional bootstrap (auto-fills signer, agent wallet, counterparty from `~/.config/solana/devnet.json`):

```powershell
npm run test:integration:devnet:bootstrap
```

After bootstrap, you still need to set:

- `HF_DEVNET_MINT`
- `HF_DEVNET_AMOUNT_BASE_UNITS`

## Actions

| Action | Aliases | Description | Signer required |
|---|---|---|---|
| `CHECK_REPUTATION` | `LOOKUP_REPUTATION`, `GET_AGENT_SCORE`, `VERIFY_AGENT` | Look up reputation tier, score, pact history, and dispute count for any Solana public key | No |
| `CREATE_PACT` | `OPEN_PACT`, `START_ESCROW`, `NEW_PACT` | Create a programmable escrow pact with a counterparty. Supports task, milestone, and timed release conditions | Yes |
| `DEPOSIT_ESCROW` | `FUND_ESCROW`, `ACTIVATE_PACT` | Deposit funds into an existing pact to activate it | Yes |
| `RELEASE_PACT` | `COMPLETE_PACT`, `RELEASE_ESCROW`, `SETTLE_PACT` | Release escrowed funds to the counterparty, completing the pact | Yes |
| `OPEN_DISPUTE` | `DISPUTE_PACT`, `RAISE_DISPUTE` | Open a dispute on an active pact with a stated reason | Yes |

All write actions include automatic retry with exponential backoff for transient RPC failures (rate limits, timeouts, blockhash errors).

## Context providers

When `agentWallet` is configured, two providers automatically inject protocol state into your agent's context window:

| Provider | Injected context |
|---|---|
| **holdfast-protocol-reputation** | Agent's current tier, score, completed pacts, and dispute count |
| **holdfast-protocol-active-pacts** | Summary of all funded (active) pacts with status and counterparty — token-budgeted to 800 tokens |

This allows the agent to reason about its own reputation and active agreements without explicit lookups.

## Evaluators

| Evaluator | Trigger | Behavior |
|---|---|---|
| **reputationThresholdEvaluator** | After `CREATE_PACT` | Checks that the counterparty meets minimum reputation requirements (tier and score). Logs a warning if requirements are not met |

## Background event listener

The plugin starts an **EscrowEventListenerService** that polls for pact state changes every 30 seconds. When a pact's status changes (e.g., funded, disputed, released), it emits a `HOLDFAST_PACT_STATE` event that your agent can react to.

- Exponential backoff reconnection on failure (up to 5 attempts)
- Graceful degradation — polling failures never crash the agent

## Reputation system

Holdfast Protocol tracks on-chain reputation for every registered agent wallet:

| Field | Description |
|---|---|
| **Tier** | Verification level: `Unverified` (secp256r1 key registered), `Attested` (key attested on-chain), `Hardline` (TEE-attested via Hardline Protocol) |
| **Score** | Reputation score in basis points (0–10,000; 5,000 = neutral) — accrued from completed pacts |
| **Pacts completed** | Total count of successfully completed pacts |
| **Disputes** | Number of disputes opened against this agent |

Use `CHECK_REPUTATION` to look up any agent by public key, or let the reputation context provider surface your agent's own stats automatically.

## Devnet program addresses

| Program | Address |
|---|---|
| `holdfast` (vaultpact) | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| `holdfast-escrow` (vaultpact_escrow) | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

Verify accounts on [Solana Explorer (devnet)](https://explorer.solana.com/?cluster=devnet).

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@elizaos/core` | ^1.0.0 | Peer dependency — ElizaOS agent framework |
| `@holdfastprotocol/sdk` | ^0.2.0-devnet.2 | Holdfast Protocol SDK for on-chain interactions |
| `@solana/web3.js` | ^1.95.0 | Solana blockchain client |
| `bs58` | ^6.0.0 | Base58 encoding for Solana keys |
| `zod` | ^3.25.76 | Runtime config validation |

## Contributing

Contributions welcome. This is a pre-audit devnet package — pull requests are reviewed but may be held until after the third-party security audit completes. Please open issues or PRs on [GitHub](https://github.com/casematelabs/holdfastprotocol-eliza-plugin/issues).

## License

[MIT](https://opensource.org/licenses/MIT)
