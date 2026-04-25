/**
 * E2E integration tests for orchestrator routing pipeline — HOL-10
 *
 * Covers: fetch issue metadata -> classify -> route -> PATCH override -> POST audit comment.
 * Also validates fallback model application flow.
 *
 * Run: npx tsx --test lib/orchestrator-router.e2e.test.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
};

type MockResponse = {
  status?: number;
  jsonBody?: unknown;
  textBody?: string;
};

function normalizeHeaders(input: HeadersInit | undefined): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, string>)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

function toResponse(payload: MockResponse): Response {
  const status = payload.status ?? 200;
  if (payload.jsonBody !== undefined) {
    return new Response(JSON.stringify(payload.jsonBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(payload.textBody ?? '', { status });
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.PAPERCLIP_API_URL = 'https://paperclip.test';
  process.env.PAPERCLIP_API_KEY = 'test-key';
  process.env.PAPERCLIP_RUN_ID = 'run-123';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

async function loadOrchestratorRouter() {
  const cacheBust = `${Date.now()}-${Math.random()}`;
  return import(`./orchestrator-router.ts?e2e=${cacheBust}`);
}

describe('orchestrator router e2e pipeline', () => {
  test('routeIssue applies model override and writes audit comment', async () => {
    const calls: FetchCall[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = normalizeHeaders(init?.headers);
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : undefined;

      calls.push({ url, method, headers, body });

      if (url === 'https://paperclip.test/api/issues/issue-1' && method === 'GET') {
        return toResponse({
          jsonBody: {
            priority: 'high',
            labels: [{ name: 'task_type:integration_work' }, { name: 'requires_code' }],
          },
        });
      }

      if (url === 'https://paperclip.test/api/issues/issue-1' && method === 'PATCH') {
        return toResponse({ status: 200, jsonBody: { ok: true } });
      }

      if (url === 'https://paperclip.test/api/issues/issue-1/comments' && method === 'POST') {
        return toResponse({ status: 201, jsonBody: { ok: true } });
      }

      return toResponse({ status: 404, textBody: 'not found' });
    }) as typeof fetch;

    const orchestrator = await loadOrchestratorRouter();
    const decision = await orchestrator.routeIssue('issue-1', 'HOL-10');

    assert.equal(decision.taskType, 'integration_work');
    assert.equal(decision.primaryModel, 'codex');
    assert.equal(decision.ruleApplied, 'requires_code');

    assert.equal(calls.length, 3);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].method, 'PATCH');
    assert.equal(calls[2].method, 'POST');

    assert.deepEqual(calls[1].body, { assigneeAdapterOverrides: { model: 'codex' } });
    assert.equal(calls[1].headers.authorization, 'Bearer test-key');
    assert.equal(calls[1].headers['x-paperclip-run-id'], 'run-123');

    const postedComment = calls[2].body as { body: string };
    assert.match(postedComment.body, /Model routing decision/);
    assert.match(postedComment.body, /HOL-10/);
    assert.match(postedComment.body, /"model":"codex"/);
  });

  test('applyFallback switches to fallback model and posts fallback note', async () => {
    const calls: FetchCall[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = normalizeHeaders(init?.headers);
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, headers, body });

      if (url === 'https://paperclip.test/api/issues/issue-2' && method === 'PATCH') {
        return toResponse({ status: 200, jsonBody: { ok: true } });
      }

      if (url === 'https://paperclip.test/api/issues/issue-2/comments' && method === 'POST') {
        return toResponse({ status: 201, jsonBody: { ok: true } });
      }

      return toResponse({ status: 404, textBody: 'not found' });
    }) as typeof fetch;

    const orchestrator = await loadOrchestratorRouter();
    const decision = orchestrator.routeTask({
      task_type: 'integration_work',
      requires_code: true,
      risk_level: 'medium',
    });

    await orchestrator.applyFallback('issue-2', 'HOL-10', decision, 'Primary model timeout');

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body, {
      assigneeAdapterOverrides: { model: decision.fallbackModel },
    });

    const fallbackComment = calls[1].body as { body: string };
    assert.match(fallbackComment.body, /Model fallback applied/);
    assert.match(fallbackComment.body, /Primary model timeout/);
    assert.match(fallbackComment.body, new RegExp(decision.fallbackModel));
  });

  test('routeIssue propagates PATCH failures with API status context', async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === 'https://paperclip.test/api/issues/issue-3' && method === 'GET') {
        return toResponse({
          jsonBody: {
            priority: 'low',
            labels: [{ name: 'task_type:docs_sdk' }],
          },
        });
      }

      if (url === 'https://paperclip.test/api/issues/issue-3' && method === 'PATCH') {
        return toResponse({ status: 500, textBody: 'patch failed' });
      }

      return toResponse({ status: 404, textBody: 'not found' });
    }) as typeof fetch;

    const orchestrator = await loadOrchestratorRouter();

    await assert.rejects(
      () => orchestrator.routeIssue('issue-3', 'HOL-10'),
      /Failed to set adapter overrides on issue-3: 500 patch failed/,
    );
  });
});
