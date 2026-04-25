# Holdfast Protocol — ElizaOS Integration Guide

> **Pre-audit devnet release.** The on-chain programs and this plugin have not undergone a third-party security audit. Do not use in production. Funds in devnet escrow accounts are at risk.

This guide shows how to wire `@holdfastprotocol/eliza-plugin` into an ElizaOS agent. By the end your agent will be able to check counterparty reputation, create escrow pacts, deposit funds, and respond to on-chain state transitions — all triggered by natural-language messages.

---

## Installation

```bash
npm install @holdfastprotocol/eliza-plugin @holdfastprotocol/sdk @solana/web3.js bs58
```

The plugin peer-depends on `@elizaos/core` ≥ 0.1.0 — install that separately if it is not already in your agent project.

---

## Plugin Configuration

`createHoldfastPlugin(config)` accepts a `HoldfastPluginConfig` object:

| Field | Type | Required | Description |
|---|---|---|---|
| `rpcUrl` | `string` (URL) | No | Solana RPC endpoint. Defaults to devnet. |
| `indexerUrl` | `string` (URL) | No | Holdfast indexer endpoint. Defaults to devnet. |
| `signer` | `Signer` | No* | Pre-constructed `Keypair` or any object implementing the `Signer` interface. |
| `agentWallet` | `string` | No | Base58-encoded AgentWallet PDA public key. Required for provider context injection and event listener. |

\* `signer` is required for write operations (CREATE_PACT, DEPOSIT_ESCROW, RELEASE_PACT, OPEN_DISPUTE). Read-only mode (CHECK_REPUTATION) works without one.

### Choose the right signer pattern

**Pattern A — keypair from environment variable (recommended for most deployments)**

Load the agent's secret key from an environment variable and construct a `Keypair`. Pass it as `signer`.

```typescript
import { createHoldfastPlugin } from '@holdfastprotocol/eliza-plugin';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const signer = Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY_BASE58!));

const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: process.env.SOLANA_RPC_URL,           // e.g. https://api.devnet.solana.com
  indexerUrl: process.env.HOLDFAST_INDEXER_URL,
  signer,
  agentWallet: process.env.AGENT_WALLET_PDA,    // output of registerAgentWallet()
});
```

**Pattern B — `signer` object (for HSMs and external key management)**

Pass any object implementing the `Signer` interface. Use this when your key is managed by an HSM, KMS, or similar system.

```typescript
import { createHoldfastPlugin } from '@holdfastprotocol/eliza-plugin';
import { Keypair } from '@solana/web3.js';

const signer = Keypair.fromSecretKey(loadFromVault()); // your key management

const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: process.env.SOLANA_RPC_URL,
  signer,
  agentWallet: process.env.AGENT_WALLET_PDA,
});
```

**Pattern C — read-only (no signer)**

Omit `signer`. The plugin still loads, but CREATE_PACT, DEPOSIT_ESCROW, RELEASE_PACT, and OPEN_DISPUTE will return an error explaining that a signer is required. CHECK_REPUTATION works normally.

```typescript
const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: process.env.SOLANA_RPC_URL,
  agentWallet: process.env.AGENT_WALLET_PDA,
  // no signer — read-only mode
});
```

---

## Registering the AgentWallet (one-time setup)

Before your agent can create or participate in pacts, you must register an AgentWallet on-chain. This is a one-time operation per agent identity that writes a secp256r1 public key to the program.

```typescript
import { registerAgentWallet } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const signer = Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY_BASE58));

const { agentWallet, p256PrivateKey } = await registerAgentWallet({ connection, signer });

console.log('AgentWallet PDA:', agentWallet.toBase58());
// Set AGENT_WALLET_PDA=<this value> in your .env
```

> **Persist `p256PrivateKey`.** It is the only way to re-derive the same AgentWallet PDA. If lost, the agent must register a new identity with a different PDA — no recovery path exists.

The call is idempotent: calling it on every boot is safe. If the AgentWallet already exists on-chain, the transaction is a no-op.

---

## Wiring into an ElizaOS Agent

Pass the plugin to your agent's `plugins` array. The plugin registers its actions, providers, evaluators, and background service during the `init` lifecycle:

```typescript
import { AgentRuntime, Character } from '@elizaos/core';
import { createHoldfastPlugin } from '@holdfastprotocol/eliza-plugin';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: process.env.SOLANA_RPC_URL,
  indexerUrl: process.env.HOLDFAST_INDEXER_URL,
  signer: Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY_BASE58!)),
  agentWallet: process.env.AGENT_WALLET_PDA,
});

const character: Character = {
  name: 'PactAgent',
  plugins: [holdfastPlugin],
  // ...rest of character config
};

const runtime = new AgentRuntime({ character, /* ...other options */ });
await runtime.initialize();
```

---

## Character File Example

For agents loaded from a JSON character file, pass the plugin reference from your bootstrap code:

```json
{
  "name": "PactAgent",
  "bio": ["I manage on-chain escrow pacts for agent-to-agent contracts."],
  "lore": [],
  "topics": ["escrow", "reputation", "solana", "defi"],
  "adjectives": ["trustworthy", "precise", "on-chain"],
  "style": {
    "all": ["Respond in plain language.", "Always confirm pact IDs and amounts before acting."]
  },
  "settings": {
    "ragKnowledge": false
  }
}
```

```typescript
// bootstrap.ts — load character and inject plugin
import characterJson from './character.json';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const character = {
  ...characterJson,
  plugins: [
    createHoldfastPlugin({
      signer: Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY_BASE58!)),
      agentWallet: process.env.AGENT_WALLET_PDA,
    }),
  ],
};
```

---

## Actions Reference

The plugin registers five actions. ElizaOS routes incoming messages to the matching action based on semantic similarity.

### CHECK_REPUTATION

Looks up the Holdfast reputation account for a Solana public key.

**Triggers on:** messages containing a base58 public key and words like "reputation", "score", "verify", or "trust".

**Example interaction:**
```
User: What is the reputation of Gm1abc...xYz?
Agent: Reputation for Gm1abc...xYz:
         Tier: Attested
         Score: 6200
         Pacts completed: 14
         Pacts disputed: 0
```

**Read-only:** works without a signer configured.

---

### CREATE_PACT

Creates an on-chain escrow pact between this agent and a counterparty.

**Requires:** signer configured in plugin config.

**Required options passed from your orchestration layer:**
| Option | Type | Description |
|---|---|---|
| `counterparty` | `string` (pubkey) | Ed25519 public key of the counterparty |
| `counterpartyWallet` | `string` (pubkey) | AgentWallet PDA of the counterparty |
| `mint` | `string` (pubkey) | SPL token mint (use `So11111111111111111111111111111111111111112` for wSOL) |
| `amount` | `string \| bigint` | Amount in token base units (lamports for wSOL) |
| `releaseCondition` | object | `{ kind: 'task' \| 'milestone' \| 'timed', timeLockExpiresAt?: number }` |

**Default release condition:** `task` with a 7-day time lock if `releaseCondition` is omitted.

**Example interaction:**
```
User: Create a pact with agent Gm1... for 1 SOL, task-based, 7 day lock
Agent: Pact created. Escrow ID: a3f9b1.... Deposit to activate.
```

---

### DEPOSIT_ESCROW

Deposits funds into an existing escrow vault.

**Requires:** signer, and an `escrowId` in options.

```typescript
// Trigger programmatically after CREATE_PACT
await runtime.processActions(message, [{
  name: 'DEPOSIT_ESCROW',
  options: { escrowId: pact.escrowId },
}]);
```

---

### RELEASE_PACT

Releases escrowed funds to the counterparty. Callable only after the release condition is satisfied.

**Requires:** signer, and an `escrowId` in options.

---

### OPEN_DISPUTE

Opens an on-chain dispute for a pact. Triggers the oracle resolution process.

**Requires:** signer, and an `escrowId` plus an optional `reason` string in options.

---

## Providers

Providers inject context into the agent's context window on every message turn, before action selection.

### holdfast-protocol-reputation

Injects the agent's own reputation into the context window.

**Requires:** `agentWallet` in config.

**Injected text (example):**
```
[Holdfast Protocol Reputation]
Tier: Attested | Score: 6200 | Completed: 14 | Disputed: 0
```

Use this to let the agent reason about its own trust level in conversations.

### holdfast-protocol-active-pacts

Injects the list of active escrow pacts involving this agent's wallet.

**Requires:** `agentWallet` in config.

**Injected text (example):**
```
[Holdfast Protocol Active Pacts]
  a3f9b1...: Funded — beneficiary Gm1...
  c7d2e0...: Funded — beneficiary 4xK9...
```

Long pact lists are truncated to ~800 tokens to keep context overhead bounded. An "…and N more" note is appended when entries are omitted.

---

## Evaluator

### reputationThresholdEvaluator

Runs after CREATE_PACT. Calls `client.reputation.meetsRequirements()` on the counterparty and logs a console warning if the check fails. The evaluator uses the default `meetsRequirements` thresholds defined in the SDK.

This evaluator does not block actions — it is a signal your orchestration layer can act on.

---

## Background Service: EscrowEventListenerService

When `agentWallet` is configured, the plugin starts a background service that polls for escrow state transitions every 30 seconds. When a pact you are party to changes status, the service emits:

```
HOLDFAST_PACT_STATE — payload: { pact }
```

The `pact` object contains the full pact state at the time of the transition (escrowId, status, beneficiary, etc.). Subscribe via the ElizaOS runtime event system to trigger follow-up actions.

The service suspends polling after five consecutive failures and attempts an exponential-backoff reconnect sequence (up to five retries). If reconnect fails, the service stops and logs an error.

---

## Environment Variables

Recommended `.env` layout:

```bash
# Required
AGENT_PRIVATE_KEY_BASE58=<base58-encoded 64-byte secret key>
AGENT_WALLET_PDA=<AgentWallet PDA from registerAgentWallet()>

# Optional — defaults to devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
HOLDFAST_INDEXER_URL=https://indexer.devnet.holdfastprotocol.com
```

---

## Troubleshooting

**"Cannot create pact: plugin was initialised without a signer"**
→ Add a `signer` to your `createHoldfastPlugin()` call (see Pattern A above).

**"No valid public key found in message"**
→ CHECK_REPUTATION expects a base58 public key (32–44 chars) in the message text.

**"CREATE_PACT requires counterparty, counterpartyWallet, mint, and amount"**
→ Pass all four required options when triggering CREATE_PACT programmatically.

**"devnet-only restriction"**
→ The SDK rejects mainnet RPC URLs. If you see this error you are pointing at the wrong RPC endpoint.

**Transaction simulation fails: account not found on counterparty's `AgentWallet`**
→ The counterparty does not have an AgentWallet registered. Ask them to run `registerAgentWallet()` first.

**`p256PrivateKey` lost after restart**
→ No recovery path. Register a new AgentWallet (new PDA, new identity) and migrate reputation manually.

---

## Related

- [Integration Guide](./integration-guide.md) — raw SDK usage, PDA derivations, program addresses
- [Threat Model](./tm_escrow_engine.md) — security analysis of all escrow attack surfaces
- [Governance devnet](./governance-devnet.md) — devnet authority and upgrade key procedures
- [`src/index.ts`](../eliza-plugin/src/index.ts) — plugin factory source
- [`src/types.ts`](../eliza-plugin/src/types.ts) — `HoldfastPluginConfig` schema
