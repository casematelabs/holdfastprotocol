import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDisputeLog } from "./subscriber.js";
import { VoteOutcome } from "./types.js";

const SIG = "4xAbCdEf1234567890abcdef";

// Canonical valid log line produced by the escrow program.
const VALID_LOG =
  "Program log: VaultPactDisputeSettled " +
  "pact=aabbccdd001122 " +
  "agent=AgentPubkey111111111111111111111111111111111 " +
  "counterparty=CounterpartyPubkey1111111111111111111111111 " +
  "verdict=AgentFaulted";

test("valid log with AgentFaulted parses all fields", () => {
  const event = parseDisputeLog(VALID_LOG, SIG);
  assert.ok(event !== null);
  assert.equal(event.signature,          SIG);
  assert.equal(event.outcome,            VoteOutcome.AgentFaulted);
  assert.equal(event.agentPubkey,        "AgentPubkey111111111111111111111111111111111");
  assert.equal(event.counterpartyPubkey, "CounterpartyPubkey1111111111111111111111111");
  assert.deepEqual(event.pactId, Buffer.from("aabbccdd001122", "hex"));
});

test("valid log with CounterpartyFaulted parses correctly", () => {
  const log   = VALID_LOG.replace("verdict=AgentFaulted", "verdict=CounterpartyFaulted");
  const event = parseDisputeLog(log, SIG);
  assert.ok(event !== null);
  assert.equal(event.outcome, VoteOutcome.CounterpartyFaulted);
});

test("valid log with Mutual parses correctly", () => {
  const log   = VALID_LOG.replace("verdict=AgentFaulted", "verdict=Mutual");
  const event = parseDisputeLog(log, SIG);
  assert.ok(event !== null);
  assert.equal(event.outcome, VoteOutcome.Mutual);
});

test("line without program-log prefix returns null", () => {
  assert.equal(parseDisputeLog("Program log: SomethingElse pact=aa agent=bb counterparty=cc verdict=Mutual", SIG), null);
  assert.equal(parseDisputeLog("", SIG), null);
  assert.equal(parseDisputeLog("VaultPactDisputeSettled pact=aabbccdd001122 agent=x counterparty=y verdict=Mutual", SIG), null);
});

test("log missing counterparty field returns null", () => {
  const log = "Program log: VaultPactDisputeSettled pact=aabbccdd001122 agent=AgentPubkey111111111111111111111111111111111 verdict=AgentFaulted";
  assert.equal(parseDisputeLog(log, SIG), null);
});

test("log missing agent field returns null", () => {
  const log = "Program log: VaultPactDisputeSettled pact=aabbccdd001122 counterparty=CounterpartyPubkey1111111111111111111111111 verdict=AgentFaulted";
  assert.equal(parseDisputeLog(log, SIG), null);
});

test("pact field shorter than 14 hex chars returns null", () => {
  const log = VALID_LOG.replace("pact=aabbccdd001122", "pact=aabb"); // 4 chars
  assert.equal(parseDisputeLog(log, SIG), null);
});

test("pact field longer than 14 hex chars returns null", () => {
  const log = VALID_LOG.replace("pact=aabbccdd001122", "pact=aabbccdd00112233"); // 18 chars
  assert.equal(parseDisputeLog(log, SIG), null);
});

test("unknown verdict string returns null", () => {
  const log = VALID_LOG.replace("verdict=AgentFaulted", "verdict=UnknownVerdict");
  assert.equal(parseDisputeLog(log, SIG), null);
});

test("detectedAt is set to unix seconds approximately equal to now", () => {
  const before = Math.floor(Date.now() / 1000);
  const event  = parseDisputeLog(VALID_LOG, SIG);
  const after  = Math.floor(Date.now() / 1000);
  assert.ok(event !== null);
  assert.ok(
    event.detectedAt >= before && event.detectedAt <= after,
    `detectedAt=${event.detectedAt} out of range [${before}, ${after}]`,
  );
});
