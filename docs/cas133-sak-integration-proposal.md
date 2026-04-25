# CAS-133: Solana Agent Kit — Holdfast Protocol Native Action Proposal

*DevRel working doc. Contains: GitHub issue draft, action scope, SDK readiness notes for CTO.*

---

## GitHub Issue Draft

**Repo target:** `sendaios/solana-agent-kit`
**Title:** `[Plugin Proposal] Holdfast Protocol — on-chain reputation + programmable escrow for AI agents`

---

### Summary

[Holdfast Protocol](https://github.com/CasemateLabs/new_proto) is trust infrastructure for AI agent economies on Solana. It provides three composable primitives:

- **Hardware-attested agent identities** — secp256r1/P-256 keys registered on-chain via Solana's native SIMD-48 precompile
- **On-chain reputation oracle** — score 0–10000 bp, lazy time-decay, CPI-readable by any program
- **Programmable escrow** — task-based, milestone-gated, and time-locked pact settlement

Adding Holdfast Protocol as a SAK plugin would let any AI agent using the kit verify counterparty trust, gate operations on reputation thresholds, and create on-chain settlement contracts — all from natural-language intent.

**Status:** Devnet live. `@holdfastprotocol/sdk@0.1.0-devnet.1` published on npm. External audit in progress; mainnet gated on audit completion.

---

### Proposed Actions

| Action name | Description | Signer required? |
|---|---|---|
| `GET_HOLDFAST_REPUTATION` | Fetch live on-chain reputation (score, tier, pact count) for any agent | No |
| `CHECK_HOLDFAST_REQUIREMENTS` | Pre-flight: does an agent meet score/tier/pact thresholds? | No |
| `CREATE_HOLDFAST_PACT` | Initialise + fund an escrow pact with a counterparty | Yes |
| `GET_HOLDFAST_PACT` | Read current state of an existing pact/escrow | No |

---

### Example

```typescript
// No signer needed for reads
const rep = await agent.GET_HOLDFAST_REPUTATION({
  agentPubkey: "CounterpartyPubkey...",
});
// { score: 7500, tier: "Attested", totalPacts: 42, disputeCount: 1 }

// Pre-flight before committing funds
const ok = await agent.CHECK_HOLDFAST_REQUIREMENTS({
  agentPubkey: "CounterpartyPubkey...",
  minScore: 6000,
  minTier: "Attested",
  minPacts: 3,
});
// { qualifies: true, score: 7500, tier: "Attested", totalPacts: 42 }

// Create and fund a timed escrow pact
const pact = await agent.CREATE_HOLDFAST_PACT({
  counterpartyPubkey: "CounterpartyPubkey...",
  counterpartyAgentWallet: "CounterpartyWalletPDA...",
  mint: "So11111111111111111111111111111111111111112",  // wSOL
  amount: "1000000000",  // 1 SOL in lamports
  releaseKind: "timed",
  timeLockSecs: 604800,  // 7 days
  agentWallet: "MyAgentWalletPDA...",
  minCounterpartyScore: 5000,  // enforce neutral or above
});
// { escrowId: "...", status: "Funded", vault: "...", timeLockExpiresAt: ... }
```

---

### SDK

```bash
npm install @holdfastprotocol/sdk@devnet
```

Full plugin source (ready to drop into `packages/plugin-holdfast`):
[`examples/solana-agent-kit/index.ts`](../holdfast/sdk/examples/solana-agent-kit/index.ts)

Devnet program IDs:

| Program | Address |
|---|---|
| `vaultpact` (identity + reputation) | `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg` |
| `vaultpact-escrow` | `BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H` |

---

### Scope / Limitations

- **Devnet only** — the SDK enforces a mainnet-blocking guard. All integration testing targets devnet.
- **Agent registration is a prerequisite for `CREATE_HOLDFAST_PACT`** — the signing agent must have a registered `AgentWallet` PDA (secp256r1 key registration, not yet exposed as a SAK action). Read-only actions (`GET_HOLDFAST_REPUTATION`, `CHECK_HOLDFAST_REQUIREMENTS`, `GET_HOLDFAST_PACT`) work without registration.
- **LangChain + Eliza compatible** — the action format follows SAK v2 plugin conventions and should work with both adapters.
- **No token** — Holdfast Protocol protocol fees will be SOL/stablecoin denominated.

---

### Why this matters for SAK

SAK agents can already sign transactions and manage funds. What they can't do today is verifiably screen counterparties before those transactions — or lock funds in a dispute-resolvable settlement contract.

Holdfast Protocol adds a trust layer that fits the existing SAK agent model:

1. LLM receives a task involving an unknown counterparty agent
2. `CHECK_HOLDFAST_REQUIREMENTS` pre-flight runs before any funds move
3. If qualified, `CREATE_HOLDFAST_PACT` locks funds on-chain with built-in dispute resolution
4. Either party can monitor with `GET_HOLDFAST_PACT` at any point

This is composable with DeFi, token transfer, and any other SAK action — reputation check and pact creation are just two more steps in an existing agent pipeline.

---

### Contacts

- GitHub: [@CasemateLabs](https://github.com/CasemateLabs)
- SDK npm: [`@holdfastprotocol/sdk`](https://www.npmjs.com/package/@holdfastprotocol/sdk)
- Happy to open a PR directly if this direction looks good — we have the plugin code written and tested on devnet.

---

---

## Internal Notes (CAS-133)

### SDK Readiness — CTO Coordination Required

Before the PR to SAK can go final, confirm the following with CTO:

| Item | Status | Notes |
|---|---|---|
| `@holdfastprotocol/sdk` ESM/CJS dual build | Done — 0.1.0-devnet.1 | SAK plugins typically use ESM; the exports map is in place |
| `createPact` + `depositEscrow` pipeline | Done | Tested in hackathon-demo.ts |
| `agentWallet` param in `createPact` | Confirmed required | SAK plugin passes it as input; user must supply PDA |
| `registerAgentWallet()` SDK helper | **Not yet exposed** | Needed for a complete end-to-end SAK flow; currently manual secp256r1 only |
| Indexer required for `listPacts` / `getHistory` | Confirmed | Not needed for the 4 proposed actions (all use RPC direct reads) |
| `releasePact` action | Not included in v1 scope | Can be action 5 in a follow-up once dispute window handling is fully specified |

**Key gap for CTO:** The `CREATE_HOLDFAST_PACT` action requires the agent's `AgentWallet` PDA as input. A SAK agent using this action must have pre-registered with Holdfast Protocol. We either need:
- (a) a `REGISTER_HOLDFAST_AGENT` action (requires secp256r1 SDK helper — not yet available), or
- (b) documentation that sets the expectation: Holdfast Protocol actions are for agents already registered. Write-only actions require setup outside of SAK.

For the initial PR proposal, option (b) is correct — frame registration as a prerequisite. Action scope can expand once `registerAgentWallet()` ships in the SDK.

### SAK Maintainer Contacts

From the SAK GitHub (https://github.com/sendaios/solana-agent-kit):
- Primary maintainer: `@sendaios` GitHub org — check the `CONTRIBUTING.md` for preferred contact
- Discord: Solana Agent Kit has an active Discord server linked from the repo README
- PR process: Open a draft PR with the plugin under `packages/plugin-holdfast/`; tag the core team for review

### Action Plan

1. [x] Scope the 4 actions and write plugin code (`examples/solana-agent-kit/index.ts`)
2. [x] Draft GitHub issue (this doc, section above)
3. [ ] Confirm CTO sign-off on SDK readiness gaps (esp. `registerAgentWallet` timeline)
4. [ ] Open draft PR to `sendaios/solana-agent-kit` with:
   - `packages/plugin-holdfast/src/index.ts` (adapted from examples file)
   - `packages/plugin-holdfast/package.json`
   - `packages/plugin-holdfast/README.md`
   - Updated `packages/core/src/plugins/index.ts` to include the plugin
5. [ ] Post in SAK Discord announcing the PR and soliciting feedback
6. [ ] Once PR merged: update devnet launch post (CAS-127) to mention SAK integration

### Frame for PR / Issue

- Lead with the agent-to-agent trust use case, not the escrow mechanics
- Emphasize read-only actions need zero registration — lowest-friction entry point
- Be explicit this is devnet/preview; link the npm devnet tag
- Position the reputation pre-flight as a composable safety layer for any existing SAK DeFi action
