/**
 * End-to-end tests for oracle multi-sig aggregation (3-of-5 quorum).
 *
 * Exercises the off-chain quorum collection pattern required for mainnet:
 *   - Multiple oracle voters independently evaluate the same dispute
 *   - Votes are collected until quorum threshold is reached
 *   - On-chain submission only happens after quorum
 *   - Non-authorized signers are rejected
 *   - Vote timeout / retry paths work correctly
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { parseDisputeLog } from "./subscriber.js";
import { evaluateDispute } from "./evaluator.js";
import { Voter } from "./voter.js";
import { PendingQueue } from "./pending.js";
import { PactOutcome, VoteOutcome, type DisputeEvent, type ReputationUpdate } from "./types.js";
import type { Idl } from "./idl-offset.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("11111111111111111111111111111112");
const AGENT = "AgentPubkey111111111111111111111111111111111";
const COUNTERPART = "CounterpartyPubkey1111111111111111111111111";
const PACT_HEX = "aabbccdd001122";
const SIG = "testSig1234567890";

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
  outcome: number;
  delta: number;
  pactId: Buffer;
  signerPubkey: string;
}

function makeMockConn(opts: {
  nonce?: bigint;
  rejectUnauthorized?: Set<string>;
  sendFailCount?: number;
}): { conn: any; sends: CapturedSend[] } {
  const sends: CapturedSend[] = [];
  const nonce = opts.nonce ?? 0n;
  const rejectSet = opts.rejectUnauthorized ?? new Set<string>();
  let sendAttempt = 0;

  const conn = {
    getAccountInfo: async (_pda: PublicKey) => ({
      data: makeAccountData(nonce),
      lamports: 1_000_000,
      owner: PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    }),
    sendTransaction: async (tx: Transaction, signers: Keypair[]) => {
      sendAttempt++;
      const ix = tx.instructions[0];
      const data = Buffer.from(ix.data);
      const signerPubkey = signers[0].publicKey.toBase58();

      if (rejectSet.has(signerPubkey)) {
        const err = new Error(
          "failed to send transaction: Transaction simulation failed: " +
          "Error processing Instruction 0: custom program error: 0x1775"
        );
        (err as any).logs = [
          "Program 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq invoke [1]",
          "Program log: AnchorError occurred. Error Code: UnauthorizedReputationWriter. " +
          "Error Number: 6005. Error Message: Caller is not an authorized reputation writer (escrow or oracle program).",
          "Program 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq consumed 5200 of 200000 compute units",
          "Program 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq failed: custom program error: 0x1775",
        ];
        throw err;
      }

      if (opts.sendFailCount && sendAttempt <= opts.sendFailCount) {
        throw new Error("transient send failure");
      }

      sends.push({
        data,
        outcome: data.readUInt8(16),
        delta: data.readInt16LE(17),
        pactId: data.subarray(19, 26),
        signerPubkey,
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

// ── QuorumCollector ──────────────────────────────────────────────────────────
// Off-chain vote aggregation for mainnet 3-of-5 oracle quorum.
// Each oracle node independently evaluates a dispute and casts a vote.
// The collector tracks votes per dispute and returns the agreed-upon updates
// only once the quorum threshold is reached.

interface OracleVote {
  voterPubkey: string;
  agentUpdate: ReputationUpdate;
  counterpartyUpdate: ReputationUpdate;
  castAt: number;
}

type QuorumKey = string;

class QuorumCollector {
  private votes = new Map<QuorumKey, OracleVote[]>();

  constructor(
    private readonly quorumThreshold: number,
    private readonly authorizedVoters: Set<string>,
    private readonly voteTimeoutSeconds: number,
  ) {}

  private disputeKey(event: DisputeEvent): QuorumKey {
    return `${event.pactId.toString("hex")}:${event.agentPubkey}:${event.counterpartyPubkey}`;
  }

  castVote(
    voterPubkey: string,
    event: DisputeEvent,
  ): { quorumReached: boolean; updates: [ReputationUpdate, ReputationUpdate] | null } {
    if (!this.authorizedVoters.has(voterPubkey)) {
      throw new Error(`UnauthorizedReputationWriter: ${voterPubkey} is not in the authorized voter set`);
    }

    const key = this.disputeKey(event);
    if (!this.votes.has(key)) {
      this.votes.set(key, []);
    }
    const existing = this.votes.get(key)!;

    if (existing.some((v) => v.voterPubkey === voterPubkey)) {
      throw new Error(`Duplicate vote: ${voterPubkey} already voted on dispute ${key}`);
    }

    const [agentUpdate, counterpartyUpdate] = evaluateDispute(event);
    existing.push({
      voterPubkey,
      agentUpdate,
      counterpartyUpdate,
      castAt: Math.floor(Date.now() / 1000),
    });

    if (existing.length >= this.quorumThreshold) {
      return { quorumReached: true, updates: [agentUpdate, counterpartyUpdate] };
    }
    return { quorumReached: false, updates: null };
  }

  voteCount(event: DisputeEvent): number {
    return this.votes.get(this.disputeKey(event))?.length ?? 0;
  }

  pruneExpired(nowSeconds: number): number {
    let pruned = 0;
    for (const [key, votes] of this.votes) {
      const fresh = votes.filter((v) => (nowSeconds - v.castAt) < this.voteTimeoutSeconds);
      if (fresh.length < votes.length) {
        pruned += votes.length - fresh.length;
      }
      if (fresh.length === 0) {
        this.votes.delete(key);
      } else {
        this.votes.set(key, fresh);
      }
    }
    return pruned;
  }

  clear(): void {
    this.votes.clear();
  }
}

// ── test helpers ─────────────────────────────────────────────────────────────

function makeOracleKeypairs(count: number): Keypair[] {
  return Array.from({ length: count }, () => Keypair.generate());
}

function makeDisputeEvent(verdict: VoteOutcome = VoteOutcome.AgentFaulted): DisputeEvent {
  return {
    signature: SIG,
    pactId: makePactId(),
    agentPubkey: AGENT,
    counterpartyPubkey: COUNTERPART,
    outcome: verdict,
    detectedAt: Math.floor(Date.now() / 1000),
  };
}

// ── 3-of-5 quorum: submission only after threshold ──────────────────────────

describe("multi-sig quorum aggregation (3-of-5)", () => {
  test("votes from first 2 of 5 oracles do NOT trigger submission", () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const event = makeDisputeEvent();

    const r1 = collector.castVote(oracles[0].publicKey.toBase58(), event);
    assert.equal(r1.quorumReached, false);
    assert.equal(r1.updates, null);
    assert.equal(collector.voteCount(event), 1);

    const r2 = collector.castVote(oracles[1].publicKey.toBase58(), event);
    assert.equal(r2.quorumReached, false);
    assert.equal(r2.updates, null);
    assert.equal(collector.voteCount(event), 2);
  });

  test("3rd vote reaches quorum and returns aggregated updates", () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const event = makeDisputeEvent(VoteOutcome.AgentFaulted);

    collector.castVote(oracles[0].publicKey.toBase58(), event);
    collector.castVote(oracles[1].publicKey.toBase58(), event);
    const r3 = collector.castVote(oracles[2].publicKey.toBase58(), event);

    assert.equal(r3.quorumReached, true);
    assert.ok(r3.updates !== null);
    const [agentUpd, ctrUpd] = r3.updates;
    assert.equal(agentUpd.scoreDelta, -400);
    assert.equal(agentUpd.onChainOutcome, PactOutcome.Disputed);
    assert.equal(ctrUpd.scoreDelta, 20);
    assert.equal(ctrUpd.onChainOutcome, PactOutcome.Disputed);
    assert.equal(agentUpd.agentPubkey, AGENT);
    assert.equal(ctrUpd.agentPubkey, COUNTERPART);
  });

  test("full pipeline: parse → 3 oracle votes → quorum → on-chain submit", async () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);

    const logLine = disputeLog("CounterpartyFaulted");
    const event = parseDisputeLog(logLine, SIG);
    assert.ok(event !== null);

    for (let i = 0; i < 2; i++) {
      const r = collector.castVote(oracles[i].publicKey.toBase58(), event);
      assert.equal(r.quorumReached, false);
    }

    const result = collector.castVote(oracles[2].publicKey.toBase58(), event);
    assert.equal(result.quorumReached, true);
    assert.ok(result.updates !== null);

    const submitterKeypair = oracles[0];
    const { conn, sends } = makeMockConn({ nonce: 5n });
    const voter = new Voter(conn, PROGRAM_ID, submitterKeypair, MOCK_IDL);

    const [agentUpd, ctrUpd] = result.updates;
    await voter.submitUpdate(agentUpd);
    await voter.submitUpdate(ctrUpd);

    assert.equal(sends.length, 2);
    assert.equal(sends[0].delta, 20);
    assert.equal(sends[0].outcome, PactOutcome.Disputed);
    assert.equal(sends[1].delta, -400);
    assert.equal(sends[1].outcome, PactOutcome.Disputed);
    assert.deepEqual(sends[0].pactId, makePactId());
    assert.deepEqual(sends[1].pactId, makePactId());
  });

  test("all 5 oracles vote — quorum reached at 3rd, extras accepted", () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const event = makeDisputeEvent();

    let quorumAt = -1;
    for (let i = 0; i < 5; i++) {
      const r = collector.castVote(oracles[i].publicKey.toBase58(), event);
      if (r.quorumReached && quorumAt === -1) quorumAt = i;
    }

    assert.equal(quorumAt, 2, "quorum should be reached on the 3rd vote (index 2)");
    assert.equal(collector.voteCount(event), 5);
  });

  test("duplicate vote from same oracle is rejected", () => {
    const oracles = makeOracleKeypairs(3);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const event = makeDisputeEvent();

    collector.castVote(oracles[0].publicKey.toBase58(), event);

    assert.throws(
      () => collector.castVote(oracles[0].publicKey.toBase58(), event),
      /Duplicate vote/,
    );
  });

  test("all three verdicts reach correct quorum consensus", () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const verdicts: [VoteOutcome, number, number, PactOutcome][] = [
      [VoteOutcome.AgentFaulted,        -400, 20, PactOutcome.Disputed],
      [VoteOutcome.CounterpartyFaulted,  20, -400, PactOutcome.Disputed],
      [VoteOutcome.Mutual,                0,   0,  PactOutcome.Cancelled],
    ];

    for (const [verdict, agentDelta, ctrDelta, expectedOutcome] of verdicts) {
      const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
      const event = makeDisputeEvent(verdict);

      collector.castVote(oracles[0].publicKey.toBase58(), event);
      collector.castVote(oracles[1].publicKey.toBase58(), event);
      const r = collector.castVote(oracles[2].publicKey.toBase58(), event);

      assert.equal(r.quorumReached, true, `quorum should be reached for ${verdict}`);
      assert.ok(r.updates !== null);
      assert.equal(r.updates[0].scoreDelta, agentDelta, `agent delta for ${verdict}`);
      assert.equal(r.updates[1].scoreDelta, ctrDelta, `counterparty delta for ${verdict}`);
      assert.equal(r.updates[0].onChainOutcome, expectedOutcome, `outcome for ${verdict}`);
    }
  });
});

// ── unauthorized voter rejection ─────────────────────────────────────────────

describe("unauthorized voter rejection", () => {
  test("vote from non-voter keypair is rejected by QuorumCollector", () => {
    const authorizedOracles = makeOracleKeypairs(3);
    const unauthorizedOracle = Keypair.generate();
    const authorizedSet = new Set(authorizedOracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const event = makeDisputeEvent();

    assert.throws(
      () => collector.castVote(unauthorizedOracle.publicKey.toBase58(), event),
      /UnauthorizedReputationWriter/,
    );
    assert.equal(collector.voteCount(event), 0, "rejected vote should not be counted");
  });

  test("on-chain submission with unauthorized signer returns program error 0x1775", { timeout: 15_000 }, async () => {
    const unauthorizedOracle = Keypair.generate();

    const { conn } = makeMockConn({
      rejectUnauthorized: new Set([unauthorizedOracle.publicKey.toBase58()]),
    });

    const voter = new Voter(conn, PROGRAM_ID, unauthorizedOracle, MOCK_IDL);
    const update: ReputationUpdate = {
      agentPubkey: AGENT,
      onChainOutcome: PactOutcome.Disputed,
      scoreDelta: -400,
      pactId: makePactId(),
    };

    try {
      await voter.submitUpdate(update);
      assert.fail("should have thrown");
    } catch (err: any) {
      assert.ok(err.message.includes("0x1775"), "error should contain program error code 0x1775");
      assert.ok(
        Array.isArray(err.logs) && err.logs.some((l: string) => l.includes("UnauthorizedReputationWriter")),
        "error logs should contain UnauthorizedReputationWriter",
      );
    }
  });

  test("authorized signer succeeds where unauthorized signer failed", { timeout: 15_000 }, async () => {
    const authorizedOracle = Keypair.generate();
    const unauthorizedOracle = Keypair.generate();

    const rejectSet = new Set([unauthorizedOracle.publicKey.toBase58()]);
    const { conn: conn1 } = makeMockConn({ rejectUnauthorized: rejectSet });
    const { conn: conn2, sends } = makeMockConn({ rejectUnauthorized: rejectSet });

    const update: ReputationUpdate = {
      agentPubkey: AGENT,
      onChainOutcome: PactOutcome.Disputed,
      scoreDelta: -400,
      pactId: makePactId(),
    };

    try {
      await new Voter(conn1, PROGRAM_ID, unauthorizedOracle, MOCK_IDL).submitUpdate(update);
      assert.fail("unauthorized signer should have thrown");
    } catch (err: any) {
      assert.ok(err.message.includes("0x1775"));
      assert.ok(
        Array.isArray(err.logs) && err.logs.some((l: string) => l.includes("UnauthorizedReputationWriter")),
      );
    }

    const sig = await new Voter(conn2, PROGRAM_ID, authorizedOracle, MOCK_IDL).submitUpdate(update);
    assert.equal(sig, "mockSig");
    assert.equal(sends.length, 1);
    assert.equal(sends[0].delta, -400);
  });

  test("mixed authorized and unauthorized voters — only authorized votes count", () => {
    const authorizedOracles = makeOracleKeypairs(3);
    const unauthorizedOracles = makeOracleKeypairs(2);
    const authorizedSet = new Set(authorizedOracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const event = makeDisputeEvent();

    collector.castVote(authorizedOracles[0].publicKey.toBase58(), event);

    assert.throws(
      () => collector.castVote(unauthorizedOracles[0].publicKey.toBase58(), event),
      /UnauthorizedReputationWriter/,
    );

    collector.castVote(authorizedOracles[1].publicKey.toBase58(), event);

    assert.throws(
      () => collector.castVote(unauthorizedOracles[1].publicKey.toBase58(), event),
      /UnauthorizedReputationWriter/,
    );

    assert.equal(collector.voteCount(event), 2, "only authorized votes counted");

    const r = collector.castVote(authorizedOracles[2].publicKey.toBase58(), event);
    assert.equal(r.quorumReached, true);
    assert.equal(collector.voteCount(event), 3);
  });
});

// ── vote timeout and retry ───────────────────────────────────────────────────

describe("oracle vote timeout and retry", () => {
  test("expired votes are pruned and quorum resets", () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const timeoutSecs = 72 * 3600;
    const collector = new QuorumCollector(3, authorizedSet, timeoutSecs);
    const event = makeDisputeEvent();

    collector.castVote(oracles[0].publicKey.toBase58(), event);
    collector.castVote(oracles[1].publicKey.toBase58(), event);
    assert.equal(collector.voteCount(event), 2);

    const futureTime = Math.floor(Date.now() / 1000) + timeoutSecs + 1;
    const pruned = collector.pruneExpired(futureTime);
    assert.equal(pruned, 2);
    assert.equal(collector.voteCount(event), 0, "all votes should be pruned after timeout");
  });

  test("PendingQueue surfaces missed vote deadlines", () => {
    const pending = new PendingQueue(72 * 3600);
    const event = makeDisputeEvent();
    event.detectedAt = Math.floor(Date.now() / 1000) - (73 * 3600);

    pending.add(event);
    assert.equal(pending.size(), 1);

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
    pending.checkDeadlines();
    console.warn = origWarn;

    assert.ok(warnings.length > 0, "should have logged a deadline warning");
    assert.ok(warnings[0].includes("MISSED VOTE DEADLINE"));
  });

  test("on-chain retry succeeds after transient failure", { timeout: 10_000 }, async () => {
    const oracle = Keypair.generate();
    const { conn, sends } = makeMockConn({ sendFailCount: 2 });
    const voter = new Voter(conn, PROGRAM_ID, oracle, MOCK_IDL);

    const update: ReputationUpdate = {
      agentPubkey: AGENT,
      onChainOutcome: PactOutcome.Disputed,
      scoreDelta: -400,
      pactId: makePactId(),
    };

    const sig = await voter.submitUpdate(update);
    assert.equal(sig, "mockSig");
    assert.equal(sends.length, 1, "successful send captured after retries");
    assert.equal(sends[0].delta, -400);
  });

  test("on-chain submission exhausts all retries and throws", { timeout: 10_000 }, async () => {
    const oracle = Keypair.generate();
    const { conn } = makeMockConn({ sendFailCount: 999 });
    const voter = new Voter(conn, PROGRAM_ID, oracle, MOCK_IDL);

    const update: ReputationUpdate = {
      agentPubkey: AGENT,
      onChainOutcome: PactOutcome.Disputed,
      scoreDelta: -400,
      pactId: makePactId(),
    };

    await assert.rejects(
      () => voter.submitUpdate(update),
      /transient send failure/,
    );
  });

  test("PendingQueue tracks and clears submitted disputes", () => {
    const pending = new PendingQueue(72 * 3600);
    const event = makeDisputeEvent();

    pending.add(event);
    assert.equal(pending.size(), 1);

    pending.remove(event);
    assert.equal(pending.size(), 0);
  });
});

// ── end-to-end: full multi-sig pipeline with PendingQueue integration ────────

describe("full multi-sig pipeline integration", () => {
  test("dispute detected → queued → 3 oracles vote → quorum → submit → dequeue", async () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);
    const pending = new PendingQueue(72 * 3600);

    const logLine = disputeLog("AgentFaulted");
    const event = parseDisputeLog(logLine, SIG);
    assert.ok(event !== null);

    pending.add(event);
    assert.equal(pending.size(), 1);

    let quorumResult: { quorumReached: boolean; updates: [ReputationUpdate, ReputationUpdate] | null } =
      { quorumReached: false, updates: null };

    for (let i = 0; i < 3; i++) {
      quorumResult = collector.castVote(oracles[i].publicKey.toBase58(), event);
    }
    assert.equal(quorumResult.quorumReached, true);
    assert.ok(quorumResult.updates !== null);

    const submitter = oracles[0];
    const { conn, sends } = makeMockConn({ nonce: 10n });
    const voter = new Voter(conn, PROGRAM_ID, submitter, MOCK_IDL);

    const [agentUpd, ctrUpd] = quorumResult.updates;
    await voter.submitUpdate(agentUpd);
    await voter.submitUpdate(ctrUpd);

    pending.remove(event);
    assert.equal(pending.size(), 0, "dispute removed from pending after submission");

    assert.equal(sends.length, 2);
    assert.equal(sends[0].signerPubkey, submitter.publicKey.toBase58());
    assert.equal(sends[1].signerPubkey, submitter.publicKey.toBase58());

    const nonce0 = sends[0].data.readBigUInt64LE(8);
    assert.equal(nonce0, 11n, "nonce should be on-chain value (10) + 1");

    assert.equal(sends[0].delta, -400, "faulted agent gets -400");
    assert.equal(sends[1].delta, 20, "counterparty gets +20");
    assert.deepEqual(sends[0].pactId, makePactId());
    assert.deepEqual(sends[1].pactId, makePactId());
  });

  test("concurrent disputes with independent quorum tracking", () => {
    const oracles = makeOracleKeypairs(5);
    const authorizedSet = new Set(oracles.map((k) => k.publicKey.toBase58()));
    const collector = new QuorumCollector(3, authorizedSet, 72 * 3600);

    const event1: DisputeEvent = {
      signature: "sig1",
      pactId: Buffer.from("11111111111111", "hex"),
      agentPubkey: AGENT,
      counterpartyPubkey: COUNTERPART,
      outcome: VoteOutcome.AgentFaulted,
      detectedAt: Math.floor(Date.now() / 1000),
    };
    const event2: DisputeEvent = {
      signature: "sig2",
      pactId: Buffer.from("22222222222222", "hex"),
      agentPubkey: COUNTERPART,
      counterpartyPubkey: AGENT,
      outcome: VoteOutcome.Mutual,
      detectedAt: Math.floor(Date.now() / 1000),
    };

    collector.castVote(oracles[0].publicKey.toBase58(), event1);
    collector.castVote(oracles[0].publicKey.toBase58(), event2);
    collector.castVote(oracles[1].publicKey.toBase58(), event1);

    assert.equal(collector.voteCount(event1), 2);
    assert.equal(collector.voteCount(event2), 1);

    const r1 = collector.castVote(oracles[2].publicKey.toBase58(), event1);
    assert.equal(r1.quorumReached, true, "event1 quorum reached at 3 votes");

    const r2 = collector.castVote(oracles[1].publicKey.toBase58(), event2);
    assert.equal(r2.quorumReached, false, "event2 still needs 1 more vote");

    const r3 = collector.castVote(oracles[2].publicKey.toBase58(), event2);
    assert.equal(r3.quorumReached, true, "event2 quorum reached at 3 votes");
  });

  test("nonce increments correctly across sequential on-chain submissions", async () => {
    const oracle = Keypair.generate();

    let currentNonce = 5n;
    const sends: CapturedSend[] = [];
    const conn = {
      getAccountInfo: async () => ({
        data: makeAccountData(currentNonce),
        lamports: 1_000_000,
        owner: PROGRAM_ID,
        executable: false,
        rentEpoch: 0,
      }),
      sendTransaction: async (tx: Transaction, signers: Keypair[]) => {
        const ix = tx.instructions[0];
        const data = Buffer.from(ix.data);
        sends.push({
          data,
          outcome: data.readUInt8(16),
          delta: data.readInt16LE(17),
          pactId: data.subarray(19, 26),
          signerPubkey: signers[0].publicKey.toBase58(),
        });
        currentNonce += 1n;
        return "mockSig";
      },
      confirmTransaction: async () => ({ value: { err: null } }),
    };

    const voter = new Voter(conn as any, PROGRAM_ID, oracle, MOCK_IDL);
    const update1: ReputationUpdate = {
      agentPubkey: AGENT,
      onChainOutcome: PactOutcome.Disputed,
      scoreDelta: -400,
      pactId: makePactId(),
    };
    const update2: ReputationUpdate = {
      agentPubkey: COUNTERPART,
      onChainOutcome: PactOutcome.Disputed,
      scoreDelta: 20,
      pactId: makePactId(),
    };

    await voter.submitUpdate(update1);
    await voter.submitUpdate(update2);

    assert.equal(sends[0].data.readBigUInt64LE(8), 6n, "first submission nonce = 5+1");
    assert.equal(sends[1].data.readBigUInt64LE(8), 7n, "second submission nonce = 6+1");
  });
});
