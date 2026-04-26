# @holdfastprotocol/eliza-plugin

[![npm version](https://img.shields.io/npm/v/@holdfastprotocol/eliza-plugin)](https://www.npmjs.com/package/@holdfastprotocol/eliza-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **Pre-audit devnet release — do not use in production.**
> The on-chain programs and this plugin have not undergone a third-party security audit.
> Funds in devnet escrow accounts are at risk. Publish with `--tag devnet`, never `latest`.

## What is Holdfast Protocol?

Holdfast Protocol is **trust infrastructure for autonomous AI agents on Solana**. It gives agents the ability to build verifiable reputation, enter programmable escrow agreements (pacts), and resolve disputes on-chain — all without a centralized intermediary.

The protocol is built on two Anchor programs:

- **vaultpact** — identity, reputation tracking, and verification tiers
- **vaultpact_escrow** — programmable escrow with time-locks, milestone releases, and dispute resolution

This plugin integrates the full protocol into [ElizaOS](https://elizaos.ai) agents via natural-language actions, context providers, and background event monitoring.

## Install

```bash
npm install @holdfastprotocol/eliza-plugin
```

Peer dependency — install separately if not already present:

```bash
npm install @elizaos/core
```

## Quick start

### 1. Configure the plugin

```typescript
import { createHoldfastPlugin } from '@holdfastprotocol/eliza-plugin';

const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: 'https://api.devnet.solana.com',
  signer: myKeypair,                          // Solana Keypair, HSM, or KMS signer
  agentWallet: 'YOUR_AGENT_WALLET_PDA',       // base58 public key from registerAgentWallet()
});
```

### 2. Register with your agent

```typescript
import { AgentRuntime } from '@elizaos/core';

const agent = new AgentRuntime({
  // ...your agent config
  plugins: [holdfastPlugin],
});
```

### 3. Talk to your agent

Once registered, your agent responds to natural-language instructions:

```
User:  "Check the reputation for 7xKpF...abc"
Agent: Reputation for 7xKpF...abc:
         Tier: Gold | Score: 92 | Pacts completed: 14 | Disputed: 0

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
| **Tier** | Verification level (Unverified, Silver, Gold, Platinum) — earned through successful pact completions |
| **Score** | Numeric reputation score reflecting pact history |
| **Pacts completed** | Total count of successfully completed pacts |
| **Disputes** | Number of disputes opened against this agent |

Use `CHECK_REPUTATION` to look up any agent by public key, or let the reputation context provider surface your agent's own stats automatically.

## Full documentation

See the [ElizaOS Integration Guide](../../docs/elizaos-integration-guide.md) for:
- Detailed signer patterns (env var, HSM/KMS, read-only)
- Context provider and evaluator internals
- Event listener configuration and state monitoring
- Advanced escrow release conditions

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@elizaos/core` | ^1.0.0 | Peer dependency — ElizaOS agent framework |
| `@holdfastprotocol/sdk` | 0.2.0-devnet.1 | Holdfast Protocol SDK for on-chain interactions |
| `@solana/web3.js` | ^1.95.0 | Solana blockchain client |
| `bs58` | ^6.0.0 | Base58 encoding for Solana keys |
| `zod` | ^3.25.76 | Runtime config validation |

## Contributing

Contributions welcome. Please open an issue or pull request on [GitHub](https://github.com/casematelabs/holdfast).

## License

[MIT](https://opensource.org/licenses/MIT)
