import {
  Connection,
  PublicKey,
  type Context,
  type Logs,
} from "@solana/web3.js";
import { parseReputationLog } from "./parser.js";
import type { EventStore } from "./store.js";
import { PactOutcome, type ReputationEvent } from "./types.js";
import {
  REPUTATION_ACCOUNT_SCHEMA_VERSION,
  ACCOUNT_SIZE,
  HIST_ENTRY_SIZE,
  OFF_SCHEMA_VERSION,
  OFF_HISTORY_LEN,
  OFF_HISTORY_HEAD,
  OFF_HISTORY,
} from "./reputation-layout.js";

export class SchemaVersionError extends Error {
  constructor(expected: number, got: number) {
    super(
      `ReputationAccount schema_version mismatch: expected ${expected}, got ${got}. ` +
      `Redeploy the indexer after a contract layout change.`,
    );
    this.name = "SchemaVersionError";
  }
}

function assertSchemaVersion(data: Buffer): void {
  const version = data.readUInt8(OFF_SCHEMA_VERSION);
  if (version !== REPUTATION_ACCOUNT_SCHEMA_VERSION) {
    throw new SchemaVersionError(REPUTATION_ACCOUNT_SCHEMA_VERSION, version);
  }
}

// HistEntry byte offsets within a single 18-byte entry:
//  0 outcome  (u8)
//  1 score_delta (i16 LE)
//  3 timestamp  (i64 LE)
// 11 pact_id   (7 bytes)

function extractLatestRingEntry(
  data: Buffer,
): { scoreDelta: number; ts: number; pactId: string } | null {
  if (data.length < ACCOUNT_SIZE) return null;
  assertSchemaVersion(data);

  const historyLen = data.readUInt8(OFF_HISTORY_LEN);
  const historyHead = data.readUInt8(OFF_HISTORY_HEAD);
  if (historyLen === 0) return null;

  // The entry just written is at (head - 1 + 20) % 20.
  const latestIdx = (historyHead - 1 + 20) % 20;
  return extractRingEntryAt(data, latestIdx);
}

/**
 * Read a specific ring entry by the nonce that wrote it.
 * Write #N (nonce=N) goes to slot (N-1) % 20.
 * Only accurate while history hasn't fully wrapped (nonce <= 20).
 */
function extractRingEntryByNonce(
  data: Buffer,
  nonce: number,
): { scoreDelta: number; ts: number; pactId: string } | null {
  if (data.length < ACCOUNT_SIZE) return null;
  assertSchemaVersion(data);
  const historyLen = data.readUInt8(OFF_HISTORY_LEN);
  if (historyLen === 0) return null;
  const slotIdx = (nonce - 1) % 20;
  return extractRingEntryAt(data, slotIdx);
}

function extractRingEntryAt(
  data: Buffer,
  idx: number,
): { scoreDelta: number; ts: number; pactId: string } {
  const base = OFF_HISTORY + idx * HIST_ENTRY_SIZE;
  const scoreDelta = data.readInt16LE(base + 1);
  const ts = Number(data.readBigInt64LE(base + 3));
  const pactId = data.subarray(base + 11, base + 18).toString("hex");
  return { scoreDelta, ts, pactId };
}

export class ReputationSubscriber {
  private subscriptionId: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly store: EventStore,
  ) {}

  start(): void {
    this.subscribe();
    // On startup, catch up from the last indexed signature so we don't miss
    // events that arrived while the indexer was offline (up to 1000 sigs back).
    const lastSig = this.store.getLastIndexedSignature();
    void this.pollBackfill(lastSig !== null ? 1000 : 50, lastSig ?? undefined);
    // Periodic poll every 30s as a fallback for dropped WebSocket events.
    setInterval(() => void this.pollBackfill(20), 30_000);
  }

  private subscribe(): void {
    // Pass the PublicKey directly — onLogs accepts PublicKey | 'all' | 'allWithVotes'.
    this.subscriptionId = this.connection.onLogs(
      this.programId,
      (logs: Logs, ctx: Context) => void this.handleLogs(logs, ctx),
      "confirmed",
    );

    console.log(
      `[subscriber] Subscribed to program logs (program=${this.programId.toBase58()})`,
    );
  }

  /**
   * Poll recent signatures for the program and index any missed reputation events.
   * Used at startup (backfill) and as a periodic fallback when WebSocket events
   * are dropped by the public devnet endpoint.
   *
   * When `until` is provided (the last signature already in the DB), the RPC
   * returns only signatures newer than that one — enabling targeted catch-up
   * after a restart without re-processing the full history.
   */
  async pollBackfill(limit: number, until?: string): Promise<void> {
    try {
      const sigs = await this.connection.getSignaturesForAddress(
        this.programId,
        { limit, ...(until !== undefined ? { until } : {}) },
        "confirmed",
      );

      for (const sigInfo of sigs) {
        if (sigInfo.err !== null) continue;

        const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (tx === null) continue;

        const logMessages = tx.meta?.logMessages ?? [];
        for (const raw of logMessages) {
          // getParsedTransaction prefixes each line with "Program log: ";
          // parseReputationLog expects the raw message without that prefix.
          const line = raw.startsWith("Program log: ") ? raw.slice(13) : raw;
          const parsed = parseReputationLog(line);
          if (parsed === null) continue;

          const { agent, score, nonce, outcome } = parsed;

          let scoreDelta = 0;
          let pactId = "";
          let ts = tx.blockTime ?? Math.floor(Date.now() / 1000);

          try {
            const agentPubkey = new PublicKey(agent);
            const [repPda] = PublicKey.findProgramAddressSync(
              [Buffer.from("reputation"), agentPubkey.toBuffer()],
              this.programId,
            );
            const info = await this.connection.getAccountInfo(repPda, "confirmed");
            if (info !== null) {
              const ring = extractRingEntryByNonce(Buffer.from(info.data), nonce);
              if (ring !== null) {
                scoreDelta = ring.scoreDelta;
                pactId = ring.pactId;
                ts = ring.ts;
              }
            }
          } catch (err) {
            if (err instanceof SchemaVersionError) {
              // Legacy account pre-dates schema_version field — skip gracefully.
              // Real-time events in handleLogs still crash on mismatch.
              console.warn(`[subscriber] ${err.message} — skipping legacy account`);
              continue;
            }
            // best-effort; fallback values already set
          }

          const event: ReputationEvent = {
            agent,
            slot: sigInfo.slot,
            signature: sigInfo.signature,
            nonce,
            score,
            scoreDelta,
            outcome,
            pactId,
            ts,
            indexedAt: Math.floor(Date.now() / 1000),
          };

          this.store.upsertEvent(event);
        }
      }

      console.log(`[subscriber] Poll backfill complete (checked ${sigs.length} sigs)`);
    } catch (err) {
      if (err instanceof SchemaVersionError) throw err;
      console.warn("[subscriber] Backfill poll error:", err);
    }
  }

  private async handleLogs(logs: Logs, ctx: Context): Promise<void> {
    if (logs.err !== null) return;

    for (const line of logs.logs) {
      const parsed = parseReputationLog(line);
      if (parsed === null) continue;

      const { agent, score, nonce, outcome } = parsed;

      // Fetch on-chain account to get scoreDelta and pactId from the ring buffer.
      let scoreDelta = 0;
      let pactId = "";
      let ts = Math.floor(Date.now() / 1000);

      try {
        const agentPubkey = new PublicKey(agent);
        const [repPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("reputation"), agentPubkey.toBuffer()],
          this.programId,
        );
        const info = await this.connection.getAccountInfo(repPda, "confirmed");
        if (info !== null) {
          const ring = extractLatestRingEntry(Buffer.from(info.data));
          if (ring !== null) {
            scoreDelta = ring.scoreDelta;
            pactId = ring.pactId;
            ts = ring.ts;
          }
        }
      } catch (err) {
        if (err instanceof SchemaVersionError) {
          // Consistent with backfill: log and skip rather than crash the subscriber.
          console.warn(`[subscriber] ${(err as SchemaVersionError).message} — skipping real-time event`);
          continue;
        }
        console.warn(
          `[subscriber] Failed to fetch on-chain account for agent ${agent}:`,
          err,
        );
      }

      const event: ReputationEvent = {
        agent,
        slot: ctx.slot,
        signature: logs.signature,
        nonce,
        score,
        scoreDelta,
        outcome,
        pactId,
        ts,
        indexedAt: Math.floor(Date.now() / 1000),
      };

      this.store.upsertEvent(event);

      if (outcome === PactOutcome.Cancelled) {
        // MutuallyCancelled: explicit no-op — scoreDelta is 0 by design (CAS-187).
        // Logged here for analytics; the on-chain oracle already submitted delta=0.
        console.log(
          `[subscriber] MutuallyCancelled indexed: agent=${agent.slice(0, 8)}... pactId=${pactId} — no score delta applied`,
        );
      } else {
        console.log(
          `[subscriber] Indexed: agent=${agent.slice(0, 8)}... nonce=${nonce} score=${score} outcome=${outcome}`,
        );
      }
    }
  }

  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
  }
}
