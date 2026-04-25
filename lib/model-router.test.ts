/**
 * Unit tests for model-router — HOL-8
 *
 * Run: node --import tsx/esm --test lib/model-router.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeTask,
  formatRoutingAuditComment,
  parseTaskType,
  riskLevelFromPriority,
  adapterTypeForModel,
  TaskType,
  RiskLevel,
  AdapterType,
  ModelId,
  type TaskMetadata,
} from './model-router.js';

// ── routeTask — routing table entries ─────────────────────────────────────────

describe('routeTask — routing table', () => {
  test('strategy → claude_opus primary', () => {
    const d = routeTask({ task_type: TaskType.strategy });
    assert.equal(d.primaryModel, ModelId.claude_opus);
    assert.equal(d.primaryAdapterType, AdapterType.claude_local);
    assert.equal(d.fallbackModel, ModelId.claude_sonnet);
  });

  test('architecture_review → deepseek_reasoner_max primary', () => {
    const d = routeTask({ task_type: TaskType.architecture_review });
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner_max);
    assert.equal(d.primaryAdapterType, AdapterType.opencode_local);
    assert.equal(d.fallbackModel, ModelId.claude_opus);
  });

  test('code_generation → codex primary', () => {
    const d = routeTask({ task_type: TaskType.code_generation });
    assert.equal(d.primaryModel, ModelId.codex);
    assert.equal(d.primaryAdapterType, AdapterType.codex_local);
    assert.equal(d.fallbackModel, ModelId.claude_sonnet);
  });

  test('security_review → deepseek_reasoner primary', () => {
    const d = routeTask({ task_type: TaskType.security_review });
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner);
    assert.equal(d.primaryAdapterType, AdapterType.opencode_local);
  });

  test('final_security_gate → deepseek_reasoner_max primary', () => {
    const d = routeTask({ task_type: TaskType.final_security_gate });
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner_max);
    assert.equal(d.primaryAdapterType, AdapterType.opencode_local);
  });

  test('docs_sdk → claude_sonnet primary', () => {
    const d = routeTask({ task_type: TaskType.docs_sdk });
    assert.equal(d.primaryModel, ModelId.claude_sonnet);
    assert.equal(d.primaryAdapterType, AdapterType.claude_local);
  });

  test('marketing_narrative → claude_sonnet primary', () => {
    const d = routeTask({ task_type: TaskType.marketing_narrative });
    assert.equal(d.primaryModel, ModelId.claude_sonnet);
  });

  test('solana_contract_work → codex primary', () => {
    const d = routeTask({ task_type: TaskType.solana_contract_work });
    assert.equal(d.primaryModel, ModelId.codex);
    assert.equal(d.primaryAdapterType, AdapterType.codex_local);
  });
});

// ── routeTask — decision rules ────────────────────────────────────────────────

describe('routeTask — decision rules', () => {
  test('rule 1: explicit preferred_model overrides everything', () => {
    const d = routeTask({
      task_type:       TaskType.strategy,
      preferred_model: ModelId.claude_haiku,
    });
    assert.equal(d.primaryModel, ModelId.claude_haiku);
    assert.equal(d.ruleApplied, 'explicit_preferred_model');
  });

  test('rule 1: preferred_model + explicit fallback_model', () => {
    const d = routeTask({
      task_type:      TaskType.strategy,
      preferred_model: ModelId.claude_haiku,
      fallback_model:  ModelId.deepseek_reasoner,
    });
    assert.equal(d.primaryModel, ModelId.claude_haiku);
    assert.equal(d.fallbackModel, ModelId.deepseek_reasoner);
  });

  test('rule 2: critical risk_level → deepseek_reasoner_max', () => {
    const d = routeTask({
      task_type:  TaskType.docs_sdk,
      risk_level: RiskLevel.critical,
    });
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner_max);
    assert.equal(d.ruleApplied, 'critical_risk_or_final_security_gate');
  });

  test('rule 2: final_security_gate overrides even without critical risk', () => {
    const d = routeTask({
      task_type:  TaskType.final_security_gate,
      risk_level: RiskLevel.low,
    });
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner_max);
    assert.equal(d.ruleApplied, 'critical_risk_or_final_security_gate');
  });

  test('rule 3: requires_code → codex (even for strategy task_type)', () => {
    const d = routeTask({
      task_type:    TaskType.strategy,
      requires_code: true,
    });
    assert.equal(d.primaryModel, ModelId.codex);
    assert.equal(d.primaryAdapterType, AdapterType.codex_local);
    assert.equal(d.ruleApplied, 'requires_code');
  });

  test('rule 3: requires_code does not override critical risk (rule 2 wins)', () => {
    const d = routeTask({
      task_type:    TaskType.strategy,
      risk_level:   RiskLevel.critical,
      requires_code: true,
    });
    // Rule 2 fires before rule 3
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner_max);
    assert.equal(d.ruleApplied, 'critical_risk_or_final_security_gate');
  });

  test('rule 4: security_review → deepseek_reasoner via rule 4', () => {
    const d = routeTask({
      task_type:  TaskType.security_review,
      risk_level: RiskLevel.medium,
    });
    assert.equal(d.primaryModel, ModelId.deepseek_reasoner);
    assert.equal(d.ruleApplied, 'security_or_architecture_task_type');
  });

  test('rule 5: approval_package → claude_opus via rule 5', () => {
    const d = routeTask({
      task_type:  TaskType.approval_package,
      risk_level: RiskLevel.low,
    });
    assert.equal(d.primaryModel, ModelId.claude_sonnet);
    assert.equal(d.ruleApplied, 'strategy_or_approval_task_type');
  });
});

// ── assigneeAdapterOverrides shape ────────────────────────────────────────────

describe('assigneeAdapterOverrides', () => {
  test('contains model field matching primary model', () => {
    const d = routeTask({ task_type: TaskType.code_generation });
    assert.deepEqual(d.assigneeAdapterOverrides, { model: ModelId.codex });
  });

  test('explicit override: contains overridden model', () => {
    const d = routeTask({
      task_type:       TaskType.qa_review,
      preferred_model: ModelId.claude_opus,
    });
    assert.deepEqual(d.assigneeAdapterOverrides, { model: ModelId.claude_opus });
  });
});

// ── formatRoutingAuditComment ─────────────────────────────────────────────────

describe('formatRoutingAuditComment', () => {
  test('includes task type, rule, models, and identifier link', () => {
    const d = routeTask({ task_type: TaskType.strategy });
    const comment = formatRoutingAuditComment(d, 'HOL-8');
    assert.match(comment, /HOL-8/);
    assert.match(comment, /strategy/);
    assert.match(comment, /claude-opus-4-7/);
    assert.match(comment, /claude_local/);
    assert.match(comment, /assigneeAdapterOverrides/);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('parseTaskType', () => {
  test('parses known task type string', () => {
    assert.equal(parseTaskType('code_generation'), TaskType.code_generation);
  });

  test('normalises hyphens to underscores', () => {
    assert.equal(parseTaskType('code-generation'), TaskType.code_generation);
  });

  test('returns undefined for unknown type', () => {
    assert.equal(parseTaskType('unknown_xyz'), undefined);
  });
});

describe('riskLevelFromPriority', () => {
  test('maps critical → critical', () => {
    assert.equal(riskLevelFromPriority('critical'), RiskLevel.critical);
  });

  test('maps high → high', () => {
    assert.equal(riskLevelFromPriority('high'), RiskLevel.high);
  });

  test('maps medium → medium', () => {
    assert.equal(riskLevelFromPriority('medium'), RiskLevel.medium);
  });

  test('maps unknown → low', () => {
    assert.equal(riskLevelFromPriority('unknown'), RiskLevel.low);
  });
});

describe('adapterTypeForModel', () => {
  test('claude models → claude_local', () => {
    assert.equal(adapterTypeForModel(ModelId.claude_opus), AdapterType.claude_local);
    assert.equal(adapterTypeForModel(ModelId.claude_sonnet), AdapterType.claude_local);
  });

  test('deepseek models → opencode_local', () => {
    assert.equal(adapterTypeForModel(ModelId.deepseek_reasoner), AdapterType.opencode_local);
    assert.equal(adapterTypeForModel(ModelId.deepseek_reasoner_max), AdapterType.opencode_local);
  });

  test('codex model → codex_local', () => {
    assert.equal(adapterTypeForModel(ModelId.codex), AdapterType.codex_local);
  });
});
