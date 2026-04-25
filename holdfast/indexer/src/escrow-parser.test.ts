import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEscrowLog } from "./escrow-parser.js";

// --- each event kind ---

test("'Escrow initialized:' -> kind=initialized, idx=1", () => {
  const result = parseEscrowLog("Escrow initialized: escrow=abc123");
  assert.ok(result !== null);
  assert.equal(result.kind, "initialized");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Funds deposited:' -> kind=funded, idx=1", () => {
  const result = parseEscrowLog("Funds deposited: amount=1000000000");
  assert.ok(result !== null);
  assert.equal(result.kind, "funded");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Beneficiary staked:' -> kind=beneficiary_staked, idx=1", () => {
  const result = parseEscrowLog("Beneficiary staked: amount=500000");
  assert.ok(result !== null);
  assert.equal(result.kind, "beneficiary_staked");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Escrow locked' (exact) -> kind=locked, idx=2", () => {
  const result = parseEscrowLog("Escrow locked");
  assert.ok(result !== null);
  assert.equal(result.kind, "locked");
  assert.equal(result.escrowAccountIndex, 2);
});

test("'Escrow released,' -> kind=released, idx=1", () => {
  const result = parseEscrowLog("Escrow released, beneficiary=xyz");
  assert.ok(result !== null);
  assert.equal(result.kind, "released");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Auto-released,' -> kind=auto_released, idx=1", () => {
  const result = parseEscrowLog("Auto-released, escrow=xyz slot=99");
  assert.ok(result !== null);
  assert.equal(result.kind, "auto_released");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Escrow claimed:' -> kind=claimed, idx=1", () => {
  const result = parseEscrowLog("Escrow claimed: beneficiary=abc");
  assert.ok(result !== null);
  assert.equal(result.kind, "claimed");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Dispute raised by' -> kind=dispute_raised, idx=1", () => {
  const result = parseEscrowLog("Dispute raised by initiator=abc123");
  assert.ok(result !== null);
  assert.equal(result.kind, "dispute_raised");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Dispute escalated by' -> kind=dispute_escalated, idx=1", () => {
  const result = parseEscrowLog("Dispute escalated by oracle committee");
  assert.ok(result !== null);
  assert.equal(result.kind, "dispute_escalated");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Dispute resolved:' -> kind=dispute_resolved, idx=1", () => {
  const result = parseEscrowLog("Dispute resolved: verdict=AgentFaulted");
  assert.ok(result !== null);
  assert.equal(result.kind, "dispute_resolved");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Refunded:' -> kind=refunded, idx=1", () => {
  const result = parseEscrowLog("Refunded: amount=1000000000");
  assert.ok(result !== null);
  assert.equal(result.kind, "refunded");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Auto-refunded:' -> kind=auto_refunded, idx=1", () => {
  const result = parseEscrowLog("Auto-refunded: amount=500000000");
  assert.ok(result !== null);
  assert.equal(result.kind, "auto_refunded");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'Protocol freeze:' -> kind=protocol_frozen, idx=1", () => {
  const result = parseEscrowLog("Protocol freeze: reason=compliance_violation");
  assert.ok(result !== null);
  assert.equal(result.kind, "protocol_frozen");
  assert.equal(result.escrowAccountIndex, 1);
});

test("'MutuallyCancelled:' -> kind=mutually_cancelled, idx=2", () => {
  const result = parseEscrowLog("MutuallyCancelled: escrow=abc123");
  assert.ok(result !== null);
  assert.equal(result.kind, "mutually_cancelled");
  assert.equal(result.escrowAccountIndex, 2);
});

test("'Escrow closed' (exact) -> kind=closed, idx=1", () => {
  const result = parseEscrowLog("Escrow closed");
  assert.ok(result !== null);
  assert.equal(result.kind, "closed");
  assert.equal(result.escrowAccountIndex, 1);
});

// --- account index: three-account instructions use idx=2 ---

test("locked and mutually_cancelled are the only kinds with escrowAccountIndex=2", () => {
  const locked = parseEscrowLog("Escrow locked");
  const cancelled = parseEscrowLog("MutuallyCancelled: escrow=abc");
  assert.ok(locked !== null && locked.escrowAccountIndex === 2);
  assert.ok(cancelled !== null && cancelled.escrowAccountIndex === 2);
});

test("initialized, funded, and claimed all use escrowAccountIndex=1", () => {
  for (const line of [
    "Escrow initialized: x",
    "Funds deposited: x",
    "Escrow claimed: x",
  ]) {
    const result = parseEscrowLog(line);
    assert.ok(result !== null, `expected non-null for: ${line}`);
    assert.equal(result.escrowAccountIndex, 1, `expected idx=1 for: ${line}`);
  }
});

// --- exact-match patterns: "Escrow locked" and "Escrow closed" require end-of-line ---

test("'Escrow locked' with trailing text does NOT match", () => {
  assert.equal(parseEscrowLog("Escrow locked extra content"), null);
});

test("'Escrow locked' with trailing space does NOT match", () => {
  assert.equal(parseEscrowLog("Escrow locked "), null);
});

test("'Escrow closed' with trailing text does NOT match", () => {
  assert.equal(parseEscrowLog("Escrow closed now"), null);
});

test("'Escrow closed' with trailing space does NOT match", () => {
  assert.equal(parseEscrowLog("Escrow closed "), null);
});

// --- prefix-match patterns accept extra content ---

test("'Escrow initialized:' with extra content still matches", () => {
  const result = parseEscrowLog("Escrow initialized: lots of extra data here");
  assert.ok(result !== null);
  assert.equal(result.kind, "initialized");
});

test("'Dispute raised by' with extra content still matches", () => {
  const result = parseEscrowLog("Dispute raised by agent ABC and counterparty XYZ");
  assert.ok(result !== null);
  assert.equal(result.kind, "dispute_raised");
});

test("'Refunded:' with extra content still matches", () => {
  const result = parseEscrowLog("Refunded: amount=1000 slot=12345678");
  assert.ok(result !== null);
  assert.equal(result.kind, "refunded");
});

// --- patterns requiring specific punctuation ---

test("'Escrow initialized' without colon returns null", () => {
  assert.equal(parseEscrowLog("Escrow initialized escrow=abc"), null);
});

test("'Funds deposited' without colon returns null", () => {
  assert.equal(parseEscrowLog("Funds deposited amount=1000"), null);
});

test("'Escrow released' without comma returns null", () => {
  assert.equal(parseEscrowLog("Escrow released beneficiary=abc"), null);
});

test("'Auto-released' without comma returns null", () => {
  assert.equal(parseEscrowLog("Auto-released escrow=xyz"), null);
});

test("'Auto-refunded' without colon returns null", () => {
  assert.equal(parseEscrowLog("Auto-refunded amount=500"), null);
});

test("'MutuallyCancelled' without colon returns null", () => {
  assert.equal(parseEscrowLog("MutuallyCancelled escrow=abc"), null);
});

// --- case sensitivity ---

test("lowercase 'escrow initialized:' returns null", () => {
  assert.equal(parseEscrowLog("escrow initialized: escrow=abc"), null);
});

test("lowercase 'funds deposited:' returns null", () => {
  assert.equal(parseEscrowLog("funds deposited: amount=1000"), null);
});

test("lowercase 'escrow locked' returns null", () => {
  assert.equal(parseEscrowLog("escrow locked"), null);
});

test("all-caps 'ESCROW LOCKED' returns null", () => {
  assert.equal(parseEscrowLog("ESCROW LOCKED"), null);
});

test("lowercase 'dispute raised by' returns null", () => {
  assert.equal(parseEscrowLog("dispute raised by agent"), null);
});

test("lowercase 'mutuallycancelled:' returns null", () => {
  assert.equal(parseEscrowLog("mutuallycancelled: escrow=abc"), null);
});

// --- null cases ---

test("empty string returns null", () => {
  assert.equal(parseEscrowLog(""), null);
});

test("unrelated program log line returns null", () => {
  assert.equal(parseEscrowLog("Program log: Hello from program"), null);
});

test("'Escrow' alone returns null", () => {
  assert.equal(parseEscrowLog("Escrow"), null);
});

test("'Dispute' alone returns null", () => {
  assert.equal(parseEscrowLog("Dispute"), null);
});

test("'Refunded' alone returns null", () => {
  assert.equal(parseEscrowLog("Refunded"), null);
});

test("similar-but-wrong 'Dispute raised:' returns null (missing 'by')", () => {
  assert.equal(parseEscrowLog("Dispute raised: agent=abc"), null);
});

test("'Dispute escalated' without 'by' suffix returns null", () => {
  assert.equal(parseEscrowLog("Dispute escalated oracle"), null);
});

// --- return shape ---

test("returned ParsedEscrowLog has exactly kind and escrowAccountIndex", () => {
  const result = parseEscrowLog("Escrow initialized: test");
  assert.ok(result !== null);
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ["escrowAccountIndex", "kind"]);
});
