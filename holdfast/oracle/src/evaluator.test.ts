import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDispute } from "./evaluator.js";
import { PactOutcome, VoteOutcome, type DisputeEvent } from "./types.js";

const AGENT       = "AgentPubkey111111111111111111111111111111111";
const COUNTERPART = "CounterpartyPubkey1111111111111111111111111";
const PACT_ID     = Buffer.from("aabbccdd001122", "hex");

function makeEvent(outcome: VoteOutcome): DisputeEvent {
  return {
    signature:           "sig1",
    pactId:              PACT_ID,
    agentPubkey:         AGENT,
    counterpartyPubkey:  COUNTERPART,
    outcome,
    detectedAt:          1_700_000_000,
  };
}

test("AgentFaulted: agent -400 (Disputed), counterparty +20 (Disputed)", () => {
  const [agentUpd, ctrUpd] = evaluateDispute(makeEvent(VoteOutcome.AgentFaulted));
  assert.equal(agentUpd.agentPubkey,    AGENT);
  assert.equal(agentUpd.scoreDelta,     -400);
  assert.equal(agentUpd.onChainOutcome, PactOutcome.Disputed);
  assert.equal(ctrUpd.agentPubkey,      COUNTERPART);
  assert.equal(ctrUpd.scoreDelta,       20);
  assert.equal(ctrUpd.onChainOutcome,   PactOutcome.Disputed);
});

test("CounterpartyFaulted: agent +20 (Disputed), counterparty -400 (Disputed)", () => {
  const [agentUpd, ctrUpd] = evaluateDispute(makeEvent(VoteOutcome.CounterpartyFaulted));
  assert.equal(agentUpd.scoreDelta,     20);
  assert.equal(agentUpd.onChainOutcome, PactOutcome.Disputed);
  assert.equal(ctrUpd.scoreDelta,       -400);
  assert.equal(ctrUpd.onChainOutcome,   PactOutcome.Disputed);
});

test("Mutual: both 0 delta (Cancelled)", () => {
  const [agentUpd, ctrUpd] = evaluateDispute(makeEvent(VoteOutcome.Mutual));
  assert.equal(agentUpd.scoreDelta,     0);
  assert.equal(agentUpd.onChainOutcome, PactOutcome.Cancelled);
  assert.equal(ctrUpd.scoreDelta,       0);
  assert.equal(ctrUpd.onChainOutcome,   PactOutcome.Cancelled);
});

test("pactId is threaded through to both updates", () => {
  const [a, b] = evaluateDispute(makeEvent(VoteOutcome.AgentFaulted));
  assert.deepEqual(a.pactId, PACT_ID);
  assert.deepEqual(b.pactId, PACT_ID);
});

test("first element always refers to agent, second to counterparty", () => {
  for (const outcome of [VoteOutcome.AgentFaulted, VoteOutcome.CounterpartyFaulted, VoteOutcome.Mutual]) {
    const [a, b] = evaluateDispute(makeEvent(outcome));
    assert.equal(a.agentPubkey, AGENT,       `outcome=${outcome}: first update should be for agent`);
    assert.equal(b.agentPubkey, COUNTERPART, `outcome=${outcome}: second update should be for counterparty`);
  }
});
