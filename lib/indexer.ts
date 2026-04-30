import { DEVNET_INDEXER_BASE } from './release-manifest';

const INDEXER_BASE = process.env.NEXT_PUBLIC_INDEXER_URL ?? DEVNET_INDEXER_BASE;

export type PactStatus =
  | 'pending' | 'funded' | 'locked' | 'released'
  | 'disputed' | 'refunded' | 'closed' | 'claimed' | 'cancelled';

export interface IndexerPact {
  id: string;
  escrowAddress: string;
  counterparty: string;
  role: 'initiator' | 'beneficiary';
  amountLamports: string;
  amountSol: number;
  mint: string;
  status: PactStatus;
  autoRelease: boolean;
  createdAt: string;
  lockedAt: string | null;
  releasedAt: string | null;
  disputeWindowEndsAt: string | null;
  disputeDeadlineAt: string | null;
  resolvedVia: string | null;
  txSignature: string;
}

export interface PactsResponse {
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  pacts: IndexerPact[];
}

export interface ReputationResponse {
  pubkey: string;
  score: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  pactCount: number;
  disputeRate: number;
  lastOracleUpdate: string;
  history30d: number[];
  history90d: number[];
}

export interface WalletInfo {
  address: string;
  registrationState: 'registered' | 'unregistered' | 'revoked';
  attestationType: 'hardware' | 'software';
  teeProvider: string | null;
  registrationSlot: number;
  registrationDate: string;
  registrationTx: string;
  agentStatus: number;
  revokedAt: string | null;
  deregistrationDeadline: string | null;
}

export interface KeyRotationsResponse {
  pubkey: string;
  wallet: WalletInfo;
  rotationCount: number;
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  rotations: Array<{
    slot: number;
    timestamp: string;
    txSignature: string;
    prevSecp256r1Pubkey: string | null;
    newSecp256r1Pubkey: string;
  }>;
}

async function indexerFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${INDEXER_BASE}${path}`);
  if (!res.ok) {
    let message = `Indexer error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {}
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchReputation(pubkey: string) {
  return indexerFetch<ReputationResponse>(`/agents/${pubkey}/reputation`);
}

export function fetchPacts(pubkey: string, status: 'active' | 'completed', limit = 20) {
  return indexerFetch<PactsResponse>(`/agents/${pubkey}/pacts?status=${status}&limit=${limit}`);
}

export function fetchKeyRotations(pubkey: string) {
  return indexerFetch<KeyRotationsResponse>(`/agents/${pubkey}/key-rotations`);
}

// ── Protocol Health types ──────────────────────────────────────────────────

export interface HealthResponse {
  indexer: {
    status: 'ok' | 'degraded' | 'down';
    latestIndexedSlot: number;
    chainHeadSlot: number;
    syncLagSlots: number;
    syncLagMs: number;
    lastUpdatedAt: string;
  };
  oracle: {
    status: 'ok' | 'late' | 'offline';
    lastHeartbeatAt: string;
    lastHeartbeatSlot: number;
    uptimePercent7d: number;
    missedHeartbeats24h: number;
  };
  programs: Array<{
    name: string;
    anchorModule: string;
    programId: string;
    status: 'active' | 'unreachable';
    lastSeenSlot: number;
  }>;
  network: string;
}

export interface ProtocolEvent {
  id: string;
  type: string;
  slot: number;
  timestamp: string;
  txSignature: string;
  program: string;
  actors: Record<string, string>;
  meta: Record<string, unknown>;
}

export interface EventsResponse {
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  events: ProtocolEvent[];
}

export interface AgentEventsResponse {
  pagination: { total: number; limit: number; hasMore: boolean; cursor: string | null };
  events: ProtocolEvent[];
}

export function fetchHealth() {
  return indexerFetch<HealthResponse>('/health');
}

export function fetchEvents(limit = 10) {
  return indexerFetch<EventsResponse>(`/events?limit=${limit}`);
}

export function fetchAgentEvents(pubkey: string, limit = 50, after?: string) {
  const params = new URLSearchParams({ agent: pubkey, limit: String(limit) });
  if (after) params.set('after', after);
  return indexerFetch<AgentEventsResponse>(`/events?${params}`);
}
