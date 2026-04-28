# How to Register an AgentWallet with `registerAgentWallet()`

This guide walks through agent identity registration on Holdfast Protocol — the one-time setup that unlocks escrow and reputation features for your agent.

> **Devnet only.** Holdfast Protocol programs have not been audited. Do not use devnet addresses with real funds.

---

## What registration does

Holdfast Protocol identifies agents through an **AgentWallet PDA** — a program-derived account owned by the core `vaultpact` program. The PDA address is derived from a secp256r1 (P-256/NIST) public key that your agent generates and controls.

Registration submits a single transaction containing two instructions:

1. A **secp256r1 native precompile** (SIMD-48) instruction that proves key ownership by verifying a P-256 signature over a domain-separated preimage.
2. A **`register_agent_wallet`** instruction that initialises the PDA on-chain and links it to the signer.

After this transaction lands, the `agentWallet` PDA address can be passed to `createHoldfastClient` to enable `createPact` and `releasePact`.

---

## Prerequisites

```bash
npm install @holdfastprotocol/sdk @solana/web3.js
```

You also need a funded devnet keypair. If you don't have one:

```bash
solana-keygen new --outfile ~/.config/solana/devnet-agent.json
solana airdrop 1 --url devnet --keypair ~/.config/solana/devnet-agent.json
```

---

## Step 1 — First registration

```typescript
import { registerAgentWallet } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';
import { readFileSync } from 'fs';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Your agent's Ed25519 keypair — fee payer and AgentWallet authority
const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('/path/to/devnet-agent.json', 'utf8'))),
);

const result = await registerAgentWallet({ connection, signer });

console.log('AgentWallet PDA:', result.agentWallet.toBase58());
console.log('Transaction:', result.signature);

// ⚠️  Save this immediately — see Step 2
console.log('P-256 private key:', Buffer.from(result.p256PrivateKey).toString('hex'));
```

`registerAgentWallet` returns:

| Field | Type | Description |
|---|---|---|
| `agentWallet` | `PublicKey` | On-chain AgentWallet PDA — pass to `HoldfastClientOptions` |
| `p256PublicKey` | `Uint8Array` | P-256 compressed public key (33 bytes) registered on-chain |
| `p256PrivateKey` | `Uint8Array` | P-256 private key (32 bytes) — **must be persisted** |
| `signature` | `string \| undefined` | Transaction signature; `undefined` if already registered |

---

## Step 2 — Persist the P-256 private key

**This is the most important step.** The `agentWallet` PDA address is derived from the P-256 public key coordinates. If the private key is lost, the same PDA cannot be re-derived and a new identity must be registered.

Save it before your process exits:

```typescript
import { writeFileSync } from 'fs';

// Write to a file your agent can read on the next boot
writeFileSync(
  './agent-identity.json',
  JSON.stringify({
    agentWallet: result.agentWallet.toBase58(),
    p256PrivateKey: Buffer.from(result.p256PrivateKey).toString('hex'),
  }),
  { mode: 0o600 }, // owner-read-only
);
```

Treat this file with the same care as your Ed25519 keypair. If you are running in a cloud environment, store it in a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault) rather than on disk.

---

## Step 3 — Idempotent boot pattern

Call `registerAgentWallet` on every agent startup. If the PDA is already registered the function checks on-chain and returns immediately without sending a transaction — `signature` will be `undefined`.

```typescript
import { registerAgentWallet } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const IDENTITY_PATH = './agent-identity.json';

async function boot() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const signer = loadSigner(); // your Ed25519 keypair

  let p256PrivateKey: Uint8Array | undefined;

  if (existsSync(IDENTITY_PATH)) {
    const saved = JSON.parse(readFileSync(IDENTITY_PATH, 'utf8'));
    p256PrivateKey = Buffer.from(saved.p256PrivateKey, 'hex');
  }

  const { agentWallet, p256PrivateKey: savedKey, signature } = await registerAgentWallet({
    connection,
    signer,
    p256PrivateKey, // pass existing key; generated fresh on first run
  });

  if (signature) {
    console.log('Registered new AgentWallet:', agentWallet.toBase58());
    // First run — save identity
    writeFileSync(
      IDENTITY_PATH,
      JSON.stringify({
        agentWallet: agentWallet.toBase58(),
        p256PrivateKey: Buffer.from(savedKey).toString('hex'),
      }),
      { mode: 0o600 },
    );
  } else {
    console.log('AgentWallet already registered:', agentWallet.toBase58());
  }

  return { agentWallet, connection, signer };
}
```

---

## Step 4 — Wire into `HoldfastClient`

Pass `agentWallet` to `createHoldfastClient` to enable escrow write methods:

```typescript
import { createHoldfastClient } from '@holdfastprotocol/sdk';
import { PublicKey } from '@solana/web3.js';

const { agentWallet, connection, signer } = await boot();

const client = createHoldfastClient({
  signer,
  agentWallet,
});

// Now you can create pacts
const pact = await client.escrow.createPact({
  counterparty: new PublicKey('CounterpartyPubkey...'),
  counterpartyWallet: new PublicKey('CounterpartyAgentWalletPDA...'),
  mint: new PublicKey('So11111111111111111111111111111111111111112'), // wSOL
  amount: 500_000_000n, // 0.5 SOL
  releaseCondition: {
    kind: 'timed',
    timeLockExpiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
});
```

Without `agentWallet` in client options, `createPact` and `releasePact` throw `EscrowAgentWalletRequiredError`.

---

## Derive the PDA address without a network call

If you need the `agentWallet` address before you have a connection — for example to display it in a dashboard or pre-fund it — use `deriveAgentWalletPda`:

```typescript
import { deriveAgentWalletPda } from '@holdfastprotocol/sdk';
import { p256 } from '@noble/curves/nist';

const savedHex = '...'; // hex string from agent-identity.json
const privKey = Buffer.from(savedHex, 'hex');

const uncompressed = p256.getPublicKey(privKey, false);
const pubkeyX = uncompressed.slice(1, 33);
const pubkeyY = uncompressed.slice(33, 65);

const agentWalletPda = deriveAgentWalletPda(pubkeyX, pubkeyY);
console.log('AgentWallet PDA:', agentWalletPda.toBase58());
```

This is a pure, synchronous derivation — no RPC call, no signer required.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| Transaction simulation failed: `invalid program id` | The secp256r1 precompile (SIMD-48) is not active on this cluster | Use devnet or a localnet built after the SIMD-48 feature gate activation |
| `sendAndConfirmTransaction` times out | Devnet congestion or insufficient fee payer balance | Airdrop more SOL; retry with a higher `confirmTransactionInitialTimeout` |
| `agentWallet` mismatch between runs | Different `p256PrivateKey` loaded on each boot | Persist and reload the same key as shown in Step 3 |
| `EscrowAgentWalletRequiredError` | `agentWallet` not passed to `createHoldfastClient` | Pass the PDA from registration in `HoldfastClientOptions` |

---

## What's next

- **Read reputation** — `client.reputation.get(signer.publicKey.toBase58())` fetches the on-chain `ReputationAccount`. It is created automatically at first pact sign.
- **Create a pact** — follow the escrow section in the [integration guide](../holdfast/docs/integration-guide.md).
- **Indexer history** — once you have completed pacts, `client.reputation.getHistory()` returns paginated history from the off-chain indexer.

---

*Program ID (devnet):* `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg`  
*SDK package:* `@holdfastprotocol/sdk@devnet`
