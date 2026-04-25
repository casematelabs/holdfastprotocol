# Holdfast Devnet Alert Bot

Lightweight TypeScript poller that monitors Holdfast Protocol devnet health and posts Discord alerts via webhook. No Discord bot library — webhook only.

## What it monitors

| Poller | Interval | Alerts on |
|---|---|---|
| **Indexer** | 60s | `/health` non-200 or timeout |
| **Escrow** | 60s | `protocol_frozen`, `dispute_raised`, `dispute_escalated` events in recent RPC logs |
| **Oracle** | 5min | Oracle health endpoint (if `ORACLE_URL` set) |
| **Program** | 10min | Program account missing, not executable, or hash mismatch vs baseline |
| **RPC** | 5min | RPC unreachable, slot lag > threshold, chain stalled |

All alerts use Discord rich embeds with colour-coded severity (red = critical, orange = warning, green = recovery). Duplicate alerts for the same ongoing failure are suppressed for 5 minutes (configurable). Recovery alerts fire automatically when a previously-failing check passes again.

## Setup

```bash
cd holdfast/alert-bot
cp .env.example .env
# Edit .env — set DISCORD_WEBHOOK_URL at minimum
npm install
npm run build
npm start
```

## Development

```bash
npm run dev        # run with ts-node (no build step)
npm run typecheck  # type-check without emitting
```

## Configuration

See [`.env.example`](.env.example) for all environment variables with descriptions.

The only required variable is `DISCORD_WEBHOOK_URL`. Everything else has sensible defaults for a standard devnet deployment.

### Setting program baseline hashes

```bash
# Dump current program binary and hash it
solana program dump D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg /tmp/holdfast.so
sha256sum /tmp/holdfast.so
# Add the hash to .env as HOLDFAST_PROGRAM_BASELINE_HASH
```

## Alert categories

| Category | Description |
|---|---|
| `indexer` | Indexer HTTP health |
| `escrow:protocol_frozen` | Protocol freeze event detected |
| `escrow:dispute_raised` | Dispute raised on an escrow |
| `escrow:dispute_escalated` | Dispute escalated on an escrow |
| `oracle` | Oracle HTTP health (requires `ORACLE_URL`) |
| `program:holdfast` | Holdfast program binary health |
| `program:escrow` | Escrow program binary health |
| `rpc:slot-lag` | Confirmed/processed slot lag |
| `rpc:stalled` | Chain slot advancement rate |
