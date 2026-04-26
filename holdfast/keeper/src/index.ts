import * as fs from "fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { pathToFileURL } from "url";
import { createHoldfastClient } from "@holdfastprotocol/sdk";
import { loadConfig } from "./config.js";
import { log, type LogLevel } from "./logger.js";
import { startHealthServer, updateHealthState } from "./health.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length !== 64) {
    throw new Error(`Invalid keypair file at ${path}: expected a 64-byte JSON array`);
  }
  const bytes = Uint8Array.from(raw);
  return Keypair.fromSecretKey(bytes);
}

export interface AutoReleaseCandidateLike {
  escrowId: PublicKey;
  escrowAddress: PublicKey;
  timeLockExpiresAt: number;
  isExpired: boolean;
}

export interface KeeperEscrowApi {
  listAutoReleaseCandidates(opts: {
    nowUnixSecs: number;
    lookaheadSecs: number;
    limit: number;
  }): Promise<AutoReleaseCandidateLike[]>;
  autoRelease(escrowId: PublicKey): Promise<string>;
}

export interface KeeperClientLike {
  escrow: KeeperEscrowApi;
}

export interface PollCycleResult {
  totalCandidates: number;
  expiredCount: number;
  approachingCount: number;
  released: number;
  failed: number;
  dryRunSkipped: number;
}

export type KeeperLogger = (
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
) => void;

export async function runPollCycle(params: {
  client: KeeperClientLike;
  nowUnixSecs: number;
  cycleStartedAtMs: number;
  lookaheadSecs: number;
  maxCandidatesPerPoll: number;
  dryRun: boolean;
  logger?: KeeperLogger;
}): Promise<PollCycleResult> {
  const logger = params.logger ?? log;
  let released = 0;
  let failed = 0;
  let dryRunSkipped = 0;

  try {
    const candidates = await params.client.escrow.listAutoReleaseCandidates({
      nowUnixSecs: params.nowUnixSecs,
      lookaheadSecs: params.lookaheadSecs,
      limit: params.maxCandidatesPerPoll,
    });

    const expired = candidates.filter((candidate) => candidate.isExpired);
    const approaching = candidates.length - expired.length;

    logger("info", "keeper_poll_candidates", {
      totalCandidates: candidates.length,
      expiredCount: expired.length,
      approachingCount: approaching,
    });

    for (const candidate of expired) {
      if (params.dryRun) {
        dryRunSkipped += 1;
        logger("info", "keeper_auto_release_dry_run", {
          escrowId: candidate.escrowId.toBase58(),
          escrowAddress: candidate.escrowAddress.toBase58(),
          timeLockExpiresAt: candidate.timeLockExpiresAt,
        });
        continue;
      }
      try {
        const signature = await params.client.escrow.autoRelease(candidate.escrowId);
        released += 1;
        logger("info", "keeper_auto_release_ok", {
          escrowId: candidate.escrowId.toBase58(),
          escrowAddress: candidate.escrowAddress.toBase58(),
          timeLockExpiresAt: candidate.timeLockExpiresAt,
          signature,
        });
      } catch (error) {
        failed += 1;
        logger("warn", "keeper_auto_release_failed", {
          escrowId: candidate.escrowId.toBase58(),
          escrowAddress: candidate.escrowAddress.toBase58(),
          timeLockExpiresAt: candidate.timeLockExpiresAt,
          error,
        });
      }
    }

    logger("info", "keeper_poll_done", {
      released,
      failed,
      dryRunSkipped,
      durationMs: Date.now() - params.cycleStartedAtMs,
    });

    return {
      totalCandidates: candidates.length,
      expiredCount: expired.length,
      approachingCount: approaching,
      released,
      failed,
      dryRunSkipped,
    };
  } catch (error) {
    logger("error", "keeper_poll_error", {
      durationMs: Date.now() - params.cycleStartedAtMs,
      error,
    });
    return {
      totalCandidates: 0,
      expiredCount: 0,
      approachingCount: 0,
      released,
      failed,
      dryRunSkipped,
    };
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const signer = loadKeypair(config.keypairPath);
  const client = createHoldfastClient({
    rpcUrl: config.rpcUrl,
    signer,
    escrowProgramId: config.escrowProgramId,
    holdfastProgramId: config.holdfastProgramId,
  });

  const healthPort = Number(process.env["KEEPER_HEALTH_PORT"] ?? 8888);
  updateHealthState({
    keeperPubkey: signer.publicKey.toBase58(),
    rpcUrl: config.rpcUrl,
    dryRun: config.dryRun,
  });
  const healthServer = startHealthServer(healthPort);

  let running = true;
  const stop = (signal: NodeJS.Signals): void => {
    running = false;
    log("info", "keeper_shutdown_signal", { signal });
    healthServer.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  log("info", "keeper_started", {
    keeperPubkey: signer.publicKey.toBase58(),
    rpcUrl: config.rpcUrl,
    keypairPath: config.keypairPath,
    pollIntervalMs: config.pollIntervalMs,
    lookaheadSecs: config.lookaheadSecs,
    maxCandidatesPerPoll: config.maxCandidatesPerPoll,
    dryRun: config.dryRun,
    keeperPublicUrl: config.keeperPublicUrl ?? null,
    healthPort,
  });

  while (running) {
    const cycleStartedAt = Date.now();
    const nowUnixSecs = Math.floor(cycleStartedAt / 1000);
    const result = await runPollCycle({
      client,
      nowUnixSecs,
      cycleStartedAtMs: cycleStartedAt,
      lookaheadSecs: config.lookaheadSecs,
      maxCandidatesPerPoll: config.maxCandidatesPerPoll,
      dryRun: config.dryRun,
      logger: log,
    });

    updateHealthState({
      lastPollAt: new Date(cycleStartedAt).toISOString(),
      lastPollResult: result as unknown as Record<string, unknown>,
    });

    const elapsed = Date.now() - cycleStartedAt;
    const sleepMs = Math.max(config.pollIntervalMs - elapsed, 0);
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  log("info", "keeper_stopped");
}

const directRunPath = process.argv[1];
const isDirectRun =
  typeof directRunPath === "string" && import.meta.url === pathToFileURL(directRunPath).href;

if (isDirectRun) {
  main().catch((error) => {
    log("error", "keeper_fatal", { error });
    process.exit(1);
  });
}
