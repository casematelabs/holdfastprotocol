/**
 * Tests for orchestrator-heartbeat — HOL-9
 *
 * Run: node --import tsx/esm --test lib/orchestrator-heartbeat.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeNewAssignment,
  routeAssignedIssues,
  DEFAULT_ROUTE_DECISION,
  type RoutingResult,
} from './orchestrator-heartbeat.js';
import { ModelId, AdapterType, TaskType } from './model-router.js';
import type { RouteDecision } from './model-router.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_DECISION: RouteDecision = {
  taskType:                 TaskType.code_generation,
  primaryAdapterType:       AdapterType.codex_local,
  primaryModel:             ModelId.codex,
  fallbackAdapterType:      AdapterType.claude_local,
  fallbackModel:            ModelId.claude_sonnet,
  assigneeAdapterOverrides: { model: ModelId.codex },
  ruleApplied:              'routing_table:code_generation',
};

// ── DEFAULT_ROUTE_DECISION ─────────────────────────────────────────────────────

describe('DEFAULT_ROUTE_DECISION', () => {
  test('uses claude_sonnet as primary model', () => {
    assert.equal(DEFAULT_ROUTE_DECISION.primaryModel, ModelId.claude_sonnet);
    assert.equal(DEFAULT_ROUTE_DECISION.primaryAdapterType, AdapterType.claude_local);
  });

  test('uses claude_opus as fallback model', () => {
    assert.equal(DEFAULT_ROUTE_DECISION.fallbackModel, ModelId.claude_opus);
  });

  test('assigneeAdapterOverrides points to primary model', () => {
    assert.deepEqual(DEFAULT_ROUTE_DECISION.assigneeAdapterOverrides, {
      model: ModelId.claude_sonnet,
    });
  });

  test('ruleApplied is default_sonnet', () => {
    assert.equal(DEFAULT_ROUTE_DECISION.ruleApplied, 'default_sonnet');
  });
});

// ── routeNewAssignment — happy path ───────────────────────────────────────────

describe('routeNewAssignment — happy path', () => {
  test('returns the decision from routeIssue', async () => {
    let routeIssueCalled = false;
    const mockRouteIssue = async (_id: string, _identifier: string) => {
      routeIssueCalled = true;
      return MOCK_DECISION;
    };
    const mockApplyFallback = async () => {};

    const result = await routeNewAssignment('issue-1', 'HOL-10', {
      routeIssue:    mockRouteIssue,
      applyFallback: mockApplyFallback,
    });

    assert.ok(routeIssueCalled);
    assert.deepEqual(result, MOCK_DECISION);
  });

  test('passes correct issueId and identifier to routeIssue', async () => {
    let capturedId = '';
    let capturedIdentifier = '';
    const mockRouteIssue = async (id: string, identifier: string) => {
      capturedId = id;
      capturedIdentifier = identifier;
      return MOCK_DECISION;
    };

    await routeNewAssignment('abc-123', 'HOL-42', {
      routeIssue:    mockRouteIssue,
      applyFallback: async () => {},
    });

    assert.equal(capturedId, 'abc-123');
    assert.equal(capturedIdentifier, 'HOL-42');
  });
});

// ── routeNewAssignment — fallback path ────────────────────────────────────────

describe('routeNewAssignment — fallback path', () => {
  test('calls applyFallback when routeIssue throws', async () => {
    let fallbackCalled = false;
    const mockRouteIssue = async () => {
      throw new Error('primary model unavailable');
    };
    const mockApplyFallback = async () => {
      fallbackCalled = true;
    };

    await routeNewAssignment('issue-1', 'HOL-10', {
      routeIssue:    mockRouteIssue,
      applyFallback: mockApplyFallback,
    });

    assert.ok(fallbackCalled);
  });

  test('returns DEFAULT_ROUTE_DECISION when routeIssue throws', async () => {
    const result = await routeNewAssignment('issue-1', 'HOL-10', {
      routeIssue:    async () => { throw new Error('network error'); },
      applyFallback: async () => {},
    });

    assert.deepEqual(result, DEFAULT_ROUTE_DECISION);
  });

  test('passes failure reason to applyFallback', async () => {
    let capturedReason = '';
    const mockRouteIssue = async () => {
      throw new Error('timeout after 30s');
    };
    const mockApplyFallback = async (
      _id: string,
      _identifier: string,
      _decision: RouteDecision,
      reason: string,
    ) => {
      capturedReason = reason;
    };

    await routeNewAssignment('issue-1', 'HOL-10', {
      routeIssue:    mockRouteIssue,
      applyFallback: mockApplyFallback,
    });

    assert.equal(capturedReason, 'timeout after 30s');
  });

  test('passes DEFAULT_ROUTE_DECISION to applyFallback', async () => {
    let capturedDecision: RouteDecision | null = null;
    const mockApplyFallback = async (
      _id: string,
      _identifier: string,
      decision: RouteDecision,
    ) => {
      capturedDecision = decision;
    };

    await routeNewAssignment('issue-1', 'HOL-10', {
      routeIssue:    async () => { throw new Error('fail'); },
      applyFallback: mockApplyFallback,
    });

    assert.deepEqual(capturedDecision, DEFAULT_ROUTE_DECISION);
  });
});

// ── routeAssignedIssues ────────────────────────────────────────────────────────

describe('routeAssignedIssues', () => {
  test('routes all in_progress issues', async () => {
    const mockInbox = async () => [
      { id: 'id-1', identifier: 'HOL-11', status: 'in_progress', title: 'Task A' },
      { id: 'id-2', identifier: 'HOL-12', status: 'in_progress', title: 'Task B' },
    ];
    const routed: string[] = [];
    const mockRoute = async (id: string, identifier: string) => {
      routed.push(identifier);
      return MOCK_DECISION;
    };

    const results = await routeAssignedIssues({
      fetchInbox:         mockInbox,
      routeNewAssignment: mockRoute,
    });

    assert.deepEqual(routed, ['HOL-11', 'HOL-12']);
    assert.equal(results.length, 2);
  });

  test('skips non-in_progress issues', async () => {
    const mockInbox = async () => [
      { id: 'id-1', identifier: 'HOL-11', status: 'todo',        title: 'Pending' },
      { id: 'id-2', identifier: 'HOL-12', status: 'in_progress', title: 'Active' },
      { id: 'id-3', identifier: 'HOL-13', status: 'done',        title: 'Finished' },
      { id: 'id-4', identifier: 'HOL-14', status: 'blocked',     title: 'Stuck' },
    ];
    const routed: string[] = [];
    const mockRoute = async (id: string, identifier: string) => {
      routed.push(identifier);
      return MOCK_DECISION;
    };

    await routeAssignedIssues({
      fetchInbox:         mockInbox,
      routeNewAssignment: mockRoute,
    });

    assert.deepEqual(routed, ['HOL-12']);
  });

  test('returns routing results with issueId and identifier', async () => {
    const mockInbox = async () => [
      { id: 'uuid-abc', identifier: 'HOL-20', status: 'in_progress', title: 'T' },
    ];

    const results = await routeAssignedIssues({
      fetchInbox:         mockInbox,
      routeNewAssignment: async (id, identifier) => ({ ...MOCK_DECISION } as RouteDecision),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].issueId, 'uuid-abc');
    assert.equal(results[0].issueIdentifier, 'HOL-20');
  });

  test('continues processing remaining issues after one fails', async () => {
    const mockInbox = async () => [
      { id: 'id-1', identifier: 'HOL-30', status: 'in_progress', title: 'A' },
      { id: 'id-2', identifier: 'HOL-31', status: 'in_progress', title: 'B' },
    ];
    const mockRoute = async (_id: string, identifier: string) => {
      if (identifier === 'HOL-30') throw new Error('complete failure');
      return MOCK_DECISION;
    };

    const results = await routeAssignedIssues({
      fetchInbox:         mockInbox,
      routeNewAssignment: mockRoute,
    });

    // HOL-30 threw entirely (not caught by routeNewAssignment), HOL-31 succeeds
    assert.equal(results.length, 1);
    assert.equal(results[0].issueIdentifier, 'HOL-31');
  });

  test('returns empty array when inbox is empty', async () => {
    const results = await routeAssignedIssues({
      fetchInbox:         async () => [],
      routeNewAssignment: async () => MOCK_DECISION,
    });

    assert.deepEqual(results, []);
  });
});
