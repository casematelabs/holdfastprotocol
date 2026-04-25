/**
 * Integration tests: full oracle pipeline for all escrow lifecycle states.
 *
 * Covers the path from a raw program log line through to a submitted
 * update_reputation instruction, for each VoteOutcome.  Also verifies that
 * the oracle ignores log lines emitted for every non-dispute escrow state
 * (Pending / Funded / Locked / Released) because those transitions do not
 * require oracle action.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { parseDisputeLog } from "./subscriber.js";
import { evaluateDispute } from "./evaluator.js";
import { Voter } from "./voter.js";
import { PactOutcome, VoteOutcome, type ReputationUpdate } from "./types.js";
import type { Idl } from "./idl-offset.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID     = new PublicKey("11111111111111111111111111111112");
const ORACLE_KEYPAIR = Keypair.generate();
const AGENT          = "AgentPubkey111111111111111111111111111111111";
const COUNTERPART    = "CounterpartyPubkey1111111111111111111111111";
const PACT_HEX       = "aabbccdd001122";
const SIG            = "testSig1234567890";

// Matches the layout produced by voter.test.ts MOCK_IDL (nonce at offset 90).
const MOCK_IDL: Idl = {
  types: [
    {
      name: "VerifTier",
      type: { kind: "enum", variants: [{ name: "Unverified" }, { name: "Attested" }, { name: "Hardline" }] },
    },
    {
      name: "ReputationAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "schema_version", type: "u8" },
          { name: "agent",          type: "pubkey" },
          { name: "score",          type: "u64" },
          { name: "tier",           type: { defined: { name: "VerifTier" } } },
          { name: "total_pacts",    type: "u64" },
          { name: "dispute_count",  type: "u64" },
          { name: "created_at",     type: "i64" },
          { name: "last_updated",   type: "i64" },
          { name: "decay_cursor",   type: "i64" },
          { name: "nonce",          type: "u64" },
        ],
      },
    },
  ],
};

const NONCE_OFFSET = 90;

function makeAccountData(nonce: bigint): Buffer {
  const buf = Buffer.alloc(200, 0);
  buf.writeBigUInt64LE(nonce, NONCE_OFFSET);
  return buf;
}

interface CapturedSend {
  data: Buffer;
  outcome: number;  // byte at offset 16
  delta: number;    // i16 at offset 17
  pactId: Buffer;   // 7 bytes at offset 19
}

function makeMockConn(nonce = 0n): { conn: any; sends: CapturedSend[] } {
  const sends: CapturedSend[] = [];
  const conn = {
    getAccountInfo: async (_pda: PublicKey) => ({
      data: makeAccountData(nonce),
      lamports: 1_000_000,
      owner: PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    }),
    sendTransaction: async (tx: Transaction) => {
      const ix = tx.instructions[0];
      const data = Buffer.from(ix.data);
      sends.push({
        data,
        outcome: data.readUInt8(16),
        delta:   data.readInt16LE(17),
        pactId:  data.subarray(19, 26),
      });
      return "mockSig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  return { conn, sends };
}

function disputeLog(verdict: string): string {
  return (
    `Program log: VaultPactDisputeSettled ` +
    `pact=${PACT_HEX} ` +
    `agent=${AGENT} ` +
    `counterparty=${COUNTERPART} ` +
    `verdict=${verdict}`
  );
}

function makePactId(): Buffer {
  return Buffer.from(PACT_HEX, "hex");
}

// ── full pipeline: all three verdicts ─────────────────────────────────────────

test("AgentFaulted: full pipeline parses log → evaluates → submits two updates", async () => {
  const event = parseDisputeLog(disputeLog("AgentFaulted"), SIG);
  assert.ok(event !== null);
  assert.equal(event.outcome, VoteOutcome.AgentFaulted);

  const [agentUpd, ctrUpd] = evaluateDispute(event);
  assert.equal(agentUpd.scoreDelta,     -400);
  assert.equal(agentUpd.onChainOutcome, PactOutcome.Disputed);
  assert.equal(ctrUpd.scoreDelta,        20);
  assert.equal(ctrUpd.onChainOutcome,   PactOutcome.Disputed);

  const { conn, sends } = makeMockConn();
  const voter = new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL);
  await voter.submitUpdate(agentUpd);
  await voter.submitUpdate(ctrUpd);

  assert.equal(sends.length, 2);
  assert.equal(sends[0].delta,   -400);
  assert.equal(sends[0].outcome, PactOutcome.Disputed);
  assert.equal(sends[1].delta,    20);
  assert.equal(sends[1].outcome, PactOutcome.Disputed);
  assert.deepEqual(sends[0].pactId, makePactId());
  assert.deepEqual(sends[1].pactId, makePactId());
});

test("CounterpartyFaulted: full pipeline inverts fault and no-fault deltas", async () => {
  const event = parseDisputeLog(disputeLog("CounterpartyFaulted"), SIG);
  assert.ok(event !== null);

  const [agentUpd, ctrUpd] = evaluateDispute(event);
  assert.equal(agentUpd.scoreDelta,  20);
  assert.equal(ctrUpd.scoreDelta,   -400);

  const { conn, sends } = makeMockConn();
  const voter = new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL);
  await voter.submitUpdate(agentUpd);
  await voter.submitUpdate(ctrUpd);

  assert.equal(sends.length, 2);
  assert.equal(sends[0].delta,   20);
  assert.equal(sends[1].delta, -400);
});

test("Mutual: full pipeline submits zero deltas with Cancelled outcome", async () => {
  const event = parseDisputeLog(disputeLog("Mutual"), SIG);
  assert.ok(event !== null);

  const [agentUpd, ctrUpd] = evaluateDispute(event);
  assert.equal(agentUpd.scoreDelta,     0);
  assert.equal(agentUpd.onChainOutcome, PactOutcome.Cancelled);
  assert.equal(ctrUpd.scoreDelta,       0);
  assert.equal(ctrUpd.onChainOutcome,   PactOutcome.Cancelled);

  const { conn, sends } = makeMockConn();
  const voter = new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL);
  await voter.submitUpdate(agentUpd);
  await voter.submitUpdate(ctrUpd);

  assert.equal(sends.length, 2);
  assert.equal(sends[0].delta,   0);
  assert.equal(sends[0].outcome, PactOutcome.Cancelled);
  assert.equal(sends[1].delta,   0);
  assert.equal(sends[1].outcome, PactOutcome.Cancelled);
});

test("pactId is propagated through the full pipeline without corruption", async () => {
  const event = parseDisputeLog(disputeLog("AgentFaulted"), SIG);
  assert.ok(event !== null);
  assert.deepEqual(event.pactId, makePactId());

  const [agentUpd] = evaluateDispute(event);
  assert.deepEqual(agentUpd.pactId, makePactId());

  const { conn, sends } = makeMockConn();
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(agentUpd);
  assert.deepEqual(sends[0].pactId, makePactId());
});

test("agent and counterparty pubkeys preserved through full pipeline", async () => {
  const event = parseDisputeLog(disputeLog("AgentFaulted"), SIG);
  assert.ok(event !== null);
  assert.equal(event.agentPubkey,        AGENT);
  assert.equal(event.counterpartyPubkey, COUNTERPART);

  const [agentUpd, ctrUpd] = evaluateDispute(event);
  assert.equal(agentUpd.agentPubkey, AGENT);
  assert.equal(ctrUpd.agentPubkey,   COUNTERPART);
});

// ── oracle ignores all non-dispute escrow state log lines ─────────────────────
// These log lines correspond to state transitions that do not require oracle action:
//   Pending   → "Escrow initialized:"
//   Funded    → "Funds deposited:"
//   Locked    → "Escrow locked"
//   Released  → "Escrow released,"  |  "Auto-released,"  |  "Escrow claimed:"

const NON_DISPUTE_LOGS = [
  // Pending state
  ["Pending: Escrow initialized",    "Escrow initialized: escrow=abc123"],
  // Funded state
  ["Funded: Funds deposited",        "Funds deposited: amount=1000000000"],
  ["Funded: Beneficiary staked",     "Beneficiary staked: amount=500000"],
  // Locked state
  ["Locked: Escrow locked",          "Escrow locked"],
  // Released states
  ["Released: Escrow released",      "Escrow released, beneficiary=abc"],
  ["Released: Auto-released",        "Auto-released, escrow=abc slot=99"],
  ["Released: Escrow claimed",       "Escrow claimed: beneficiary=abc"],
  // Refunded states
  ["Refunded: manual",               "Refunded: amount=1000000000"],
  ["Refunded: auto",                 "Auto-refunded: amount=500000000"],
  // Other lifecycle events
  ["Dispute raised (pre-escalation)","Dispute raised by initiator=abc"],
  ["Dispute escalated",              "Dispute escalated by oracle committee"],
  ["Protocol frozen",                "Protocol freeze: reason=compliance"],
  ["Mutually cancelled",             "MutuallyCancelled: escrow=abc123"],
  ["Closed",                         "Escrow closed"],
];

for (const [label, logLine] of NON_DISPUTE_LOGS) {
  test(`oracle ignores ${label} log line (no dispute parsed)`, () => {
    assert.equal(
      parseDisputeLog(logLine, SIG),
      null,
      `Expected null for escrow state log: "${logLine}"`,
    );
  });
}

// ── pact field validation ─────────────────────────────────────────────────────

test("pact field with non-hex characters returns null (invalid log rejected)", () => {
  const badLog =
    `Program log: VaultPactDisputeSettled ` +
    `pact=gghhiijj001122 ` +   // 14 chars but not valid hex
    `agent=${AGENT} ` +
    `counterparty=${COUNTERPART} ` +
    `verdict=AgentFaulted`;
  assert.equal(parseDisputeLog(badLog, SIG), null);
});

test("pact field with mixed valid/invalid hex chars returns null", () => {
  const badLog =
    `Program log: VaultPactDisputeSettled ` +
    `pact=aabbcc!@#$%^ ` +     // 14 chars, but some are not hex
    `agent=${AGENT} ` +
    `counterparty=${COUNTERPART} ` +
    `verdict=AgentFaulted`;
  assert.equal(parseDisputeLog(badLog, SIG), null);
});

test("pact field with uppercase hex is accepted (case-insensitive)", () => {
  const upperLog =
    `Program log: VaultPactDisputeSettled ` +
    `pact=AABBCCDD001122 ` +
    `agent=${AGENT} ` +
    `counterparty=${COUNTERPART} ` +
    `verdict=AgentFaulted`;
  const event = parseDisputeLog(upperLog, SIG);
  assert.ok(event !== null);
  assert.deepEqual(event.pactId, makePactId());
});

// ── dispute settled log also present inside a transaction that has other logs ─

test("dispute log parsed correctly even when other unrelated log lines precede it", () => {
  const logs = [
    "Program log: Dispute escalated by oracle committee",
    "Program log: State transition: Disputed",
    disputeLog("CounterpartyFaulted"),
    "Program log: Compute units consumed: 42000",
  ];
  let found = 0;
  for (const line of logs) {
    const event = parseDisputeLog(line, SIG);
    if (event !== null) {
      found++;
      assert.equal(event.outcome, VoteOutcome.CounterpartyFaulted);
    }
  }
  assert.equal(found, 1, "exactly one dispute event should be parsed from the batch");
});
