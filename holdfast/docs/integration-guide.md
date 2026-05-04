# Holdfast Protocol — Devnet Integration Guide

> **Security notice:** Holdfast Protocol is currently in devnet. Do not use devnet program addresses in production. An internal security review completed in April 2026 — all High and Medium findings have been remediated. A third-party audit is in progress; the report will be published before mainnet.

---

## Canonical Devnet Program Addresses

Holdfast Protocol is deployed as **two on-chain programs**. There is no separate reputation or agent-wallet program — both account types are PDAs inside the Holdfast identity program (Anchor module: `vaultpact`).

| Program (Anchor module) | Program ID | Description |
|---|---|---|
| `vaultpact` (Holdfast Identity) | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` | Core program: AgentWallet, ReputationAccount, AttestationRegistry |
| `vaultpact-escrow` (Holdfast Escrow) | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` | Pact escrow lifecycle: create, deposit, release, dispute |

### Deployment Verification

Both programs verified live on devnet as of 2026-04-20:

```bash
solana program show 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq --url devnet
# Program Id: 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq
# Authority: 2TH4VxNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd
# Last Deployed In Slot: 456484926
# Data Length: 293352 bytes

solana program show CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi --url devnet
# Program Id: CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi
# Authority: 2TH4VxNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd
# Last Deployed In Slot: 456485397
# Data Length: 444760 bytes
```

**Upgrade authority (devnet):** `2TH4VxNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd`  
Note: This is a single-key authority used for devnet iteration. Mainnet deployment will use a multisig upgrade authority — Squads v4 vault PDA, 3-of-5 hardware signers (see Upgrade Authority section below).

---

## IDL Files

IDL (Interface Description Language) files are stored on-chain alongside the deployed programs and can be fetched at any time using the Anchor CLI.

```bash
# Fetch the Holdfast identity program IDL
anchor idl fetch 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq \
  --url https://api.devnet.solana.com \
  -o target/idl/vaultpact.json

# Fetch the Holdfast escrow program IDL
anchor idl fetch CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi \
  --url https://api.devnet.solana.com \
  -o target/idl/vaultpact_escrow.json
```

**Spec version:** `0.1.0` — [Anchor IDL spec `0.1.0`](https://www.anchor-lang.com/docs/idl)

> Always re-fetch after a program upgrade. Using a stale IDL against an upgraded program produces incorrect instruction serialization.

### Generating a typed client from the IDL

```typescript
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import holdfastIdl from '../target/idl/vaultpact.json';
import escrowIdl from '../target/idl/vaultpact_escrow.json';

const holdfastProgram = new Program(holdfastIdl as Idl, provider);
const escrow = new Program(escrowIdl as Idl, provider);
```

For most use cases, prefer the [`@holdfastprotocol/sdk`](../sdk) which wraps these programs with typed helpers and PDA derivation utilities.

---

## PDA Derivations

### AgentWallet

Seeds: `["agent_wallet", pubkey_x (32 bytes), pubkey_y (32 bytes)]`  
Program: `vaultpact`

The agent's secp256r1 (P-256) public key coordinates anchor the PDA — both X and Y are required because X alone is ambiguous on the curve.

### ReputationAccount

Seeds: `["reputation", agent_ed25519_pubkey (32 bytes)]`  
Program: `vaultpact`

Created explicitly via `init_reputation` (separate from `register_agent_wallet`). Size: 512 bytes (~0.00358 SOL rent).

### AttestationRegistry

Seeds: `["attestation_registry"]`  
Program: `vaultpact`  
Singleton — one per program deployment.

### EscrowAccount

Seeds: `["escrow", pact_id (7 bytes)]`  
Program: `vaultpact-escrow`

---

## Reputation Queries — Canonical Read Path

**For any reputation-gated decision, read the on-chain `ReputationAccount` PDA directly. Do not gate on indexer responses.**

Holdfast deliberately splits reputation into two access paths with different trust properties. Most third-party consumers — agents composing Holdfast into character graphs, plugins gating actions on counterparty score, programs wanting an on-chain trust signal — should only ever touch the first one.

### Path 1 — Canonical: read the PDA directly

```typescript
import { createHoldfastClient, VerifTier } from '@holdfastprotocol/sdk';

// Default client connects to devnet — no signer needed for reads
const client = createHoldfastClient();

// Reads the on-chain ReputationAccount PDA directly — no indexer in the path
const rep = await client.reputation.get('AgentPubkeyBase58...');

console.log('Score:', rep.score);              // basis points [0, 10000]; 5000 = neutral
console.log('Tier:', rep.tier);                 // VerifTier.Unverified | Attested | Hardline
console.log('Pacts completed:', rep.totalPacts);
console.log('Disputes:', rep.disputeCount);
```

The score this returns is **authoritative**. It comes from a single Solana RPC `getAccountInfo` against the canonical PDA seeds — there is no service in between, nothing to be stale, no operator who could lie to you. Worst case the RPC is unreachable and you get an error to handle; you cannot get back a wrong number.

For the common pattern of "block this action if the counterparty doesn't meet threshold X", use the typed helper:

```typescript
const ok = await client.reputation.meetsRequirements('CounterpartyPubkey...', {
  minScore: 5000,                  // neutral or above
  minTier: VerifTier.Attested,     // identity-attested
  minPacts: 1,                     // at least one prior completed pact
});

if (!ok) {
  // Decline the contract — counterparty is below trust threshold
}
```

`meetsRequirements` returns `false` (it does not throw) for agents with no `ReputationAccount` yet, mirroring the on-chain `validate_reputation_for_pact` constraint. Your pre-flight check is consistent with what the program enforces at lock time.

### Path 2 — Non-canonical: paginated history via indexer

```typescript
// Dashboard / analytics use ONLY — not for trust decisions
const history = await client.reputation.getHistory('AgentPubkey...', { limit: 20 });
// history.entries: HistEntry[]   — ordered oldest → newest
// history.hasMore: boolean
// history.cursor?: string        — pass as `before` to paginate
```

`getHistory` reads from the off-chain Holdfast indexer, which mirrors the on-chain event stream into a queryable database. Treat it as a dashboard cache, not as authoritative state. The indexer cannot mutate any on-chain account — its only failure mode is staleness.

### Why this split exists

The on-chain `ReputationAccount.score` is mutated only by the escrow program via CPI at terminal pact events (claim, dispute resolution, refund). The indexer **observes** those events and persists them for paginated queries. This means:

- For a **gating decision** ("should I sign this pact?"), you want the current authoritative score — read the PDA.
- For a **history view** ("show me this agent's last 20 pacts"), you want event-stream pagination — query the indexer.

Mixing them up — gating on `getHistory` results — gives the indexer trust authority it shouldn't have. Anyone composing Holdfast into a larger system without reading the internals first should default to `client.reputation.get()` for trust-path queries; this guide makes that the canonical entry point intentionally.

---

## SDK Quick Start

```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js
```

For reputation reads, see the [canonical read path above](#reputation-queries--canonical-read-path).

### Register an AgentWallet

Agent registration is a one-time setup per identity. The `registerAgentWallet` helper generates a secp256r1 keypair, builds the SIMD-48 precompile instruction, and submits both in one transaction. The call is idempotent — safe to call on every boot.

```typescript
import { registerAgentWallet } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const signer = Keypair.fromSecretKey(/* your agent keypair */);

const { agentWallet, p256PrivateKey } = await registerAgentWallet({ connection, signer });
// agentWallet: PublicKey — pass this as `agentWallet` in HoldfastClientOptions
// p256PrivateKey: Uint8Array — save this; it determines the AgentWallet PDA address
```

> **Important:** persist `p256PrivateKey` across restarts. It is the only way to re-derive the same `AgentWallet` PDA for your agent identity. If lost, the agent must register a new identity.

### Create and fund a pact

```typescript
import { createHoldfastClient, VerifTier } from '@holdfastprotocol/sdk';
import { PublicKey } from '@solana/web3.js';

const client = createHoldfastClient({
  signer,                              // Ed25519 keypair
  agentWallet,                         // AgentWallet PDA from registerAgentWallet()
});

const pact = await client.escrow.createPact({
  counterparty: new PublicKey('CounterpartyPubkeyBase58...'),
  counterpartyWallet: new PublicKey('CounterpartyAgentWalletPDA...'),
  mint: new PublicKey('So11111111111111111111111111111111111111112'), // wSOL
  amount: 1_000_000_000n,             // 1 SOL in lamports
  releaseCondition: {
    kind: 'task',
    timeLockExpiresAt: Math.floor(Date.now() / 1000) + 604800,  // 7 days
  },
  reputationThreshold: { minScore: 4500 },
});

// Fund the vault PDA
await client.escrow.depositEscrow(new PublicKey(Buffer.from(pact.escrowId, 'hex')));
```

For a runnable end-to-end example see `sdk/examples/quickstart.ts`.

---

## Program Interaction Flow

```
External caller
      │
      ▼
vaultpact-escrow
   (createPact, depositEscrow, releasePact, openDispute)
      │
      │  CPI — update_reputation, validate_reputation_for_pact
      ▼
vaultpact (core)
   AgentWallet ── identity key, nonce, status
   ReputationAccount ── score, tier, pact history ring-buffer
   AttestationRegistry ── total agents, protocol authority
```

---

## Upgrade Authority — Devnet vs Mainnet

| Environment | Upgrade Authority | Type |
|---|---|---|
| Devnet | `2TH4VxNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd` | Single keypair (iteration speed) |
| Mainnet (planned) | TBD — Squads v4 vault PDA, 3-of-5 hardware signers | Squads v4 multisig |

### Mainnet authority transfer procedure

Before mainnet launch, both program upgrade authorities must be transferred from the deployer keypair to a **Squads v4 3-of-5 multisig vault PDA**. This is a hard gate in the launch checklist.

The transfer is a two-step operation per program — no program redeployment required:

```bash
# 1. Transfer upgrade authority (run as the current authority keypair holder)
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUADS_VAULT_PDA> \
  --keypair <CURRENT_AUTHORITY_KEYPAIR> \
  --url <mainnet-beta|devnet>

# 2. Verify on-chain
solana program show <PROGRAM_ID> --url <mainnet-beta|devnet>
# Output must show: Authority: <SQUADS_VAULT_PDA>
```

Once the Squads v4 multisig is created and the vault PDA is confirmed, this table will be updated with the finalized address.

**Squads v4 vault PDA (mainnet):** `TBD — pending founding team multisig setup`  
**Squads v4 multisig PDA (mainnet):** `TBD — pending founding team multisig setup`

---

## Related Docs

| Guide | What it covers |
|---|---|
| [Developer Quickstart](../sdk/docs/quickstart.md) | Zero to first confirmed on-chain pact in ~15 minutes |
| [ElizaOS Integration](./elizaos-integration-guide.md) | Wire the Holdfast plugin into an ElizaOS agent |
| [Solana Agent Kit Integration](./sak-integration-guide.md) | Add Holdfast actions to a SAK agent |
| [Reputation Composability](../../docs/dev/reputation-composability.md) | Gate your protocol on Holdfast reputation (off-chain SDK + on-chain CPI) |
| [Troubleshooting Reference](./troubleshooting.md) | Error codes, SDK exceptions, and recovery paths |
