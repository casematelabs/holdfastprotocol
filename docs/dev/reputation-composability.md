# Holdfast Protocol — Reputation Composability Guide

> **Security notice:** Holdfast Protocol is currently in devnet. On-chain programs have not yet undergone a third-party security audit. Do not use devnet program addresses in production.

This guide shows how to gate your own protocol on an agent's Holdfast reputation — using either the off-chain TypeScript SDK or an on-chain CPI instruction.

---

## Contents

1. [Overview](#overview)
2. [Concepts](#concepts)
3. [Off-Chain Path (SDK)](#off-chain-path-sdk)
   - [client.reputation.get()](#clientreputationgetpubkey)
   - [client.reputation.meetsRequirements()](#clientreputationmeetsrequirementspubkey-requirements)
   - [client.reputation.getHistoryWithFallback()](#clientreputationgethistorywithfallbackpubkey-options)
4. [On-Chain Path (CPI)](#on-chain-path-cpi)
   - [Step 1 — Import the IDL](#step-1--import-the-idl)
   - [Step 2 — Add the Cargo dependency](#step-2--add-the-cargo-dependency)
   - [Step 3 — Add the account to your context](#step-3--add-the-reputationaccount-to-your-instruction-context)
   - [Step 4 — Call the CPI](#step-4--call-the-cpi)
5. [Deriving the PDA](#deriving-the-reputationaccount-pda)
6. [Combining pre-flight with on-chain enforcement](#combining-off-chain-pre-flight-with-on-chain-enforcement)
7. [Error handling](#error-handling)
   - [Missing accounts](#missing-accounts)
   - [Stale scores](#stale-scores)
   - [Corruption recovery](#corruption-recovery)
8. [Score and tier reference](#score-and-tier-reference)

---

## Overview

Holdfast exposes reputation data through two integration paths:

| Path | When to use |
|---|---|
| **Off-chain SDK** | Service selection, pre-flight checks, UI display — anywhere you control the off-chain stack |
| **On-chain CPI** | Smart contract enforcement — when the rejection must be provable and atomic on-chain |

Both paths read from the same `ReputationAccount` PDA. An agent cannot present a different score on-chain than what the SDK reads — there is one account, one source of truth.

---

## Concepts

### Score and Tier

**Score** is stored as an integer in the range `[0, 10000]` (basis points). A freshly initialised agent starts at `5000` (neutral). Fulfilled pacts increase it; disputes, cancellations, and time-decay pull it back toward neutral.

**Tier** is a verification level that is separate from score and can only increase:

| Value | Constant | Meaning |
|---|---|---|
| `0` | `VerifTier.Unverified` | Default — no external attestation |
| `1` | `VerifTier.Attested` | Identity-attested via Holdfast oracle |
| `2` | `VerifTier.Hardline` | TEE-attested via Hardline Protocol |

### Score decay

Reputation is lazy-evaluated. The on-chain score is not updated on every block — instead, a decay function is applied when a pact fires `update_reputation`. Effective score at any point in time is:

```
effective_score = 5000 + (raw_score - 5000) * 0.99^days_since_decay
```

Decay is capped at 365 days. After a full year of inactivity an agent's score approaches neutral (`5000`) but never goes below it solely through decay.

Implication: `client.reputation.get()` returns the *stored* score. For a very idle agent this may be higher than what `validate_reputation_for_pact` would compute on-chain, because the on-chain instruction applies decay before checking. See [Stale scores](#stale-scores) for how to handle this.

### Account lifecycle

`ReputationAccount` PDAs are **not** created automatically. They are initialised by `init_reputation` before or during a first pact sign. An agent that has never signed a pact has no account. Treat a missing account as an unmet requirement in all gating logic.

---

## Off-Chain Path (SDK)

Install the SDK:

```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js
```

Create a read-only client (no signer or wallet needed for reputation reads):

```typescript
import { createHoldfastClient } from '@holdfastprotocol/sdk';

const client = createHoldfastClient({
  rpcUrl: 'https://api.devnet.solana.com',
  indexerUrl: 'https://indexer.devnet.holdfastprotocol.com', // required only for getHistory
});
```

---

### `client.reputation.get(pubkey)`

Fetches the full `ReputationAccount` directly from RPC — no oracle round-trip, no indexer.

**Signature:**
```typescript
async get(agentPubkey: PublicKey | string): Promise<ReputationAccount>
```

**Return type:**
```typescript
interface ReputationAccount {
  agent: string;          // Base58 pubkey
  score: number;          // [0, 10000]; 5000 = neutral
  tier: VerifTier;
  totalPacts: number;     // Lifetime fulfilled pacts
  disputeCount: number;   // Lifetime disputes
  createdAt: number;      // Unix seconds
  lastUpdated: number;    // Unix seconds
  decayCursor: number;    // Timestamp of last score decay application
  nonce: number;          // Monotonic anti-replay counter
  historyLen: number;     // Valid entries in the ring buffer [0, 20]
  historyHead: number;    // Next write index in the ring buffer
  history: HistEntry[];   // Up to 20 most recent entries, oldest → newest
}

interface HistEntry {
  outcome: PactOutcome;   // Fulfilled | Disputed | Cancelled
  scoreDelta: number;     // Signed basis-point change applied at this pact
  timestamp: number;      // Unix seconds
  pactId: string;         // 7-byte hex display ID (not globally unique)
}

enum VerifTier  { Unverified = 0, Attested = 1, Hardline = 2 }
enum PactOutcome { Fulfilled = 0, Disputed  = 1, Cancelled = 2 }
```

**Errors thrown:**
- `ReputationNotFoundError` — agent has no `ReputationAccount`
- `ReputationAccountCorruptError` — account data is malformed (wrong discriminator or schema version)

**Example:**
```typescript
import {
  createHoldfastClient,
  ReputationNotFoundError,
  VerifTier,
} from '@holdfastprotocol/sdk';

const client = createHoldfastClient();

try {
  const rep = await client.reputation.get(agentPubkey);

  console.log(`Score:    ${rep.score}/10000`);
  console.log(`Tier:     ${VerifTier[rep.tier]}`);
  console.log(`Pacts:    ${rep.totalPacts} completed, ${rep.disputeCount} disputed`);
  console.log(`Updated:  ${new Date(rep.lastUpdated * 1000).toISOString()}`);
} catch (err) {
  if (err instanceof ReputationNotFoundError) {
    // Safe to surface as a readable message — this is expected for new agents
    console.log('Agent has no reputation history. Treating as unverified.');
    return;
  }
  throw err; // ReputationAccountCorruptError or network error — bubble up
}
```

---

### `client.reputation.meetsRequirements(pubkey, requirements)`

Checks whether an agent satisfies a set of requirements. Returns `false` (does not throw) if the agent has no `ReputationAccount`. This mirrors the logic of the on-chain `validate_reputation_for_pact` instruction, making it suitable for pre-flight checks.

**Signature:**
```typescript
async meetsRequirements(
  agentPubkey: PublicKey | string,
  requirements: ReputationRequirements,
): Promise<boolean>
```

**`ReputationRequirements`:**
```typescript
interface ReputationRequirements {
  minScore?: number;    // Minimum score in basis points [0, 10000]. Default: 0
  minTier?: VerifTier;  // Minimum verification tier. Default: Unverified
  minPacts?: number;    // Minimum lifetime completed pacts. Default: 0
}
```

All fields are optional. Omitting a field means no requirement on that dimension.

**Example — binary gate:**
```typescript
import { VerifTier } from '@holdfastprotocol/sdk';

async function acceptServiceRequest(agentPubkey: string): Promise<void> {
  const qualified = await client.reputation.meetsRequirements(agentPubkey, {
    minScore: 6000,               // Above-neutral score
    minTier: VerifTier.Attested,  // Must have identity attestation
    minPacts: 3,                  // At least 3 completed pacts
  });

  if (!qualified) {
    throw new Error('Agent does not meet reputation requirements');
  }
  // Proceed
}
```

**Example — tiered service levels:**
```typescript
import { VerifTier } from '@holdfastprotocol/sdk';

async function getServiceTier(
  agentPubkey: string,
): Promise<'premium' | 'standard' | 'restricted'> {
  const [premium, standard] = await Promise.all([
    client.reputation.meetsRequirements(agentPubkey, {
      minScore: 7500,
      minTier: VerifTier.Hardline,
      minPacts: 10,
    }),
    client.reputation.meetsRequirements(agentPubkey, {
      minScore: 5500,
      minTier: VerifTier.Attested,
      minPacts: 1,
    }),
  ]);

  if (premium) return 'premium';
  if (standard) return 'standard';
  return 'restricted';
}
```

---

### `client.reputation.getHistoryWithFallback(pubkey, options?)`

Fetches pact history, trying the indexer first and falling back to the on-chain ring buffer on server errors. This is the right choice for any user-facing history view — it degrades gracefully when the indexer is unavailable.

```typescript
async getHistoryWithFallback(
  agentPubkey: PublicKey | string,
  options?: GetHistoryOptions,
): Promise<HistoryPage>

interface GetHistoryOptions {
  limit?: number;   // default 50, max 200 (indexer); 20 (ring buffer fallback)
  before?: string;  // pagination cursor (indexer only; ignored in fallback)
}

interface HistoryPage {
  entries: HistEntry[];   // oldest → newest
  total: number;
  hasMore: boolean;
  cursor?: string;        // pass as `before` for the next page
}
```

- Falls back to the on-chain ring buffer only on `5xx` or network errors — **not** on `4xx` responses.
- The ring buffer holds the 20 most recent entries. If the indexer is down, you get those 20.

```typescript
const page = await client.reputation.getHistoryWithFallback(agentPubkey, { limit: 20 });
for (const entry of page.entries) {
  const outcome = PactOutcome[entry.outcome];
  const delta = entry.scoreDelta >= 0 ? `+${entry.scoreDelta}` : `${entry.scoreDelta}`;
  console.log(`${outcome} ${delta}bp — pact ${entry.pactId}`);
}
```

For dashboards with pagination, prefer `getHistory` (indexer-only, supports cursors up to 200 entries per page). Use `getHistoryWithFallback` in any trust-path or operator context where availability matters.

---

## On-Chain Path (CPI)

Use this when the reputation gate must be enforced atomically inside a Solana transaction — so that the rejection is provable and cannot be bypassed off-chain.

### Program addresses

| Program | Program ID |
|---|---|
| Core (`vaultpact`) | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| Escrow | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

---

### Step 1 — Import the IDL

Fetch the IDL pinned to the currently deployed program:

```bash
anchor idl fetch 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq \
  --url https://api.devnet.solana.com \
  -o idl/holdfast_vaultpact.json
```

> Always re-fetch after a Holdfast program upgrade. A stale IDL produces incorrect instruction serialization.

---

### Step 2 — Add the Cargo dependency

```toml
[dependencies]
anchor-lang = "0.31.1"
holdfast-vaultpact = { git = "https://github.com/casematelabs/holdfast", features = ["cpi"] }
```

A crates.io publication is planned for mainnet. Until then, use the git reference.

---

### Step 3 — Add the `ReputationAccount` to your instruction context

```rust
use anchor_lang::prelude::*;
use holdfast_vaultpact::program::HoldfastVaultpact;
use holdfast_vaultpact::cpi::accounts::ValidateReputationAccounts;
use holdfast_vaultpact::state::ReputationAccount;

declare_id!("YourProgramIdHere11111111111111111111111111");

#[error_code]
pub enum MyProtocolError {
    #[msg("Invalid verification tier value (must be 0, 1, or 2)")]
    InvalidTier,
}

#[program]
pub mod my_protocol {
    use super::*;

    // min_tier is u8 so TypeScript clients can pass 0/1/2 directly via Anchor.
    // Convert to VerifTier before the CPI — the on-chain function expects the enum.
    pub fn create_service_request(
        ctx: Context<CreateServiceRequest>,
        min_score: u64,
        min_tier: u8,
        min_pacts: u64,
    ) -> Result<()> {
        let tier = match min_tier {
            0 => holdfast_vaultpact::VerifTier::Unverified,
            1 => holdfast_vaultpact::VerifTier::Attested,
            2 => holdfast_vaultpact::VerifTier::Hardline,
            _ => return err!(MyProtocolError::InvalidTier),
        };

        // Enforce the reputation gate as the first step in the instruction.
        // The CPI applies lazy decay before checking, so effective score may
        // differ from the stored score for idle agents.
        holdfast_vaultpact::cpi::validate_reputation_for_pact(
            ctx.accounts.validate_reputation_ctx(),
            min_score,
            tier,
            min_pacts,
        )?;

        // Your instruction logic follows
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateServiceRequest<'info> {
    /// The agent submitting the request — must match reputation_account.agent.
    pub agent: Signer<'info>,

    /// The agent's ReputationAccount PDA.
    /// Seeds: [b"reputation", agent.key().as_ref()]
    /// Program: 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq
    #[account(
        seeds = [b"reputation", agent.key().as_ref()],
        bump,
        seeds::program = holdfast_vaultpact_program.key(),
    )]
    pub reputation_account: Account<'info, ReputationAccount>,

    pub holdfast_vaultpact_program: Program<'info, HoldfastVaultpact>,
    // ... rest of your accounts
}

impl<'info> CreateServiceRequest<'info> {
    fn validate_reputation_ctx(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, ValidateReputationAccounts<'info>> {
        CpiContext::new(
            self.holdfast_vaultpact_program.to_account_info(),
            ValidateReputationAccounts {
                reputation_account: self.reputation_account.to_account_info(),
            },
        )
    }
}
```

---

### Step 4 — Call the CPI

The CPI returns `Ok(())` if requirements are met, or one of three errors if not:

| Error constant | Code | Condition |
|---|---|---|
| `ReputationScoreTooLow` | `6017` | `effective_score < min_score` |
| `ReputationTierTooLow` | `6018` | `tier < min_tier` |
| `ReputationInsufficientHistory` | `6019` | `total_pacts < min_pacts` |

Handle these in your TypeScript client:

```typescript
import { AnchorError } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

const HOLDFAST_PROGRAM_ID = new PublicKey(
  '2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq',
);

try {
  await myProtocol.methods
    .createServiceRequest(
      new anchor.BN(6000),  // min_score (basis points)
      1,                    // min_tier: 1 = Attested
      new anchor.BN(3),     // min_pacts
    )
    .accounts({
      agent: wallet.publicKey,
      reputationAccount: reputationPda,
      holdfastVaultpactProgram: HOLDFAST_PROGRAM_ID,
    })
    .rpc();
} catch (err) {
  if (err instanceof AnchorError) {
    switch (err.error.errorCode.number) {
      case 6017: throw new Error('Agent score is below the required minimum');
      case 6018: throw new Error('Agent verification tier is too low');
      case 6019: throw new Error('Agent has not completed enough pacts');
    }
  }
  throw err;
}
```

---

## Deriving the `ReputationAccount` PDA

All `ReputationAccount` PDAs share the same derivation — seeds `[b"reputation", agent_pubkey_bytes]` on the core `vaultpact` program.

**TypeScript:**
```typescript
import { PublicKey } from '@solana/web3.js';

const HOLDFAST_PROGRAM_ID = new PublicKey(
  '2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq',
);

function findReputationPda(agentPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), agentPubkey.toBytes()],
    HOLDFAST_PROGRAM_ID,
  );
  return pda;
}

const reputationPda = findReputationPda(wallet.publicKey);
```

**Rust (in your program):**
```rust
let reputation_seeds = &[
    b"reputation".as_ref(),
    agent_pubkey.as_ref(),
];
let (reputation_pda, _bump) = Pubkey::find_program_address(
    reputation_seeds,
    &holdfast_vaultpact::ID,
);
```

If no `ReputationAccount` exists at that address, the agent has not yet called `init_reputation`. Treat this as an unmet requirement — do not attempt to create the account for them.

---

## Combining off-chain pre-flight with on-chain enforcement

The recommended pattern: run `meetsRequirements` off-chain before building the transaction to give users an early, readable error without paying gas, then let the CPI enforce the same constraint atomically on-chain.

```typescript
import {
  createHoldfastClient,
  VerifTier,
  ReputationRequirements,
} from '@holdfastprotocol/sdk';
import { PublicKey } from '@solana/web3.js';

const client = createHoldfastClient();

async function submitServiceRequest(
  agentPubkey: PublicKey,
  requirements: ReputationRequirements,
): Promise<string> {
  // Step 1 — Off-chain pre-flight: cheap, readable error, no fee
  const qualified = await client.reputation.meetsRequirements(
    agentPubkey,
    requirements,
  );

  if (!qualified) {
    // Fetch full account for a more informative error message
    const rep = await client.reputation.get(agentPubkey).catch(() => null);
    if (!rep) {
      throw new Error('Agent has no reputation account — cannot verify eligibility');
    }
    throw new Error(
      `Reputation check failed: score=${rep.score}/10000, ` +
      `tier=${VerifTier[rep.tier]}, pacts=${rep.totalPacts}`,
    );
  }

  // Step 2 — Submit transaction: on-chain CPI is the authoritative gate
  const reputationPda = findReputationPda(agentPubkey);
  const txSignature = await myProtocol.methods
    .createServiceRequest(
      new anchor.BN(requirements.minScore ?? 0),
      requirements.minTier ?? 0,
      new anchor.BN(requirements.minPacts ?? 0),
    )
    .accounts({
      agent: agentPubkey,
      reputationAccount: reputationPda,
      holdfastVaultpactProgram: HOLDFAST_PROGRAM_ID,
    })
    .rpc();

  return txSignature;
}
```

---

## Error handling

### Missing accounts

`ReputationNotFoundError` means the agent has never signed a Holdfast pact. This is not an error in your code — it is valid agent state.

```typescript
import { ReputationNotFoundError } from '@holdfastprotocol/sdk';

async function checkReputation(agentPubkey: string) {
  try {
    return await client.reputation.get(agentPubkey);
  } catch (err) {
    if (err instanceof ReputationNotFoundError) {
      // Return a zero-state object or reject the agent as unqualified
      return null;
    }
    throw err;
  }
}
```

`meetsRequirements` handles this for you — it returns `false` (not throws) when the account is absent. Use `get` directly only when you need the full account data.

---

### Stale scores

The stored `score` field in `ReputationAccount` may be higher than the *effective* score that the on-chain program would compute, because decay is lazy. An idle agent's score is not decremented until the next `update_reputation` call.

To compute the effective score off-chain before submitting a transaction:

```typescript
const DECAY_RATE = 0.99;  // 1% per day
const NEUTRAL = 5000;

function computeEffectiveScore(rep: ReputationAccount): number {
  const now = Math.floor(Date.now() / 1000);
  const daysSinceDecay = Math.min(
    Math.floor((now - rep.decayCursor) / 86_400),
    365,
  );
  if (daysSinceDecay === 0) return rep.score;

  const delta = rep.score - NEUTRAL;
  const decayFactor = Math.pow(DECAY_RATE, daysSinceDecay);
  return Math.round(NEUTRAL + delta * decayFactor);
}

const rep = await client.reputation.get(agentPubkey);
const effective = computeEffectiveScore(rep);

console.log(`Stored score:    ${rep.score}`);
console.log(`Effective score: ${effective}`);
```

When running `meetsRequirements`, the SDK applies the same decay function as the on-chain program. The `minScore` check therefore uses the *effective* score, not the stored one — so pre-flight results will match on-chain enforcement for idle agents.

---

### Corruption recovery

`ReputationAccountCorruptError` means the account data at the expected PDA address has an unrecognised discriminator or schema version. This should not occur under normal operation; it typically indicates:

- A program upgrade changed the account layout (schema version mismatch)
- The account was closed and reallocated to a different program (discriminator mismatch)
- Data corruption on the RPC node (transient)

**Recovery steps:**

1. **Verify the program ID is current.** Confirm you are using the canonical devnet program ID `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq`. If the program was upgraded after you deployed, re-fetch the IDL and update your dependency.

2. **Check for a schema version bump.** Fetch the raw account data and inspect byte 8 (the `schema_version` field):
   ```typescript
   const accountInfo = await connection.getAccountInfo(reputationPda);
   if (accountInfo) {
     const schemaVersion = accountInfo.data[8];
     console.log('Schema version:', schemaVersion); // current = 1
   }
   ```

3. **Try a second RPC endpoint.** Discriminator mismatches on a single RPC node may be transient data errors. Retry with a different endpoint before treating the account as truly corrupt.

4. **Do not attempt to write to a corrupt account.** If `ReputationAccountCorruptError` persists across RPC endpoints, treat the agent's reputation as unavailable and reject the request conservatively:
   ```typescript
   import { ReputationAccountCorruptError } from '@holdfastprotocol/sdk';

   try {
     const rep = await client.reputation.get(agentPubkey);
     return rep;
   } catch (err) {
     if (err instanceof ReputationAccountCorruptError) {
       // Treat as unavailable — do not allow access during corruption
       throw new Error('Reputation data is unavailable. Please try again later.');
     }
     throw err;
   }
   ```

5. **Report to the Holdfast team** with the agent pubkey, PDA address, and the raw `accountInfo.data` bytes (hex). A schema version change after a program upgrade is the most likely cause.

---

## Score and tier reference

| Score range | Interpretation |
|---|---|
| `8000–10000` | Excellent — long track record, rare disputes |
| `6000–7999` | Good — above neutral, reasonable history |
| `5000–5999` | Neutral — new, idle, or recovering agent |
| `3000–4999` | Below neutral — recent disputes or cancellations |
| `0–2999` | Poor — significant dispute history or severe decay |

Score starts at `5000` at account initialisation. Time-decay pulls idle agents back toward `5000`. An agent can never fall *below* their natural decay floor through inactivity alone — only disputes and cancellations push the score below `5000`.

For tier requirements:
- `minTier: VerifTier.Unverified` (the default) accepts all agents with an account.
- `minTier: VerifTier.Attested` requires identity attestation via the Holdfast oracle.
- `minTier: VerifTier.Hardline` requires TEE-level attestation via Hardline Protocol — use for high-value pacts only.

---

## Related guides

- [Quickstart](./quickstart.md) — set up your first devnet pact
- [SDK API Reference](./sdk-reference.md) — full `ReputationModule` method signatures
- [Integration Guide](../holdfast/docs/integration-guide.md) — devnet program addresses and IDL management
- [Escrow IDL Reference](./escrow-idl-reference.md) — on-chain error codes for the escrow program

---

*Guide version: 2026-04-26*

