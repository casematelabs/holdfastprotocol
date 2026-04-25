import Database from "better-sqlite3";
import type { ReputationEvent, HistEntry, HistoryPage, CancelIntentRecord, EscrowEvent, EscrowEventEntry, EscrowEventPage } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reputation_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT    NOT NULL,
  slot        INTEGER NOT NULL,
  signature   TEXT    NOT NULL,
  nonce       INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  score_delta INTEGER NOT NULL,
  outcome     INTEGER NOT NULL,
  pact_id     TEXT    NOT NULL DEFAULT '',
  ts          INTEGER NOT NULL,
  indexed_at  INTEGER NOT NULL,
  UNIQUE(agent, nonce)
);
CREATE INDEX IF NOT EXISTS idx_agent_ts    ON reputation_events(agent, ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_nonce ON reputation_events(agent, nonce DESC);

CREATE TABLE IF NOT EXISTS cancel_intents (
  escrow_id    TEXT    NOT NULL,
  requested_by TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (escrow_id, requested_by)
);
CREATE INDEX IF NOT EXISTS idx_cancel_intents_escrow ON cancel_intents(escrow_id);

CREATE TABLE IF NOT EXISTS escrow_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  escrow      TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  slot        INTEGER NOT NULL,
  signature   TEXT    NOT NULL,
  ts          INTEGER NOT NULL,
  indexed_at  INTEGER NOT NULL,
  UNIQUE(escrow, signature, kind)
);
CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow ON escrow_events(escrow, ts DESC);
`;

export class EventStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(SCHEMA);
  }

  upsertEvent(event: ReputationEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reputation_events
         (agent, slot, signature, nonce, score, score_delta, outcome, pact_id, ts, indexed_at)
         VALUES (@agent, @slot, @signature, @nonce, @score, @scoreDelta, @outcome, @pactId, @ts, @indexedAt)`,
      )
      .run({
        agent: event.agent,
        slot: event.slot,
        signature: event.signature,
        nonce: event.nonce,
        score: event.score,
        scoreDelta: event.scoreDelta,
        outcome: event.outcome,
        pactId: event.pactId,
        ts: event.ts,
        indexedAt: event.indexedAt,
      });
  }

  getHistory(
    agent: string,
    limit: number,
    beforeId?: number,
  ): HistoryPage {
    const countRow = this.db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) as n FROM reputation_events WHERE agent = ?",
      )
      .get(agent);
    const total = countRow?.n ?? 0;

    const rows = beforeId !== undefined
      ? this.db
          .prepare<[string, number, number], DbRow>(
            `SELECT id, outcome, score_delta, ts, pact_id
             FROM reputation_events
             WHERE agent = ? AND id < ?
             ORDER BY id DESC
             LIMIT ?`,
          )
          .all(agent, beforeId, limit)
      : this.db
          .prepare<[string, number], DbRow>(
            `SELECT id, outcome, score_delta, ts, pact_id
             FROM reputation_events
             WHERE agent = ?
             ORDER BY id DESC
             LIMIT ?`,
          )
          .all(agent, limit);

    const entries: HistEntry[] = rows.map((r) => ({
      outcome: r.outcome,
      scoreDelta: r.score_delta,
      timestamp: r.ts,
      pactId: r.pact_id,
    }));

    const lastRow = rows[rows.length - 1];
    // hasMore is true when we filled the page — there may be older rows.
    const hasMore = rows.length === limit;

    return {
      entries,
      total,
      hasMore,
      ...(hasMore && lastRow ? { cursor: String(lastRow.id) } : {}),
    };
  }

  isHealthy(): boolean {
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  getLastIndexedSignature(): string | null {
    const row = this.db
      .prepare<[], { signature: string | null }>(
        "SELECT signature FROM reputation_events ORDER BY slot DESC, id DESC LIMIT 1",
      )
      .get();
    return row?.signature ?? null;
  }

  // 72-hour TTL for cancel intents.
  private static readonly CANCEL_INTENT_TTL_S = 72 * 60 * 60;

  upsertCancelIntent(escrowId: string, requestedBy: string): CancelIntentRecord {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + EventStore.CANCEL_INTENT_TTL_S;
    this.db
      .prepare(
        `INSERT INTO cancel_intents (escrow_id, requested_by, created_at, expires_at)
         VALUES (@escrowId, @requestedBy, @createdAt, @expiresAt)
         ON CONFLICT(escrow_id, requested_by) DO UPDATE SET
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run({ escrowId, requestedBy, createdAt: now, expiresAt });
    return { escrowId, requestedBy, createdAt: now, expiresAt };
  }

  getCancelIntent(escrowId: string): CancelIntentRecord | null {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db
      .prepare<[string, number], CancelIntentDbRow>(
        `SELECT escrow_id, requested_by, created_at, expires_at
         FROM cancel_intents
         WHERE escrow_id = ? AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(escrowId, now);
    if (row === undefined) return null;
    return {
      escrowId: row.escrow_id,
      requestedBy: row.requested_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  deleteCancelIntent(escrowId: string, requestedBy: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM cancel_intents WHERE escrow_id = ? AND requested_by = ?`,
      )
      .run(escrowId, requestedBy);
    return result.changes > 0;
  }

  pruneExpiredIntents(): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare("DELETE FROM cancel_intents WHERE expires_at <= ?").run(now);
  }

  upsertEscrowEvent(event: EscrowEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO escrow_events
         (escrow, kind, slot, signature, ts, indexed_at)
         VALUES (@escrow, @kind, @slot, @signature, @ts, @indexedAt)`,
      )
      .run({
        escrow: event.escrow,
        kind: event.kind,
        slot: event.slot,
        signature: event.signature,
        ts: event.ts,
        indexedAt: event.indexedAt,
      });
  }

  getEscrowEvents(escrow: string, limit: number, beforeId?: number): EscrowEventPage {
    const countRow = this.db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) as n FROM escrow_events WHERE escrow = ?",
      )
      .get(escrow);
    const total = countRow?.n ?? 0;

    const rows = beforeId !== undefined
      ? this.db
          .prepare<[string, number, number], EscrowEventDbRow>(
            `SELECT id, kind, slot, signature, ts
             FROM escrow_events
             WHERE escrow = ? AND id < ?
             ORDER BY id DESC
             LIMIT ?`,
          )
          .all(escrow, beforeId, limit)
      : this.db
          .prepare<[string, number], EscrowEventDbRow>(
            `SELECT id, kind, slot, signature, ts
             FROM escrow_events
             WHERE escrow = ?
             ORDER BY id DESC
             LIMIT ?`,
          )
          .all(escrow, limit);

    const events: EscrowEventEntry[] = rows.map((r) => ({
      kind: r.kind,
      slot: r.slot,
      signature: r.signature,
      timestamp: r.ts,
    }));

    const lastRow = rows[rows.length - 1];
    const hasMore = rows.length === limit;

    return {
      events,
      total,
      hasMore,
      ...(hasMore && lastRow ? { cursor: String(lastRow.id) } : {}),
    };
  }

  getLastIndexedEscrowSignature(): string | null {
    const row = this.db
      .prepare<[], { signature: string | null }>(
        "SELECT signature FROM escrow_events ORDER BY slot DESC, id DESC LIMIT 1",
      )
      .get();
    return row?.signature ?? null;
  }

  close(): void {
    this.db.close();
  }
}

interface CancelIntentDbRow {
  escrow_id: string;
  requested_by: string;
  created_at: number;
  expires_at: number;
}

interface DbRow {
  id: number;
  outcome: number;
  score_delta: number;
  ts: number;
  pact_id: string;
}

interface EscrowEventDbRow {
  id: number;
  kind: string;
  slot: number;
  signature: string;
  ts: number;
}
