import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReputationProvider } from "../providers/reputationProvider.js";
import { makeActivePactsProvider } from "../providers/activePactsProvider.js";
import { makeReputationThresholdEvaluator } from "../evaluators/reputationThreshold.js";

const fakeRuntime = {} as never;
const fakeMessage = { content: {} } as never;
const fakeState = {} as never;

const AGENT_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const COUNTERPARTY  = "7WNp3pFzBs1wLXsqMLXUKnUWGMH6qDMWpH8p2zQVqjVh";

// ─── reputationProvider ───────────────────────────────────────────────────────

test("reputationProvider: returns empty object when agentWallet not configured", async () => {
  const provider = makeReputationProvider({} as never, undefined);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.deepEqual(result, {});
});

test("reputationProvider: returns formatted text with all reputation fields", async () => {
  const client = {
    reputation: {
      get: async () => ({ tier: "Gold", score: 92, totalPacts: 14, disputeCount: 1 }),
    },
  } as never;
  const provider = makeReputationProvider(client, AGENT_WALLET);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.ok(typeof result.text === "string");
  assert.match(result.text!, /Tier: Gold/);
  assert.match(result.text!, /Score: 92/);
  assert.match(result.text!, /Completed: 14/);
  assert.match(result.text!, /Disputed: 1/);
});

test("reputationProvider: returns empty object when client throws", async () => {
  const client = {
    reputation: { get: async () => { throw new Error("RPC down"); } },
  } as never;
  const provider = makeReputationProvider(client, AGENT_WALLET);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.deepEqual(result, {});
});

// ─── activePactsProvider ──────────────────────────────────────────────────────

test("activePactsProvider: returns empty object when agentWallet not configured", async () => {
  const provider = makeActivePactsProvider({} as never, undefined);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.deepEqual(result, {});
});

test("activePactsProvider: returns 'No active pacts' when list is empty", async () => {
  const client = { escrow: { listPacts: async () => ({ pacts: [] }) } } as never;
  const provider = makeActivePactsProvider(client, AGENT_WALLET);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.match(result.text!, /No active pacts/);
});

test("activePactsProvider: lists pact escrowId and beneficiary in output", async () => {
  const pacts = [
    { escrowId: "EscrowAAA", status: "funded", beneficiary: "BeneficiaryXYZ" },
    { escrowId: "EscrowBBB", status: "funded", beneficiary: "BeneficiaryABC" },
  ];
  const client = { escrow: { listPacts: async () => ({ pacts }) } } as never;
  const provider = makeActivePactsProvider(client, AGENT_WALLET);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.match(result.text!, /EscrowAAA/);
  assert.match(result.text!, /EscrowBBB/);
  assert.match(result.text!, /BeneficiaryXYZ/);
});

test("activePactsProvider: omits excess pacts when token budget exceeded", async () => {
  // 100 pacts × ~100 chars each = well over 800-token budget
  const pacts = Array.from({ length: 100 }, (_, i) => ({
    escrowId: `Escrow${"X".repeat(40)}${i}`,
    status: "funded",
    beneficiary: `Beneficiary${"Y".repeat(40)}`,
  }));
  const client = { escrow: { listPacts: async () => ({ pacts }) } } as never;
  const provider = makeActivePactsProvider(client, AGENT_WALLET);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.match(result.text!, /omitted/);
});

test("activePactsProvider: returns empty object when client throws", async () => {
  const client = {
    escrow: { listPacts: async () => { throw new Error("indexer down"); } },
  } as never;
  const provider = makeActivePactsProvider(client, AGENT_WALLET);
  const result = await provider.get(fakeRuntime, fakeMessage, fakeState);
  assert.deepEqual(result, {});
});

// ─── reputationThresholdEvaluator ─────────────────────────────────────────────

test("reputationThresholdEvaluator validate: true when action is CREATE_PACT", async () => {
  const evaluator = makeReputationThresholdEvaluator({} as never);
  const msg = { content: { action: "CREATE_PACT" } } as never;
  assert.equal(await evaluator.validate(fakeRuntime, msg), true);
});

test("reputationThresholdEvaluator validate: false when action is not CREATE_PACT", async () => {
  const evaluator = makeReputationThresholdEvaluator({} as never);
  const msg = { content: { action: "CHECK_REPUTATION" } } as never;
  assert.equal(await evaluator.validate(fakeRuntime, msg), false);
});

test("reputationThresholdEvaluator handler: no-ops silently when counterparty missing", async () => {
  const evaluator = makeReputationThresholdEvaluator({} as never);
  const msg = { content: { action: "CREATE_PACT", options: {} } } as never;
  await assert.doesNotReject(() => evaluator.handler(fakeRuntime, msg));
});

test("reputationThresholdEvaluator handler: calls meetsRequirements for counterparty", async () => {
  let called = false;
  const client = {
    reputation: {
      meetsRequirements: async () => { called = true; return true; },
    },
  } as never;
  const msg = {
    content: { action: "CREATE_PACT", options: { counterparty: COUNTERPARTY } },
  } as never;
  await makeReputationThresholdEvaluator(client).handler(fakeRuntime, msg);
  assert.equal(called, true);
});

test("reputationThresholdEvaluator handler: swallows errors non-fatally", async () => {
  const client = {
    reputation: { meetsRequirements: async () => { throw new Error("SDK error"); } },
  } as never;
  const msg = {
    content: { action: "CREATE_PACT", options: { counterparty: COUNTERPARTY } },
  } as never;
  await assert.doesNotReject(() => makeReputationThresholdEvaluator(client).handler(fakeRuntime, msg));
});
