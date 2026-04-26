import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  runPollCycle,
  type AutoReleaseCandidateLike,
  type KeeperClientLike,
  type KeeperLogger,
} from "../src/index.js";

interface CapturedLog {
  level: "info" | "warn" | "error";
  event: string;
  fields: Record<string, unknown>;
}

function makeCandidate(opts: {
  escrowIdSeed: number;
  escrowAddressSeed: number;
  expiresAt: number;
  isExpired: boolean;
}): AutoReleaseCandidateLike {
  const escrowId = Keypair.fromSeed(Uint8Array.from(new Array(32).fill(opts.escrowIdSeed))).publicKey;
  const escrowAddress = Keypair.fromSeed(
    Uint8Array.from(new Array(32).fill(opts.escrowAddressSeed)),
  ).publicKey;
  return {
    escrowId,
    escrowAddress,
    timeLockExpiresAt: opts.expiresAt,
    isExpired: opts.isExpired,
  };
}

describe("runPollCycle", async () => {
  await test("releases only expired candidates", async () => {
    const now = 1_800_000_000;
    const expired = makeCandidate({
      escrowIdSeed: 1,
      escrowAddressSeed: 2,
      expiresAt: now - 10,
      isExpired: true,
    });
    const upcoming = makeCandidate({
      escrowIdSeed: 3,
      escrowAddressSeed: 4,
      expiresAt: now + 60,
      isExpired: false,
    });

    const released: string[] = [];
    const logs: CapturedLog[] = [];
    const logger: KeeperLogger = (level, event, fields = {}) => {
      logs.push({ level, event, fields });
    };

    const client: KeeperClientLike = {
      escrow: {
        async listAutoReleaseCandidates() {
          return [expired, upcoming];
        },
        async autoRelease(escrowId: PublicKey) {
          released.push(escrowId.toBase58());
          return "sig-1";
        },
      },
    };

    const result = await runPollCycle({
      client,
      nowUnixSecs: now,
      cycleStartedAtMs: Date.now() - 5,
      lookaheadSecs: 120,
      maxCandidatesPerPoll: 100,
      dryRun: false,
      logger,
    });

    assert.equal(result.totalCandidates, 2);
    assert.equal(result.expiredCount, 1);
    assert.equal(result.approachingCount, 1);
    assert.equal(result.released, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(released, [expired.escrowId.toBase58()]);

    const pollCandidatesLog = logs.find((entry) => entry.event === "keeper_poll_candidates");
    assert.ok(pollCandidatesLog);
    assert.equal(pollCandidatesLog.fields.totalCandidates, 2);
    assert.equal(pollCandidatesLog.fields.expiredCount, 1);
    assert.equal(pollCandidatesLog.fields.approachingCount, 1);
  });

  await test("continues when one autoRelease call fails", async () => {
    const now = 1_800_000_000;
    const first = makeCandidate({
      escrowIdSeed: 11,
      escrowAddressSeed: 12,
      expiresAt: now - 20,
      isExpired: true,
    });
    const second = makeCandidate({
      escrowIdSeed: 13,
      escrowAddressSeed: 14,
      expiresAt: now - 10,
      isExpired: true,
    });
    const logs: CapturedLog[] = [];
    const logger: KeeperLogger = (level, event, fields = {}) => {
      logs.push({ level, event, fields });
    };

    const attempted: string[] = [];
    const client: KeeperClientLike = {
      escrow: {
        async listAutoReleaseCandidates() {
          return [first, second];
        },
        async autoRelease(escrowId: PublicKey) {
          attempted.push(escrowId.toBase58());
          if (escrowId.equals(first.escrowId)) {
            throw new Error("simulated failure");
          }
          return "sig-ok";
        },
      },
    };

    const result = await runPollCycle({
      client,
      nowUnixSecs: now,
      cycleStartedAtMs: Date.now() - 5,
      lookaheadSecs: 120,
      maxCandidatesPerPoll: 100,
      dryRun: false,
      logger,
    });

    assert.equal(result.totalCandidates, 2);
    assert.equal(result.released, 1);
    assert.equal(result.failed, 1);
    assert.equal(attempted.length, 2);
    assert.ok(logs.some((entry) => entry.event === "keeper_auto_release_failed"));
    assert.ok(logs.some((entry) => entry.event === "keeper_auto_release_ok"));
  });

  await test("logs and recovers from candidate discovery errors", async () => {
    const logs: CapturedLog[] = [];
    const logger: KeeperLogger = (level, event, fields = {}) => {
      logs.push({ level, event, fields });
    };
    const client: KeeperClientLike = {
      escrow: {
        async listAutoReleaseCandidates() {
          throw new Error("rpc unavailable");
        },
        async autoRelease() {
          throw new Error("not expected");
        },
      },
    };

    const result = await runPollCycle({
      client,
      nowUnixSecs: 1_800_000_000,
      cycleStartedAtMs: Date.now() - 5,
      lookaheadSecs: 120,
      maxCandidatesPerPoll: 100,
      dryRun: false,
      logger,
    });

    assert.equal(result.totalCandidates, 0);
    assert.equal(result.expiredCount, 0);
    assert.equal(result.released, 0);
    assert.equal(result.failed, 0);
    assert.ok(logs.some((entry) => entry.level === "error" && entry.event === "keeper_poll_error"));
  });

  await test("dry-run mode skips transactions and logs candidates", async () => {
    const now = 1_800_000_000;
    const expired = makeCandidate({
      escrowIdSeed: 21,
      escrowAddressSeed: 22,
      expiresAt: now - 5,
      isExpired: true,
    });
    const logs: CapturedLog[] = [];
    const logger: KeeperLogger = (level, event, fields = {}) => {
      logs.push({ level, event, fields });
    };

    let autoReleaseCalls = 0;
    const client: KeeperClientLike = {
      escrow: {
        async listAutoReleaseCandidates() {
          return [expired];
        },
        async autoRelease() {
          autoReleaseCalls += 1;
          return "sig-should-not-happen";
        },
      },
    };

    const result = await runPollCycle({
      client,
      nowUnixSecs: now,
      cycleStartedAtMs: Date.now() - 5,
      lookaheadSecs: 120,
      maxCandidatesPerPoll: 100,
      dryRun: true,
      logger,
    });

    assert.equal(autoReleaseCalls, 0);
    assert.equal(result.released, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.dryRunSkipped, 1);
    assert.ok(logs.some((entry) => entry.event === "keeper_auto_release_dry_run"));
  });
});
