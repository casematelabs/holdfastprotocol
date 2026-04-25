/**
 * Orchestrator heartbeat integration — HOL-9
 *
 * Call site that wires routeIssue() into the Orchestrator's heartbeat loop.
 * Every new issue assignment triggers a routing decision: classifies the task,
 * selects the optimal model, applies assigneeAdapterOverrides, and posts an
 * audit comment. Falls back to Claude Sonnet when primary routing fails.
 */

import {
  routeIssue,
  applyFallback,
} from './orchestrator-router.js';
import {
  ModelId,
  AdapterType,
  TaskType,
  type RouteDecision,
} from './model-router.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_URL = process.env.PAPERCLIP_API_URL ?? '';
const API_KEY = process.env.PAPERCLIP_API_KEY ?? '';
const RUN_ID  = process.env.PAPERCLIP_RUN_ID  ?? '';

/**
 * Used when primary routing fails before producing a decision.
 * Claude Sonnet is the safest universal fallback.
 */
export const DEFAULT_ROUTE_DECISION: RouteDecision = {
  taskType:                 TaskType.task_decomposition,
  primaryAdapterType:       AdapterType.claude_local,
  primaryModel:             ModelId.claude_sonnet,
  fallbackAdapterType:      AdapterType.claude_local,
  fallbackModel:            ModelId.claude_opus,
  assigneeAdapterOverrides: { model: ModelId.claude_sonnet },
  ruleApplied:              'default_sonnet',
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface InboxIssue {
  id:         string;
  identifier: string;
  status:     string;
  title:      string;
}

interface InboxLiteResponse {
  issues?: InboxIssue[];
}

export interface RoutingResult {
  issueId:         string;
  issueIdentifier: string;
  decision:        RouteDecision;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  return {
    'Authorization':      `Bearer ${API_KEY}`,
    'Content-Type':       'application/json',
    'X-Paperclip-Run-Id': RUN_ID,
  };
}

async function fetchInbox(): Promise<InboxIssue[]> {
  const res = await fetch(`${API_URL}/api/agents/me/inbox-lite`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Inbox fetch failed: ${res.status}`);
  const body = await res.json() as InboxLiteResponse;
  return body.issues ?? [];
}

// ── Call site ──────────────────────────────────────────────────────────────────

/**
 * Route a single newly-assigned issue.
 *
 * On primary routing failure, applies the fallback model instead of leaving
 * the issue without a routing decision. Dependencies are injectable for testing.
 */
export async function routeNewAssignment(
  issueId: string,
  issueIdentifier: string,
  deps: {
    routeIssue:    typeof routeIssue;
    applyFallback: typeof applyFallback;
  } = { routeIssue, applyFallback },
): Promise<RouteDecision> {
  try {
    return await deps.routeIssue(issueId, issueIdentifier);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] Primary routing failed for ${issueIdentifier}: ${reason}`);
    await deps.applyFallback(issueId, issueIdentifier, DEFAULT_ROUTE_DECISION, reason);
    return DEFAULT_ROUTE_DECISION;
  }
}

// ── Heartbeat step ─────────────────────────────────────────────────────────────

/**
 * Heartbeat step: route all in-progress assigned issues.
 *
 * Fetches the Orchestrator's inbox and calls routeNewAssignment() for each
 * in_progress issue. Per-issue errors are caught and logged so one failure
 * does not abort the rest of the batch.
 */
export async function routeAssignedIssues(
  deps: {
    fetchInbox:          typeof fetchInbox;
    routeNewAssignment:  typeof routeNewAssignment;
  } = { fetchInbox, routeNewAssignment },
): Promise<RoutingResult[]> {
  const issues = await deps.fetchInbox();
  const results: RoutingResult[] = [];

  for (const issue of issues) {
    if (issue.status !== 'in_progress') continue;
    try {
      const decision = await deps.routeNewAssignment(issue.id, issue.identifier);
      results.push({ issueId: issue.id, issueIdentifier: issue.identifier, decision });
    } catch (err) {
      console.error(
        `[orchestrator] Routing failed entirely for ${issue.identifier}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return results;
}
