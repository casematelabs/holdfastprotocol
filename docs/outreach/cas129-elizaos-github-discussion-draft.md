# Draft: GitHub Discussion post for elizaos/eliza

**Title:** Holdfast Protocol plugin — hardware-attested escrow & reputation for ElizaOS agents

---

## Body

We're building `@holdfastprotocol/eliza-plugin`, a Holdfast Protocol integration for ElizaOS agents, and wanted to share the design early and get input from the community.

### What Holdfast Protocol is

Holdfast Protocol is a Solana trust infrastructure protocol for autonomous agents — two modules:

- **Reputation layer** — on-chain `VerifTier`-scored track records. Agents can check counterparty reputation before committing to a pact.
- **Programmable escrow** — `createPact` / `releasePact` with `TaskRelease | MilestoneRelease | TimedRelease` conditions. Funds move autonomously when conditions are met. Execution events are hardware-attested.

### Why ElizaOS

ElizaOS agents are making real economic decisions — contracting, trading, hiring. The missing primitive is *verifiable trust*: how does an agent know its counterparty's track record before locking funds?

Holdfast Protocol answers that with on-chain provenance that survives agent replacement.

### Plugin design (MVP)

```typescript
import { createHoldfastPlugin } from "@holdfastprotocol/eliza-plugin";

export const character = {
  plugins: [
    createHoldfastPlugin({
      rpcUrl: "https://api.devnet.solana.com",
      signer: myKeypair,
      agentWallet: "Gm1...xYz",
    }),
  ],
};
// Agent can now CHECK_REPUTATION, CREATE_PACT, DEPOSIT_ESCROW, RELEASE_PACT, OPEN_DISPUTE
```

**Actions:** `CHECK_REPUTATION`, `CREATE_PACT`, `DEPOSIT_ESCROW`, `RELEASE_PACT`, `OPEN_DISPUTE`  
**Providers:** reputation score + active pacts injected into context window  
**Evaluator:** post-pact-creation counterparty reputation check  
**Service:** background escrow state poller, emits runtime events

### Current status

- SDK (`@holdfastprotocol/sdk`) is live on devnet
- Plugin implementation is complete. npm package publish in progress.
- We'd love feedback on: the action/provider API surface, anything we're missing from the ElizaOS v2 plugin interface, and the registry PR process

### Questions for the community

1. Is there a preferred way to inject a Solana signer into ElizaOS agent config — or is plugin config the idiomatic path?
2. Any conventions in the registry for tagging financial / escrow plugins?
3. Interest in collaborating on a joint demo agent that uses Holdfast Protocol reputation before taking on paid tasks?

Repo: [github.com/casemate-labs/holdfast-protocol](https://github.com/casemate-labs/holdfast-protocol) *(link to be updated at public launch)*  
Docs: holdfastprotocol.com *(coming)*

Happy to answer questions. Thanks for building ElizaOS — it's exactly the runtime we needed.

— Matthew @ Casemate Labs
