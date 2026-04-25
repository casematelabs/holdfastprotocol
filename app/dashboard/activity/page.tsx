'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchAgentEvents, type ProtocolEvent } from '@/lib/indexer';

type ActionCategory = 'Escrow' | 'Custody' | 'Reputation' | 'System';
type EventStatus = 'Success' | 'Failed' | 'Pending';
type SortDir = 'asc' | 'desc';

interface ActivityEvent {
  id: string;
  timestamp: string;
  action: string;
  category: ActionCategory;
  actor: string;
  actorFull: string;
  details: string;
  txHash?: string;
  status: EventStatus;
}

const CAT_COLORS: Record<ActionCategory, string> = {
  Escrow:     '#2D8CFF',
  Custody:    '#A855F7',
  Reputation: '#10B981',
  System:     '#8A99AC',
};

const STATUS_STYLE: Record<EventStatus, { color: string; dim: string; border: string }> = {
  Success: { color: '#22C55E', dim: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.22)'  },
  Failed:  { color: '#EF4444', dim: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.22)'  },
  Pending: { color: '#F59E0B', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.22)' },
};

const DEVNET_EXPLORER = 'https://explorer.solana.com/tx';
const PAGE_SIZE = 50;

// ── Category mapping ─────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, ActionCategory> = {
  PactCreated: 'Escrow',
  PactDeposited: 'Escrow',
  PactReleased: 'Escrow',
  PactCancelled: 'Escrow',
  PactClaimed: 'Escrow',
  PactLocked: 'Escrow',
  PactFunded: 'Escrow',
  DisputeOpened: 'Escrow',
  DisputeResolved: 'Escrow',
  EvidenceSubmitted: 'Escrow',
  EscrowRefunded: 'Escrow',
  AgentRegistered: 'Custody',
  AgentDeregistered: 'Custody',
  AgentRevoked: 'Custody',
  KeyRotationInitiated: 'Custody',
  KeyRotationConfirmed: 'Custody',
  WalletRegistered: 'Custody',
  ReputationUpdated: 'Reputation',
  ThresholdUpdated: 'Reputation',
  TierChanged: 'Reputation',
  OracleHeartbeat: 'System',
  ProgramUpgraded: 'System',
};

function mapCategory(eventType: string): ActionCategory {
  return CATEGORY_MAP[eventType] ?? 'System';
}

function mapStatus(event: ProtocolEvent): EventStatus {
  const meta = event.meta;
  if (meta?.status === 'failed' || meta?.error) return 'Failed';
  if (meta?.status === 'pending' || eventType_isPending(event.type)) return 'Pending';
  return 'Success';
}

function eventType_isPending(type: string): boolean {
  return type === 'KeyRotationInitiated';
}

function formatDetails(event: ProtocolEvent): string {
  if (typeof event.meta?.description === 'string') return event.meta.description;
  const parts: string[] = [];
  if (event.meta?.amount) parts.push(`${event.meta.amount} SOL`);
  if (event.meta?.counterparty) parts.push(`with ${truncatePubkey(String(event.meta.counterparty))}`);
  if (event.meta?.pactId) parts.push(`pact ${String(event.meta.pactId).slice(0, 8)}`);
  if (event.meta?.score !== undefined) parts.push(`score: ${event.meta.score}`);
  if (event.meta?.tier) parts.push(`tier: ${event.meta.tier}`);
  if (parts.length > 0) return parts.join(' · ');
  return event.type.replace(/([A-Z])/g, ' $1').trim();
}

function truncatePubkey(pk: string): string {
  if (pk.length <= 11) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function primaryActor(actors: Record<string, string>): { short: string; full: string } {
  const keys = Object.keys(actors);
  if (keys.length === 0) return { short: 'System', full: 'System' };
  const first = actors[keys[0]];
  return { short: truncatePubkey(first), full: first };
}

function toActivityEvent(event: ProtocolEvent): ActivityEvent {
  const actor = primaryActor(event.actors);
  return {
    id: event.id,
    timestamp: event.timestamp,
    action: event.type,
    category: mapCategory(event.type),
    actor: actor.short,
    actorFull: actor.full,
    details: formatDetails(event),
    txHash: event.txSignature || undefined,
    status: mapStatus(event),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Component ────────────────────────────────────────────────────────────────

const ALL_CATS: Array<ActionCategory | 'All'> = ['All', 'Escrow', 'Custody', 'Reputation', 'System'];
const ALL_STATUSES: Array<EventStatus | 'All'> = ['All', 'Success', 'Failed', 'Pending'];

export default function ActivityPage() {
  const { publicKey, connected } = useWallet();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [catFilter, setCatFilter] = useState<ActionCategory | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'All'>('All');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async (pubkey: string, afterCursor?: string) => {
    const isInitial = !afterCursor;
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await fetchAgentEvents(pubkey, PAGE_SIZE, afterCursor);
      const mapped = res.events.map(toActivityEvent);

      setEvents(prev => isInitial ? mapped : [...prev, ...mapped]);
      setCursor(res.pagination.cursor);
      setHasMore(res.pagination.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach indexer');
      if (isInitial) setEvents([]);
    } finally {
      if (isInitial) setLoading(false);
      else setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setEvents([]);
      setCursor(null);
      setHasMore(false);
      setError(null);
      return;
    }
    loadEvents(publicKey.toBase58());
  }, [connected, publicKey, loadEvents]);

  useEffect(() => {
    if (!hasMore || loadingMore || !cursor || !publicKey) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadEvents(publicKey.toBase58(), cursor);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, cursor, publicKey, loadEvents]);

  const filtered = events
    .filter(e => catFilter === 'All' || e.category === catFilter)
    .filter(e => statusFilter === 'All' || e.status === statusFilter)
    .sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sortDir === 'desc' ? -diff : diff;
    });

  const s: Record<string, React.CSSProperties> = {
    page:       { padding: '28px 32px', maxWidth: 960, margin: '0 auto' },
    header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    title:      { fontSize: 20, fontWeight: 600, color: '#E8EDF2', margin: 0 },
    filterRow:  { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' as const, alignItems: 'center' },
    filterLabel:{ fontSize: 12, color: '#8A99AC', marginRight: 4 },
    pill:       { fontSize: 12, padding: '4px 12px', borderRadius: 20, border: '1px solid #1E2D42', background: '#111822', color: '#8A99AC', cursor: 'pointer', transition: 'all 0.15s' },
    pillActive: { background: 'rgba(45,140,255,0.15)', borderColor: 'rgba(45,140,255,0.4)', color: '#2D8CFF' },
    sortBtn:    { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #1E2D42', background: '#111822', color: '#8A99AC', cursor: 'pointer', marginLeft: 'auto' },
    table:      { width: '100%', borderCollapse: 'collapse' as const },
    th:         { fontSize: 11, fontWeight: 600, color: '#8A99AC', textAlign: 'left' as const, padding: '8px 12px', borderBottom: '1px solid #1E2D42', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
    tr:         { borderBottom: '1px solid rgba(30,45,66,0.6)', transition: 'background 0.1s', cursor: 'pointer' },
    td:         { padding: '10px 12px', fontSize: 13, color: '#C8D4E0', verticalAlign: 'top' as const },
    catPill:    { display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.05em' },
    statusDot:  { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', marginRight: 5 },
    txLink:     { fontSize: 11, color: '#2D8CFF', textDecoration: 'none', fontFamily: "'JetBrains Mono', monospace" },
    detail:     { fontSize: 12, color: '#8A99AC', marginTop: 4, lineHeight: 1.5 },
    actorMono:  { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#C8D4E0' },
    emptyCard:  { textAlign: 'center' as const, padding: '56px 24px', background: '#111822', border: '1px solid #1E2D42', borderRadius: 8 },
  };

  if (!connected) {
    return (
      <div style={{ ...s.page, textAlign: 'center', paddingTop: 80 }}>
        <p style={{ color: '#8A99AC', fontSize: 14 }}>Connect your wallet to view activity.</p>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Activity</h1>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            marginBottom: 20,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.22)',
            borderRadius: 6,
            fontSize: 13,
            color: '#EF4444',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4.5V7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="7" cy="9.5" r="0.6" fill="currentColor"/>
          </svg>
          <span>
            Indexer unavailable — {error}.{' '}
            <button
              onClick={() => publicKey && loadEvents(publicKey.toBase58())}
              style={{
                background: 'none',
                border: 'none',
                color: '#EF4444',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 13,
                padding: 0,
              }}
            >
              Retry
            </button>
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={s.filterRow}>
        <span style={s.filterLabel}>Category</span>
        {ALL_CATS.map(c => (
          <button
            key={c}
            style={{ ...s.pill, ...(catFilter === c ? s.pillActive : {}), ...(c !== 'All' ? { borderColor: `${CAT_COLORS[c as ActionCategory]}33`, color: catFilter === c ? CAT_COLORS[c as ActionCategory] : '#8A99AC' } : {}) }}
            onClick={() => setCatFilter(c as ActionCategory | 'All')}
          >
            {c}
          </button>
        ))}
        <span style={{ ...s.filterLabel, marginLeft: 12 }}>Status</span>
        {ALL_STATUSES.map(st => (
          <button
            key={st}
            style={{ ...s.pill, ...(statusFilter === st ? s.pillActive : {}) }}
            onClick={() => setStatusFilter(st as EventStatus | 'All')}
          >
            {st}
          </button>
        ))}
        <button
          style={s.sortBtn}
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          aria-label="Toggle sort direction"
        >
          Time {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="vp-skel"
              style={{ height: 42, width: '100%' }}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && events.length === 0 && (
        <div style={s.emptyCard}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ margin: '0 auto 16px', display: 'block', color: '#3A4A5C' }}>
            <rect x="4" y="8" width="28" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 14h28" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="18" cy="22" r="2" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          <p style={{ color: '#8A99AC', fontSize: 14, margin: '0 0 6px' }}>
            No activity yet
          </p>
          <p style={{ color: '#4D5E72', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            On-chain events for your agent will appear here once you create your first pact or register your wallet.
          </p>
        </div>
      )}

      {/* Event table */}
      {!loading && filtered.length > 0 && (
        <>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Time</th>
                <th style={s.th}>Action</th>
                <th style={s.th}>Category</th>
                <th style={s.th}>Actor</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ev => {
                const ss = STATUS_STYLE[ev.status];
                const expanded = expandedId === ev.id;
                return (
                  <tr
                    key={ev.id}
                    style={s.tr}
                    onClick={() => setExpandedId(expanded ? null : ev.id)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(45,140,255,0.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ ...s.td, whiteSpace: 'nowrap', color: '#8A99AC', fontSize: 12 }}>
                      {relativeTime(ev.timestamp)}
                    </td>
                    <td style={s.td}>
                      <div style={{ fontWeight: 400, color: '#C8D4E0' }}>{ev.action}</div>
                      {expanded && <div style={s.detail}>{ev.details}</div>}
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.catPill, background: `${CAT_COLORS[ev.category]}18`, color: CAT_COLORS[ev.category], border: `1px solid ${CAT_COLORS[ev.category]}33` }}>
                        {ev.category.toUpperCase()}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={s.actorMono} title={ev.actorFull}>{ev.actor}</span>
                    </td>
                    <td style={s.td}>
                      <span style={{ display: 'flex', alignItems: 'center', fontSize: 12 }}>
                        <span style={{ ...s.statusDot, background: ss.color }} />
                        <span style={{ color: ss.color }}>{ev.status}</span>
                      </span>
                    </td>
                    <td style={s.td}>
                      {ev.txHash ? (
                        <a
                          href={`${DEVNET_EXPLORER}/${ev.txHash}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={s.txLink}
                          onClick={e => e.stopPropagation()}
                        >
                          {ev.txHash.slice(0, 8)}…
                        </a>
                      ) : (
                        <span style={{ color: '#3A4A5C', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingMore && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <span className="vp-skel" style={{ display: 'inline-block', width: 120, height: 14 }} />
            </div>
          )}
        </>
      )}

      {/* No-filter-match state (distinct from empty-data) */}
      {!loading && events.length > 0 && filtered.length === 0 && (
        <p style={{ textAlign: 'center', padding: '48px 0', color: '#8A99AC', fontSize: 14 }}>
          No events match the current filters.
        </p>
      )}

      <p style={{ fontSize: 11, color: '#3A4A5C', marginTop: 16, textAlign: 'right' }}>
        Showing {filtered.length} of {events.length} events
        {hasMore && ' · scroll for more'}
      </p>
    </div>
  );
}
