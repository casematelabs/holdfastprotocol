# CAS-459: Timed Escrow Auto-Release — Keeper Strategy and Operator Documentation

**Status:** Draft  
**Owner:** Head of Product  
**Last updated:** 2026-04-24

---

## Background

Timed escrow pacts (`releaseCondition.kind === "timed"`) rely on an off-chain keeper to fire the on-chain `auto_release` instruction once `timeLockExpiresAt` has passed. The program enforces `now > time_lock_expires_at` (strict `>`), so no early release is possible; but nothing on-chain triggers the call automatically — an external crank must do it.

Two outcomes are possible depending on `PactRecord.auto_release_on_expiry`:

| `auto_release_on_expiry` | Result | Effect |
|---|---|---|
| `true` | `Released` | 7-day dispute window opens; funds stay in vault until `claim_released` |
| `false` | `Refunded` | Immediate CPI refund: initiator recovers `escrow_amount + initiator_stake`; beneficiary recovers `beneficiary_stake` |

**Who can call it?** Any funded wallet after expiry. The cranker account is `[signer, writable]` and pays the Solana transaction fee.

---

## Architecture Options

### Option A — Beneficiary-Side Self-Keeper (Recommended for devnet / early mainnet)

The beneficiary (or their agent) runs the keeper script themselves. The reference implementation is at `holdfast/scripts/auto-release-keeper.ts`.

**How it works:**
1. Keeper polls the Holdfast indexer every N seconds for all `Locked` pacts where the caller is the beneficiary.
2. Filters for `timeLockExpiresAt <= now`.
3. Fires `auto_release` for each candidate.

**Advantages:**
- Zero protocol infrastructure required.
- Beneficiary has direct economic motivation to call promptly.
- Composable: can be embedded in agent frameworks (ElizaOS, SAK) as a background task.

**Disadvantages:**
- Relies on operator uptime. If the beneficiary's keeper is down at expiry, release is delayed until they come back.
- Requires a funded keeper keypair.
- SDK `autoRelease()` method is not yet implemented — keeper must construct the instruction manually using the anchor discriminator pattern (see reference script, lines 130–146).

**Gap to close (CAS-460 or sub-task):** Add `autoRelease(escrowId)` to `EscrowModule` in `holdfast/sdk/src/escrow/index.ts` so keepers don't need manual discriminator construction.

---

### Option B — Initiator-Side Keeper

Same pattern as Option A but run by the initiator. Useful when `auto_release_on_expiry = false` (auto-refund path) — the initiator has motivation to reclaim their stake promptly.

**Note:** For the auto-release path (`auto_release_on_expiry = true`), the beneficiary is better motivated to run the keeper since the release opens their claim window.

---

### Option C — Protocol-Operated Crank (Future / mainnet)

Casemate Labs runs a shared keeper service that monitors all `Locked` timed pacts across all operators. It calls `auto_release` on behalf of the network.

**Advantages:** Zero operator setup; guaranteed liveness independent of beneficiary uptime.

**Disadvantages:**
- Requires protocol infrastructure (keeper service, funded fee wallet).
- Centralisation risk — a single point of failure for all timed pacts.
- Fee wallet maintenance and monitoring overhead.
- Not recommended until keeper activity volume justifies the cost.

**Recommendation:** Ship Option A for devnet and early mainnet. Design Option C as an opt-in overlay for high-value pacts in a future milestone. Operators wanting guaranteed liveness should run their own keeper (Option A/B) regardless.

---

### Option D — Third-Party Keeper Network (Future)

Use an existing Solana keeper network (e.g., a Clockwork/temporal-style cron, or a custom Jito bundle hook) to trigger `auto_release` at the right slot.

**Advantages:** Decentralised liveness; no Casemate infrastructure.

**Disadvantages:**
- Adds an external protocol dependency.
- Integration complexity for operators.
- Most Solana cron services are experimental or deprecated.

**Recommendation:** Do not pursue for devnet. Revisit after mainnet if protocol-operated crank proves burdensome.

---

## Recommended Approach

**Devnet and early mainnet: Option A (beneficiary-side self-keeper).**

Operators who create timed pacts are responsible for running a keeper. The reference script is the canonical implementation. The spec and runbook below document exactly how to operate it.

This defers infrastructure cost and centralisation risk while giving operators the control they need. A protocol-run crank (Option C) can be layered on top later without changing the on-chain program.

---

## Operator Runbook

### Prerequisites

| Requirement | Detail |
|---|---|
| Node.js | ≥ 18 |
| Funded devnet wallet | Needs ≥ 0.1 SOL for transaction fees |
| AgentWallet PDA | Your registered keeper/beneficiary PDA — obtain from `holdfast agent register` |
| Indexer access | Holdfast indexer endpoint (devnet default: `https://holdfast-indexer.fly.dev`) |

---

### Step 1: Set Up a Keeper Keypair

Use an existing devnet keypair or generate a dedicated one:

```bash
solana-keygen new --outfile ~/.config/solana/keeper.json
solana airdrop 1 ~/.config/solana/keeper.json --url devnet
```

Keep this keypair funded. At ~5,000 lamports per `auto_release` transaction, 0.05 SOL covers ~10,000 releases. Set up an alert if the balance drops below 0.02 SOL.

---

### Step 2: Configure Environment Variables

Create a `.env` file or export these in your shell:

```bash
# Required
KEEPER_AGENT_WALLET=<your-AgentWallet-PDA-base58>

# Optional (defaults shown)
KEEPER_KEYPAIR_PATH=~/.config/solana/devnet.json  # Use dedicated key in production
RPC_URL=https://api.devnet.solana.com
INDEXER_URL=https://holdfast-indexer.fly.dev
POLL_INTERVAL_SECS=300          # 5 minutes; reduce for time-sensitive pacts
DRY_RUN=0                       # Set to 1 to test without submitting transactions
```

**`KEEPER_AGENT_WALLET`** is the AgentWallet PDA of the beneficiary whose pacts this keeper manages. The indexer query is scoped to this address (`/v1/agents/:beneficiaryPubkey/escrow/pacts?status=2`).

---

### Step 3: Dry-Run Test

Before going live, run with `DRY_RUN=1` to confirm the keeper can reach the indexer and identify candidates:

```bash
DRY_RUN=1 \
KEEPER_AGENT_WALLET=<your-pda> \
KEEPER_KEYPAIR_PATH=~/.config/solana/keeper.json \
npx ts-node --transpile-only holdfast/scripts/auto-release-keeper.ts
```

Expected output for a candidate pact:
```
[DRY RUN] Would fire auto_release for pact <address> (expired <N>s ago)
```

---

### Step 4: Run the Keeper

**One-shot (manual / CI):**

```bash
KEEPER_AGENT_WALLET=<your-pda> \
KEEPER_KEYPAIR_PATH=~/.config/solana/keeper.json \
npx ts-node --transpile-only holdfast/scripts/auto-release-keeper.ts
```

**Long-running daemon (recommended):**

The keeper script loops internally at `POLL_INTERVAL_SECS`. Run it as a background process via `pm2` or a systemd unit:

```bash
# pm2 example
pm2 start "npx ts-node --transpile-only holdfast/scripts/auto-release-keeper.ts" \
  --name holdfast-keeper \
  --env KEEPER_AGENT_WALLET=<pda> \
  --env KEEPER_KEYPAIR_PATH=~/.config/solana/keeper.json \
  --restart-delay 5000

pm2 save
pm2 startup
```

---

### Step 5: Verify a Successful Release

After the keeper fires, confirm the pact transitioned:

```bash
# Via SDK
holdfast escrow status <escrow-id>
# Expected: status = Released (3) or Refunded (5)

# Via indexer
curl https://holdfast-indexer.fly.dev/v1/escrow/<address>
# Check: "status": 3 and "releasedAt": <timestamp>
```

If `auto_release_on_expiry = true`, the beneficiary can now call `claim_released` after the 7-day dispute window (`disputeWindowEndsAt`).

---

### Monitoring and Alerting

| What to monitor | Signal | Suggested alert |
|---|---|---|
| Keeper wallet balance | SOL balance on `KEEPER_KEYPAIR_PATH` wallet | Alert if < 0.02 SOL |
| Pact backlog | Count of Locked pacts with `timeLockExpiresAt < now` via indexer | Alert if > 0 for more than `2 × POLL_INTERVAL_SECS` |
| Keeper process health | pm2 / systemd status | Alert on restart or crash |
| Failed transactions | Keeper logs `[ERROR]` lines | Alert on repeated failures for same pact |

The indexer emits a `pact_auto_released` event when `auto_release` succeeds. Subscribe to this via indexer webhooks (if available) as an alternative to polling.

---

### Troubleshooting

**`InvalidEscrowStatus` error:**  
The pact is not in `Locked` status. It may have been manually released, disputed, or already auto-released by another keeper. Ignore.

**`TimeLockNotExpired` error:**  
Clock skew between your system and on-chain `Clock::get()`. The program uses a strict `>` check. Wait a few seconds and retry.

**`NotTimedPact` error (if returned):**  
The pact's `auto_release_on_expiry` is `false`, meaning it will auto-refund rather than release. The keeper handles both paths — this may indicate a pact that was not configured for auto-release. Check the pact configuration.

**Pacts not appearing in indexer response:**  
Confirm `KEEPER_AGENT_WALLET` matches the `beneficiary` field on the escrow. The indexer scopes results to this PDA.

**Transaction simulation fails:**  
Run `DRY_RUN=1` first to confirm candidate selection, then check the RPC endpoint is healthy and the keeper wallet has SOL.

---

## SDK Gap: `autoRelease()` Method

The on-chain instruction is deployed and tested. The SDK does not yet expose a typed `autoRelease(escrowId)` method — the keeper script constructs the instruction manually.

**Required fields for the `auto_release` instruction:**

| Account | Role | Constraint |
|---|---|---|
| `cranker` | Signer, writable | Pays fee; any funded wallet |
| `escrowPda` | Writable | Derived from `escrowId`; must be `Locked` |
| `pactPda` | Readonly | Derived from `pactRecord` field on escrow |
| `crankerWallet` | Readonly | Cranker's AgentWallet PDA |

Discriminator: `sha256("global:auto_release")[0..8]`.

**Recommendation:** Create a sub-task to implement `EscrowModule.autoRelease(escrowId: string): Promise<TransactionSignature>` in `holdfast/sdk/src/escrow/index.ts`. This is a straightforward wrapper and should be added before any external integrations rely on the keeper pattern, to avoid the manual discriminator construction spreading across operator codebases.

---

## Open Questions

1. **Fee recovery:** Should the protocol reimburse keeper transaction fees from a protocol fee pool? Not needed for devnet, but worth designing before mainnet if protocol-operated crank is introduced.
2. **Multi-beneficiary keepers:** Should the reference keeper support watching pacts across multiple `KEEPER_AGENT_WALLET` addresses? Current design is single-agent-wallet scoped.
3. **Dispute window claim reminder:** Should the keeper (or a companion script) also fire `claim_released` reminders after `disputeWindowEndsAt`? Separate concern but related to the same operator setup.
