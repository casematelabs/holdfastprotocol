# Solana Agent Kit — Holdfast Protocol Integration Guide

This guide shows you how to add Holdfast Protocol actions to a [Solana Agent Kit (SAK)](https://github.com/sendaios/solana-agent-kit) agent. After following it, your agent can check counterparty reputation, run pre-flight trust requirements, and create on-chain escrow pacts — all from natural-language intent.

**Network:** Devnet only. `@holdfastprotocol/sdk` blocks mainnet connections; the external audit must complete before mainnet access is enabled.

---

## What you get

| Action | What it does | Signer needed? |
|---|---|---|
| `GET_HOLDFAST_REPUTATION` | Fetch live on-chain reputation (score, tier, pact count) for any agent | No |
| `CHECK_HOLDFAST_REQUIREMENTS` | Pre-flight: does an agent meet score / tier / pact thresholds? | No |
| `CREATE_HOLDFAST_PACT` | Create and fund an escrow pact with a counterparty | Yes |
| `GET_HOLDFAST_PACT` | Read current state of an existing pact | No |

The read-only actions (`GET_HOLDFAST_REPUTATION`, `CHECK_HOLDFAST_REQUIREMENTS`, `GET_HOLDFAST_PACT`) need no registration and no signer. They work as lightweight safety checks you can drop into any SAK pipeline before funds move.

---

## Prerequisites

- Node.js ≥ 18
- A SAK agent already configured with a Solana keypair (Ed25519) and a devnet RPC URL
- `@solana-agent-kit/core` ≥ 2.0 installed in your project
- **For `CREATE_HOLDFAST_PACT` only:** A registered Holdfast `AgentWallet` PDA (see [Agent registration](#agent-registration-prerequisite))

---

## Installation

```bash
npm install @holdfastprotocol/sdk@devnet
```

The `@devnet` dist-tag tracks `0.1.x-devnet.*` pre-releases. Pin to a specific version in production-like devnet environments.

---

## Add the plugin to your SAK agent

Drop the plugin file from the SDK examples into your project, or install it from npm once `@holdfast/sak-plugin` is published.

**From the SDK examples (copy approach):**

```bash
# Copy the ready-to-use plugin into your project
cp node_modules/@holdfastprotocol/sdk/examples/solana-agent-kit/index.ts \
   src/plugins/holdfast.ts
```

**Wire it into your agent:**

```typescript
import { SolanaAgentKit } from "@solana-agent-kit/core";
import { holdfastPlugin } from "./plugins/holdfast";

const agent = new SolanaAgentKit(keypair, rpcUrl, {});
agent.use(holdfastPlugin);
```

That's it. The four actions are now registered and the LLM can invoke them by natural-language intent (e.g., "check the reputation of this agent before we proceed").

---

## Actions

### GET_HOLDFAST_REPUTATION

Fetches the on-chain `ReputationAccount` for any agent.

**Input**

| Field | Type | Description |
|---|---|---|
| `agentPubkey` | `string` | Base58 Solana public key of the agent to look up |

**Output (success)**

```json
{
  "agentPubkey": "AgentBase58...",
  "score": 7500,
  "tier": "Attested",
  "totalPacts": 42,
  "disputeCount": 1,
  "lastUpdated": 1744000000
}
```

**Score interpretation**

| Range | Meaning |
|---|---|
| 0–4999 | Below neutral (history of disputes or no activity) |
| 5000 | Neutral baseline (new agent or decay-settled) |
| 5001–10000 | Above neutral; higher = more trusted |

**Tier values**

- `Unverified` — no on-chain attestation
- `Attested` — secp256r1 / P-256 self-attestation registered on-chain
- `Hardline` — TEE-attested via Hardline cross-program invocation

**Output (agent has no reputation account yet)**

```json
{
  "agentPubkey": "AgentBase58...",
  "error": "REPUTATION_NOT_FOUND",
  "message": "No Holdfast reputation account found for this agent."
}
```

This is not an exception — an agent with no account is simply unregistered. `REPUTATION_NOT_FOUND` is a safe signal to stop, not to crash.

---

### CHECK_HOLDFAST_REQUIREMENTS

Pre-flight check: returns whether an agent meets your specified thresholds. Use this before committing funds.

This action mirrors the `validate_reputation_for_pact` constraint enforced on-chain during `lockEscrow`, so a passing pre-flight means the program will accept the lock too.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `agentPubkey` | `string` | Yes | Agent to validate |
| `minScore` | `number` (0–10000) | No | Minimum score in basis points |
| `minTier` | `"Unverified" \| "Attested" \| "Hardline"` | No | Minimum verification tier |
| `minPacts` | `number` | No | Minimum lifetime completed pacts |

**Output (passes)**

```json
{
  "agentPubkey": "AgentBase58...",
  "qualifies": true,
  "score": 7500,
  "tier": "Attested",
  "totalPacts": 42
}
```

**Output (fails threshold)**

```json
{
  "agentPubkey": "AgentBase58...",
  "qualifies": false,
  "score": 4200,
  "tier": "Unverified",
  "totalPacts": 0
}
```

**Output (no reputation account)**

```json
{
  "agentPubkey": "AgentBase58...",
  "qualifies": false,
  "reason": "REPUTATION_NOT_FOUND"
}
```

**Example — combined pre-flight in a pipeline**

```typescript
// Run before any payment or agreement
const check = await agent.CHECK_HOLDFAST_REQUIREMENTS({
  agentPubkey: counterpartyPubkey,
  minScore: 6000,
  minTier: "Attested",
  minPacts: 3,
});

if (!check.qualifies) {
  // abort or escalate — do not proceed
}
```

---

### CREATE_HOLDFAST_PACT

Creates and immediately funds an escrow pact. The signing agent is the initiator; the counterparty is the beneficiary.

Funds are locked in a vault PDA owned by the escrow program. Neither party can withdraw unilaterally until the release condition is met.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `counterpartyPubkey` | `string` | Yes | Base58 public key of the counterparty (beneficiary) |
| `counterpartyAgentWallet` | `string` | Yes | Base58 address of the counterparty's `AgentWallet` PDA |
| `mint` | `string` | Yes | SPL token mint. Use `So11111111111111111111111111111111111111112` for wrapped SOL |
| `amount` | `string` | Yes | Escrow amount in token base units (lamports for wSOL). Pass as string to avoid JS precision loss |
| `releaseKind` | `"task" \| "milestone" \| "timed"` | Yes | Release condition type (see below) |
| `timeLockSecs` | `number` | Yes | Seconds from now until the time-lock expires |
| `agentWallet` | `string` | Yes | Your own `AgentWallet` PDA — required (see [Agent registration](#agent-registration-prerequisite)) |
| `arbiter` | `string` | No | Optional Base58 public key of an arbiter for dispute resolution |
| `minCounterpartyScore` | `number` | No | Abort if counterparty score is below this threshold |
| `minCounterpartyTier` | `"Unverified" \| "Attested" \| "Hardline"` | No | Abort if counterparty tier is below this |
| `deliverablesUri` | `string` | No | IPFS or Arweave URI pointing to a deliverables specification |

**Release conditions**

| Kind | Behaviour |
|---|---|
| `task` | Initiator manually calls `releasePact` when satisfied; 7-day dispute window opens |
| `milestone` | Arbiter-verified release; requires an arbiter address |
| `timed` | Auto-released by an on-chain keeper crank after `timeLockSecs` elapses |

**Output (success)**

```json
{
  "escrowId": "a1b2c3d4e5f6...",
  "escrowAddress": "EscrowPDABase58...",
  "status": "Funded",
  "amount": "1000000000",
  "vault": "VaultATABase58...",
  "timeLockExpiresAt": 1745000000
}
```

**Output (reputation threshold not met)**

```json
{
  "error": "REPUTATION_THRESHOLD_NOT_MET",
  "message": "Counterparty score 3200 is below the required minimum 5000."
}
```

**Output (registration missing)**

```json
{
  "error": "AGENT_WALLET_REQUIRED",
  "message": "agentWallet PDA is required. Register your agent with Holdfast first."
}
```

**Example — 1 SOL timed pact with reputation guard**

```typescript
const pact = await agent.CREATE_HOLDFAST_PACT({
  counterpartyPubkey: "CounterpartyPubkey...",
  counterpartyAgentWallet: "CounterpartyWalletPDA...",
  mint: "So11111111111111111111111111111111111111112",  // wSOL
  amount: "1000000000",                                 // 1 SOL in lamports
  releaseKind: "timed",
  timeLockSecs: 604800,                                 // 7 days
  agentWallet: "MyAgentWalletPDA...",
  minCounterpartyScore: 5000,
  minCounterpartyTier: "Attested",
});
```

**Internals:** The action calls `createPact()` then `depositEscrow()` in sequence. After the deposit confirms it reads back the account and returns `status: "Funded"`. If you need finer-grained control over deposit timing, call those SDK methods directly instead.

---

### GET_HOLDFAST_PACT

Reads the current state of an escrow account.

**Input**

| Field | Type | Description |
|---|---|---|
| `escrowAddress` | `string` | Base58 address of the `EscrowAccount` PDA |

**Output (success)**

```json
{
  "escrowAddress": "EscrowPDABase58...",
  "escrowId": "a1b2c3d4...",
  "status": "Funded",
  "initiator": "InitiatorBase58...",
  "beneficiary": "BeneficiaryBase58...",
  "arbiter": null,
  "mint": "So11111111111111111111111111111111111111112",
  "vault": "VaultATABase58...",
  "amount": "1000000000",
  "initiatorStake": "50000000",
  "beneficiaryStake": "0",
  "timeLockExpiresAt": 1745000000,
  "disputeWindowEndsAt": null,
  "createdAt": 1744000000,
  "lockedAt": null,
  "releasedAt": null
}
```

**Status values**

| Status | Meaning |
|---|---|
| `Pending` | Pact created, not yet funded |
| `Funded` | Initiator deposit confirmed; waiting for beneficiary to stake + lock |
| `Locked` | Both parties staked; pact is active |
| `Released` | Initiator released; 7-day dispute window open |
| `Disputed` | Dispute raised; awaiting arbiter resolution |
| `Refunded` | Initiator refunded from Pending state |
| `Claimed` | Funds claimed after dispute window closed |
| `Closed` | Pact closed out |
| `MutuallyCancelled` | Both parties cancelled |

---

## Agent registration prerequisite

`CREATE_HOLDFAST_PACT` requires a registered `AgentWallet` PDA. Registration binds a secp256r1 / P-256 key to your Ed25519 Solana keypair on-chain.

**Registration is a one-time operation per agent identity.** It is not yet exposed as a SAK action. Do it via the SDK directly, then persist the output `agentWallet` PDA address — you pass it as a parameter to every `CREATE_HOLDFAST_PACT` call.

```typescript
import { registerAgentWallet } from "@holdfastprotocol/sdk";

const result = await registerAgentWallet({
  connection,  // web3.js Connection (devnet)
  signer,      // your Ed25519 Keypair
});

// Store these permanently:
console.log("AgentWallet PDA:", result.agentWallet.toBase58());
console.log("P-256 private key (hex):", Buffer.from(result.p256PrivateKey).toString("hex"));
```

**Critical:** The `p256PrivateKey` is the key material that derives your on-chain identity. If you lose it after registration you cannot recover the same PDA — you would need to register a new identity. Store it in your secrets manager alongside your Ed25519 keypair.

Registration is idempotent: calling `registerAgentWallet` a second time with the same P-256 key returns the existing PDA without re-registering.

Read-only SAK actions (`GET_HOLDFAST_REPUTATION`, `CHECK_HOLDFAST_REQUIREMENTS`, `GET_HOLDFAST_PACT`) work without any registration.

---

## Complete example: agent-to-agent trust pipeline

This pattern covers the common case: an agent receives a task involving an unknown counterparty, runs a pre-flight trust check, then creates an escrow pact if the counterparty qualifies.

```typescript
import { SolanaAgentKit } from "@solana-agent-kit/core";
import { holdfastPlugin } from "./plugins/holdfast";

const agent = new SolanaAgentKit(keypair, "https://api.devnet.solana.com", {});
agent.use(holdfastPlugin);

const COUNTERPARTY_PUBKEY = "CounterpartyPubkey...";
const COUNTERPARTY_WALLET = "CounterpartyWalletPDA...";
const MY_AGENT_WALLET    = "MyAgentWalletPDA...";

// Step 1 — Inspect the counterparty
const rep = await agent.GET_HOLDFAST_REPUTATION({
  agentPubkey: COUNTERPARTY_PUBKEY,
});
console.log(`Score: ${rep.score}, Tier: ${rep.tier}, Pacts: ${rep.totalPacts}`);

// Step 2 — Pre-flight check
const check = await agent.CHECK_HOLDFAST_REQUIREMENTS({
  agentPubkey: COUNTERPARTY_PUBKEY,
  minScore: 5500,
  minTier: "Attested",
  minPacts: 2,
});

if (!check.qualifies) {
  throw new Error(`Counterparty does not meet requirements: ${JSON.stringify(check)}`);
}

// Step 3 — Create the pact (counterparty has Attested tier, score ≥ 5500)
const pact = await agent.CREATE_HOLDFAST_PACT({
  counterpartyPubkey: COUNTERPARTY_PUBKEY,
  counterpartyAgentWallet: COUNTERPARTY_WALLET,
  mint: "So11111111111111111111111111111111111111112",
  amount: "500000000",          // 0.5 SOL
  releaseKind: "task",
  timeLockSecs: 86400 * 3,      // 3-day time-lock
  agentWallet: MY_AGENT_WALLET,
});

console.log(`Pact created: ${pact.escrowAddress} — status: ${pact.status}`);

// Step 4 — Poll status later
const current = await agent.GET_HOLDFAST_PACT({
  escrowAddress: pact.escrowAddress,
});
console.log(`Current status: ${current.status}`);
```

---

## Error reference

| Error key | Returned by | Meaning |
|---|---|---|
| `REPUTATION_NOT_FOUND` | `GET_HOLDFAST_REPUTATION`, `CHECK_HOLDFAST_REQUIREMENTS` | No `ReputationAccount` exists for this agent — they have not yet completed a pact |
| `REPUTATION_THRESHOLD_NOT_MET` | `CREATE_HOLDFAST_PACT` | Counterparty score or tier is below your specified minimum |
| `AGENT_WALLET_REQUIRED` | `CREATE_HOLDFAST_PACT` | `agentWallet` PDA missing from input — register first |
| `SIGNER_REQUIRED` | `CREATE_HOLDFAST_PACT` | SAK agent has no signer configured |
| `ESCROW_NOT_FOUND` | `GET_HOLDFAST_PACT` | No escrow account at the given address |

All errors are returned as JSON strings from the action handler, not thrown exceptions, so they compose cleanly with SAK's LLM response formatting.

---

## Program addresses (devnet)

| Program | Address |
|---|---|
| Holdfast identity & reputation (`vaultpact`) | `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg` |
| Holdfast escrow (`vaultpact-escrow`) | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

---

## Troubleshooting

**"No Holdfast reputation account found" for a known agent**

The account is initialized explicitly via `init_reputation` (separate from agent registration). A newly registered agent may show `REPUTATION_NOT_FOUND` until that step is run. This is expected; treat it the same as `qualifies: false` in your pre-flight logic.

**`CREATE_HOLDFAST_PACT` returns `AGENT_WALLET_REQUIRED`**

Your agent is not registered with Holdfast. Complete the [Agent registration](#agent-registration-prerequisite) step and persist the returned `agentWallet` PDA address.

**Transaction times out on devnet**

Devnet RPC can be congested. The SDK's `sendAndConfirmWithRetry` helper retries with exponential backoff automatically. If you're hitting consistent timeouts, switch to a dedicated devnet RPC endpoint (Helius, QuickNode, etc.).

**Score seems stale**

Reputation scores apply lazy time-decay toward the 5000 neutral baseline on any write operation. A score is only recomputed on-chain when the account is written (e.g., a new pact outcome is recorded). Off-chain reads via the SDK reflect the stored value plus an estimated decay projection. For exact on-chain state, use `client.reputation.get()` directly.

---

## What's not in v1

These capabilities are planned but not yet included in the current SAK plugin scope:

- **`REGISTER_HOLDFAST_AGENT`** — registration as a SAK action requires a `registerAgentWallet` SAK wrapper; tracked as a follow-up once the SDK helper is exposed as a high-level action
- **`RELEASE_HOLDFAST_PACT`** — manual pact release by the initiator; post-audit follow-up
- **`OPEN_DISPUTE`** — dispute escalation action; post-audit follow-up
- **Mainnet support** — gated on the external audit; the SDK will remove the mainnet-blocking guard after audit sign-off

---

## Related docs

- [Quickstart guide](quickstart.md) — 15-minute walkthrough: register an agent, check reputation, create a pact
- [Integration guide](integration-guide.md) — program addresses, PDA derivation, IDL access
- [Reputation composability](reputation-composability.md) — reading Holdfast reputation from your own Solana program via CPI
- [ElizaOS integration guide](elizaos-integration-guide.md) — ElizaOS plugin wiring (alternative to SAK)
