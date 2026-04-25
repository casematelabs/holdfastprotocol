/**
 * Orchestrator routing utilities — HOL-8
 *
 * Wraps the model-router decision engine with Paperclip API calls.
 * The Orchestrator uses these functions to classify incoming tasks,
 * select optimal models, apply assigneeAdapterOverrides, and post
 * routing audit comments.
 *
 * Usage pattern:
 *   const decision = routeTask(metadata);
 *   await applyRoutingDecision(issueId, decision, issueIdentifier);
 */

import {
  routeTask,
  formatRoutingAuditComment,
  riskLevelFromPriority,
  parseTaskType,
  TaskType,
  type TaskMetadata,
  type RouteDecision,
} from './model-router.js';

export { routeTask, formatRoutingAuditComment } from './model-router.js';
export type { TaskMetadata, RouteDecision } from './model-router.js';

// ── Environment ────────────────────────────────────────────────────────────────

const API_URL   = process.env.PAPERCLIP_API_URL ?? '';
const API_KEY   = process.env.PAPERCLIP_API_KEY ?? '';
const RUN_ID    = process.env.PAPERCLIP_RUN_ID  ?? '';

function authHeaders(): Record<string, string> {
  return {
    'Authorization':        `Bearer ${API_KEY}`,
    'Content-Type':         'application/json',
    'X-Paperclip-Run-Id':   RUN_ID,
  };
}

// ── Paperclip API wrappers ────────────────────────────────────────────────────

interface IssueLabels {
  labels?: Array<{ name: string }>;
  priority?: string;
}

/** Fetch lightweight issue metadata (labels + priority) for routing classification. */
export async function fetchIssueRoutingMeta(issueId: string): Promise<IssueLabels> {
  const res = await fetch(`${API_URL}/api/issues/${issueId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch issue ${issueId}: ${res.status}`);
  return res.json() as Promise<IssueLabels>;
}

/**
 * Apply a routing decision to an issue:
 *  1. PATCH the issue with assigneeAdapterOverrides
 *  2. POST an audit comment with the routing decision details
 */
export async function applyRoutingDecision(
  issueId: string,
  decision: RouteDecision,
  issueIdentifier: string,
): Promise<void> {
  await patchIssueAdapterOverrides(issueId, decision);
  await postRoutingAuditComment(issueId, decision, issueIdentifier);
}

async function patchIssueAdapterOverrides(
  issueId: string,
  decision: RouteDecision,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/issues/${issueId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      assigneeAdapterOverrides: decision.assigneeAdapterOverrides,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to set adapter overrides on ${issueId}: ${res.status} ${body}`);
  }
}

async function postRoutingAuditComment(
  issueId: string,
  decision: RouteDecision,
  issueIdentifier: string,
): Promise<void> {
  const comment = formatRoutingAuditComment(decision, issueIdentifier);
  const res = await fetch(`${API_URL}/api/issues/${issueId}/comments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ body: comment }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to post routing comment on ${issueId}: ${res.status} ${body}`);
  }
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Derive TaskMetadata from an issue's labels and priority fields.
 * Falls back to `task_decomposition` when no task_type label is found.
 */
export function classifyIssue(issue: IssueLabels & {
  priority?: string;
  labels?: Array<{ name: string }>;
  title?: string;
}): TaskMetadata {
  const labels = issue.labels ?? [];
  const priority = issue.priority ?? 'medium';

  // Extract task_type from labels (e.g. label "task_type:code_generation")
  let task_type: TaskType = TaskType.task_decomposition;
  let requires_code = false;
  let requires_security_review = false;

  for (const label of labels) {
    const name = label.name ?? '';
    if (name.startsWith('task_type:')) {
      const parsed = parseTaskType(name.replace('task_type:', ''));
      if (parsed) task_type = parsed;
    }
    if (name === 'requires_code') requires_code = true;
    if (name === 'requires_security_review') requires_security_review = true;
  }

  const risk_level = riskLevelFromPriority(priority);

  return { task_type, risk_level, requires_code, requires_security_review };
}

// ── Main entry point for Orchestrator heartbeats ───────────────────────────────

/**
 * Route a newly-assigned issue: classify it, pick the optimal model,
 * apply the override, and log the routing decision.
 *
 * Returns the routing decision for callers that need to inspect it.
 */
export async function routeIssue(
  issueId: string,
  issueIdentifier: string,
): Promise<RouteDecision> {
  const issueMeta = await fetchIssueRoutingMeta(issueId);
  const metadata  = classifyIssue(issueMeta);
  const decision  = routeTask(metadata);
  await applyRoutingDecision(issueId, decision, issueIdentifier);
  return decision;
}

// ── Fallback handling ─────────────────────────────────────────────────────────

/**
 * Apply the fallback model for an issue when the primary model has failed.
 * Posts a comment noting the fallback reason.
 */
export async function applyFallback(
  issueId: string,
  issueIdentifier: string,
  decision: RouteDecision,
  failureReason: string,
): Promise<void> {
  const fallbackOverrides = { model: decision.fallbackModel };

  const patchRes = await fetch(`${API_URL}/api/issues/${issueId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ assigneeAdapterOverrides: fallbackOverrides }),
  });
  if (!patchRes.ok) {
    const body = await patchRes.text();
    throw new Error(`Failed to apply fallback on ${issueId}: ${patchRes.status} ${body}`);
  }

  const comment = [
    `**Model fallback applied for [${issueIdentifier}](/HOL/issues/${issueIdentifier})**`,
    '',
    `- **Reason:** ${failureReason}`,
    `- **Primary model (failed):** \`${decision.primaryModel}\``,
    `- **Fallback model:** \`${decision.fallbackModel}\` (adapter: \`${decision.fallbackAdapterType}\`)`,
    `- **assigneeAdapterOverrides:** \`${JSON.stringify(fallbackOverrides)}\``,
  ].join('\n');

  const commentRes = await fetch(`${API_URL}/api/issues/${issueId}/comments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ body: comment }),
  });
  if (!commentRes.ok) {
    console.warn(`Failed to post fallback comment on ${issueId}: ${commentRes.status}`);
  }
}
