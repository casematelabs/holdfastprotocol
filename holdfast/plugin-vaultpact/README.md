# @elizaos/plugin-holdfast

ElizaOS plugin for the [Holdfast Protocol](https://holdfastprotocol.com) — trust infrastructure for autonomous AI agents on Solana. Enables AI agents to register on-chain, create and release escrow pacts, and inject live reputation and pact-status data into the context window.

> **Status**: Skeleton / pre-release. All action handlers throw `Error("not implemented")`. Production logic will land as the on-chain programs stabilise.

## Installation

```bash
npm install @elizaos/plugin-holdfast
```

## Plugin registration

```typescript
import { createAgent } from "@elizaos/core";
import { holdfastPlugin } from "@elizaos/plugin-holdfast";

const agent = createAgent({ plugins: [holdfastPlugin] });
```

## Actions

### `REGISTER_AGENT_WALLET`
Registers the agent's secp256r1 public key on the Holdfast Protocol on-chain agent registry. Must succeed before the agent can be a party to any pact.

**Env vars**: `HOLDFAST_RPC_URL`, `HOLDFAST_AGENT_KEYPAIR`

### `INITIATE_PACT`
Creates a new Holdfast Protocol escrow on-chain. The agent becomes the pact initiator and funds are locked until the pact is released or escalated to dispute.

**Env vars**: `HOLDFAST_RPC_URL`, `HOLDFAST_AGENT_KEYPAIR`

### `RELEASE_PACT`
Releases escrowed funds to the counterparty once pact conditions are fulfilled. Only the initiating agent or an authorised oracle may invoke this.

**Env vars**: `HOLDFAST_RPC_URL`, `HOLDFAST_AGENT_KEYPAIR`

## Providers

### `REPUTATION_SCORE`
Fetches the agent's on-chain reputation account via `@holdfastprotocol/sdk` and injects a summary (score in basis points, tier, total pacts, dispute count) into the context window.

**Env vars**: `HOLDFAST_RPC_URL`, `HOLDFAST_INDEXER_URL` *(optional — defaults to devnet indexer)*

### `PACT_STATUS`
Queries the current state of an escrow PDA directly via RPC and injects the status (e.g. `Funded`, `Locked`, `Released`, `Disputed`) into the context window.

**Env vars**: `HOLDFAST_RPC_URL`

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `HOLDFAST_RPC_URL` | Yes | Solana RPC endpoint |
| `HOLDFAST_AGENT_KEYPAIR` | Actions only | Base58-encoded agent keypair for signing transactions |
| `HOLDFAST_INDEXER_URL` | No | Off-chain indexer base URL for extended history |
