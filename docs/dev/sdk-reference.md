# Holdfast Protocol SDK API Reference

SDK channel: `@holdfastprotocol/sdk@devnet` — devnet only, pre-audit.

---

## Table of Contents

- [HoldfastClient](#holdfastclient)
- [registerAgentWallet()](#registeragentwallet)
- [EscrowModule](#escrowmodule)
- [ReputationModule](#reputationmodule)
- [Types](#types)
- [SDK Errors](#sdk-errors)
- [On-Chain Error Codes](#on-chain-error-codes)
- [Eliza Plugin](#eliza-plugin)

---

## HoldfastClient

The top-level entry point. Exposes `escrow` and `reputation` modules.

### `createHoldfastClient(options?)`

Factory function. Equivalent to `new HoldfastClient(options)`.

```typescript
import { createHoldfastClient } from "@holdfastprotocol/sdk";

const client = createHoldfastClient(options);
```

**Parameters**

| Field | Type | Required | Description |
|---|---|---|---|
| `rpcUrl` | `string` | No | Solana RPC endpoint. Defaults to `https://api.devnet.solana.com`. |
| `indexerUrl` | `string` | No | Off-chain indexer base URL. Required for `reputation.getHistory` and `escrow.listPacts`. Defaults to `https://holdfast-indexer.fly.dev`. |
| `signer` | `Signer` | No | Signing keypair for write operations (`createPact`, `depositEscrow`, `releasePact`, `openDispute`). Read-only methods work without a signer. |
| `agentWallet` | `PublicKey` | No | The caller's `AgentWallet` PDA. Required for `createPact` and `releasePact`. Obtained from `registerAgentWallet()`. |
| `escrowProgramId` | `PublicKey` | No | Override the holdfast-escrow program ID. Defaults to the devnet deployment. |
| `holdfastProgramId` | `PublicKey` | No | Override the holdfast program ID. Defaults to the devnet deployment. |

**Throws**

- `Error` — if the `rpcUrl` matches a known mainnet-beta endpoint pattern. Mainnet is blocked in pre-audit releases.

**Members**

| Member | Type | Description |
|---|---|---|
| `connection` | `Connection` | The Solana RPC connection. |
| `escrow` | `EscrowModule` | Escrow lifecycle methods. |
| `reputation` | `ReputationModule` | Reputation read methods. |

---

## registerAgentWallet()

One-time setup call per agent identity. Creates an `AgentWallet` PDA on the `holdfast` program tied to a P-256 (secp256r1) key. The call is idempotent — safe to call again with the same `p256PrivateKey`.

```typescript
import { registerAgentWallet } from "@holdfastprotocol/sdk/registration";

const result = await registerAgentWallet({
  connection,
  signer,
  p256PrivateKey, // optional — generated if omitted
});
```

**Parameters** (`RegisterAgentWalletParams`)

| Field | Type | Required | Description |
|---|---|---|---|
| `connection` | `Connection` | Yes | Solana RPC connection. |
| `signer` | `Signer` | Yes | Ed25519 keypair. Becomes the `AgentWallet` authority and fee payer. |
| `p256PrivateKey` | `Uint8Array` | No | 32-byte P-256 private key. A fresh key is generated if omitted. |
| `holdfastProgramId` | `PublicKey` | No | Override the program ID (defaults to devnet). |

**Returns** (`RegisterAgentWalletResult`)

| Field | Type | Description |
|---|---|---|
| `agentWallet` | `PublicKey` | The on-chain `AgentWallet` PDA. Pass as `agentWallet` in `HoldfastClientOptions`. |
| `p256PublicKey` | `Uint8Array` | P-256 compressed public key (33 bytes) registered on-chain. |
| `p256PrivateKey` | `Uint8Array` | P-256 private key (32 bytes). **Save this** — it re-derives the same PDA after restart. |
| `signature` | `string \| undefined` | Transaction signature. `undefined` when the PDA already existed and no tx was sent. |

**PDA Seeds**

```
["agent_wallet", pubkey_x (32 bytes), pubkey_y (32 bytes)]  →  holdfast program
```

Where `pubkey_x` and `pubkey_y` are the raw uncompressed P-256 coordinates.

### `deriveAgentWalletPda(p256PubkeyX, p256PubkeyY, holdfastProgramId?)`

Derives the `AgentWallet` PDA without registering. Use to look up an existing wallet.

```typescript
import { deriveAgentWalletPda } from "@holdfastprotocol/sdk/registration";

const agentWallet = deriveAgentWalletPda(pubkeyX, pubkeyY);
```

---

## EscrowModule

Accessed as `client.escrow`. All write methods require `signer` and most require `agentWallet` to be set on the client.

### SDK v0.2 methods (shipped)

`stakeBeneficiary`, `lockEscrow`, `buildLockEscrowTransaction`, and `claimReleased` shipped in SDK v0.2. Full documentation for each is below. IDL direct-call patterns remain in [escrow-idl-reference.md](./escrow-idl-reference.md) for reference.

Completed: [CAS-200](/CAS/issues/CAS-200) · [CAS-201](/CAS/issues/CAS-201) · [CAS-202](/CAS/issues/CAS-202)

---

### `createPact(params)`

Initializes a new escrow between the signer (initiator) and a counterparty. Calls `initialize_escrow` on the holdfast-escrow program, which creates the `EscrowAccount`, `PactRecord`, and vault ATA atomically.

```typescript
const escrow = await client.escrow.createPact(params);
```

**Parameters** (`CreatePactParams`)

| Field | Type | Required | Description |
|---|---|---|---|
| `counterparty` | `PublicKey` | Yes | Counterparty (beneficiary) Solana pubkey. |
| `counterpartyWallet` | `PublicKey` | Yes | Counterparty's `AgentWallet` PDA. |
| `mint` | `PublicKey` | Yes | SPL token mint. Use wrapped SOL (`So111...1112`) for native SOL. Token-2022 is not supported in v0.1. |
| `amount` | `bigint` | Yes | Escrow amount in token base units (lamports for wrapped SOL). |
| `releaseCondition` | `ReleaseCondition` | Yes | Release trigger type. See [ReleaseCondition](#releasecondition). |
| `arbiter` | `PublicKey` | No | Arbiter pubkey. Omit for arbiter-free pacts. |
| `arbiterWallet` | `PublicKey` | No | Arbiter's `AgentWallet` PDA. Required when `arbiter` is provided. |
| `stakes.initiator` | `bigint` | No | Initiator stake in token base units. Defaults to `0n`. |
| `stakes.beneficiary` | `bigint` | No | Beneficiary stake in token base units. Defaults to `0n`. |
| `deliverablesHash` | `Uint8Array` | No | SHA-256 hash of the deliverables spec (exactly 32 bytes). |
| `deliverablesUri` | `string` | No | URI to deliverables spec (IPFS, Arweave, etc.). Truncated to 128 bytes on-chain. |
| `reputationThreshold.minScore` | `number` | No | Minimum reputation score (basis points, 0–10000). Pre-flight + enforced on-chain via CPI. |
| `reputationThreshold.minTier` | `VerifTier` | No | Minimum verification tier. |
| `reputationThreshold.minPacts` | `number` | No | Minimum completed pact count. |
| `disputeDeadlineSecs` | `number` | No | Arbiter resolution window in seconds. Default: `604800` (7 days). Minimum: 3600. |
| `slashLoserStake` | `boolean` | No | Slash the losing party's stake when an arbiter resolves. Default: `false`. |
| `escrowId` | `Uint8Array` | No | Custom 32-byte escrow ID for idempotent retries. Generated from `sha256(initiator ‖ counterparty ‖ timestamp)` if omitted. |

**Returns** `Promise<EscrowAccount>` — the newly created escrow account state.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowAgentWalletRequiredError` | No `agentWallet` on the client. |
| `EscrowArbiterWalletRequiredError` | `arbiter` was provided but `arbiterWallet` was not. |
| `ReputationThresholdNotMet` | Pre-flight reputation check failed. |

---

### `depositEscrow(escrowId)`

Transfers `escrow_amount + initiator_stake` from the initiator's ATA to the vault. The escrow must be in `Pending` status. Status advances to `Funded` on success.

```typescript
const txSig = await client.escrow.depositEscrow(escrowIdPubkey);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. Use `new PublicKey(Buffer.from(escrow.escrowId, "hex"))`. |

**Returns** `Promise<string>` — transaction signature.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowNotFoundError` | No escrow exists for this ID. |

---

### `releasePact(escrowId)`

Releases escrow funds to the beneficiary. Only the initiator can call this. The escrow must be in `Locked` status.

After release, a 7-day dispute window opens (`disputeWindowEndsAt`). The beneficiary cannot spend the funds until the window closes and they call `claim_released`.

```typescript
const txSig = await client.escrow.releasePact(escrowIdPubkey);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |

**Returns** `Promise<string>` — transaction signature.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowAgentWalletRequiredError` | No `agentWallet` on the client. |

---

### `openDispute(escrowId, reason)`

Raises a dispute on a `Locked` escrow, or a `Released` escrow within the 7-day dispute window. Either party (initiator or beneficiary) may call this.

The `reason` is stored as the evidence URI on-chain (truncated to 128 UTF-8 bytes). For hashed evidence, call `raise_dispute` directly via the Anchor IDL.

```typescript
const txSig = await client.escrow.openDispute(escrowIdPubkey, reason);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |
| `reason` | `string` | Human-readable dispute reason. Truncated to 128 UTF-8 bytes. |

**Returns** `Promise<string>` — transaction signature.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |

---

### `stakeBeneficiary(escrowId)`

Marks `EscrowAccount.beneficiary_staked = true` and, when `beneficiary_stake > 0`, transfers that amount from the beneficiary's ATA to the vault. **Must be called before `lockEscrow`** — even when the stake amount is zero.

The client's `signer` must be the beneficiary.

```typescript
const txSig = await beneficiaryClient.escrow.stakeBeneficiary(escrowIdPubkey);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |

**Status precondition:** `Funded` (1)

**Returns** `Promise<string>` — transaction signature.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowAgentWalletRequiredError` | No `agentWallet` on the client. |
| on-chain `InvalidStatus` (6004) | Escrow is not in `Funded` status. |
| on-chain `BeneficiaryAlreadyStaked` (6023) | `stakeBeneficiary` was already called; safe to skip. |
| on-chain `AgentNotActive` (6016) | Beneficiary's `AgentWallet` is not `Active`. |
| on-chain `UnauthorizedTokenAccount` (6022) | Token account owner does not match the beneficiary. |

---

### `buildLockEscrowTransaction(escrowId, beneficiaryWallet, arbiterWallet?)`

Builds an unsigned `lock_escrow` transaction for async multi-agent flows. Use when initiator and beneficiary run in separate processes and need to exchange a partially-signed transaction off-band before submitting.

```typescript
const unsignedTx = await client.escrow.buildLockEscrowTransaction(
  escrowIdPubkey,
  beneficiaryWallet,
  // arbiterWallet — omit when no arbiter was set at pact creation
);
// Serialise and send to beneficiary via your messaging channel.
// Beneficiary signs, then either party submits with sendRawTransaction.
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |
| `beneficiaryWallet` | `PublicKey` | Beneficiary's `AgentWallet` PDA. |
| `arbiterWallet` | `PublicKey` | Optional. Arbiter's `AgentWallet` PDA. Defaults to the initiator's `agentWallet` when no arbiter was set at pact creation. |

**Returns** `Promise<Transaction>` — unsigned transaction. Sign with `tx.sign(initiatorKeypair)` before transmitting, then obtain the beneficiary's co-signature.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowAgentWalletRequiredError` | No `agentWallet` on the client. |

---

### `lockEscrow(escrowId, beneficiarySigner, beneficiaryWallet, arbiterWallet?)`

Advances status from `Funded` → `Locked`. Both the initiator (client's `signer`) and beneficiary must sign. Re-validates reputation thresholds for both parties at lock time.

`stakeBeneficiary` must have been called first — `lock_escrow` enforces `beneficiary_staked == true` on-chain.

```typescript
const txSig = await client.escrow.lockEscrow(
  escrowIdPubkey,
  beneficiarySigner,   // beneficiary's Signer (co-signs the same tx)
  beneficiaryWallet,   // beneficiary's AgentWallet PDA
);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |
| `beneficiarySigner` | `Signer` | Beneficiary's signing keypair. The initiator (from `client.signer`) and the beneficiary both sign the transaction. |
| `beneficiaryWallet` | `PublicKey` | Beneficiary's `AgentWallet` PDA. |
| `arbiterWallet` | `PublicKey` | Optional. Arbiter's `AgentWallet` PDA. Defaults to the initiator's `agentWallet` when no arbiter was set at pact creation. |

**Status precondition:** `Funded` (1) AND `beneficiary_staked == true`

**Returns** `Promise<string>` — transaction signature.

> **Async agents (separate processes):** Use `buildLockEscrowTransaction` to get an unsigned transaction, exchange it off-band for the beneficiary's signature, then submit with `connection.sendRawTransaction`.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowAgentWalletRequiredError` | No `agentWallet` on the client. |
| on-chain `InvalidStatus` (6004) | Escrow is not `Funded`, or `beneficiary_staked` is still `false`. Ensure `stakeBeneficiary()` completed first. |
| on-chain `AgentNotActive` (6016) | One party's `AgentWallet` status is not `Active`. |
| on-chain `VaultBalanceMismatch` (6006) | Vault balance does not equal `escrow_amount + stakes`. Do not transfer directly to the vault. |
| on-chain `TimeLockInPast` (6002) | `timeLockExpiresAt` has already elapsed. |

---

### `claimReleased(escrowId, initiatorPubkey)`

Finalizes a released pact by charging the protocol fee and paying out claim-time transfers:

- Protocol fee is charged **only** in `claim_released`.
- Fee rate is fixed at **25 bps** (0.25%) on `escrow_amount` only.
- Formula: `fee = floor(escrow_amount * 25 / 10_000)`.
- Beneficiary receives `beneficiary_net = escrow_amount + beneficiary_stake - fee`.
- Initiator receives `initiator_stake` back unchanged.

On success, both parties receive +50 reputation bp (`Fulfilled` outcome) and status advances to `Claimed` (7).

Out of scope in v1: no protocol fees on refunds, cancellations, disputes, or any non-escrow path.

The SDK pre-flights the dispute window: if `disputeWindowEndsAt` has not elapsed, `DisputeWindowStillOpenError` is thrown **before** any transaction is sent.

```typescript
const txSig = await beneficiaryClient.escrow.claimReleased(
  escrowIdPubkey,
  initiatorPubkey,  // needed to derive initiator's ATA for stake return
);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |
| `initiatorPubkey` | `PublicKey` | Initiator's Solana pubkey. Used to derive the initiator's ATA for stake return. |

**Status precondition:** `Released` (3) AND `now > disputeWindowEndsAt`

**Returns** `Promise<string>` — transaction signature.

**Throws**

| Error | Condition |
|---|---|
| `EscrowSignerRequiredError` | No `signer` on the client. |
| `EscrowAgentWalletRequiredError` | No `agentWallet` on the client. |
| `DisputeWindowStillOpenError` | Pre-flight: `disputeWindowEndsAt` has not elapsed. Check `pact.disputeWindowEndsAt` for the exact close time. |
| on-chain `DisputeWindowOpen` (6008) | Dispute window has not yet closed. |
| on-chain `InvalidStatus` (6004) | Escrow is not in `Released` status. |
| on-chain `AgentBlacklisted` (6017) | Beneficiary is blacklisted; claim is blocked. |

---

### `getPact(escrowId)`

Fetches current pact state directly via RPC. Trust-critical path — no oracle or indexer round-trip.

```typescript
const pact = await client.escrow.getPact(escrowIdPubkey);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey` | The 32-byte escrow ID encoded as a `PublicKey`. |

**Returns** `Promise<EscrowAccount>`

**Throws**

| Error | Condition |
|---|---|
| `EscrowNotFoundError` | No escrow account found for this ID. |
| `EscrowAccountCorruptError` | Account data is malformed (discriminator mismatch or insufficient size). |

---

### `listPacts(agentPubkey, opts?)`

Lists pacts for an agent via the off-chain indexer. **Dashboard use only** — not in the trust path. For trust-critical reads, use `getPact()`.

```typescript
const page = await client.escrow.listPacts(agentPubkey, {
  status: 3,   // Released
  limit: 20,
});
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `agentPubkey` | `PublicKey \| string` | The agent's Solana public key. |
| `opts.status` | `EscrowStatus` | Filter by escrow status. |
| `opts.limit` | `number` | Page size. Max 100, defaults to 20. |
| `opts.before` | `string` | Cursor for pagination (opaque string from previous response). |

**Returns** `Promise<PactPage>`

**Throws**

| Error | Condition |
|---|---|
| `IndexerRequestError` | Non-2xx response from the indexer. |

---

### `getEscrowEvents(escrowId, opts?)`

Lists escrow lifecycle events for one escrow via the off-chain indexer (`GET /v1/escrows/:escrow/events`).

For claim events, fee accounting is surfaced explicitly:

- `grossAmount` = `beneficiaryNetAmount + protocolFeeAmount`
- `protocolFeeAmount` = claim-time protocol fee
- `beneficiaryNetAmount` = beneficiary payout after fee

```typescript
const events = await client.escrow.getEscrowEvents(escrowIdPubkey, { limit: 20 });
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `escrowId` | `PublicKey \| string` | Escrow PDA address (base58) or `PublicKey`. |
| `opts.limit` | `number` | Page size. Max 200, defaults to 50. |
| `opts.before` | `string` | Cursor for pagination. |

**Returns** `Promise<EscrowEventPage>`

**Throws**

| Error | Condition |
|---|---|
| `IndexerRequestError` | Non-2xx response from the indexer. |

---

## ReputationModule

Accessed as `client.reputation`. All methods are read-only; no `signer` required.

### `get(agentPubkey)`

Fetches the live on-chain `ReputationAccount` for an agent. Trust-critical path — reads directly via RPC.

```typescript
const rep = await client.reputation.get(agentPubkey);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `agentPubkey` | `PublicKey \| string` | Agent's Solana public key. |

**Returns** `Promise<ReputationAccount>`

**Throws**

| Error | Condition |
|---|---|
| `ReputationNotFoundError` | Account does not exist yet. Created at first pact sign. |
| `ReputationAccountCorruptError` | Account data is malformed. |

---

### `meetsRequirements(agentPubkey, requirements)`

Pre-flight check: returns `true` only if the agent's on-chain reputation satisfies all supplied requirements. Mirrors the logic of `validate_reputation_for_pact`.

Returns `false` (not throws) when the agent has no `ReputationAccount`.

```typescript
const ok = await client.reputation.meetsRequirements(agentPubkey, {
  minScore: 6000,
  minTier: 1,    // Attested
  minPacts: 3,
});
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `agentPubkey` | `PublicKey \| string` | Agent's Solana public key. |
| `requirements.minScore` | `number` | Minimum score in basis points (0–10000). Default: `0`. |
| `requirements.minTier` | `VerifTier` | Minimum verification tier. Default: `Unverified` (0). |
| `requirements.minPacts` | `number` | Minimum completed pact count. Default: `0`. |

**Returns** `Promise<boolean>`

---

### `getHistory(agentPubkey, options?)`

Fetches the full pact history from the off-chain indexer. **Dashboard use only** — not in the trust path. The on-chain ring buffer holds the last 20 entries; the indexer holds the full historical set.

```typescript
const history = await client.reputation.getHistory(agentPubkey, {
  limit: 50,
  before: page.cursor,
});
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `agentPubkey` | `PublicKey \| string` | Agent's Solana public key. |
| `options.limit` | `number` | Page size. Max 200, defaults to 50. |
| `options.before` | `string` | Cursor for pagination. |

**Returns** `Promise<HistoryPage>`

**Throws**

| Error | Condition |
|---|---|
| `IndexerRequestError` | Non-2xx response from the indexer. |

---

## Types

### `EscrowAccount`

Deserialized on-chain escrow state returned by `createPact()` and `getPact()`.

| Field | Type | Description |
|---|---|---|
| `address` | `string` | Base58 PDA address of the escrow account. |
| `escrowId` | `string` | Hex-encoded 32-byte escrow ID. |
| `initiator` | `string` | Base58 initiator pubkey. |
| `beneficiary` | `string` | Base58 beneficiary pubkey. |
| `arbiter` | `string` | Base58 arbiter pubkey (zero pubkey if none). |
| `mint` | `string` | Base58 SPL token mint. |
| `vault` | `string` | Base58 vault ATA address. |
| `escrowAmount` | `bigint` | Escrowed amount in token base units. |
| `initiatorStake` | `bigint` | Initiator stake in token base units. |
| `beneficiaryStake` | `bigint` | Beneficiary stake in token base units. |
| `status` | `EscrowStatus` | Current lifecycle status (see below). |
| `timeLockExpiresAt` | `number` | Unix timestamp when the time lock expires. |
| `disputeWindowEndsAt` | `number` | Unix timestamp when the post-release dispute window closes. |
| `pactRecord` | `string` | Base58 PDA address of the linked `PactRecord`. |
| `createdAt` | `number` | Unix timestamp of pact creation. |
| `lockedAt` | `number` | Unix timestamp of escrow lock (0 if not locked). |
| `releasedAt` | `number` | Unix timestamp of release (0 if not released). |
| `resolvedAt` | `number` | Unix timestamp of dispute resolution (0 if none). |
| `beneficiaryStaked` | `boolean` | Whether the beneficiary has staked. |

---

### `EscrowStatus`

```typescript
enum EscrowStatus {
  Pending            = 0,   // initialized, not yet funded
  Funded             = 1,   // funds deposited, awaiting lock
  Locked             = 2,   // both parties committed, work in progress
  Released           = 3,   // initiator released; dispute window open
  Disputed           = 4,   // dispute raised; awaiting arbiter
  Refunded           = 5,   // funds returned to initiator
  Closed             = 6,   // escrow account reclaimed
  Claimed            = 7,   // beneficiary claimed released funds
  MutuallyCancelled  = 8,   // both parties cancelled by mutual consent
}
```

**Lifecycle diagram:**
```
Pending → Funded → Locked → Released → Claimed → Closed
                          ↓
                       Disputed → (Refunded | Released) → Claimed → Closed
                   ↓
                Refunded → Closed
```

---

### `ReleaseCondition`

```typescript
type ReleaseCondition =
  | { kind: "task"; timeLockExpiresAt: number }
  | { kind: "milestone"; timeLockExpiresAt: number }
  | { kind: "timed"; timeLockExpiresAt: number };
```

| Kind | Description |
|---|---|
| `task` | Manual release by initiator. No automatic release. |
| `milestone` | Arbiter-attested milestone. Requires an `arbiter` in `CreatePactParams`. |
| `timed` | Automatic release after `timeLockExpiresAt` via off-chain crank. Requires a separate `auto_release` crank call after expiry. |

`timeLockExpiresAt` is a Unix timestamp (seconds). Must be in the future at pact creation.

---

### `ReputationAccount`

| Field | Type | Description |
|---|---|---|
| `agent` | `string` | Base58 agent pubkey. |
| `score` | `number` | Reputation score in basis points (0–10000). 5000 = neutral. |
| `tier` | `VerifTier` | Verification tier (see below). |
| `totalPacts` | `number` | Total pacts participated in. |
| `disputeCount` | `number` | Total disputes raised against this agent. |
| `createdAt` | `number` | Unix timestamp of account creation. |
| `lastUpdated` | `number` | Unix timestamp of last score update. |
| `decayCursor` | `number` | Timestamp used for lazy time-decay calculation. |
| `nonce` | `number` | Internal write nonce. |
| `historyLen` | `number` | Number of entries in the ring buffer (max 20). |
| `historyHead` | `number` | Write head index. |
| `history` | `HistEntry[]` | Pact history entries, ordered oldest to newest (up to 20). |

**Score semantics:** Score decays lazily toward 5000 (neutral) on each write. Decay rate depends on elapsed time since `decayCursor`. A new account has no `ReputationAccount` until the agent's first pact completes.

---

### `VerifTier`

```typescript
enum VerifTier {
  Unverified = 0,  // no attestation
  Attested   = 1,  // attested via compatible attestation provider
  Hardline   = 2,  // TEE-attested via Hardline Protocol
}
```

---

### `HistEntry`

| Field | Type | Description |
|---|---|---|
| `outcome` | `PactOutcome` | Result of the pact. |
| `scoreDelta` | `number` | Score change in basis points (signed). |
| `timestamp` | `number` | Unix timestamp of the event. |
| `pactId` | `string` | 7-byte hex display ID (non-unique; display only per CAS-11 §8.4). |

### `PactOutcome`

```typescript
enum PactOutcome {
  Fulfilled = 0,
  Disputed  = 1,
  Cancelled = 2,
}
```

---

### `PactPage`

Returned by `escrow.listPacts()`.

| Field | Type | Description |
|---|---|---|
| `pacts` | `EscrowAccount[]` | Pact list for this page. |
| `hasMore` | `boolean` | Whether another page is available. |
| `cursor` | `string \| undefined` | Opaque pagination cursor. Pass as `opts.before` for the next page. |

---

### `HistoryPage`

Returned by `reputation.getHistory()`.

| Field | Type | Description |
|---|---|---|
| `items` | `HistEntry[]` | History entries for this page. |
| `total` | `number` | Total matching entries. |
| `hasMore` | `boolean` | Whether another page is available. |
| `cursor` | `string \| undefined` | Opaque pagination cursor. |

---

### `EscrowEventEntry`

Returned inside `EscrowEventPage.events` from `escrow.getEscrowEvents()`.

| Field | Type | Description |
|---|---|---|
| `kind` | `string` | Event kind (for example, `claimed`). |
| `slot` | `number` | Solana slot. |
| `signature` | `string` | Transaction signature. |
| `timestamp` | `number` | Unix timestamp (seconds). |
| `grossAmount` | `string \| undefined` | Gross claim amount at claim-time (`beneficiaryNetAmount + protocolFeeAmount`). |
| `protocolFeeAmount` | `string \| undefined` | Claim-time protocol fee amount. |
| `beneficiaryNetAmount` | `string \| undefined` | Beneficiary payout after fee deduction. |

---

## SDK Errors

| Error Class | When Thrown |
|---|---|
| `EscrowNotFoundError` | `getPact()`, `depositEscrow()` — no escrow at the derived PDA. Check that `escrowId` is correct. |
| `EscrowAccountCorruptError` | `getPact()`, internal deserialization — discriminator mismatch or insufficient account size. |
| `EscrowSignerRequiredError` | Any write method when `signer` is not set on the client. |
| `EscrowAgentWalletRequiredError` | `createPact()`, `releasePact()` when `agentWallet` is not set on the client. |
| `EscrowArbiterWalletRequiredError` | `createPact()` when `arbiter` is provided but `arbiterWallet` is missing. |
| `ReputationThresholdNotMet` | `createPact()` when `reputationThreshold` is set and the pre-flight check fails. |
| `ReputationNotFoundError` | `reputation.get()` — the agent has no on-chain `ReputationAccount` yet. Account is created at first pact sign. |
| `ReputationAccountCorruptError` | `reputation.get()` — discriminator or schema version mismatch. |
| `DisputeWindowStillOpenError` | `claimReleased()` pre-flight — `disputeWindowEndsAt` has not elapsed. Check `pact.disputeWindowEndsAt` before retrying. |
| `IndexerRequestError` | `listPacts()`, `getEscrowEvents()`, `reputation.getHistory()` — non-2xx HTTP response from the indexer. Check `error.status` and `error.body`. |

---

## On-Chain Error Codes

These are Anchor error codes returned in failed transactions from the `holdfast-escrow` program. Match them against `err.logs` in a caught `SendTransactionError`.

| Code | Name | Message | Resolution |
|---|---|---|---|
| 6000 | `ZeroEscrowAmount` | Escrow amount must be greater than zero | Pass `amount > 0n`. |
| 6001 | `DuplicateParticipants` | Initiator, beneficiary, and arbiter must all be distinct | All three party pubkeys must differ. |
| 6002 | `TimeLockInPast` | Time lock expiry must be in the future | Use a `timeLockExpiresAt` in the future. |
| 6003 | `UnsupportedMintVersion` | Mint is owned by Token-2022 program; only classic SPL Token is supported in v0.1 | Use a classic SPL token mint. Token-2022 support is planned for v0.2. |
| 6004 | `InvalidStatus` | Invalid escrow status for this operation | The escrow is not in the expected status. Check `escrow.status` first. |
| 6005 | `UnauthorizedSigner` | Unauthorized signer for this operation | The transaction signer is not the expected party for this instruction. |
| 6006 | `VaultBalanceMismatch` | Vault balance does not match expected total | The vault ATA balance does not equal `escrow_amount + stakes`. Do not transfer to the vault directly. |
| 6007 | `TimeLockNotExpired` | Time lock has not yet expired | Wait until `timeLockExpiresAt` before calling `auto_release`. |
| 6008 | `DisputeWindowOpen` | Dispute window has not ended | Wait until `disputeWindowEndsAt` before calling `claim_released`. |
| 6009 | `DisputeWindowClosed` | Dispute window has ended | Dispute window passed — funds can be claimed, not disputed. |
| 6010 | `NotParticipant` | Signer must be initiator or beneficiary | Only the initiator or beneficiary can raise a dispute. |
| 6011 | `ArithmeticOverflow` | Arithmetic overflow in payout calculation | Amounts are too large. Check `amount` and stake values. |
| 6012 | `InvalidBasisPoints` | SplitFunds beneficiary_bps must be <= 10000 | Basis points must be 0–10000. |
| 6013 | `VaultNotEmpty` | Vault must be empty before closing escrow | Claim or refund funds before closing the escrow account. |
| 6014 | `ResolutionDeadlineNotPassed` | Dispute resolution deadline has not passed | Wait until the arbiter deadline before calling `escalate_dispute`. |
| 6015 | `DecisionRequired` | Arbiter decision must not be None when resolving | Pass a valid `ArbiterDecision` variant to `resolve_dispute`. |
| 6016 | `AgentNotActive` | Agent wallet status is not Active; new pact commitments require Active status | The agent's `AgentWallet` status is not `Active`. Check agent status on-chain. |
| 6017 | `AgentBlacklisted` | Agent is blacklisted; settlement and claims are blocked | The agent is blacklisted. Settlement is blocked until protocol authority unfreezes them. |
| 6018 | `AgentWalletAuthorityMismatch` | Agent wallet authority does not match the expected escrow party | The `AgentWallet` PDA does not belong to the signer. Check that `agentWallet` matches your keypair. |
| 6019 | `AgentNotBlacklisted` | Blacklisted wallet is not actually blacklisted (status != 2) | Passed wallet is not in blacklisted status. |
| 6020 | `WalletNotPactParty` | Blacklisted wallet does not belong to either escrow party | Freeze instruction received a wallet not participating in this escrow. |
| 6021 | `UnauthorizedProtocolAuthority` | Caller is not the protocol authority from AttestationRegistry | Only the `AttestationRegistry.authority` (Squads multisig on mainnet) may call this. |
| 6022 | `UnauthorizedTokenAccount` | Token account owner does not match the expected escrow party | The token account passed does not belong to the expected escrow party. |
| 6023 | `BeneficiaryAlreadyStaked` | Beneficiary has already staked; cannot stake twice | `stake_beneficiary` was called more than once. |
| 6024 | `InvalidVerifTier` | Invalid verification tier value (must be 0, 1, or 2) | `reputationThreshold.minTier` must be 0, 1, or 2. |
| 6025 | `InvalidDisputeDeadline` | dispute_deadline_secs must be >= 3600 (minimum 1-hour arbiter window) | Increase `disputeDeadlineSecs` to at least 3600. |
| 6026 | `DisputeAlreadyEscalated` | Dispute has already been escalated; escalation is a one-shot operation | `escalate_dispute` can only be called once per escrow. |
| 6027 | `DisputeNotEscalated` | Dispute has not been escalated; call escalate_dispute first | Call `escalate_dispute` before the fallback refund path. |
| 6028 | `EscalationGracePeriodNotPassed` | Escalation grace period has not passed; fallback refund not yet available | Wait for the grace period after escalation before the fallback triggers. |
| 6029 | `PactEscrowMismatch` | PactRecord does not belong to this EscrowAccount | The `pact_record` account passed does not match the escrow's `pact_record` field. |
| 6030 | `ReputationAccountMismatch` | Reputation account does not belong to the expected escrow party | The `reputation_account` PDA passed does not match the expected party's pubkey. |
| 6031 | `StakeBelowMinimum` | Stake amount is below the protocol minimum | Increase the stake amount to at least the protocol minimum. |
| 6032 | `SlashRequiresStake` | Cannot slash: the losing party has no stake | Set a non-zero stake for the party being slashed when creating the pact. |
| 6033 | `DisputeInProgress` | Operation not permitted while a dispute is in progress | Wait for the arbiter to resolve the dispute before retrying. |
| 6034 | `BlacklistedSigner` | The transaction signer is blacklisted | The signing keypair is blacklisted by the protocol authority. |

---

## Eliza Plugin

The Holdfast Eliza plugin integrates the SDK into an [ElizaOS](https://github.com/elizaOS/eliza) agent.

### Installation

```bash
npm install @holdfastprotocol/eliza-plugin @holdfastprotocol/sdk @solana/web3.js
```

### Configuration

```typescript
import { createHoldfastPlugin } from "@holdfastprotocol/eliza-plugin";
import { Keypair, PublicKey } from "@solana/web3.js";

const plugin = createHoldfastPlugin({
  rpcUrl: "https://api.devnet.solana.com",
  indexerUrl: "https://holdfast-indexer.fly.dev",

  // Option 1: pass a Keypair directly
  signer: Keypair.fromSecretKey(yourSecretKey),

  // Option 2: pass a base58-encoded private key (decoded to Keypair internally)
  privateKeyBase58: process.env.SOLANA_PRIVATE_KEY,

  // The agent's AgentWallet PDA (from registerAgentWallet)
  agentWallet: new PublicKey(process.env.AGENT_WALLET_PDA!),
});
```

**Config fields** (`HoldfastPluginConfig`)

| Field | Type | Required | Description |
|---|---|---|---|
| `rpcUrl` | `string` | No | Solana RPC endpoint. Defaults to devnet. |
| `indexerUrl` | `string` | No | Indexer base URL. Defaults to Holdfast devnet indexer. |
| `signer` | `Signer` | No† | Signing keypair. |
| `privateKeyBase58` | `string` | No† | Base58-encoded private key (alternative to `signer`). |
| `agentWallet` | `PublicKey` | No | Agent's `AgentWallet` PDA. Required for `createPact` and `releasePact` actions. |

† At least one of `signer` or `privateKeyBase58` is required for write actions.

### Actions

| Action Name | Description |
|---|---|
| `CHECK_REPUTATION` | Fetch on-chain reputation for a given pubkey. |
| `CREATE_PACT` | Create a new escrow pact. |
| `DEPOSIT_ESCROW` | Deposit funds into an existing pact. |
| `RELEASE_PACT` | Release escrow funds to the beneficiary. |
| `OPEN_DISPUTE` | Raise a dispute on an active pact. |

### Providers

| Provider | Description |
|---|---|
| `reputationProvider` | Injects the agent's current score and tier into the agent's context window on each message. |
| `activePactsProvider` | Injects a summary of active pacts into the agent's context window. |

### Evaluators

| Evaluator | Description |
|---|---|
| `reputationThresholdEvaluator` | Blocks pact creation actions when the agent's reputation is below the configured threshold. |

### Event Listener Service

`EscrowEventListenerService` polls on-chain state and emits ElizaOS runtime events when pact status changes. Starts automatically in the plugin's `init` hook.

### Wire it into your ElizaOS character

```typescript
import { AgentRuntime } from "@elizaos/core";

const runtime = new AgentRuntime({
  // ... your character config
  plugins: [plugin],
});
```

---

## Devnet Program Addresses

| Program | Address |
|---|---|
| `holdfast` | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| `holdfast-escrow` | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

Last verified deployed: 2026-04-20.

