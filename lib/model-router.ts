/**
 * Dynamic Model Routing Layer — HOL-8
 *
 * Classifies tasks and selects the optimal model/adapter based on task type,
 * risk level, and routing rules defined in HOL-6. The Orchestrator uses this
 * to populate `assigneeAdapterOverrides` on issue create/update so each agent
 * runs the right model for each specific task.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export const TaskType = {
  strategy:              'strategy',
  task_decomposition:    'task_decomposition',
  architecture_review:   'architecture_review',
  code_generation:       'code_generation',
  solana_contract_work:  'solana_contract_work',
  integration_work:      'integration_work',
  test_generation:       'test_generation',
  qa_review:             'qa_review',
  security_review:       'security_review',
  final_security_gate:   'final_security_gate',
  docs_sdk:              'docs_sdk',
  marketing_narrative:   'marketing_narrative',
  devops_scripts:        'devops_scripts',
  release_planning:      'release_planning',
  approval_package:      'approval_package',
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const RiskLevel = {
  low:      'low',
  medium:   'medium',
  high:     'high',
  critical: 'critical',
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const AdapterType = {
  claude_local:   'claude_local',
  opencode_local: 'opencode_local',
  codex_local:    'codex_local',
} as const;

export type AdapterType = (typeof AdapterType)[keyof typeof AdapterType];

// ── Models ────────────────────────────────────────────────────────────────────

/** Model IDs used in adapter config overrides */
export const ModelId = {
  // Claude family (claude_local)
  claude_opus:       'claude-opus-4-7',
  claude_sonnet:     'claude-sonnet-4-6',
  claude_haiku:      'claude-haiku-4-5-20251001',

  // DeepSeek / OpenCode family (opencode_local)
  deepseek_reasoner:     'deepseek-reasoner',
  deepseek_reasoner_max: 'deepseek-reasoner-max',

  // OpenAI Codex family (codex_local)
  codex:             'codex',
  gpt4o:             'gpt-4o',
} as const;

export type ModelId = (typeof ModelId)[keyof typeof ModelId];

// ── Task Metadata ─────────────────────────────────────────────────────────────

/** Routing hints attached to a task. Read from issue labels/metadata on assignment. */
export interface TaskMetadata {
  task_type:                 TaskType;
  risk_level?:               RiskLevel;
  requires_code?:            boolean;
  requires_security_review?: boolean;
  /** Explicit model override — skips routing table, still logs decision. */
  preferred_model?:          ModelId;
  /** Explicit fallback override. */
  fallback_model?:           ModelId;
  acceptance_criteria?:      string[];
}

// ── Routing Table ─────────────────────────────────────────────────────────────

interface RoutingEntry {
  primaryAdapterType:   AdapterType;
  primaryModel:         ModelId;
  fallbackAdapterType:  AdapterType;
  fallbackModel:        ModelId;
}

/** Routing table from HOL-6 architecture plan */
const ROUTING_TABLE: Record<TaskType, RoutingEntry> = {
  strategy: {
    primaryAdapterType:  AdapterType.claude_local,
    primaryModel:        ModelId.claude_opus,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_sonnet,
  },
  task_decomposition: {
    primaryAdapterType:  AdapterType.claude_local,
    primaryModel:        ModelId.claude_sonnet,
    fallbackAdapterType: AdapterType.opencode_local,
    fallbackModel:       ModelId.deepseek_reasoner,
  },
  architecture_review: {
    primaryAdapterType:  AdapterType.opencode_local,
    primaryModel:        ModelId.deepseek_reasoner_max,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_opus,
  },
  code_generation: {
    primaryAdapterType:  AdapterType.codex_local,
    primaryModel:        ModelId.codex,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_sonnet,
  },
  solana_contract_work: {
    primaryAdapterType:  AdapterType.codex_local,
    primaryModel:        ModelId.codex,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_sonnet,
  },
  integration_work: {
    primaryAdapterType:  AdapterType.codex_local,
    primaryModel:        ModelId.codex,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_sonnet,
  },
  test_generation: {
    primaryAdapterType:  AdapterType.codex_local,
    primaryModel:        ModelId.codex,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_sonnet,
  },
  qa_review: {
    primaryAdapterType:  AdapterType.codex_local,
    primaryModel:        ModelId.codex,
    fallbackAdapterType: AdapterType.opencode_local,
    fallbackModel:       ModelId.deepseek_reasoner,
  },
  security_review: {
    primaryAdapterType:  AdapterType.opencode_local,
    primaryModel:        ModelId.deepseek_reasoner,
    fallbackAdapterType: AdapterType.opencode_local,
    fallbackModel:       ModelId.deepseek_reasoner_max,
  },
  final_security_gate: {
    primaryAdapterType:  AdapterType.opencode_local,
    primaryModel:        ModelId.deepseek_reasoner_max,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_opus,
  },
  docs_sdk: {
    primaryAdapterType:  AdapterType.claude_local,
    primaryModel:        ModelId.claude_sonnet,
    fallbackAdapterType: AdapterType.codex_local,
    fallbackModel:       ModelId.codex,
  },
  marketing_narrative: {
    primaryAdapterType:  AdapterType.claude_local,
    primaryModel:        ModelId.claude_sonnet,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_opus,
  },
  devops_scripts: {
    primaryAdapterType:  AdapterType.codex_local,
    primaryModel:        ModelId.codex,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_sonnet,
  },
  release_planning: {
    primaryAdapterType:  AdapterType.claude_local,
    primaryModel:        ModelId.claude_sonnet,
    fallbackAdapterType: AdapterType.opencode_local,
    fallbackModel:       ModelId.deepseek_reasoner,
  },
  approval_package: {
    primaryAdapterType:  AdapterType.claude_local,
    primaryModel:        ModelId.claude_sonnet,
    fallbackAdapterType: AdapterType.claude_local,
    fallbackModel:       ModelId.claude_opus,
  },
};

// ── Decision Result ───────────────────────────────────────────────────────────

export interface RouteDecision {
  taskType:             TaskType;
  primaryAdapterType:   AdapterType;
  primaryModel:         ModelId;
  fallbackAdapterType:  AdapterType;
  fallbackModel:        ModelId;
  /** The override dict to pass as `assigneeAdapterOverrides` in the Paperclip API. */
  assigneeAdapterOverrides: { model: ModelId };
  ruleApplied:          string;
}

// ── Router Decision Rules ─────────────────────────────────────────────────────

/**
 * Route a task to the optimal model based on its metadata.
 *
 * Priority order:
 *  1. Explicit preferred_model override
 *  2. risk_level=critical or final_security_gate → DeepSeek Reasoner Max
 *  3. requires_code=true → Codex primary
 *  4. security_review / architecture_review → DeepSeek Reasoner
 *  5. strategy / approval_package → Claude Opus
 *  6. Routing table entry for task_type
 *  7. Default → Claude Sonnet
 */
export function routeTask(metadata: TaskMetadata): RouteDecision {
  let entry: RoutingEntry;
  let ruleApplied: string;

  // Rule 1: explicit override wins
  if (metadata.preferred_model) {
    const fallback = metadata.fallback_model ?? ModelId.claude_sonnet;
    return {
      taskType:            metadata.task_type,
      primaryAdapterType:  adapterTypeForModel(metadata.preferred_model),
      primaryModel:        metadata.preferred_model,
      fallbackAdapterType: adapterTypeForModel(fallback),
      fallbackModel:       fallback,
      assigneeAdapterOverrides: { model: metadata.preferred_model },
      ruleApplied:         'explicit_preferred_model',
    };
  }

  // Rule 2: critical risk or final_security_gate → DeepSeek Reasoner Max
  if (
    metadata.risk_level === RiskLevel.critical ||
    metadata.task_type === TaskType.final_security_gate
  ) {
    entry = {
      primaryAdapterType:  AdapterType.opencode_local,
      primaryModel:        ModelId.deepseek_reasoner_max,
      fallbackAdapterType: AdapterType.claude_local,
      fallbackModel:       ModelId.claude_opus,
    };
    ruleApplied = 'critical_risk_or_final_security_gate';
  }
  // Rule 3: requires_code → Codex
  else if (metadata.requires_code) {
    entry = {
      primaryAdapterType:  AdapterType.codex_local,
      primaryModel:        ModelId.codex,
      fallbackAdapterType: AdapterType.claude_local,
      fallbackModel:       ModelId.claude_sonnet,
    };
    ruleApplied = 'requires_code';
  }
  // Rule 4: security/architecture → DeepSeek Reasoner
  else if (
    metadata.task_type === TaskType.security_review ||
    metadata.task_type === TaskType.architecture_review
  ) {
    entry = ROUTING_TABLE[metadata.task_type];
    ruleApplied = 'security_or_architecture_task_type';
  }
  // Rule 5: strategy → Opus; approval_package → Sonnet (from routing table)
  else if (
    metadata.task_type === TaskType.strategy ||
    metadata.task_type === TaskType.approval_package
  ) {
    entry = ROUTING_TABLE[metadata.task_type];
    ruleApplied = 'strategy_or_approval_task_type';
  }
  // Rule 6: routing table
  else if (ROUTING_TABLE[metadata.task_type]) {
    entry = ROUTING_TABLE[metadata.task_type];
    ruleApplied = `routing_table:${metadata.task_type}`;
  }
  // Rule 7: default
  else {
    entry = {
      primaryAdapterType:  AdapterType.claude_local,
      primaryModel:        ModelId.claude_sonnet,
      fallbackAdapterType: AdapterType.claude_local,
      fallbackModel:       ModelId.claude_opus,
    };
    ruleApplied = 'default_sonnet';
  }

  return {
    taskType:             metadata.task_type,
    primaryAdapterType:   entry.primaryAdapterType,
    primaryModel:         entry.primaryModel,
    fallbackAdapterType:  entry.fallbackAdapterType,
    fallbackModel:        entry.fallbackModel,
    assigneeAdapterOverrides: { model: entry.primaryModel },
    ruleApplied,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the expected adapter type for a given model ID. */
export function adapterTypeForModel(model: ModelId): AdapterType {
  if (model.startsWith('claude-')) return AdapterType.claude_local;
  if (model.startsWith('deepseek-')) return AdapterType.opencode_local;
  return AdapterType.codex_local;
}

/** Build a human-readable audit string for a routing decision comment. */
export function formatRoutingAuditComment(
  decision: RouteDecision,
  issueIdentifier: string,
): string {
  return [
    `**Model routing decision for [${issueIdentifier}](/HOL/issues/${issueIdentifier})**`,
    '',
    `- **Task type:** \`${decision.taskType}\``,
    `- **Rule applied:** \`${decision.ruleApplied}\``,
    `- **Primary model:** \`${decision.primaryModel}\` (adapter: \`${decision.primaryAdapterType}\`)`,
    `- **Fallback model:** \`${decision.fallbackModel}\` (adapter: \`${decision.fallbackAdapterType}\`)`,
    `- **assigneeAdapterOverrides:** \`${JSON.stringify(decision.assigneeAdapterOverrides)}\``,
  ].join('\n');
}

/**
 * Parse task_type from an issue label string, returning undefined when the
 * label does not match any known task type.
 */
export function parseTaskType(label: string): TaskType | undefined {
  const normalized = label.toLowerCase().replace(/[-\s]/g, '_') as TaskType;
  return (Object.values(TaskType) as string[]).includes(normalized)
    ? (normalized as TaskType)
    : undefined;
}

/**
 * Parse risk_level from an issue priority string.
 * Maps Paperclip priorities (critical/high/medium/low) to RiskLevel values.
 */
export function riskLevelFromPriority(priority: string): RiskLevel {
  const p = priority.toLowerCase();
  if (p === 'critical') return RiskLevel.critical;
  if (p === 'high')     return RiskLevel.high;
  if (p === 'medium')   return RiskLevel.medium;
  return RiskLevel.low;
}
