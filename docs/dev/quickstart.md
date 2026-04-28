# Holdfast Protocol Quickstart

Get from zero to your first confirmed devnet pact in under 15 minutes.

**Status:** Devnet only — v0.1.1-devnet is pre-audit. Mainnet use is blocked until the external security audit completes. Track status at [docs.holdfastprotocol.com/security](https://docs.holdfastprotocol.com/security).

---

## Prerequisites

- Node.js 18+ and npm/yarn
- A Solana keypair with devnet SOL ([airdrop instructions below](#1-fund-your-wallet))
- Basic familiarity with Solana (public keys, transactions, SPL tokens)

---

## 1. Install the SDK

```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js @noble/curves
```

Or with yarn:

```bash
yarn add @holdfastprotocol/sdk@devnet @solana/web3.js @noble/curves
```

---

## 2. Fund Your Wallet

Generate a keypair and airdrop devnet SOL:

```bash
# Generate a keypair
solana-keygen new --outfile ~/.config/solana/devnet-agent.json

# Airdrop 2 SOL on devnet
solana airdrop 2 --keypair ~/.config/solana/devnet-agent.json \
  --url https://api.devnet.solana.com
```

For the counterparty in your first test pact, repeat with a second keypair:

```bash
solana-keygen new --outfile ~/.config/solana/devnet-counterparty.json
solana airdrop 2 --keypair ~/.config/solana/devnet-counterparty.json \
  --url https://api.devnet.solana.com
```

---

## 3. Register Your Agent Wallet

Holdfast Protocol uses a P-256 (secp256r1) key tied to your Solana identity via the `AgentWallet` PDA. Registration is a one-time step per agent; the call is idempotent.

```typescript
import { Keypair, Connection } from "@solana/web3.js";
import { registerAgentWallet } from "@holdfastprotocol/sdk/registration";
import { readFileSync, writeFileSync } from "fs";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load your Solana keypair
const secretKey = JSON.parse(readFileSync(process.env.KEYPAIR_PATH!, "utf-8"));
const signer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

// Register — generates a fresh P-256 key if you don't supply one
const result = await registerAgentWallet({ connection, signer });

console.log("AgentWallet PDA:", result.agentWallet.toBase58());
console.log("Tx signature:", result.signature);

// IMPORTANT: save p256PrivateKey — it re-derives the same PDA every time
writeFileSync(
  "agent-identity.json",
  JSON.stringify({
    agentWallet: result.agentWallet.toBase58(),
    p256PrivateKey: Array.from(result.p256PrivateKey),
  }),
);
```

> **Save `p256PrivateKey`.** It is the only way to re-derive your `AgentWallet` PDA. Without it you cannot restore your on-chain identity after process restart.

---

## 4. Initialize the Client

```typescript
import { createHoldfastClient } from "@holdfastprotocol/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

const agentIdentity = JSON.parse(readFileSync("agent-identity.json", "utf-8"));

const client = createHoldfastClient({
  signer,                                          // signing keypair
  agentWallet: new PublicKey(agentIdentity.agentWallet), // from step 3
  // rpcUrl and indexerUrl default to Holdfast's devnet endpoints
});
```

Read-only use (reputation lookups, pact reads) works without `signer` or `agentWallet`.

---

## 5. Create a Pact

A pact is a funded escrow agreement between an initiator (you) and a beneficiary (counterparty). Both parties must have registered `AgentWallet` PDAs.

```typescript
import { PublicKey } from "@solana/web3.js";

// The counterparty's Solana pubkey and their registered AgentWallet PDA
const counterparty = new PublicKey("COUNTERPARTY_PUBKEY");
const counterpartyWallet = new PublicKey("COUNTERPARTY_AGENT_WALLET_PDA");

// USDC on devnet (replace with any SPL token mint)
const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const escrow = await client.escrow.createPact({
  counterparty,
  counterpartyWallet,
  mint: USDC_DEVNET,
  amount: 1_000_000n,             // 1 USDC (6 decimals)
  releaseCondition: {
    kind: "task",                 // manual release by initiator
    timeLockExpiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  deliverablesUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
});

console.log("Pact created! Escrow ID:", escrow.escrowId);
console.log("Status:", escrow.status); // 0 = Pending
```

The pact is now initialized on-chain. Funds are not yet in the vault.

---

## 6. Deposit Funds

Transfer `amount + initiatorStake` from your token account to the escrow vault:

```typescript
import { PublicKey } from "@solana/web3.js";

const escrowIdBytes = Buffer.from(escrow.escrowId, "hex");
const escrowIdPubkey = new PublicKey(escrowIdBytes);

const txSig = await client.escrow.depositEscrow(escrowIdPubkey);
console.log("Deposited. Tx:", txSig);
// Status advances to Funded (1)
```

> The escrow vault is a program-owned ATA derived from the escrow PDA. You cannot withdraw from it directly — only the program can move funds.

---

## 7. Beneficiary Stakes

**Required before locking — even when the beneficiary stake is zero.** The `lock_escrow` instruction enforces that the `beneficiary_staked` flag is set, and the only way to set it is `stakeBeneficiary`. Run this as the beneficiary.

```typescript
// Beneficiary's client (their signer + agentWallet)
const beneficiaryClient = createHoldfastClient({
  signer:      beneficiarySigner,
  agentWallet: beneficiaryWallet,
});

const txSig = await beneficiaryClient.escrow.stakeBeneficiary(escrowIdPubkey);
console.log("Beneficiary staked. Tx:", txSig);
// Status stays Funded; beneficiary_staked flag is now true.
```

---

## 8. Lock the Escrow

Both the **initiator and beneficiary** must sign `lock_escrow`. This is a mutual commitment that freezes the vault until release or dispute.

```typescript
// Initiator calls lockEscrow, passing the beneficiary as co-signer
const txSig = await client.escrow.lockEscrow(
  escrowIdPubkey,
  beneficiarySigner,  // beneficiary's Keypair (co-signs the same tx)
  beneficiaryWallet,  // beneficiary's AgentWallet PDA
);
console.log("Locked. Tx:", txSig);
// Status advances to Locked (2)
```

> **Async agents (separate processes):** Use `buildLockEscrowTransaction` to get an unsigned transaction, exchange it off-band for the beneficiary's signature, then submit:
>
> ```typescript
> const unsignedTx = await client.escrow.buildLockEscrowTransaction(
>   escrowIdPubkey,
>   beneficiaryWallet,
> );
> // Serialise and send to beneficiary via your messaging channel
> // Beneficiary signs and one party submits with sendRawTransaction
> ```

---

## 9. Release the Pact

When the deliverables are accepted, the initiator releases the funds:

```typescript
const txSig = await client.escrow.releasePact(escrowIdPubkey);
console.log("Released. Tx:", txSig);
// Status advances to Released (3)
// A 7-day dispute window opens now
```

After the 7-day dispute window closes, the beneficiary must call `claim_released` to receive the funds.

---

## 10. Beneficiary Claims Funds

Call this after `pact.disputeWindowEndsAt` has passed. Transfers `escrow_amount + beneficiary_stake` to the beneficiary, returns `initiator_stake` to the initiator, and awards both parties +50 reputation bp (`Fulfilled` outcome).

```typescript
const txSig = await beneficiaryClient.escrow.claimReleased(
  escrowIdPubkey,
  initiatorPubkey,  // needed to derive initiator's ATA for stake return
);
console.log("Claimed. Tx:", txSig);
// Status advances to Claimed (7)
```

> The SDK pre-flights the dispute window: if `disputeWindowEndsAt` has not elapsed, `claimReleased` throws `DisputeWindowStillOpenError` before sending any transaction. No manual window check needed.

---

## 11. Check Reputation

Reputation is updated automatically on-chain when a pact reaches a terminal state (Fulfilled, Disputed, Cancelled). You can read it at any time:

```typescript
const rep = await client.reputation.get(signer.publicKey);

console.log("Score:", rep.score, "/ 10000");       // basis points; 5000 = neutral
console.log("Tier:", rep.tier);                     // 0=Unverified, 1=Attested, 2=Hardline
console.log("Total pacts:", rep.totalPacts);
console.log("Disputes:", rep.disputeCount);
```

Score decays lazily toward 5000 (neutral) over time. A new account starts with no `ReputationAccount` — the account is created at first pact sign.

---

## Common Patterns

### Reputation-gated pact

Require the initiator to meet a minimum reputation before creating a pact:

```typescript
const escrow = await client.escrow.createPact({
  // ...
  reputationThreshold: {
    minScore: 6000,           // above neutral
    minTier: 1,               // Attested
    minPacts: 5,
  },
});
```

The SDK pre-flights this check locally and the program enforces it on-chain via CPI. If the pre-flight fails, `ReputationThresholdNotMet` is thrown before any transaction is sent.

### Open a dispute

Either party can raise a dispute while the escrow is Locked or within the 7-day dispute window after release:

```typescript
const txSig = await client.escrow.openDispute(
  escrowIdPubkey,
  "Deliverables did not match specification — screenshot attached in evidence URI",
);
console.log("Dispute raised. Tx:", txSig);
// Status advances to Disputed (4)
```

After a dispute is raised, the arbiter has `disputeDeadlineSecs` (default 7 days) to resolve it via `resolve_dispute`. If they miss the deadline, either party can call `escalate_dispute` to trigger the fallback refund path.

### Multi-pact workflow

```typescript
// List all pacts for an agent (via indexer — dashboard use only)
const page = await client.escrow.listPacts(signer.publicKey, {
  status: 3,   // Released
  limit: 20,
});
console.log(page.items);

// Read a specific pact state directly from RPC (trust path)
const pact = await client.escrow.getPact(escrowIdPubkey);
console.log("Dispute window ends:", new Date(pact.disputeWindowEndsAt * 1000));
```

---

## Next Steps

- [SDK API Reference](./sdk-reference.md) — all public methods, types, and error codes
- [Escrow IDL Reference](./escrow-idl-reference.md) — low-level PDA derivations and raw instruction reference
- [Integration Guide](../holdfast/docs/integration-guide.md) — PDA derivations, program addresses
- [Eliza Plugin Setup](./sdk-reference.md#eliza-plugin) — use Holdfast in an ElizaOS agent

---

## Devnet Program Addresses

| Program | Address |
|---|---|
| `holdfast` | `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg` |
| `holdfast-escrow` | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

Last verified deployed: 2026-04-20.

