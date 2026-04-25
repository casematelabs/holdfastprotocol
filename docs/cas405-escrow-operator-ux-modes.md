# CAS-405 · Escrow Operator UX Modes: Task, Milestone, and Timed

> **Status:** Draft — Head of Product  
> **Date:** 2026-04-23  
> **Relates to:** [CAS-323](/CAS/issues/CAS-323) (escrow activity wireframe), [CAS-152](/CAS/issues/CAS-152) (dispute resolution)

---

## 1. Overview

The Holdfast escrow program supports three release trigger types controlled by the `releaseCondition.kind` field at pact creation. The operator-facing UX for each mode is currently undefined and the dashboard create-pact flow is MVP single-mode. This spec defines:

- When to use each mode
- Operator decision tree
- On-chain parameters per mode
- Step-by-step UI flow per mode
- Acceptance criteria for the multi-mode create-pact wizard
- Mode-aware filtering requirements for the escrow activity view (CAS-323)

---

## 2. Mode Summary

| Mode | Release trigger | Arbiter required | Auto-release | Use when |
|---|---|---|---|---|
| **Task** | Initiator calls `releasePact` manually | No (optional for dispute) | No | Discrete deliverable, binary completion |
| **Milestone** | Arbiter calls release after confirming milestone(s) | Yes | No | Multi-stage work, phased payments |
| **Timed** | `auto_release` crank fires at `timeLockExpiresAt` | No (optional) | Yes | Time-boxed services, subscriptions, retainers |

On-chain distinction: Task and Milestone both set `auto_release_on_expiry = false`. Timed sets `auto_release_on_expiry = true`. Task vs Milestone is differentiated by whether an arbiter address is set at creation — however, this is a convention enforced by the SDK/UI, not a hard on-chain constraint. See [§8](#8-known-gaps) for implications.

---

## 3. When to Use Each Mode

### 3.1 Task-based

**Best for:** A single, clearly-defined deliverable where both parties can agree on completion. The initiator holds release authority — they review the output and call release when satisfied. If they don't release, the beneficiary cannot claim funds without opening a dispute.

**Examples:**
- Agent A hires Agent B to process a batch of documents and return results.
- An operator commissions a one-time data feed integration.
- A code audit with a defined scope and pass/fail outcome.

**Key property:** No automatic release. If the initiator goes offline or refuses to release, the beneficiary must raise a dispute. An arbiter is optional at pact creation; if omitted, dispute escalation falls back to the protocol's default resolution path.

**Risk:** Initiator has full unilateral hold on release. Suitable only when the initiator is trusted to act in good faith, or when a reputation threshold is enforced.

### 3.2 Milestone-based

**Best for:** Multi-stage work where payments are gated on verified progress. Each milestone is a separate pact — the current program does not support multiple tranches within a single escrow account. The arbiter confirms milestone completion on-chain and triggers release.

**Examples:**
- A three-phase development project (design, build, test), with each phase as a separate pact.
- Content production with staged review gates (outline approved → draft approved → final).
- Agent training runs where each checkpoint is independently verified.

**Key property:** Requires an explicitly named arbiter at pact creation. The arbiter is the trusted third party who calls `releasePact` on behalf of both parties after verifying the milestone. Neither initiator nor beneficiary can release unilaterally without the arbiter's involvement.

**Implementation note for multi-milestone flows:** Until the program supports tranche accounts natively, operators should create a separate pact per milestone with the same arbiter. The UI should provide a "linked pacts" grouping UI to surface this as a logical batch (tracked in [CAS-323](/CAS/issues/CAS-323) advanced escrow activity).

### 3.3 Timed

**Best for:** Time-boxed engagements where the passage of time is itself the acceptance criterion. If the beneficiary delivers service throughout the period and no dispute is raised, funds auto-release at expiry.

**Examples:**
- A monthly infrastructure management retainer.
- A 30-day monitoring or on-call service agreement.
- Agent subscription models (recurring pacts with rolling expiry).

**Key property:** Auto-release fires via an off-chain crank (the beneficiary, a keeper, or the SDK's `auto_release` instruction) at or after `timeLockExpiresAt`. The SDK does not trigger the crank automatically — the operator or beneficiary must call `client.escrow.autoRelease(escrowId)` after expiry, or integrate a keeper service. The 7-day dispute window still applies after release.

> **Keeper requirement — action required for every timed pact.**
> Without a keeper, a timed pact in `Locked` status stays locked indefinitely after expiry. Funds are not lost but the beneficiary cannot claim them until `auto_release` is submitted on-chain. For devnet, run the reference keeper script (`holdfast/scripts/auto-release-keeper.ts`). For production, consider a monitored process or Holdfast-operated keeper (roadmap item). Document this requirement to counterparties at pact creation — the dashboard wizard (§6.1 timed fields) must display this notice prominently.

---

## 4. Operator Decision Tree

```
Is the deliverable a discrete, pass/fail output?
├─ YES → Is there a trusted neutral third party available?
│         ├─ YES (and you want their sign-off) → MILESTONE
│         └─ NO / initiator decides alone → TASK
└─ NO → Is the work time-boxed (hours, days, months)?
          ├─ YES → TIMED
          └─ NO (complex, negotiated) → TASK with arbiter recommended
```

**Quick heuristic:**
- "I'll know it when I see it" → **Task**
- "Phase complete when arbiter says so" → **Milestone**
- "Just run for 30 days" → **Timed**

---

## 5. On-Chain Parameters Per Mode

All three modes share common `createPact` parameters. Mode-specific parameters are noted below.

### 5.1 Common parameters (all modes)

| Parameter | Required | Notes |
|---|---|---|
| `counterparty` | Yes | Beneficiary pubkey |
| `counterpartyWallet` | Yes | Beneficiary's AgentWallet PDA |
| `mint` | Yes | SPL token mint (wSOL = `So11...112`) |
| `amount` | Yes | Escrow amount in base units |
| `releaseCondition` | Yes | Mode selector + `timeLockExpiresAt` |
| `stakes.initiator` | No | Initiator skin-in-the-game. Slashed on dispute loss if `slashLoserStake: true` |
| `stakes.beneficiary` | No | Beneficiary skin-in-the-game |
| `slashLoserStake` | No | Default `false`. Set `true` only when stakes are non-zero and arbiter is present |
| `deliverablesHash` | No | SHA-256 of off-chain deliverables spec (recommended for milestone) |
| `deliverablesUri` | No | IPFS/Arweave URI for deliverables (max 128 bytes on-chain) |
| `reputationThreshold` | No | Min score, tier, pact count enforced on-chain |
| `disputeDeadlineSecs` | No | Arbiter resolution window. Default 7 days (604800s). Min 3600s |

### 5.2 Task-specific

```typescript
releaseCondition: {
  kind: "task",
  timeLockExpiresAt: number, // Unix seconds — pact must be locked before this time
}
```

- `auto_release_on_expiry = false` on-chain
- `arbiter` / `arbiterWallet`: optional. Include if you want a named dispute arbiter. If omitted, disputes escalate to the protocol default.
- `timeLockExpiresAt`: Operator sets this as the work deadline. Both parties must lock the pact (call `lockEscrow`) before this timestamp. If not locked by then, `lockEscrow` fails with `TimeLockInPast (6002)`. After locking, this timestamp has no further effect — release is always manual.

**UI label:** "Work deadline (lock-by date)"

### 5.3 Milestone-specific

```typescript
releaseCondition: {
  kind: "milestone",
  timeLockExpiresAt: number, // Must be locked before this time
}
arbiter: PublicKey,         // Required
arbiterWallet: PublicKey,   // Required
```

- `auto_release_on_expiry = false` on-chain
- Arbiter is **required**. The UI must enforce this — disable the "Create pact" button if mode is Milestone and no arbiter is set.
- `slashLoserStake: true` is recommended for high-value milestone pacts where stakes are set.
- `deliverablesHash` + `deliverablesUri` are strongly recommended so the arbiter has an immutable reference to the milestone criteria.
- `timeLockExpiresAt`: Same lock-by-date semantics as task mode. Set to the milestone completion deadline.

**UI label:** "Milestone deadline (lock-by date)"

### 5.4 Timed-specific

```typescript
releaseCondition: {
  kind: "timed",
  timeLockExpiresAt: number, // Unix seconds — auto-release fires at or after this time
}
```

- `auto_release_on_expiry = true` on-chain
- `timeLockExpiresAt` here is the **auto-release date**, not just a lock-by deadline.
- Both parties must still lock the pact before `timeLockExpiresAt` (same `TimeLockInPast` validation applies at lock time). Operators should set this well in advance of engagement start.
- After `timeLockExpiresAt` passes, the beneficiary (or a keeper) calls `auto_release`. Dashboard should surface a "Trigger release" CTA when the pact is in `Locked` status and `now >= timeLockExpiresAt`.
- 7-day dispute window still applies after auto-release.

**UI label:** "Auto-release date"

---

## 6. UI Flow Per Mode

### 6.1 Create-pact wizard — step flow

The wizard uses a 3-step layout. Step 2 is mode-aware.

**Step 1: Counterparty & Amount** (shared across all modes)
- Counterparty wallet address (with reputation preview)
- Token mint selector (wSOL pre-selected)
- Escrow amount
- Optional: initiator stake, beneficiary stake, slash-loser-stake toggle (enabled only when both stakes > 0)

**Step 2: Mode Selection & Configuration**

The mode selector renders three cards:

```
[ Task ]  [ Milestone ]  [ Timed ]
```

Each card shows a one-line description and the key tradeoff (see §3). Selecting a card reveals the mode-specific fields:

*Task selected:*
- Work deadline (date picker → `timeLockExpiresAt`)
- Optional: Arbiter wallet address
- Optional: Deliverables URI

*Milestone selected:*
- Milestone deadline (date picker → `timeLockExpiresAt`)
- Arbiter wallet address (required, validated)
- Deliverables hash or URI (strongly recommended — show advisory if omitted)
- Optional: Deliverables URI

*Timed selected:*
- Auto-release date (date picker → `timeLockExpiresAt`)
  - Warning if date is less than 24h from now
- Optional: Deliverables URI
- Keeper notice: "Auto-release requires an on-chain crank. Ensure your integration calls `autoRelease()` at expiry, or configure a keeper."

**Step 3: Review & Sign**
- Summary of all parameters
- SDK call preview (collapsed by default, expandable)
- "Create pact" button → calls `client.escrow.createPact()` → shows tx signature on success

### 6.2 Post-creation flow (all modes)

After pact creation:
1. Dashboard navigates to the new pact detail page (or opens a side panel).
2. Pact is in `Pending` status. Initiator deposits via "Fund escrow" button → `depositEscrow`.
3. Status advances to `Funded`. Beneficiary is notified (off-chain, e.g. via integration).
4. Beneficiary stakes → `stakeBeneficiary`.
5. Both parties sign the lock transaction → `lockEscrow`.
6. Status advances to `Locked`.

### 6.3 Release flow per mode (post-lock)

**Task:**
- Initiator sees "Release funds" button once pact is `Locked`.
- On click: confirmation modal → `releasePact` → status `Released`.
- 7-day dispute window shown on pact detail with countdown.
- After window: beneficiary sees "Claim" button → `claimReleased`.

**Milestone:**
- Arbiter sees "Confirm milestone & release" button (requires arbiter wallet connected).
- Either party can see the deliverables URI/hash for reference.
- On arbiter action: `releasePact` (called by arbiter from their connected wallet) → `Released`.
- Same 7-day dispute window applies.

**Timed:**
- Pact detail shows countdown to `timeLockExpiresAt`.
- When `now >= timeLockExpiresAt` and status is `Locked`: dashboard shows "Trigger auto-release" button for beneficiary (or any connected wallet if keeper mode).
- On click: `autoRelease(escrowId)` → `Released`.
- Same 7-day dispute window applies.
- If pact is in `Locked` and `timeLockExpiresAt` has not passed: show time remaining, no release action available.

---

## 7. Create-Pact Wizard: Acceptance Criteria

### 7.1 Mode selection
- [ ] Wizard step 2 renders three mode cards: Task, Milestone, Timed.
- [ ] Each card shows: mode name, one-line description, key tradeoff.
- [ ] Exactly one mode can be selected at a time. Default: Task.
- [ ] Mode-specific fields are shown only for the selected mode.

### 7.2 Task mode fields
- [ ] "Work deadline" date picker is required. Must be at least 1h in the future.
- [ ] Arbiter wallet address is optional.
- [ ] Deliverables URI is optional (max 200 chars, validated as URL).

### 7.3 Milestone mode fields
- [ ] "Milestone deadline" date picker is required. Must be at least 1h in the future.
- [ ] Arbiter wallet address is required. "Create pact" is disabled until a valid address is entered.
- [ ] Advisory banner shown if neither `deliverablesHash` nor `deliverablesUri` is provided.
- [ ] Deliverables URI is optional (same validation as task).

### 7.4 Timed mode fields
- [ ] "Auto-release date" date picker is required. Must be at least 1h in the future.
- [ ] Warning shown if auto-release date is less than 24h from now.
- [ ] Static keeper advisory shown explaining the crank requirement.

### 7.5 Shared validation
- [ ] `timeLockExpiresAt` in the past: form shows an inline error, "Create pact" is disabled.
- [ ] `amount` must be > 0.
- [ ] If `slashLoserStake: true`, both `stakes.initiator` and `stakes.beneficiary` must be > 0.
- [ ] If `slashLoserStake: true` and mode is Task with no arbiter: show advisory "Slash requires an arbiter to resolve disputes."

### 7.6 Review step
- [ ] Mode label shown prominently in the summary ("Release mode: Task / Milestone / Timed").
- [ ] `timeLockExpiresAt` shown as human-readable date ("Work deadline: May 1, 2026 12:00 UTC").
- [ ] Arbiter address shown if set.
- [ ] Deliverables URI shown if set.
- [ ] SDK call preview expandable panel shows the exact `createPact` call with all parameters.

### 7.7 Success state
- [ ] On successful creation: toast with "Pact created" + tx explorer link.
- [ ] Navigates to pact detail page (or refreshes escrow activity list).
- [ ] Pact appears in activity view with correct mode badge.

---

## 8. Escrow Activity View: Mode-Aware Filtering (CAS-323 Update)

The current activity view (`app/dashboard/escrow/page.tsx`) has no mode column or filter. The following additions are required:

### 8.1 Mode badge in pact row

Add a "Mode" column to the active and completed pact tables:

| Badge | Color | Condition |
|---|---|---|
| `TASK` | `#8A99AC` (neutral) | `releaseKind === "task"` |
| `MILESTONE` | `#9F6BFF` (purple) | `releaseKind === "milestone"` |
| `TIMED` | `#F59E0B` (amber) | `releaseKind === "timed"` |

**Data requirement:** The indexer must expose `releaseKind` (or `autoReleaseOnExpiry` + `arbiterSet`) on pact list responses. The current `EscrowAccount` SDK type does not include this field. Add `releaseKind: "task" | "milestone" | "timed"` to the indexer API response and the SDK's `EscrowAccount` type. Until this ships, the badge can be omitted (not show "unknown").

### 8.2 Mode filter

Add a filter control to the escrow activity header row:

```
[ All modes ▾ ]  [ Task ]  [ Milestone ]  [ Timed ]
```

Filter is applied client-side on the pact list. If mode is not yet available from the indexer, the filter is disabled with a tooltip "Mode filtering available after indexer update."

### 8.3 Timed-mode expiry warning

For `Timed` pacts in `Locked` status where `timeLockExpiresAt < now + 24h`:
- Show a subtle amber row background tint.
- Show "Expiring soon" tag in the mode badge column.

For `Timed` pacts in `Locked` status where `timeLockExpiresAt < now`:
- Show "Release ready" CTA in the row actions column.

### 8.4 Milestone grouping (future)

When multiple pacts share the same arbiter and were created within the same 24h window:
- Group them under a collapsed "Milestone series" row in the activity list.
- Expand to show individual milestone pacts with their statuses.
- This is a post-MVP enhancement; do not block the initial mode filter on it.

---

## 9. Known Gaps

| Gap | Impact | Resolution |
|---|---|---|
| `EscrowAccount` SDK type lacks `releaseKind` field | Cannot surface mode in dashboard without indexer addition | Add to indexer response + SDK type. Track separately. |
| Auto-release requires manual crank | Timed pacts silently fail to release if no keeper runs | Reference keeper script ships at `holdfast/scripts/auto-release-keeper.ts` (CAS-459). Quickstart documents keeper setup as a required step. Future: `client.escrow.autoRelease()` SDK method + Holdfast-operated keeper endpoint. |
| Milestone multi-tranche requires multiple pacts | UX complexity for operators | Dashboard "linked pacts" grouping (§8.4, future). |
| Task with no arbiter and expired `timeLockExpiresAt` | Beneficiary has no recourse except `openDispute` with protocol default resolution | Advise minimum dispute deadline in wizard. |

---

## 10. Out of Scope (for this spec)

- Arbiter registry / discovery UI — arbiter addresses entered manually for now.
- Recurring timed pacts (auto-renewal on expiry) — protocol does not support this.
- Token-2022 support — blocked until SDK v0.3.
- Partial releases within a single escrow account — not supported on-chain; use multiple pacts.
