export enum PactOutcome {
  Fulfilled = 0,
  Disputed = 1,
  Cancelled = 2,
}

export interface ReputationEvent {
  agent: string;
  slot: number;
  signature: string;
  nonce: number;
  score: number;
  scoreDelta: number;
  outcome: PactOutcome;
  pactId: string;
  ts: number;
  indexedAt: number;
}

export interface HistEntry {
  outcome: PactOutcome;
  scoreDelta: number;
  timestamp: number;
  pactId: string;
}

export interface HistoryPage {
  entries: HistEntry[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

export interface CancelIntentRecord {
  escrowId: string;
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface EscrowEvent {
  escrow: string;
  kind: string;
  slot: number;
  signature: string;
  ts: number;
  indexedAt: number;
}

export interface EscrowEventEntry {
  kind: string;
  slot: number;
  signature: string;
  timestamp: number;
}

export interface EscrowEventPage {
  events: EscrowEventEntry[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}
