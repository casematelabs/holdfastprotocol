import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReputationLog } from "./parser.js";
import { PactOutcome } from "./types.js";

const AGENT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const VALID_LOG = `Reputation updated: agent=${AGENT} score=1500 nonce=3 outcome=0`;

// --- valid inputs ---

test("valid log with outcome=0 (Fulfilled) parses all fields", () => {
  const result = parseReputationLog(VALID_LOG);
  assert.ok(result !== null);
  assert.equal(result.agent, AGENT);
  assert.equal(result.score, 1500);
  assert.equal(result.nonce, 3);
  assert.equal(result.outcome, PactOutcome.Fulfilled);
});

test("valid log with outcome=1 (Disputed) parses correctly", () => {
  const log = `Reputation updated: agent=${AGENT} score=800 nonce=7 outcome=1`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.outcome, PactOutcome.Disputed);
});

test("valid log with outcome=2 (Cancelled) parses correctly", () => {
  const log = `Reputation updated: agent=${AGENT} score=200 nonce=99 outcome=2`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.outcome, PactOutcome.Cancelled);
});

test("valid log with score=0 and nonce=0", () => {
  const log = `Reputation updated: agent=${AGENT} score=0 nonce=0 outcome=0`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.score, 0);
  assert.equal(result.nonce, 0);
});

test("valid log with large score value", () => {
  const largeScore = Number.MAX_SAFE_INTEGER;
  const log = `Reputation updated: agent=${AGENT} score=${largeScore} nonce=1 outcome=0`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.score, largeScore);
});

test("valid log with large nonce value", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=99999 outcome=2`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.nonce, 99999);
});

test("leading and trailing whitespace is trimmed and parsed", () => {
  const log = `  Reputation updated: agent=${AGENT} score=100 nonce=1 outcome=0  `;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.agent, AGENT);
});

test("agent field is extracted verbatim", () => {
  const shortAgent = "ABC123def";
  const log = `Reputation updated: agent=${shortAgent} score=0 nonce=0 outcome=0`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.agent, shortAgent);
});

test("score is a JS number", () => {
  const log = `Reputation updated: agent=${AGENT} score=42 nonce=0 outcome=0`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(typeof result.score, "number");
  assert.equal(result.score, 42);
});

test("nonce is a JS number", () => {
  const log = `Reputation updated: agent=${AGENT} score=0 nonce=17 outcome=0`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(typeof result.nonce, "number");
  assert.equal(result.nonce, 17);
});

test("outcome=0 maps to PactOutcome.Fulfilled (value 0)", () => {
  const log = `Reputation updated: agent=${AGENT} score=0 nonce=0 outcome=0`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.outcome, 0);
});

test("outcome=1 maps to PactOutcome.Disputed (value 1)", () => {
  const log = `Reputation updated: agent=${AGENT} score=0 nonce=0 outcome=1`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.outcome, 1);
});

test("outcome=2 maps to PactOutcome.Cancelled (value 2)", () => {
  const log = `Reputation updated: agent=${AGENT} score=0 nonce=0 outcome=2`;
  const result = parseReputationLog(log);
  assert.ok(result !== null);
  assert.equal(result.outcome, 2);
});

// --- invalid inputs ---

test("empty string returns null", () => {
  assert.equal(parseReputationLog(""), null);
});

test("outcome=3 (out of range) returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=1 outcome=3`;
  assert.equal(parseReputationLog(log), null);
});

test("outcome=99 (far out of range) returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=1 outcome=99`;
  assert.equal(parseReputationLog(log), null);
});

test("wrong prefix returns null", () => {
  const log = `Rep updated: agent=${AGENT} score=100 nonce=1 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("missing prefix returns null", () => {
  const log = `agent=${AGENT} score=100 nonce=1 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("lowercase prefix returns null (case-sensitive match)", () => {
  const log = `reputation updated: agent=${AGENT} score=100 nonce=1 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("extra trailing content returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=1 outcome=0 extra`;
  assert.equal(parseReputationLog(log), null);
});

test("missing outcome field returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=1`;
  assert.equal(parseReputationLog(log), null);
});

test("missing nonce field returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("missing score field returns null", () => {
  const log = `Reputation updated: agent=${AGENT} nonce=1 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("non-numeric score returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=abc nonce=1 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("non-numeric nonce returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=xyz outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("non-numeric outcome returns null", () => {
  const log = `Reputation updated: agent=${AGENT} score=100 nonce=1 outcome=Fulfilled`;
  assert.equal(parseReputationLog(log), null);
});

test("double space between fields returns null", () => {
  const log = `Reputation updated:  agent=${AGENT} score=100 nonce=1 outcome=0`;
  assert.equal(parseReputationLog(log), null);
});

test("random program log line returns null", () => {
  assert.equal(parseReputationLog("Program log: Hello world"), null);
});

test("whitespace-only string returns null", () => {
  assert.equal(parseReputationLog("   "), null);
});
