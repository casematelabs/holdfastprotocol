# HOL-136 Functional Validation

Date: 2026-04-26  
Scope: Network Status health dashboard (`app/status/page.tsx`) and dashboard data client (`lib/indexer.ts`)

## Result

PASS with follow-up items.

## Test Execution Summary

- `npm test` (root): PASS (`53/53` tests)
- `npm run build` (root): PASS (static generation includes `/status`)
- `npm run lint` (root): BLOCKED by interactive ESLint bootstrap prompt (`next lint` requires initial config)

## Coverage Added (HOL-136)

New test file: `lib/indexer.test.ts`

Validated invariants:

1. `fetchHealth()` always targets `/v1/health`.
2. `fetchEvents(limit)` sends the expected `limit` query parameter.
3. `fetchAgentEvents(pubkey, limit, after)` encodes `agent`, `limit`, and `after` correctly.
4. `fetchAgentEvents(pubkey)` omits `after` when no cursor is provided.
5. Structured backend errors propagate `error.message` to callers.
6. Non-JSON backend errors fall back to deterministic `Indexer error <status>`.

## Functional Findings

1. Lint pipeline is not yet non-interactive in this checkout. CI/local QA runs cannot rely on `npm run lint` until ESLint config is committed.
2. `next build` reports a warning for optional `pino-pretty` resolution from wallet-connect dependency chain. Build succeeds; warning should be triaged separately.

## Security-Auditor Notes

No direct security regression found in this validation scope. New tests reduce risk of silent dashboard misreporting caused by malformed API wiring or opaque error handling.
