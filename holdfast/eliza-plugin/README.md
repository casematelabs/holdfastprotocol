# @holdfastprotocol/eliza-plugin

> **Pre-audit devnet release — do not use in production.**
> The on-chain programs and this plugin have not undergone a third-party security audit.
> Funds in devnet escrow accounts are at risk. Publish with `--tag devnet`, never `latest`.

Holdfast Protocol reputation and escrow plugin for [ElizaOS](https://elizaos.ai) agents.
Adds reputation lookup, pact creation, escrow management, and dispute handling via natural-language actions.

## Install

```bash
npm install @holdfastprotocol/eliza-plugin
```

Peer dependency — install separately if not already present:

```bash
npm install @elizaos/core
```

## Minimal configuration

```typescript
import { createHoldfastPlugin } from '@holdfastprotocol/eliza-plugin';

const holdfastPlugin = createHoldfastPlugin({
  rpcUrl: process.env.SOLANA_RPC_URL,               // e.g. https://api.devnet.solana.com
  privateKeyBase58: process.env.AGENT_PRIVATE_KEY_BASE58,
  agentWallet: process.env.AGENT_WALLET_PDA,        // output of registerAgentWallet()
});
```

Register the plugin with your ElizaOS agent:

```typescript
const agent = new AgentRuntime({
  // ...your agent config
  plugins: [holdfastPlugin],
});
```

## Actions

| Action | Description |
|---|---|
| `CHECK_REPUTATION` | Look up reputation for a Solana public key |
| `CREATE_PACT` | Create an escrow pact with a counterparty |
| `DEPOSIT_ESCROW` | Fund an existing pact escrow to activate it |
| `RELEASE_PACT` | Release funds to the counterparty |
| `OPEN_DISPUTE` | Open a dispute on an active pact |

Write operations (`CREATE_PACT`, `DEPOSIT_ESCROW`, `RELEASE_PACT`, `OPEN_DISPUTE`) require a signer.
`CHECK_REPUTATION` works in read-only mode (no signer required).

## Full documentation

See [`holdfast/docs/elizaos-integration-guide.md`](../../docs/elizaos-integration-guide.md) for:
- All config fields (`rpcUrl`, `indexerUrl`, `signer`, `privateKeyBase58`, `agentWallet`)
- Signer patterns (env var, HSM/KMS, read-only)
- Context providers and evaluator details
- Event listener and pact state monitoring
