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
  grossAmount?: bigint;
  protocolFeeAmount?: bigint;
  beneficiaryNetAmount?: bigint;
}

export interface EscrowEventEntry {
  kind: string;
  slot: number;
  signature: string;
  timestamp: number;
  grossAmount?: string;
  protocolFeeAmount?: string;
  beneficiaryNetAmount?: string;
}

export interface EscrowEventPage {
  events: EscrowEventEntry[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

export interface ProtocolEventEntry {
  id: string;
  type: string;
  slot: number;
  timestamp: string;
  txSignature: string;
  program: "escrow";
  actors: Record<string, string>;
  meta: Record<string, unknown>;
}

export interface ProtocolEventPage {
  events: ProtocolEventEntry[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}
