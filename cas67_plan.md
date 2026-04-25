# Agent Operator Dashboard — MVP Product Spec

**Issue:** [CAS-67](/CAS/issues/CAS-67)
**Protocol:** Holdfast Protocol
**Phase:** Devnet (Q3 2026)
**Author:** Head of Product
**Date:** 2026-04-19
**Status:** Draft — pending CTO sign-off on data availability

---

## 1. Problem Statement

Holdfast Protocol has no operator-facing interface. Operators running AI agents on the protocol today have zero visibility into their agent's trust state, pact activity, or custody configuration without writing custom RPC scripts. This means:

- Operators cannot quickly diagnose why a pact is stuck or disputed
- There is no trust signal surface to show counterparties before accepting a pact
- Devnet onboarding is opaque — new operators cannot confirm their registration succeeded

The dashboard MVP closes this gap before the devnet public announcement.

---

## 2. User

**Primary:** AI agent operator — a developer or organisation deploying an autonomous agent on Holdfast Protocol. They own the agent wallet, configure pact parameters, and are responsible for monitoring protocol activity on behalf of their agent.

**Not in scope for MVP:** End-users (human principals interacting with a pact), multi-agent org admins, or Casemate Labs internal monitoring.

---

## 3. Core Principle

> A new agent operator can onboard and reach their first meaningful read of reputation state in under 5 minutes.

Every feature decision should be tested against this. If it adds complexity without serving that goal, it is deferred.

---

## 4. Page Structure

```
/dashboard (root — redirects to /dashboard/reputation)
├── /dashboard/reputation        — Reputation & trust state
├── /dashboard/escrow            — Pact / escrow activity
├── /dashboard/custody           — Wallet & attestation
└── /dashboard/protocol-health   — Oracle & indexer status
```

Navigation: persistent left-hand sidebar with four items matching the routes above. Current network (DEVNET) permanently displayed in the top bar as a coloured badge — no toggle.

---

## 5. Feature Specifications

### 5.1 Reputation Visibility (P0)

**Route:** `/dashboard/reputation`

**Purpose:** Surfaces the agent's on-chain trust score and tier so operators and counterparties can evaluate pact eligibility.

#### 5.1.1 Score & Tier Card

| Field | Description | Data Source |
|---|---|---|
| Current score | Integer 0–1000 | Off-chain indexer: `GET /agents/{pubkey}/reputation` |
| Tier | Bronze / Silver / Gold / Platinum | Derived from score thresholds (see §5.1.4) |
| Tier badge | Colour-coded pill | Derived |
| Pre-flight status | Pass / Fail / Unknown | Derived from configurable thresholds (see §5.1.5) |

Displayed as a prominent hero card at the top of the page. Tier badge uses colour tokens: Bronze #CD7F32, Silver #C0C0C0, Gold #FFD700, Platinum #E5E4E2.

#### 5.1.2 Score History Sparkline

Two sparklines side by side:
- **30-day:** daily score snapshots, last 30 calendar days
- **90-day:** weekly score snapshots, last 90 calendar days

Data: off-chain indexer, paginated history endpoint. If fewer than 3 data points exist, render a placeholder stating "Insufficient history — score data will appear after your agent completes its first pacts."

#### 5.1.3 Activity Metrics

| Metric | Description | Data Source |
|---|---|---|
| Total pact count | All-time pacts involving this agent | Indexer |
| Dispute rate | Disputes / total pacts (%) | Indexer |
| Last oracle update | Timestamp of last reputation oracle write | On-chain RPC: reputation account `lastUpdated` field |

Rendered as three stat tiles below the score card.

#### 5.1.4 Tier Thresholds (hardcoded for MVP)

| Tier | Min Score |
|---|---|
| Bronze | 0 |
| Silver | 300 |
| Gold | 600 |
| Platinum | 850 |

These are protocol constants — not operator-configurable.

#### 5.1.5 Pre-flight Indicator

Operators can configure two threshold values (stored in browser localStorage for MVP, no backend required):
- Minimum score required
- Minimum tier required

The indicator shows Pass (green) / Fail (red) / Not configured (grey). Fail state should surface a plain-language explanation: "Your agent's current score (210) is below your configured minimum (300). Counterparties using this threshold may reject pact requests."

---

### 5.2 Escrow Activity (P0)

**Route:** `/dashboard/escrow`

**Purpose:** Real-time view of pact lifecycle — what is active, what has settled, and what is disputed.

#### 5.2.1 Active Pacts Table

Columns:
| Column | Description |
|---|---|
| Counterparty | Truncated agent pubkey (first 4 + last 4 chars), with copy-to-clipboard |
| Amount | SOL or SPL token amount with token symbol |
| Status | Deposited / Released / Disputed |
| Release condition | Task / Milestone / Timed |
| Age | Time since pact creation (relative, e.g. "3d ago") |
| Action | Link to Solana Explorer (devnet) for the pact account |

Sortable by Amount and Age. Default sort: Age descending (newest first).
No pagination for MVP — show all active pacts (operators are expected to have <50 active pacts on devnet).

**Status colour coding:** Deposited = blue, Released = green, Disputed = red.

#### 5.2.2 Recent Completed Pacts

Collapsible panel beneath the active table. Shows last 20 completed pacts.

Columns: Counterparty, Amount, Outcome (Settled / Disputed-resolved / Cancelled), Completed at.

Outcome "Disputed-resolved" means the pact went through the dispute path but reached a final settlement.

#### 5.2.3 Open Disputes

If any active pacts have status Disputed, a priority alert banner appears at the top of the page:

> **{N} open dispute(s)** — Time-lock expires in {countdown}. Review required.

Clicking the banner scrolls to the active pacts table filtered to Disputed rows. The countdown is derived from the on-chain time-lock expiry field in the pact account.

Data: on-chain RPC for dispute state + time-lock; indexer for pact list.

---

### 5.3 Custody Monitoring (P1)

**Route:** `/dashboard/custody`

**Purpose:** Confirms the agent wallet is correctly registered and attested, surfaces key rotation history for audit.

#### 5.3.1 Registration Status Card

| Field | Description | Data Source |
|---|---|---|
| Status | Registered / Unregistered / Revoked | On-chain RPC: custody registry account |
| Attestation level | Hardware-attested / Software-attested / None | On-chain account field |
| Registered at | Timestamp of registration transaction | Indexer or on-chain account |
| Registration tx | Solana Explorer link (devnet) | Indexer |

Attestation level badge: Hardware = green, Software = yellow, None = red.

"Unregistered" state shows a CTA: "Register your agent wallet" with a link to the Holdfast Protocol SDK docs (registration guide URL TBD — leave as placeholder for now).

#### 5.3.2 Key Rotation History

Table of past key rotation events. Columns: Rotation date, New pubkey (truncated), Rotation transaction (Explorer link).

Empty state: "No key rotations recorded." — this is the expected state for most devnet operators.

---

### 5.4 Protocol Health (P1)

**Route:** `/dashboard/protocol-health`

**Purpose:** Surfaces the liveness of the protocol infrastructure so operators can distinguish agent-level issues from protocol-level outages.

#### 5.4.1 Oracle Node Status

| Field | Description |
|---|---|
| Uptime (24h) | Percentage of the last 24h the oracle was responsive |
| Last seen | Timestamp of last oracle heartbeat |
| Status | Online / Degraded / Offline |

Status derivation: Online if last-seen < 5 minutes ago, Degraded if 5–30 minutes, Offline if >30 minutes.

Data source: off-chain indexer health endpoint.

#### 5.4.2 Indexer Sync Lag

Single stat: "X blocks behind tip". Green if <100 blocks, yellow if 100–500, red if >500.

Data source: indexer self-reported lag metric.

#### 5.4.3 Recent On-Chain Events Feed

Last 10 protocol instructions executed (across all agents). Columns: Instruction type, Slot, Age, Tx link.

This is a read-only audit feed — not filtered to the operator's agent. Purpose is to confirm the protocol is live and processing.

Data source: indexer events endpoint.

---

## 6. Wallet Connection

MVP uses a standard Solana wallet adapter (Phantom / Backpack / Solflare). On connection, the dashboard derives all data from the connected wallet's public key.

No authentication beyond wallet signature. No backend session.

If wallet is not connected: show a prominent "Connect wallet" prompt and no data — do not mock or stub data.

---

## 7. Data Layer

| Data Type | Source | Notes |
|---|---|---|
| Reputation score & history | Off-chain indexer | [CAS-23](/CAS/issues/CAS-23) must expose `/agents/{pubkey}/reputation` |
| Pact list (active + recent) | Off-chain indexer | Indexer must support filtering by agent pubkey |
| Dispute state + time-lock | On-chain RPC | Direct account fetch — no indexer needed |
| Custody registry | On-chain RPC | Direct account fetch |
| Key rotation history | Off-chain indexer | May need new indexer event type |
| Oracle uptime | Indexer health endpoint | Endpoint may need to be created |
| Indexer sync lag | Indexer self-report | Standard node health endpoint |
| On-chain events feed | Off-chain indexer | Events endpoint |

**Rule:** No mocked or hardcoded state. If a data source is unavailable, show a "Data unavailable" empty state with the source name — do not substitute placeholder values.

---

## 8. Error & Empty States

Every data section must handle:

1. **Loading** — skeleton loaders, not spinners (preserves layout)
2. **No data** — descriptive empty state with next-action copy
3. **RPC/indexer error** — "Failed to load [section name]. Retry" with a retry button
4. **Wallet not connected** — single full-page prompt, no partial data shown

---

## 9. Acceptance Criteria

- [ ] A new operator connects their devnet wallet and reaches a meaningful read of their reputation score within 5 minutes of first visit
- [ ] All data is sourced from on-chain RPC or the off-chain indexer — no mocked state at any point
- [ ] The DEVNET label is permanently visible in the top bar throughout all pages
- [ ] Active pacts table renders correctly when the operator has 0, 1, and 10+ active pacts
- [ ] Disputed pacts surface the time-lock countdown correctly
- [ ] Pre-flight indicator correctly reflects configured thresholds
- [ ] Custody page shows "Unregistered" with CTA when the wallet has no registry account
- [ ] Protocol health correctly derives Oracle status from last-seen timestamp
- [ ] All RPC/indexer error states render without crashing the page

---

## 10. Out of Scope for MVP

- Multi-agent org views
- CSV or data export
- Notification / alert rules
- Mainnet vs devnet toggle
- Admin-level views (protocol governance, fee configuration)
- Mobile layout (desktop-first only for MVP)

---

## 11. Dependencies

| Dependency | Issue | Status | Notes |
|---|---|---|---|
| SDK reputation stubs | [CAS-22](/CAS/issues/CAS-22) | Done | Indexer endpoints should be available |
| Off-chain indexer | [CAS-23](/CAS/issues/CAS-23) | Done | Confirm pact list + key rotation event types exist |
| Escrow SDK stubs | TBD (to be created) | Not started | Required for pact status fields |
| Oracle health endpoint | None yet | Not started | Indexer team needs to expose uptime + last-seen |

**CTO sign-off checklist:**
- [ ] Confirm indexer exposes `/agents/{pubkey}/reputation` with history
- [ ] Confirm indexer exposes pact list filterable by agent pubkey
- [ ] Confirm indexer exposes key rotation event type
- [ ] Confirm oracle health / last-seen endpoint exists or can be added
- [ ] Confirm custody registry account schema matches P1 fields above

---

## 12. Implementation Sequence

Once this spec is accepted:

1. **API layer** — define and implement the frontend API client (RPC + indexer calls) for all data sections
2. **Reputation page** — P0, unblocked by [CAS-22](/CAS/issues/CAS-22)
3. **Escrow page** — P0, blocked on escrow SDK stubs (create ticket)
4. **Custody page** — P1, after reputation page ships
5. **Protocol health page** — P1, blocked on oracle health endpoint
6. **QA pass** — empty states, error states, devnet label, 5-minute onboarding test

---

## 13. Open Questions for CTO

1. **Indexer key rotation events:** Does [CAS-23](/CAS/issues/CAS-23) indexer currently track key rotation transactions? If not, this is a new indexer requirement that must be scoped before the Custody page can be built.
2. **Oracle health endpoint:** What format does the oracle expose for uptime/last-seen? This determines whether Protocol Health (P1) is a simple fetch or requires a new aggregation layer.
3. **Escrow SDK stubs:** What is the escrow pact account schema? The spec assumes SOL/SPL amount, status enum (deposited/released/disputed), release condition type, and time-lock field. CTO to confirm or correct.
4. **SPL token display:** For non-SOL pacts, do we show the raw mint address or a known-token list? MVP proposal: show mint address truncated; full token name lookup is post-MVP.
