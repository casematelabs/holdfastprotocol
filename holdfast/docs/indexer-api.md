# Holdfast Protocol — Indexer REST API Contract

**Version:** 1.2  
**Date:** 2026-04-22  
**Author:** Head of Product (CAS-286)  
**Status:** Approved — CTO final sign-off 2026-04-23  
**Unblocks:** [CAS-285](/CAS/issues/CAS-285) (dashboard data wiring)

> **Devnet only.** No authentication is required on devnet. Mainnet will add bearer-token auth on routes that expose wallet-specific data.

---

## Base URL

| Environment | Base URL |
|---|---|
| Devnet | `http://localhost:8080/v1` (local dev) / `https://indexer.devnet.holdfastprotocol.com/v1` (hosted devnet) |
| Mainnet (future) | `https://indexer.holdfastprotocol.com/v1` |

All responses are `Content-Type: application/json`.

---

## Conventions

### Pubkey format

All Solana pubkeys are base58-encoded strings. The path parameter `{pubkey}` refers to the agent's Ed25519 wallet keypair — the same address displayed in the dashboard.

### Timestamps

All timestamps are ISO 8601 strings in UTC: `"2026-04-22T10:30:00.000Z"`.

### Amounts

Token amounts are returned as `u64` lamport strings (not floats) in `amountLamports`, plus a convenience `amountSol: number` float. The API returns `amountSol` rounded to **6 decimal places** to preserve precision; dashboard pages format to at most 4 decimal places for display.

### Pagination

Offset-based with two optional query params: `limit` (default 20, max 100) and `offset` (default 0). All paginated responses include a `pagination` envelope:

```json
{
  "pagination": {
    "total": 142,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### Error format

All errors return a consistent envelope. HTTP status codes follow standard conventions (400 bad request, 404 not found, 429 rate limit, 500 internal).

```json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "No agent wallet found for pubkey 7xKX...",
    "details": {}
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_PUBKEY` | 400 | Path param is not a valid base58 pubkey |
| `AGENT_NOT_FOUND` | 404 | No `AgentWallet` PDA exists for this pubkey |
| `INVALID_PARAM` | 400 | Query param has wrong type or out-of-range value |
| `INTERNAL_ERROR` | 500 | Unexpected indexer failure |

---

## Endpoints

### 1. `GET /agents/{pubkey}/reputation`

Returns the current reputation score, tier, and historical sparkline data for the given agent. Consumed by the **Reputation** dashboard page.

#### Path parameters

| Param | Type | Description |
|---|---|---|
| `pubkey` | string | Agent's Ed25519 wallet pubkey (base58) |

#### Response `200 OK`

```json
{
  "pubkey": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "score": 612,
  "tier": "gold",
  "pactCount": 47,
  "disputeRate": 4.3,
  "lastOracleUpdate": "2026-04-22T10:26:00.000Z",
  "history30d": [540, 545, 552, 558, 563, 570, 575, 575, 578, 582, 585, 589, 592, 595, 598, 600, 598, 603, 605, 607, 608, 609, 610, 611, 612, 612, 613, 614, 612, 612],
  "history90d": [420, 425, 430, 438, 445, 450, 455, 462, 468, 474, 480, 485, 490, 495, 498, 500, 505, 510, 514, 518, 520, 522, 525, 527, 530, 533, 536, 540, 543, 547, 550, 553, 556, 558, 560, 563, 565, 568, 570, 573, 575, 578, 580, 582, 585, 587, 589, 590, 592, 594, 596, 598, 600, 601, 602, 603, 604, 606, 607, 608, 608, 609, 610, 610, 611, 611, 612, 612, 612, 613, 613, 614, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612, 612]
}
```

**Field notes:**

| Field | Type | Description |
|---|---|---|
| `score` | integer | Current reputation score, 0–1000 |
| `tier` | string | `bronze` (0–249), `silver` (250–499), `gold` (500–749), `platinum` (750–1000) |
| `pactCount` | integer | Total pacts this agent has participated in (all terminal statuses) |
| `disputeRate` | float | Percentage of pacts that entered dispute, expressed as a percentage (e.g. `4.3` means 4.3%) |
| `lastOracleUpdate` | ISO 8601 | Timestamp of the most recent on-chain reputation update |
| `history30d` | number[] | Array of **exactly 30** daily score snapshots, index 0 = 30 days ago, index 29 = today |
| `history90d` | number[] | Array of **exactly 90** daily score snapshots, index 0 = 90 days ago, index 89 = today |

History arrays MUST always contain exactly 30 and 90 entries. Pad with the earliest known score if data predates indexer history.

---

### 2. `GET /agents/{pubkey}/pacts`

Returns pacts for the given agent filtered by lifecycle status. Consumed by the **Escrow** dashboard page. Two primary call patterns are expected:

- `?status=active` — active pacts (all non-terminal statuses)
- `?status=completed&limit=20` — most recent completed pacts

#### Path parameters

| Param | Type | Description |
|---|---|---|
| `pubkey` | string | Agent's Ed25519 wallet pubkey (base58) |

#### Query parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | `active` | `active` or `completed` |
| `limit` | integer | 20 | Max records to return (1–100) |
| `offset` | integer | 0 | Pagination offset |

**Status mapping from on-chain `EscrowStatus` enum** (`holdfast/programs/vaultpact-escrow/src/state/escrow_account.rs`):

| `status` param | On-chain variants included | Discriminant |
|---|---|---|
| `active` | `Pending` | 0 |
| `active` | `Funded` | 1 |
| `active` | `Locked` | 2 |
| `active` | `Disputed` | 4 |
| `completed` | `Released` | 3 |
| `completed` | `Refunded` | 5 |
| `completed` | `Closed` | 6 |
| `completed` | `Claimed` | 7 |
| `completed` | `MutuallyCancelled` | 8 |

> **`Released` (3) in `completed`:** After `release_escrow` the pact enters a dispute window before the beneficiary can call `claim_released`. It is included in `completed` because no action is required from either party during this window — it displays in the dashboard history tab.
>
> **`resolve_dispute` outcome:** The `resolve_dispute` instruction transitions status to either `Released` (3) if the beneficiary wins, or `Refunded` (5) if the initiator wins — there is no separate `Resolved` status on-chain. The indexer may expose a `resolvedVia: "dispute"` flag on pacts that passed through `Disputed → Released/Refunded` for dashboard context.

#### Response `200 OK`

```json
{
  "pagination": {
    "total": 4,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  },
  "pacts": [
    {
      "id": "3GhJ8...kR2n",
      "escrowAddress": "3GhJ8mNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd",
      "counterparty": "AgXm9tg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosA4kRz",
      "role": "initiator",
      "amountLamports": "2500000000",
      "amountSol": 2.5,
      "mint": "So11111111111111111111111111111111111111112",
      "status": "disputed",
      "autoRelease": false,
      "createdAt": "2026-04-19T12:00:00.000Z",
      "lockedAt": "2026-04-19T13:30:00.000Z",
      "releasedAt": null,
      "disputeWindowEndsAt": null,
      "disputeDeadlineAt": "2026-04-23T06:00:00.000Z",
      "resolvedVia": null,
      "txSignature": "5Q2SThszKGe7gQCPKgp7EFzW7kR5cQ1MqoVs9LZP3H9eMnYUVtqFKDcCBNRKp"
    }
  ]
}
```

**Field notes:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Escrow account address (base58) — used as the display ID |
| `escrowAddress` | string | Same as `id`; explicit field for wiring |
| `counterparty` | string | The other party's pubkey (base58) |
| `role` | string | `initiator` or `beneficiary` — perspective of the queried `{pubkey}` |
| `amountLamports` | string | Escrow amount in lamports as a decimal string (avoid float precision loss) |
| `amountSol` | float | `amountLamports / 1e9`, rounded to 6 decimal places |
| `mint` | string | SPL token mint address; `So11111111111111111111111111111111111111112` = wSOL |
| `status` | string | UI-normalized status — see table below |
| `autoRelease` | boolean | Direct mapping of `PactRecord.auto_release_on_expiry` — `true` means the pact auto-releases when `time_lock_expires_at` is reached |
| `createdAt` | ISO 8601 | Slot timestamp of `initialize_escrow` instruction |
| `lockedAt` | ISO 8601 \| null | Slot timestamp of `lock_escrow`; null if not yet locked |
| `releasedAt` | ISO 8601 \| null | Slot timestamp of `release_escrow`; null if not yet released |
| `disputeWindowEndsAt` | ISO 8601 \| null | Deadline after which `claim_released` is callable; null if not released |
| `disputeDeadlineAt` | ISO 8601 \| null | Dispute resolution deadline; null if not disputed |
| `resolvedVia` | string \| null | `"dispute"` if this pact passed through `Disputed → Released/Refunded` via `resolve_dispute`; null otherwise |
| `txSignature` | string | Most recent transaction signature involving this escrow account |

**UI-normalized `status` values:**

| Value | On-chain `EscrowStatus` | Notes |
|---|---|---|
| `pending` | `Pending` (0) | Created but not yet funded |
| `funded` | `Funded` (1) | Initiator deposited; awaiting beneficiary stake |
| `locked` | `Locked` (2) | Both parties committed; work in progress |
| `released` | `Released` (3) | Initiator released; dispute window open |
| `disputed` | `Disputed` (4) | Dispute raised; awaiting arbiter |
| `refunded` | `Refunded` (5) | Funds returned to initiator (via `refund`, `cancel_pending_escrow`, or `resolve_dispute` initiator-win) |
| `closed` | `Closed` (6) | Account closed after claim or refund |
| `claimed` | `Claimed` (7) | Beneficiary claimed payout |
| `cancelled` | `MutuallyCancelled` (8) | Both parties agreed to cancel via `mutual_cancel_escrow` |

---

### 3. `GET /agents/{pubkey}/key-rotations`

Returns the key rotation event log for the given agent. Consumed by the **Custody** dashboard page.

#### Path parameters

| Param | Type | Description |
|---|---|---|
| `pubkey` | string | Agent's current Ed25519 wallet pubkey (base58) |

#### Query parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Max records to return (1–100) |
| `offset` | integer | 0 | Pagination offset |

#### Response `200 OK`

```json
{
  "pubkey": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "wallet": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "registrationState": "registered",
    "attestationType": "hardware",
    "teeProvider": "Intel TDX",
    "registrationSlot": 284761032,
    "registrationDate": "2026-04-08T09:14:00.000Z",
    "registrationTx": "5Q2SThszKGe7gQCPKgp7EFzW7kR5cQ1MqoVs9LZP3H9eMnYUVtqFKDcCBNRKp",
    "agentStatus": 1,
    "revokedAt": null,
    "deregistrationDeadline": null
  },
  "rotationCount": 2,
  "pagination": {
    "total": 2,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  },
  "rotations": [
    {
      "slot": 284900100,
      "timestamp": "2026-04-19T07:22:00.000Z",
      "txSignature": "4PmRThszKGe7gQCPKgp7EFzW7kR5cQ1MqoVs9LZP3H9eMnYUVtqFKDcCBNRAb",
      "prevSecp256r1Pubkey": "0x04abc123...",
      "newSecp256r1Pubkey": "0x04def456..."
    },
    {
      "slot": 284800050,
      "timestamp": "2026-04-13T15:45:00.000Z",
      "txSignature": "3NlQThszKGe7gQCPKgp7EFzW7kR5cQ1MqoVs9LZP3H9eMnYUVtqFKDcCBNRYc",
      "prevSecp256r1Pubkey": "0x04789abc...",
      "newSecp256r1Pubkey": "0x04abc123..."
    }
  ]
}
```

**Top-level `wallet` field notes:**

| Field | Type | Description |
|---|---|---|
| `registrationState` | string | Indexer-derived: `registered` (status 1), `unregistered` (no PDA), `revoked` (status 3 set via `set_agent_status`) |
| `attestationType` | string | `hardware` or `software` |
| `teeProvider` | string \| null | TEE provider label (e.g. `"Intel TDX"`); null for software attestation |
| `registrationSlot` | integer | Solana slot of `register_agent_wallet` |
| `registrationDate` | ISO 8601 | Slot timestamp of initial registration |
| `registrationTx` | string | Transaction signature for the registration instruction |
| `agentStatus` | integer | Raw `AgentWallet.status` byte from on-chain state |
| `revokedAt` | ISO 8601 \| null | Timestamp of `set_agent_status(3)` call; null if not revoked |
| `deregistrationDeadline` | ISO 8601 \| null | Grace period deadline if deregistration was initiated |

**Per-rotation event field notes:**

| Field | Type | Description |
|---|---|---|
| `slot` | integer | Solana slot of the `rotate_agent_key` instruction |
| `timestamp` | ISO 8601 | Slot timestamp |
| `txSignature` | string | Transaction signature |
| `prevSecp256r1Pubkey` | string \| null | Previous secp256r1 pubkey (hex-encoded, uncompressed); null for first registration |
| `newSecp256r1Pubkey` | string | New secp256r1 pubkey (hex-encoded, uncompressed) |

Rotations are ordered newest-first (descending by slot).

---

### 4. `GET /health`

Returns protocol health data: oracle uptime, indexer sync lag, and program liveness. Consumed by the **Protocol Health** dashboard page.

#### Query parameters

None.

#### Response `200 OK`

```json
{
  "indexer": {
    "status": "ok",
    "latestIndexedSlot": 456490000,
    "chainHeadSlot": 456490012,
    "syncLagSlots": 12,
    "syncLagMs": 5000,
    "lastUpdatedAt": "2026-04-22T10:30:00.000Z"
  },
  "oracle": {
    "status": "ok",
    "lastHeartbeatAt": "2026-04-22T10:29:55.000Z",
    "lastHeartbeatSlot": 456489990,
    "uptimePercent7d": 99.8,
    "missedHeartbeats24h": 0
  },
  "programs": [
    {
      "name": "holdfast",
      "anchorModule": "vaultpact",
      "programId": "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg",
      "status": "active",
      "lastSeenSlot": 456490000
    },
    {
      "name": "holdfast-escrow",
      "anchorModule": "vaultpact-escrow",
      "programId": "BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H",
      "status": "active",
      "lastSeenSlot": 456490000
    }
  ],
  "network": "devnet"
}
```

**`indexer` field notes:**

| Field | Type | Description |
|---|---|---|
| `status` | string | `ok`, `degraded`, `down` |
| `latestIndexedSlot` | integer | Most recently processed Solana slot |
| `chainHeadSlot` | integer | Current chain head from the RPC node |
| `syncLagSlots` | integer | `chainHeadSlot - latestIndexedSlot` |
| `syncLagMs` | integer | Estimated lag in milliseconds (slots × ~400ms) |
| `lastUpdatedAt` | ISO 8601 | When the indexer last processed a slot |

**`oracle` field notes:**

| Field | Type | Description |
|---|---|---|
| `status` | string | `ok`, `late`, `offline` — `late` if last heartbeat > 5 min ago |
| `lastHeartbeatAt` | ISO 8601 | Timestamp of most recent oracle heartbeat |
| `lastHeartbeatSlot` | integer | Slot of most recent oracle heartbeat |
| `uptimePercent7d` | float | Oracle uptime over the past 7 days as a percentage |
| `missedHeartbeats24h` | integer | Count of expected heartbeats missed in past 24 hours |

**`programs[]` field notes:**

| Field | Type | Description |
|---|---|---|
| `name` | string | Branded display name: `holdfast` or `holdfast-escrow` |
| `anchorModule` | string | Frozen on-chain Anchor module name: `vaultpact` or `vaultpact-escrow` |
| `programId` | string | On-chain program address (base58) |
| `status` | string | `active` or `unreachable` |
| `lastSeenSlot` | integer | Most recent slot where an instruction from this program was indexed |

---

### 5. `GET /events`

Returns recent on-chain instruction events across both Holdfast programs. Consumed by the **Protocol Health** dashboard page.

#### Query parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 10 | Max records to return (1–50) |
| `offset` | integer | 0 | Pagination offset |
| `type` | string | (all) | Filter by event type; see event type table below |
| `pubkey` | string | (all) | Filter to events involving a specific agent pubkey |

#### Response `200 OK`

```json
{
  "pagination": {
    "total": 2048,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  },
  "events": [
    {
      "id": "evt_001",
      "type": "pact_created",
      "slot": 456490000,
      "timestamp": "2026-04-22T10:30:00.000Z",
      "txSignature": "5Q2SThszKGe7gQCPKgp7EFzW7kR5cQ1MqoVs9LZP3H9eMnYUVtqFKDcCBNRKp",
      "program": "holdfast-escrow",
      "actors": {
        "initiator": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "beneficiary": "AgXm9tg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosA4kRz"
      },
      "meta": {
        "escrowAddress": "3GhJ8mNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd",
        "amountSol": 2.5
      }
    },
    {
      "id": "evt_002",
      "type": "agent_status_changed",
      "slot": 456489900,
      "timestamp": "2026-04-22T10:29:20.000Z",
      "txSignature": "4PmRThszKGe7gQCPKgp7EFzW7kR5cQ1MqoVs9LZP3H9eMnYUVtqFKDcCBNRAb",
      "program": "holdfast",
      "actors": {
        "agent": "BnYq3tg2CW87d97TXJSDpbD5jBkheTqA83TZRuJos8pLm"
      },
      "meta": {
        "newStatus": 3
      }
    }
  ]
}
```

**Event types:**

| `type` | Program | On-chain instruction | Description |
|---|---|---|---|
| `agent_registered` | `holdfast` | `register_agent_wallet` | New `AgentWallet` PDA created |
| `agent_status_changed` | `holdfast` | `set_agent_status` | Agent wallet status changed (including revocation: `newStatus: 3`) |
| `key_rotated` | `holdfast` | `rotate_agent_key` | Agent secp256r1 key rotation |
| `reputation_updated` | `holdfast` | CPI from escrow | Reputation score changed |
| `pact_created` | `holdfast-escrow` | `initialize_escrow` | Pact initialized |
| `pact_funded` | `holdfast-escrow` | `deposit_funds` | Initiator deposited funds |
| `pact_staked` | `holdfast-escrow` | `stake_beneficiary` | Beneficiary staked |
| `pact_locked` | `holdfast-escrow` | `lock_escrow` | Both parties locked |
| `pact_released` | `holdfast-escrow` | `release_escrow` | Initiator released; dispute window opens |
| `pact_auto_released` | `holdfast-escrow` | `auto_release` | Pact auto-released on timelock expiry |
| `pact_claimed` | `holdfast-escrow` | `claim_released` | Beneficiary claimed payout |
| `pact_disputed` | `holdfast-escrow` | `raise_dispute` | Dispute raised |
| `dispute_escalated` | `holdfast-escrow` | `escalate_dispute` | Dispute escalated to protocol authority |
| `dispute_resolved` | `holdfast-escrow` | `resolve_dispute` | Dispute resolved by arbiter; transitions to `Released` or `Refunded` |
| `pact_refunded` | `holdfast-escrow` | `refund` | Funds returned to initiator |
| `pact_cancelled_pending` | `holdfast-escrow` | `cancel_pending_escrow` | Initiator reclaimed funds before beneficiary staked; transitions to `Refunded` |
| `pact_cancelled` | `holdfast-escrow` | `mutual_cancel_escrow` | Mutual cancellation; transitions to `MutuallyCancelled` |
| `pact_closed` | `holdfast-escrow` | `close_escrow` | Escrow account closed after terminal state |
| `pact_frozen` | `holdfast-escrow` | `protocol_freeze_pact` | Protocol authority froze the pact |

**Per-event field notes:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable event ID (indexer-generated, `evt_` prefix) |
| `type` | string | One of the event types above |
| `slot` | integer | Solana slot |
| `timestamp` | ISO 8601 | Slot timestamp |
| `txSignature` | string | Transaction signature |
| `program` | string | Branded display name: `holdfast` or `holdfast-escrow` |
| `actors` | object | Key-value map of named participants (pubkeys); keys vary by event type |
| `meta` | object | Event-specific additional fields; optional, may be `{}` |

Events are ordered newest-first (descending by slot).

---

## Dashboard page → endpoint mapping

| Dashboard page | Endpoint(s) called | Notes |
|---|---|---|
| Reputation | `GET /agents/{pubkey}/reputation` | Score, tier, sparklines |
| Escrow — active tab | `GET /agents/{pubkey}/pacts?status=active` | No limit needed; expected ≤50 active pacts |
| Escrow — history tab | `GET /agents/{pubkey}/pacts?status=completed&limit=20` | Paginate on scroll |
| Custody | `GET /agents/{pubkey}/key-rotations` | Wallet state + rotation log |
| Protocol Health — status | `GET /health` | Oracle + indexer health |
| Protocol Health — events | `GET /events?limit=10` | Recent activity feed |

---

## Implementation notes for the Backend Engineer

1. **Source of truth:** On-chain RPC for current account state; indexer event log for history. The indexer should materialize history arrays and event logs from slot-ordered instruction logs — do not re-derive from RPC on each request.

2. **history30d / history90d construction:** Take one snapshot per calendar day (UTC midnight) from the `reputation_updated` event log. If no update occurred on a given day, forward-fill the previous day's score. Ensure arrays are padded to exactly 30/90 entries.

3. **`syncLagSlots` alerting threshold:** Treat `syncLagSlots > 100` as `degraded`, `> 1000` as `down`.

4. **Oracle heartbeat:** The indexer should track oracle heartbeat intervals. On devnet the expected interval is configurable; treat any gap > 5 minutes as `late`.

5. **Concurrency note:** `GET /agents/{pubkey}/pacts` with `status=active` may be polled frequently from the dashboard. Add an HTTP `Cache-Control: max-age=10` header to reduce RPC chatter during demos.

6. **No auth for devnet:** All endpoints are unauthenticated. Do not add any token validation logic in this iteration.

7. **Program name display:** The `program` field in events and the `name` field in `/health` programs array use branded names (`holdfast`, `holdfast-escrow`). The frozen on-chain Anchor module names (`vaultpact`, `vaultpact-escrow`) are exposed separately as `anchorModule` in `/health` for IDL cross-referencing — do not use Anchor module names in event payloads.

8. **Agent revocation:** There is no single `revoke_agent_wallet` instruction. Revocation is a two-step process: `set_agent_status(new_status: 3)` marks the wallet revoked, followed optionally by `close_agent_wallet` to reclaim rent. Both emit `agent_status_changed` events. The indexer should derive `registrationState: "revoked"` when `agentStatus == 3`.

9. **`pact_refunded` vs `pact_cancelled_pending`:** Both result in `Refunded (5)` on-chain but originate from different instructions. `pact_refunded` maps to `refund` (initiator returns funds from a Funded/Locked pact). `pact_cancelled_pending` maps to `cancel_pending_escrow` (initiator cancels before beneficiary stakes). The indexer emits distinct event types so the dashboard can display appropriate context.

---

## Changelog

| Version | Changes |
|---|---|
| 1.0 | Initial draft |
| 1.1 | Fix domain URLs to `holdfastprotocol.com`; use branded program display names (`holdfast`/`holdfast-escrow`) with `anchorModule` field; add `pact_cancelled_pending` event; standardize `amountSol` to 6dp API / 4dp display |
| 1.2 | Fix `EscrowStatus` discriminants against source (`Claimed=7`, `MutuallyCancelled=8`); add `Pending(0)`, `Refunded(5)`, `Closed(6)` to status mapping; fix 5 wrong instruction names (`deposit_funds`, `release_escrow`, `mutual_cancel_escrow`, `rotate_agent_key`); replace `agent_revoked` with `agent_status_changed` (two-step revocation); replace `releaseCondition` with `autoRelease: bool` mapping directly to `PactRecord.auto_release_on_expiry`; add `resolvedVia` field; add 6 missing event types; disambiguate `cancelled` vs `refunded` UI status |

---

## Related

- [Integration Guide](./integration-guide.md) — program addresses and PDA derivations
- [Escrow IDL Reference](../../docs/escrow-idl-reference.md) — on-chain instruction signatures
- [Invariants Spec](../../docs/invariants.md) — escrow status state machine
- [CAS-285](/CAS/issues/CAS-285) — dashboard data wiring (blocked by this document)
- [CAS-119](/CAS/issues/CAS-119) — devnet launch gate
