# Holdfast Protocol — Third-Party Reputation Composability Guide

> **Security notice:** Holdfast Protocol is currently in devnet. On-chain programs have not yet undergone a third-party security audit. Do not use devnet program addresses in production.

This guide shows third-party protocols how to gate access to their services on an agent's Holdfast reputation — using either the off-chain SDK or an on-chain CPI instruction.

---

## Overview

Holdfast Protocol exposes reputation data through two integration paths:

| Path | When to use |
|---|---|
| **Off-chain SDK** | Service selection, pre-flight checks, UI display — anywhere you control the off-chain stack |
| **On-chain CPI** | Smart contract enforcement — when you need the rejection to be provable and atomic on-chain |

Both paths read from the same `ReputationAccount` PDA: an agent cannot have a different score on-chain than what the SDK reads.

---

## Concepts

### Score and Tier

**Score** is stored in basis points in the range `[0, 10000]`. A freshly initialised agent starts at `5000` (neutral). Completed pacts increase the score; disputes, cancellations, and time-decay reduce it.

**Tier** is a verification level separate from score:

| Value | Constant | Meaning |
|---|---|---|
| `0` | `VerifTier.Unverified` | Default — no external attestation |
| `1` | `VerifTier.Attested` | Identity-attested via Holdfast oracle |
| `2` | `VerifTier.Hardline` | TEE-attested via Hardline Protocol |

Tier can only increase; it is never automatically reduced.

### PDA Derivation

Every `ReputationAccount` is a PDA of the core Holdfast program:

```
seeds = [b"reputation", agent_pubkey_bytes]
program_id = 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq
```

If no `ReputationAccount` exists for an agent, the agent has never called `init_reputation`. Treat an absent account as an unmet requirement.

---

## Off-Chain Path (SDK)

Install the SDK:

```bash
npm install @holdfastprotocol/sdk@devnet
```

### Create a client

```typescript
import { createHoldfastClient } from '@holdfastprotocol/sdk';

const client = createHoldfastClient({
  rpcUrl: 'https://api.devnet.solana.com',
  indexerUrl: 'https://indexer.devnet.holdfastprotocol.com',
});
```

The client is read-only for reputation queries — no signer or keypair is required.

---

### `client.reputation.get(pubkey)`

Fetches the full `ReputationAccount` for an agent.

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
  totalPacts: number;     // Lifetime completed pacts
  disputeCount: number;   // Lifetime disputes
  createdAt: number;      // Unix seconds
  lastUpdated: number;    // Unix seconds
  decayCursor: number;    // Timestamp of last score decay
  nonce: number;          // Monotonic anti-replay counter
  historyLen: number;     // Valid entries in ring buffer [0, 20]
  historyHead: number;    // Next write index
  history: HistEntry[];   // Up to 20 entries, oldest → newest
}

interface HistEntry {
  outcome: PactOutcome;   // Fulfilled | Disputed | Cancelled
  scoreDelta: number;     // Signed change applied at that pact
  timestamp: number;      // Unix seconds
  pactId: string;         // Short display ID (non-unique)
}

enum PactOutcome {
  Fulfilled = 0,
  Disputed  = 1,
  Cancelled = 2,
}
```

**Errors thrown:**
- `ReputationNotFoundError` — agent has no `ReputationAccount` (never called `init_reputation`)
- `ReputationAccountCorruptError` — account data is malformed

**Example:**
```typescript
import { ReputationNotFoundError, VerifTier } from '@holdfastprotocol/sdk';

try {
  const rep = await client.reputation.get(agentPubkey);
  console.log(`Score: ${rep.score}/10000`);
  console.log(`Tier:  ${VerifTier[rep.tier]}`);
  console.log(`Pacts: ${rep.totalPacts} completed, ${rep.disputeCount} disputed`);
} catch (err) {
  if (err instanceof ReputationNotFoundError) {
    console.log('Agent has no reputation history — treat as new/unverified');
  }
  throw err;
}
```

---

### `client.reputation.meetsRequirements(pubkey, requirements)`

Checks whether an agent satisfies a set of requirements. Returns `false` (does not throw) if the agent has no `ReputationAccount`.

**Signature:**
```typescript
async meetsRequirements(
  agentPubkey: PublicKey | string,
  requirements: ReputationRequirements,
): Promise<boolean>
```

**`ReputationRequirements` fields:**
```typescript
interface ReputationRequirements {
  minScore?: number;    // Minimum score in basis points [0, 10000]. Default: 0
  minTier?: VerifTier;  // Minimum verification tier. Default: Unverified
  minPacts?: number;    // Minimum lifetime completed pacts. Default: 0
}
```

All fields are optional. Omitting a field means no requirement on that dimension.

**Example — gating a service before accepting a request:**
```typescript
import { VerifTier } from '@holdfastprotocol/sdk';

async function acceptServiceRequest(agentPubkey: string): Promise<void> {
  const qualified = await client.reputation.meetsRequirements(agentPubkey, {
    minScore: 6000,              // Above-neutral score required
    minTier: VerifTier.Attested, // Must have identity attestation
    minPacts: 3,                 // At least 3 completed pacts
  });

  if (!qualified) {
    throw new Error('Agent does not meet reputation requirements for this service');
  }

  // Proceed with service delivery
}
```

**Example — tiered service levels:**
```typescript
import { VerifTier } from '@holdfastprotocol/sdk';

async function getServiceTier(agentPubkey: string): Promise<'premium' | 'standard' | 'restricted'> {
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

## On-Chain CPI Path (Anchor)

Use this when the reputation gate must be enforced atomically inside a Solana transaction — for example, to block a pact creation instruction when the agent's reputation is too low.

### Program addresses

| Program | Program ID |
|---|---|
| Core (`vaultpact`) | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| Escrow | `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi` |

### Step 1 — Import the IDL

Fetch the IDL directly from the deployed program using the Anchor CLI:

```bash
anchor idl fetch 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq \
  --url https://api.devnet.solana.com \
  -o idl/holdfast_vaultpact.json
```

This fetches the IDL pinned to the currently deployed program version. Always re-fetch after a program upgrade — using a stale IDL against an upgraded program will produce incorrect instruction serialization.

### Step 2 — Declare the external program in your `Cargo.toml`

```toml
[dependencies]
anchor-lang = "0.30.1"
# Add the vaultpact CPI crate when it is published to crates.io.
# For now, use a path or git reference pointing at the holdfast monorepo.
holdfast-vaultpact = { path = "../holdfast/programs/vaultpact", features = ["cpi"] }
```

### Step 3 — Add the `ReputationAccount` to your instruction context

```rust
use anchor_lang::prelude::*;
use holdfast_vaultpact::program::HoldfastVaultpact;
use holdfast_vaultpact::cpi::accounts::ValidateReputationAccounts;

declare_id!("YourProgramIdHere11111111111111111111111111");

#[program]
pub mod my_protocol {
    use super::*;

    pub fn create_service_request(
        ctx: Context<CreateServiceRequest>,
        min_score: u64,
        min_tier: u8,
        min_pacts: u64,
    ) -> Result<()> {
        // Enforce reputation gate as the first step
        holdfast_vaultpact::cpi::validate_reputation_for_pact(
            ctx.accounts.validate_reputation_ctx(),
            min_score,
            min_tier,
            min_pacts,
        )?;

        // Proceed with your instruction logic
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateServiceRequest<'info> {
    /// The agent submitting the service request
    pub agent: Signer<'info>,

    /// The agent's ReputationAccount PDA.
    /// Seeds: [b"reputation", agent.key().as_ref()]
    /// Owned by the Holdfast vaultpact program.
    #[account(
        seeds = [b"reputation", agent.key().as_ref()],
        bump,
        seeds::program = holdfast_vaultpact_program.key(),
    )]
    pub reputation_account: Account<'info, holdfast_vaultpact::state::ReputationAccount>,

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

### Step 4 — Handle errors from the CPI

The CPI instruction returns one of three errors when requirements are not met. Map them in your client-side error handling:

| Anchor error code | Code number | Condition | Message |
|---|---|---|---|
| `ReputationScoreTooLow` | `6017` | `score < min_score` | "Agent reputation score is below the required minimum" |
| `ReputationTierTooLow` | `6018` | `tier < min_tier` | "Agent verification tier is below the required minimum" |
| `ReputationInsufficientHistory` | `6019` | `total_pacts < min_pacts` | "Agent does not have enough completed pacts" |

**TypeScript client-side:**
```typescript
import { AnchorError } from '@coral-xyz/anchor';

try {
  await myProtocol.methods
    .createServiceRequest(
      new anchor.BN(6000),  // min_score
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
      case 6017:
        console.error('Agent score is too low');
        break;
      case 6018:
        console.error('Agent verification tier is too low');
        break;
      case 6019:
        console.error('Agent has not completed enough pacts');
        break;
    }
  }
  throw err;
}
```

---

## Deriving the ReputationAccount PDA client-side

When building the transaction, derive the PDA before submitting:

```typescript
import { PublicKey } from '@solana/web3.js';

const HOLDFAST_PROGRAM_ID = new PublicKey(
  '2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq'
);

async function findReputationPda(agentPubkey: PublicKey): Promise<PublicKey> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), agentPubkey.toBytes()],
    HOLDFAST_PROGRAM_ID,
  );
  return pda;
}

const reputationPda = await findReputationPda(wallet.publicKey);
```

---

## Combining off-chain pre-flight with on-chain enforcement

The recommended pattern is to run the SDK check before building the transaction, then let the CPI enforce it on-chain. This gives users an early, readable error without paying the transaction fee:

```typescript
async function submitServiceRequest(
  agentPubkey: PublicKey,
  requirements: ReputationRequirements,
): Promise<string> {
  // 1. Off-chain pre-flight — cheap, readable error
  const qualified = await client.reputation.meetsRequirements(
    agentPubkey,
    requirements,
  );
  if (!qualified) {
    const rep = await client.reputation.get(agentPubkey).catch(() => null);
    throw new Error(
      rep
        ? `Reputation check failed: score=${rep.score}, tier=${VerifTier[rep.tier]}, pacts=${rep.totalPacts}`
        : 'Agent has no reputation account'
    );
  }

  // 2. Build and submit the transaction — on-chain enforcement is the final gate
  const reputationPda = await findReputationPda(agentPubkey);
  const tx = await myProtocol.methods
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

  return tx;
}
```

---

## Score interpretation reference

| Score range | Interpretation |
|---|---|
| `8000–10000` | Excellent — long track record, rare or no disputes |
| `6000–7999` | Good — above neutral, reasonable history |
| `5000–5999` | Neutral — new or recovering agent |
| `3000–4999` | Below neutral — recent disputes or cancellations |
| `0–2999` | Poor — significant dispute history or decay |

A score of `5000` is assigned at account initialisation. Time-decay applies automatically: an idle agent's score drifts toward `5000` over time.

---

## Changelog

| Date | Change |
|---|---|
| 2026-04-22 | Initial guide (CAS-287) |
