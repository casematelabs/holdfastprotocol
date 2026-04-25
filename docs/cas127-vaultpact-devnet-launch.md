# Holdfast Protocol: Devnet Live — Build Trust Infrastructure for AI Agents

> **Security notice:** Holdfast Protocol is currently in devnet. The on-chain programs have not yet undergone a third-party security audit. Do not use devnet program addresses in production. Funds locked in devnet escrow accounts are at risk. An external audit is in progress; this notice will be updated when the audit is complete.

---

AI agents are executing transactions, managing funds, and settling contracts without human intervention. The infrastructure those agents rely on has no standard for verifying who they are, whether they can be trusted, or how to settle disputes when things go wrong.

Holdfast Protocol is our answer. Today, `@holdfastprotocol/sdk@0.1.0-devnet.1` is published and the programs are live on Solana devnet. Here is what it is, how it works, and how to start building with it.

---

## What Holdfast Protocol Does

Holdfast Protocol is trust infrastructure for the AI agent economy, deployed on Solana. It provides three composable primitives:

**1. Hardware-attested agent identities.** Agents register on-chain identities cryptographically bound to secp256r1 (P-256/FIDO2-compatible) keys. The current devnet release implements secp256r1 self-attestation — agents prove key possession on-chain via Solana's native secp256r1 precompile (SIMD-48). Full hardware attestation via TPM/TEE, integrating with Hardline Protocol, is on the roadmap.

**2. On-chain reputation oracle.** Every time an agent fulfills or disputes a pact, the oracle posts a signed reputation update on-chain. Scores run from 0–10000 basis points, decay lazily toward the neutral 5000 when inactive, and are queryable by any program via CPI. No trust assumptions — the chain is the record.

**3. Programmable escrow.** Task-based, milestone-gated, and time-locked settlement contracts for agent-to-agent commerce. Funds lock at pact initiation. Release conditions are set at creation time. Disputes trigger an arbiter resolution path with on-chain finality.

---

## Why Solana

EVM-based attestation (EAS and its derivatives) is general-purpose infrastructure layered on top of Ethereum. It works, but the design shows it: attestation records are separate from the execution environment, verification requires cross-contract calls with EVM gas costs at stake, and the throughput ceiling is a real constraint for agent economies running hundreds of transactions per minute.

Holdfast Protocol is Solana-native by design. The secp256r1 precompile (SIMD-48) is a native instruction-level primitive — attestation is verified in the same instruction as the program call, not in a separate round-trip. Transaction finality on Solana is ~400ms at a cost measured in fractions of a cent. For agents that sign dozens of transactions per hour, that cost difference compounds quickly.

The on-chain reputation account is a PDA. Any other program can read it directly via CPI — no oracle fee, no bridge, no cross-chain message. If your protocol wants to gate access based on agent reputation, the query is one account read.

---

## Devnet Program IDs

| Program | Address |
|---|---|
| `vaultpact` (identity + reputation) | `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg` |
| `vaultpact-escrow` | `BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H` |

Verify these on [Solana Explorer (devnet)](https://explorer.solana.com/?cluster=devnet) before integrating.

---

## How to Integrate

### Install

```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js
```

The `devnet` dist-tag points to `0.1.0-devnet.1`. The `latest` tag is intentionally unset — this SDK is devnet-only until the external audit completes.

### Read an agent's reputation

```typescript
import { createHoldfastClient, VerifTier } from '@holdfastprotocol/sdk';

// Defaults to Solana devnet — no config needed for most use cases
const client = createHoldfastClient();

const rep = await client.reputation.get('AgentPubkeyBase58...');

console.log('Score:', rep.score);          // 0–10000 bp; 5000 = neutral
console.log('Tier:', rep.tier);            // Unverified | Attested | Hardline
console.log('Pacts completed:', rep.totalPacts);
console.log('Disputes:', rep.disputeCount);
```

### Pre-flight: does this agent qualify?

```typescript
const qualified = await client.reputation.meetsRequirements(agentPubkey, {
  minScore: 6000,              // above neutral
  minTier: VerifTier.Attested, // secp256r1-attested key
  minPacts: 3,                 // at least 3 completed pacts
});

if (!qualified) {
  // Reject the counterparty before any funds move
}
```

`meetsRequirements` returns `false` (not throws) for unregistered agents. It mirrors the on-chain `validate_reputation_for_pact` constraint, so your pre-flight matches what the program enforces.

### Create and fund a pact

```typescript
import { createHoldfastClient, EscrowStatus } from '@holdfastprotocol/sdk';
import { Keypair, PublicKey } from '@solana/web3.js';

const client = createHoldfastClient({
  signer: Keypair.fromSecretKey(/* your agent keypair */),
  agentWallet: new PublicKey('YourAgentWalletPDA...'),
});

// 1. Create the pact — time-locked release, reputation gated
const escrow = await client.escrow.createPact({
  counterparty: new PublicKey('CounterpartyPubkey...'),
  counterpartyWallet: new PublicKey('CounterpartyAgentWalletPDA...'),
  mint: new PublicKey('So11111111111111111111111111111111111111112'), // wrapped SOL
  amount: 1_000_000_000n, // 1 SOL
  releaseCondition: {
    kind: 'timed',
    timeLockExpiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  reputationThreshold: { minScore: 5000 },
});

// 2. Fund it — moves SOL into the vault PDA
await client.escrow.depositEscrow(new PublicKey(Buffer.from(escrow.escrowId, 'hex')));

// 3. Release when work is done — opens a 7-day dispute window
await client.escrow.releasePact(new PublicKey(Buffer.from(escrow.escrowId, 'hex')));
```

If `reputationThreshold` is set, `createPact` runs a local pre-flight before the transaction hits the chain. If the counterparty does not qualify, you get a `ReputationThresholdNotMet` error before any fees are paid.

### Paginated history (indexer)

```typescript
const client = createHoldfastClient({
  indexerUrl: 'https://indexer.devnet.holdfastprotocol.com',
});

const page = await client.reputation.getHistory(agentPubkey, { limit: 20 });
// page.entries: HistEntry[]  — ordered oldest → newest
// page.hasMore: boolean
// page.cursor?: string       — pass as `before` for the next page
```

`getHistory` and `listPacts` require the off-chain indexer. RPC methods (`get`, `meetsRequirements`, `getPact`) read on-chain accounts directly — no indexer dependency.

---

## The Hackathon Demo

We built a working end-to-end demo for the Colosseum Frontier Hackathon that walks through the full flow in a single script:

1. Set up payer and oracle keypairs on devnet
2. Register an agent wallet — secp256r1 key generation, P-256 signing, and on-chain registration via the native precompile
3. Initialize a reputation account (score starts at 5000/10000 bp, neutral)
4. Simulate a completed pact — oracle posts a `+200 bp` reputation update
5. Query the history endpoint to verify the indexer picked it up

The full demo is in `holdfast/scripts/hackathon-demo.ts`. Clone the repo, fund a devnet keypair (`solana airdrop 1`), and run `yarn demo` to see it end to end.

One known limitation from the demo: the secp256r1 precompile (SIMD-48) requires a specific devnet feature activation that may not yet be live on the public cluster. The registration transaction flow is fully verified on localnet. Reputation and indexer flows run independently.

---

## What We Are Not Claiming

Full transparency on what is and is not live:

| Capability | Status |
|---|---|
| Reputation read/write on devnet | Live |
| Escrow create/fund/release on devnet | Live |
| secp256r1 self-attestation | Live on localnet; devnet pending cluster upgrade |
| Hardware TPM/TEE attestation | Roadmap — Q4 2026 |
| Hardline Protocol cross-CPI (Tier 2) | Roadmap |
| Public mainnet deployment | After external audit — timeline TBD |
| Revenue (protocol fees) | Planned, not yet implemented |

No token. Protocol fees will be denominated in SOL and stablecoins on actual usage — registrations, reputation queries, escrow settlements. That is the planned business model. Nothing to speculate on today.

---

## Next Steps

- [Install the SDK](https://www.npmjs.com/package/@holdfastprotocol/sdk): `npm install @holdfastprotocol/sdk@devnet`
- Browse the source and IDL in the monorepo
- Follow [@CasemateLabs] for audit timeline and mainnet launch updates
- Building something with Holdfast Protocol? Reach out — we want to support early integrators before mainnet

The programs are live. The SDK is published. Devnet is open.

---

*Holdfast Protocol is deployed on Solana devnet for development and testing only. It has not undergone a formal security audit. Do not use this software to custody real assets or in production systems. An external audit is planned before any mainnet deployment.*

---

---

# X Thread (6 tweets)

**1/**
Holdfast Protocol devnet is live.

`@holdfastprotocol/sdk@0.1.0-devnet.1` published to npm. Programs deployed on Solana devnet.

Trust infrastructure for AI agent economies: hardware-attested identities, on-chain reputation, programmable escrow.

Pre-audit — devnet only. Here's what's live and how to start building.

🧵

---

**2/**
The problem: AI agents are signing transactions with software keys in env vars.

One compromised service → pivot to the signing key → drain everything.

Your agent needs a cryptographic identity that can be verified on every transaction. Holdfast Protocol puts that on-chain, on Solana.

---

**3/**
Why Solana, not EVM?

EAS and its forks require separate contract calls, EVM gas overhead, and cross-chain bridges for non-EVM agents.

Holdfast Protocol uses Solana's native secp256r1 precompile (SIMD-48) — attestation verified at the instruction level. ~400ms finality. Sub-cent cost per operation.

An on-chain reputation PDA any program can read via CPI. No oracle fee. No bridge.

---

**4/**
Three layers, live on devnet:

→ Agent wallet registration (secp256r1/P-256 keys — FIDO2-compatible)
→ Reputation oracle (0–10000 bp score, lazy time-decay, CPI-readable)
→ Programmable escrow (task-based, milestone-gated, dispute-resolvable)

Program IDs:
• `vaultpact`: `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg`
• `vaultpact-escrow`: `BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H`

---

**5/**
Getting started:

```
npm install @holdfastprotocol/sdk@devnet
```

```typescript
const client = createHoldfastClient(); // defaults to devnet

const ok = await client.reputation.meetsRequirements(agentPubkey, {
  minScore: 6000,
  minTier: VerifTier.Attested,
  minPacts: 3,
});
```

Pre-flight returns false (not throws) for unknown agents. Matches what the program enforces on-chain.

---

**6/**
Pre-audit. Devnet only. No mainnet, no token.

What's live: reputation read/write, escrow lifecycle, secp256r1 attestation (localnet; devnet pending cluster upgrade).
What's roadmap: TPM/TEE hardware attestation, Hardline cross-CPI, mainnet post-audit.

If you're building AI agent infrastructure on Solana — we want to talk.

Follow for audit timeline and mainnet updates ↓
