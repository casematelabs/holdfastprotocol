import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

type FetchLike = typeof fetch;

let originalFetch: FetchLike;

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function responseText(body: string, status = 500): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

let importCounter = 0;

async function loadIndexerModule() {
  importCounter += 1;
  return import(`./indexer.ts?test=${importCounter}`);
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('indexer client: protocol health + events', () => {
  test('fetchHealth requests the canonical /health endpoint', async () => {
    // Invariant: Network Status health card always reads protocol state from /v1/health.
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return responseJson({
        indexer: {
          status: 'ok',
          latestIndexedSlot: 1,
          chainHeadSlot: 1,
          syncLagSlots: 0,
          syncLagMs: 0,
          lastUpdatedAt: '2026-04-26T00:00:00.000Z',
        },
        oracle: {
          status: 'ok',
          lastHeartbeatAt: '2026-04-26T00:00:00.000Z',
          lastHeartbeatSlot: 1,
          uptimePercent7d: 100,
          missedHeartbeats24h: 0,
        },
        programs: [],
        network: 'devnet',
      });
    }) as FetchLike;

    const { fetchHealth } = await loadIndexerModule();
    await fetchHealth();

    assert.equal(calledUrl, 'http://localhost:8080/v1/health');
  });

  test('fetchEvents applies limit parameter exactly once', async () => {
    // Invariant: Recent activity feed polling must request the expected page size.
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return responseJson({
        pagination: { total: 0, limit: 25, offset: 0, hasMore: false },
        events: [],
      });
    }) as FetchLike;

    const { fetchEvents } = await loadIndexerModule();
    await fetchEvents(25);

    assert.equal(calledUrl, 'http://localhost:8080/v1/events?limit=25');
  });

  test('fetchAgentEvents includes agent, limit, and optional cursor', async () => {
    // Invariant: agent-scoped dashboard filters must be encoded in query params.
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return responseJson({
        pagination: { total: 0, limit: 50, hasMore: false, cursor: null },
        events: [],
      });
    }) as FetchLike;

    const { fetchAgentEvents } = await loadIndexerModule();
    await fetchAgentEvents('AgentPubkey123', 50, 'cursor-42');

    const u = new URL(calledUrl);
    assert.equal(`${u.origin}${u.pathname}`, 'http://localhost:8080/v1/events');
    assert.equal(u.searchParams.get('agent'), 'AgentPubkey123');
    assert.equal(u.searchParams.get('limit'), '50');
    assert.equal(u.searchParams.get('after'), 'cursor-42');
  });

  test('fetchAgentEvents omits cursor when not provided', async () => {
    // Invariant: first-page fetches must not send an empty/invalid cursor token.
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return responseJson({
        pagination: { total: 0, limit: 50, hasMore: false, cursor: null },
        events: [],
      });
    }) as FetchLike;

    const { fetchAgentEvents } = await loadIndexerModule();
    await fetchAgentEvents('AgentPubkey123');

    const u = new URL(calledUrl);
    assert.equal(u.searchParams.get('after'), null);
    assert.equal(u.searchParams.get('limit'), '50');
  });
});

describe('indexer client: error handling', () => {
  test('returns API error.message when backend responds with structured error JSON', async () => {
    // Invariant: dashboard surfaces precise backend failure reason instead of opaque HTTP code.
    globalThis.fetch = (async () => {
      return responseJson({ error: { message: 'indexer unhealthy: lag > 500 slots' } }, 503);
    }) as FetchLike;

    const { fetchHealth } = await loadIndexerModule();
    await assert.rejects(fetchHealth(), /indexer unhealthy: lag > 500 slots/);
  });

  test('falls back to status-based error message when body is not JSON', async () => {
    // Invariant: non-JSON error bodies still produce deterministic error text for QA triage.
    globalThis.fetch = (async () => {
      return responseText('upstream timeout', 504);
    }) as FetchLike;

    const { fetchEvents } = await loadIndexerModule();
    await assert.rejects(fetchEvents(10), /Indexer error 504/);
  });
});
