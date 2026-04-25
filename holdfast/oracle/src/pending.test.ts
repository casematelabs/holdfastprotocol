import { test } from "node:test";
import assert from "node:assert/strict";
import { PendingQueue } from "./pending.js";
import { VoteOutcome, type DisputeEvent } from "./types.js";

function makeEvent(pactHex: string, detectedAt = 1_700_000_000): DisputeEvent {
  return {
    signature:           "sig1",
    pactId:              Buffer.from(pactHex, "hex"),
    agentPubkey:         "AgentPubkey111111111111111111111111111111111",
    counterpartyPubkey:  "CounterpartyPubkey1111111111111111111111111",
    outcome:             VoteOutcome.AgentFaulted,
    detectedAt,
  };
}

test("empty queue has size 0", () => {
  const q = new PendingQueue(72 * 3600);
  assert.equal(q.size(), 0);
});

test("add increases size, remove decreases it", () => {
  const q = new PendingQueue(72 * 3600);
  const e = makeEvent("aabbccdd001122");
  q.add(e);
  assert.equal(q.size(), 1);
  q.remove(e);
  assert.equal(q.size(), 0);
});

test("adding the same dispute key twice does not grow size past 1", () => {
  const q = new PendingQueue(72 * 3600);
  const e = makeEvent("aabbccdd001122");
  q.add(e);
  q.add(e);
  assert.equal(q.size(), 1);
});

test("distinct pact ids occupy separate slots", () => {
  const q = new PendingQueue(72 * 3600);
  q.add(makeEvent("aabbccdd001122"));
  q.add(makeEvent("ddeeff00112233"));
  assert.equal(q.size(), 2);
});

test("remove of unknown event is a no-op", () => {
  const q = new PendingQueue(72 * 3600);
  q.remove(makeEvent("aabbccdd001122")); // never added
  assert.equal(q.size(), 0);
});

test("checkDeadlines warns for overdue disputes", () => {
  // timeout=0 so deadline = detectedAt = 0, which is long in the past
  const q = new PendingQueue(0);
  q.add(makeEvent("aabbccdd001122", 0));

  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    q.checkDeadlines();
  } finally {
    console.warn = orig;
  }
  assert.ok(warnings.length > 0,              "expected a warning for overdue dispute");
  assert.ok(warnings[0].includes("MISSED VOTE DEADLINE"), `warning text: ${warnings[0]}`);
});

test("checkDeadlines does not warn for in-window disputes", () => {
  const q = new PendingQueue(72 * 3600);
  const now = Math.floor(Date.now() / 1000);
  q.add(makeEvent("aabbccdd001122", now)); // deadline = now + 72h

  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    q.checkDeadlines();
  } finally {
    console.warn = orig;
  }
  assert.equal(warnings.length, 0, "expected no warnings for in-window dispute");
});

test("checkDeadlines warns only for overdue subset when mixed", () => {
  const now = Math.floor(Date.now() / 1000);
  const q = new PendingQueue(0); // 0-second window so detectedAt determines deadline directly
  q.add(makeEvent("aabbccdd001122", 0));    // overdue: deadline=0
  q.add(makeEvent("ddeeff00112233", now + 99999)); // future: deadline=now+99999

  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    q.checkDeadlines();
  } finally {
    console.warn = orig;
  }
  assert.equal(warnings.length, 1, "expected exactly one warning for the overdue dispute");
});
