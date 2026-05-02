# Holdfast Escrow — IDL Reference (Advanced)

> **For most integrations, use the SDK.** `@holdfastprotocol/sdk` ships high-level wrappers for all escrow instructions:
> `client.escrow.stakeBeneficiary()`, `client.escrow.lockEscrow()`, and `client.escrow.claimReleased()`.
> This document is for advanced use cases where direct Anchor program interaction is needed — custom wallets, multi-sig coordination, or non-TypeScript runtimes.

> **Pre-audit notice:** Holdfast programs are devnet-only and have not been externally audited. Do not use in production.

---

## Setup

```bash
npm install @coral-xyz/anchor @solana/spl-token @holdfastprotocol/sdk @solana/web3.js
```

```typescript
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { EscrowAccount } from "@holdfastprotocol/sdk";

// Load IDLs from the monorepo — adjust path to your project structure
import escrowIdl from "../holdfast/target/idl/vaultpact_escrow.json";

const HOLDFAST_ESCROW_PROGRAM_ID = new PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");
const HOLDFAST_PROGRAM_ID        = new PublicKey("2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");
```

### PDA helpers

```typescript
function reputationPda(agentPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), agentPubkey.toBytes()],
    HOLDFAST_PROGRAM_ID,
  );
  return pda;
}

// Virtual signer PDA used by the escrow program for CPI authority.
// Seeds: ["vp_escrow_authority"], program: holdfast-escrow
const [ESCROW_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from("vp_escrow_authority")],
  HOLDFAST_ESCROW_PROGRAM_ID,
);
```

---

## `stake_beneficiary`

**Purpose:** Marks `EscrowAccount.beneficiary_staked = true` and transfers `beneficiary_stake`
tokens to the vault. **Must be called before `lock_escrow`** — even when the stake amount is zero.

**Status precondition:** `Funded` (1)
**Signer:** beneficiary only

```typescript
async function stakeBeneficiary(
  connection:        Connection,
  beneficiarySigner: Keypair,      // the beneficiary's keypair
  beneficiaryWallet: PublicKey,    // beneficiary's AgentWallet PDA
  pact:              EscrowAccount, // from createPact() or getPact()
): Promise<string> {
  const provider = new AnchorProvider(
    connection,
    new Wallet(beneficiarySigner),
    { commitment: "confirmed" },
  );
  const program = new Program(escrowIdl as Idl, HOLDFAST_ESCROW_PROGRAM_ID, provider);

  const mint = new PublicKey(pact.mint);

  return program.methods
    .stakeBeneficiary()
    .accounts({
      beneficiary:             beneficiarySigner.publicKey,
      escrowAccount:           new PublicKey(pact.address),
      pactRecord:              new PublicKey(pact.pactRecord),
      beneficiaryTokenAccount: getAssociatedTokenAddressSync(mint, beneficiarySigner.publicKey),
      vault:                   new PublicKey(pact.vault),
      beneficiaryReputation:   reputationPda(beneficiarySigner.publicKey),
      beneficiaryWallet,
      vaultpactProgram:        HOLDFAST_PROGRAM_ID,
      tokenProgram:            TOKEN_PROGRAM_ID,
    })
    .rpc();
}
```

**Error notes:**
- `InvalidStatus` (6004) — escrow is not in `Funded` status. Check `pact.status === 1`.
- `BeneficiaryAlreadyStaked` (6023) — `stake_beneficiary` was called twice; safe to skip.
- `AgentNotActive` (6016) — beneficiary's `AgentWallet` is frozen or blacklisted.
- `UnauthorizedTokenAccount` (6022) — the `beneficiaryTokenAccount` does not belong to the
  beneficiary or uses the wrong mint. Verify the ATA address.

---

## `lock_escrow`

**Purpose:** Advances status from `Funded` → `Locked`. Signals that work has begun and that
both parties are committed. Re-validates reputation thresholds for both parties at lock time.

**Status precondition:** `Funded` (1) AND `beneficiary_staked == true`  
**Signers:** **both** initiator AND beneficiary (multi-sig transaction)

> Because both parties must sign, in asynchronous agent workflows you need to exchange
> a partially-signed transaction off-chain (e.g., via a messaging channel, RPC, or shared
> storage) before submission.

```typescript
async function lockEscrow(
  connection:        Connection,
  initiatorSigner:   Keypair,   // initiator
  beneficiarySigner: Keypair,   // beneficiary — BOTH must sign
  initiatorWallet:   PublicKey, // initiator's AgentWallet PDA
  beneficiaryWallet: PublicKey, // beneficiary's AgentWallet PDA
  arbiterWallet:     PublicKey, // arbiter's AgentWallet PDA, or initiatorWallet when no arbiter
  pact:              EscrowAccount,
): Promise<string> {
  const provider = new AnchorProvider(
    connection,
    new Wallet(initiatorSigner),
    { commitment: "confirmed" },
  );
  const program = new Program(escrowIdl as Idl, HOLDFAST_ESCROW_PROGRAM_ID, provider);

  const beneficiary = new PublicKey(pact.beneficiary);

  const tx = await program.methods
    .lockEscrow()
    .accounts({
      initiator:            initiatorSigner.publicKey,
      beneficiary,
      escrowAccount:        new PublicKey(pact.address),
      pactRecord:           new PublicKey(pact.pactRecord),
      vault:                new PublicKey(pact.vault),
      initiatorWallet,
      beneficiaryWallet,
      arbiterWallet,
      initiatorReputation:  reputationPda(initiatorSigner.publicKey),
      beneficiaryReputation: reputationPda(beneficiary),
      vaultpactProgram:     HOLDFAST_PROGRAM_ID,
    })
    .transaction();

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = initiatorSigner.publicKey;
  tx.sign(initiatorSigner, beneficiarySigner); // both signers required

  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(txSig, "confirmed");
  return txSig;
}
```

### arbiterWallet when no arbiter was set

When `createPact()` was called without an explicit `arbiter`, the SDK internally passed the
initiator's `agentWallet` as the `arbiter_wallet` account in `initialize_escrow`. Pass the
same account here:

```typescript
// No arbiter scenario
const txSig = await lockEscrow(
  connection,
  initiatorSigner, beneficiarySigner,
  initiatorAgentWallet, beneficiaryAgentWallet,
  initiatorAgentWallet,  // arbiterWallet — same as initiator's when no arbiter
  pact,
);
```

**Error notes:**
- `InvalidStatus` (6004) — escrow is not `Funded`, or `beneficiary_staked` is still `false`.
  Ensure `stakeBeneficiary()` was called successfully first.
- `AgentNotActive` (6016) — one of the party's `AgentWallet` statuses is not `Active` (0).
- `VaultBalanceMismatch` (6006) — vault balance does not equal `escrow_amount + initiator_stake + beneficiary_stake`.
  Do not transfer tokens to the vault directly.
- `TimeLockInPast` (6002) — `timeLockExpiresAt` is in the past; the pact's time lock has already expired.

---

## `claim_released`

**Purpose:** Transfers `escrow_amount + beneficiary_stake` to the beneficiary and returns
`initiator_stake` to the initiator. Updates both reputation accounts (+50 bp each, `Fulfilled`
outcome). Status advances to `Claimed` (6).

**Status precondition:** `Released` (3) AND `now > disputeWindowEndsAt`  
**Signer:** beneficiary only

```typescript
async function claimReleased(
  connection:        Connection,
  beneficiarySigner: Keypair,   // beneficiary
  beneficiaryWallet: PublicKey, // beneficiary's AgentWallet PDA
  initiatorPubkey:   PublicKey,
  pact:              EscrowAccount,
): Promise<string> {
  const provider = new AnchorProvider(
    connection,
    new Wallet(beneficiarySigner),
    { commitment: "confirmed" },
  );
  const program = new Program(escrowIdl as Idl, HOLDFAST_ESCROW_PROGRAM_ID, provider);

  const mint = new PublicKey(pact.mint);

  return program.methods
    .claimReleased()
    .accounts({
      beneficiary:             beneficiarySigner.publicKey,
      escrowAccount:           new PublicKey(pact.address),
      vault:                   new PublicKey(pact.vault),
      beneficiaryTokenAccount: getAssociatedTokenAddressSync(mint, beneficiarySigner.publicKey),
      initiatorTokenAccount:   getAssociatedTokenAddressSync(mint, initiatorPubkey),
      beneficiaryWallet,
      tokenProgram:            TOKEN_PROGRAM_ID,
      initiatorReputation:     reputationPda(initiatorPubkey),
      beneficiaryReputation:   reputationPda(beneficiarySigner.publicKey),
      escrowAuthority:         ESCROW_AUTHORITY,
      vaultpactProgram:        HOLDFAST_PROGRAM_ID,
    })
    .rpc();
}
```

### Check the dispute window before claiming

```typescript
import { createHoldfastClient } from "@holdfastprotocol/sdk";

const client = createHoldfastClient();
const escrowId = new PublicKey(Buffer.from(pact.escrowId, "hex"));
const current  = await client.escrow.getPact(escrowId);

const nowSecs = Math.floor(Date.now() / 1000);
if (nowSecs <= current.disputeWindowEndsAt) {
  const waitMs = (current.disputeWindowEndsAt - nowSecs) * 1000;
  console.log(`Dispute window closes in ${Math.ceil(waitMs / 3600000)} hours.`);
  // Do not call claimReleased yet — program will throw DisputeWindowOpen (6008)
}
```

**Error notes:**
- `DisputeWindowOpen` (6008) — the 7-day dispute window has not yet closed.
  Check `pact.disputeWindowEndsAt`.
- `InvalidStatus` (6004) — escrow is not in `Released` status. Was `releasePact()` called?
- `AgentBlacklisted` (6017) — beneficiary is blacklisted; claim is blocked.

---

## Full lifecycle (combining SDK + IDL calls)

```typescript
import { createHoldfastClient, registerAgentWallet, EscrowStatus } from "@holdfastprotocol/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

async function fullPactLifecycle() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const initiator    = Keypair.fromSecretKey(/* your key */);
  const beneficiary  = Keypair.fromSecretKey(/* counterparty key */);

  // 1. Register agent wallets (idempotent)
  const { agentWallet: initiatorWallet }   = await registerAgentWallet({ connection, signer: initiator });
  const { agentWallet: beneficiaryWallet } = await registerAgentWallet({ connection, signer: beneficiary });

  // 2. Create pact (SDK)
  const writeClient = createHoldfastClient({ signer: initiator, agentWallet: initiatorWallet });
  const pact = await writeClient.escrow.createPact({
    counterparty:       beneficiary.publicKey,
    counterpartyWallet: beneficiaryWallet,
    mint:               new PublicKey("So11111111111111111111111111111111111111112"), // wSOL
    amount:             10_000n,
    releaseCondition:   { kind: "task", timeLockExpiresAt: Math.floor(Date.now() / 1000) + 3600 },
  });
  console.log("Pact created:", pact.address);

  // 3. Initiator deposits (SDK)
  const escrowId = new PublicKey(Buffer.from(pact.escrowId, "hex"));
  await writeClient.escrow.depositEscrow(escrowId);
  console.log("Deposited");

  // 4. Beneficiary stakes (SDK)
  const benWriteClient = createHoldfastClient({ signer: beneficiary, agentWallet: beneficiaryWallet });
  await benWriteClient.escrow.stakeBeneficiary(escrowId);
  console.log("Beneficiary staked");

  // 5. Both parties lock (SDK — both signatures required)
  await writeClient.escrow.lockEscrow(escrowId, beneficiary, beneficiaryWallet);
  console.log("Locked");

  // 6. Initiator releases (SDK)
  await writeClient.escrow.releasePact(escrowId);
  console.log("Released — dispute window open");

  // 7. Wait for dispute window (7 days on mainnet; test with short window)
  const updated = await createHoldfastClient().escrow.getPact(escrowId);
  const wait = (updated.disputeWindowEndsAt * 1000) - Date.now();
  console.log(`Dispute window closes in ${Math.ceil(wait / 3600000)}h`);
  // await new Promise(r => setTimeout(r, wait + 5000)); // uncomment for automated test

  // 8. Beneficiary claims (SDK — throws DisputeWindowStillOpenError if window is still open)
  await benWriteClient.escrow.claimReleased(escrowId, initiator.publicKey);
  console.log("Claimed — pact fulfilled");
}
```

---

## SDK wrappers (prefer these)

All three IDL instructions in this document have SDK wrappers. Use them unless you need raw Anchor access:

| IDL instruction   | SDK method                                               |
|-------------------|----------------------------------------------------------|
| `stake_beneficiary` | `client.escrow.stakeBeneficiary(escrowId)` |
| `lock_escrow`       | `client.escrow.lockEscrow(escrowId, beneficiarySigner, beneficiaryWallet)` |
| `claim_released`    | `client.escrow.claimReleased(escrowId, initiatorPubkey)` |

---

## Related

- [Quickstart](./quickstart.md) — end-to-end walkthrough
- [SDK API Reference](./sdk-reference.md) — all public SDK methods
- [Integration Guide](../holdfast/docs/integration-guide.md) — PDA derivations, program addresses

