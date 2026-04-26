'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import {
  fetchHealth,
  fetchEvents,
  type HealthResponse,
  type ProtocolEvent,
} from '../../lib/indexer';

const SDK_VERSION = '0.2.0-devnet.2';
const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
const POLL_MS = 30_000;

type Level = 'ok' | 'degraded' | 'critical';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ago(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

async function pingRpc(): Promise<{ slot: number; latencyMs: number }> {
  const t0 = Date.now();
  const res = await fetch(SOLANA_DEVNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSlot',
      params: [{ commitment: 'finalized' }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const data = await res.json() as { result: number };
  return { slot: data.result, latencyMs: Date.now() - t0 };
}

function toIndexerLevel(s: HealthResponse['indexer']['status']): Level {
  if (s === 'ok') return 'ok';
  if (s === 'degraded') return 'degraded';
  return 'critical';
}

function toOracleLevel(s: HealthResponse['oracle']['status']): Level {
  if (s === 'ok') return 'ok';
  if (s === 'late') return 'degraded';
  return 'critical';
}

function overallLevel(rpcOk: boolean | null, health: HealthResponse | null): Level {
  if (rpcOk === false) return 'critical';
  if (!health) return 'ok';
  if (health.oracle.status === 'offline' || health.indexer.status === 'down') return 'critical';
  if (health.oracle.status === 'late' || health.indexer.status === 'degraded') return 'degraded';
  return 'ok';
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

const LEVEL = {
  ok:       { dot: 'bg-emerald-400',  badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',  label: 'Healthy'   },
  degraded: { dot: 'bg-amber-400',    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/25',        label: 'Degraded'  },
  critical: { dot: 'bg-red-400',      badge: 'bg-red-500/10 text-red-400 border-red-500/25',              label: 'Down'      },
};

function Dot({ level, pulse = true }: { level: Level; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${LEVEL[level].dot}${pulse && level === 'ok' ? ' animate-pulse' : ''}`}
      aria-hidden="true"
    />
  );
}

function Badge({ level }: { level: Level }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-wider ${LEVEL[level].badge}`}>
      <Dot level={level} pulse={false} />
      {LEVEL[level].label}
    </span>
  );
}

function Skeleton({ w, h = 3 }: { w?: string; h?: number }) {
  return <div className={`rounded bg-slate-800 animate-pulse ${w ?? 'w-full'}`} style={{ height: h * 4 }} />;
}

// ── Status Card ───────────────────────────────────────────────────────────────

interface Metric { label: string; value: string }

function StatusCard({
  title,
  subtitle,
  level,
  loading,
  metrics,
}: {
  title: string;
  subtitle: string;
  level: Level;
  loading: boolean;
  metrics: Metric[];
}) {
  const borderColor = level === 'ok' ? 'border-emerald-500/20' : level === 'degraded' ? 'border-amber-500/20' : 'border-red-500/20';
  return (
    <div className={`border ${borderColor} rounded-lg bg-slate-900/50 p-5`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-white mb-0.5">{title}</div>
          <div className="text-xs text-slate-500 font-mono">{subtitle}</div>
        </div>
        {loading ? <Skeleton w="w-16" h={5} /> : <Badge level={level} />}
      </div>
      <div className="flex flex-col gap-2 pt-3 border-t border-slate-800/50">
        {loading ? (
          <>
            <Skeleton w="w-3/4" />
            <Skeleton w="w-1/2" />
          </>
        ) : (
          metrics.map(m => (
            <div key={m.label} className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{m.label}</span>
              <span className="text-slate-300 font-mono">{m.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Program Card ──────────────────────────────────────────────────────────────

function ProgramCard({ prog }: { prog: HealthResponse['programs'][0] }) {
  const active = prog.status === 'active';
  return (
    <div className="border border-slate-800/50 rounded-lg bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-white truncate pr-2">{prog.name}</span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold uppercase tracking-wide flex-shrink-0 ${
          active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' : 'bg-red-500/10 text-red-400 border-red-500/25'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-red-400'}`} aria-hidden="true" />
          {prog.status}
        </span>
      </div>
      <div className="font-mono text-xs text-cyan-400 break-all leading-relaxed mb-2">
        {prog.programId}
      </div>
      <div className="text-xs text-slate-500 font-mono">
        slot {prog.lastSeenSlot.toLocaleString()}
      </div>
    </div>
  );
}

// ── Activity Feed ─────────────────────────────────────────────────────────────

const EVT_LABEL: Record<string, string> = {
  pact_created:          'Pact Created',
  pact_funded:           'Pact Funded',
  pact_locked:           'Pact Locked',
  pact_released:         'Pact Released',
  pact_auto_released:    'Auto Released',
  pact_claimed:          'Pact Claimed',
  pact_disputed:         'Pact Disputed',
  pact_cancelled:        'Pact Cancelled',
  pact_closed:           'Pact Closed',
  dispute_escalated:     'Dispute Escalated',
  dispute_resolved:      'Dispute Resolved',
  agent_registered:      'Agent Registered',
  reputation_updated:    'Reputation Updated',
};

const EVT_COLOR: Record<string, string> = {
  pact_created:       'text-purple-400',
  pact_funded:        'text-cyan-400',
  pact_locked:        'text-cyan-400',
  pact_released:      'text-emerald-400',
  pact_auto_released: 'text-emerald-400',
  pact_claimed:       'text-emerald-400',
  pact_disputed:      'text-red-400',
  dispute_escalated:  'text-red-400',
  dispute_resolved:   'text-emerald-400',
  agent_registered:   'text-blue-400',
  reputation_updated: 'text-emerald-400',
};

function ActivityFeed({ events, loading }: { events: ProtocolEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="border border-slate-800/50 rounded-lg bg-slate-900/50 divide-y divide-slate-800/50">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <div className="w-8 h-8 rounded-md bg-slate-800 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton w="w-1/4" />
              <Skeleton w="w-2/5" />
            </div>
            <Skeleton w="w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="border border-slate-800/50 rounded-lg bg-slate-900/50 py-16 text-center">
        <div className="text-4xl mb-3 text-slate-700" aria-hidden="true">⬡</div>
        <div className="text-sm font-semibold text-slate-500">No recent activity</div>
        <div className="text-xs text-slate-600 mt-1 max-w-xs mx-auto">
          Protocol events will appear here once activity is recorded on devnet.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-800/50 rounded-lg bg-slate-900/50 divide-y divide-slate-800/30">
      {events.slice(0, 10).map((evt, i) => {
        const isLast = i === Math.min(events.length, 10) - 1;
        const label = EVT_LABEL[evt.type] ?? evt.type;
        const color = EVT_COLOR[evt.type] ?? 'text-slate-500';
        return (
          <div
            key={evt.id}
            className={`flex items-center gap-4 px-4 py-3.5 hover:bg-slate-800/20 transition-colors${isLast ? ' opacity-60' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-md border border-slate-700/50 bg-slate-800/50 flex items-center justify-center text-xs flex-shrink-0 ${color}`}
              aria-hidden="true"
            >
              ⬡
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-200">{label}</div>
              <a
                href={`https://explorer.solana.com/tx/${evt.txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-cyan-500 hover:text-cyan-400 transition-colors"
                aria-label={`View transaction ${evt.txSignature} on Solana Explorer`}
              >
                {evt.txSignature.slice(0, 8)}…{evt.txSignature.slice(-6)} ↗
              </a>
            </div>
            <span className="text-xs font-mono text-slate-500 flex-shrink-0 whitespace-nowrap">
              {ago(evt.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [health, setHealth]     = useState<HealthResponse | null>(null);
  const [events, setEvents]     = useState<ProtocolEvent[]>([]);
  const [rpcSlot, setRpcSlot]   = useState<number | null>(null);
  const [rpcLatency, setRpcLatency] = useState<number | null>(null);
  const [rpcOk, setRpcOk]       = useState<boolean | null>(null);
  const [loading, setLoading]   = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(POLL_MS / 1000);

  const refresh = useCallback(async () => {
    const [healthRes, eventsRes, rpcRes] = await Promise.allSettled([
      fetchHealth(),
      fetchEvents(10),
      pingRpc(),
    ]);

    if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    if (eventsRes.status === 'fulfilled') setEvents(eventsRes.value.events);

    if (rpcRes.status === 'fulfilled') {
      setRpcOk(true);
      setRpcSlot(rpcRes.value.slot);
      setRpcLatency(rpcRes.value.latencyMs);
    } else {
      setRpcOk(false);
      setRpcSlot(null);
      setRpcLatency(null);
    }

    setLastChecked(new Date().toISOString());
    setLoading(false);
    setCountdown(POLL_MS / 1000);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const overall   = overallLevel(rpcOk, health);
  const idxLevel  = health ? toIndexerLevel(health.indexer.status) : 'ok';
  const oraLevel  = health ? toOracleLevel(health.oracle.status) : 'ok';
  const rpcLevel: Level = rpcOk === null ? 'ok' : rpcOk ? 'ok' : 'critical';

  const overallLabel =
    overall === 'ok' ? 'All Systems Operational'
    : overall === 'degraded' ? 'Partial Degradation'
    : 'Service Disruption';

  const overallBadge =
    overall === 'ok'       ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
    : overall === 'degraded' ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
    : 'bg-red-500/10 text-red-400 border-red-500/25';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans">
      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav
        className="fixed w-full border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-md z-50"
        aria-label="Main navigation"
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label="Holdfast home">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Lock className="w-4 h-4 text-slate-950" aria-hidden="true" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">HOLDFAST</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="/#protocol"   className="hover:text-emerald-400 transition-colors">Protocol</a>
            <a href="/#developers" className="hover:text-emerald-400 transition-colors">Developers</a>
            <Link href="/docs"     className="hover:text-emerald-400 transition-colors">Documentation</Link>
            <Link href="/status"   className="text-emerald-400" aria-current="page">Network Status</Link>
          </div>
          <Link
            href="/onboarding"
            className="bg-slate-100 hover:bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-[0_0_15px_rgba(52,211,153,0.15)] hover:shadow-[0_0_25px_rgba(52,211,153,0.3)]"
          >
            Start Building
          </Link>
        </div>
      </nav>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <main className="pt-28 pb-20 px-6 max-w-7xl mx-auto">

        {/* Page header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-700 bg-slate-800/50 text-xs font-semibold tracking-widest text-slate-400 uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden="true" />
            Devnet
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-2">
                Network Status
              </h1>
              {lastChecked ? (
                <p className="text-sm text-slate-500 font-mono">
                  Last checked {ago(lastChecked)}
                  {' · '}refreshing in{' '}
                  <span className="text-emerald-400">{countdown}s</span>
                  {' · '}
                  <button
                    onClick={refresh}
                    className="text-slate-400 hover:text-emerald-400 transition-colors underline-offset-2 hover:underline"
                  >
                    refresh now
                  </button>
                </p>
              ) : (
                <p className="text-sm text-slate-500 font-mono">Checking status…</p>
              )}
            </div>
            {!loading && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold uppercase tracking-widest ${overallBadge}`}>
                <Dot level={overall} />
                {overallLabel}
              </div>
            )}
          </div>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatusCard
            title="Solana RPC"
            subtitle="api.devnet.solana.com"
            level={rpcLevel}
            loading={loading}
            metrics={[
              ...(rpcSlot   !== null ? [{ label: 'Current Slot', value: rpcSlot.toLocaleString() }]   : []),
              ...(rpcLatency !== null ? [{ label: 'Latency',      value: `${rpcLatency} ms`          }] : []),
            ]}
          />
          <StatusCard
            title="Indexer"
            subtitle={health ? `${health.indexer.syncLagSlots} block${health.indexer.syncLagSlots === 1 ? '' : 's'} behind` : 'Sync lag —'}
            level={idxLevel}
            loading={loading}
            metrics={health ? [
              { label: 'Latest Slot', value: health.indexer.latestIndexedSlot.toLocaleString() },
              { label: 'Updated',     value: ago(health.indexer.lastUpdatedAt)                 },
            ] : []}
          />
          <StatusCard
            title="Oracle"
            subtitle={health ? `${health.oracle.uptimePercent7d.toFixed(1)}% uptime (7d)` : '7d uptime —'}
            level={oraLevel}
            loading={loading}
            metrics={health ? [
              { label: 'Last Heartbeat',  value: ago(health.oracle.lastHeartbeatAt)               },
              { label: 'Missed (24h)',    value: String(health.oracle.missedHeartbeats24h)         },
            ] : []}
          />
        </div>

        {/* Programs + SDK */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Programs */}
          <section className="lg:col-span-2" aria-label="Deployed programs">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
              Devnet Programs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {loading ? (
                <>
                  {[0, 1].map(i => (
                    <div key={i} className="border border-slate-800/50 rounded-lg bg-slate-900/50 p-4 space-y-2">
                      <Skeleton w="w-1/2" h={4} />
                      <Skeleton h={3} />
                      <Skeleton w="w-3/4" h={3} />
                    </div>
                  ))}
                </>
              ) : health?.programs.length ? (
                health.programs.map(p => <ProgramCard key={p.programId} prog={p} />)
              ) : (
                <div className="col-span-2 border border-slate-800 rounded-lg p-8 text-center text-slate-500 text-sm">
                  Program data unavailable
                </div>
              )}
            </div>
          </section>

          {/* SDK info */}
          <section aria-label="SDK information">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
              SDK
            </h2>
            <div className="border border-slate-800/50 rounded-lg bg-slate-900/50 p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white font-mono">@holdfastprotocol/sdk</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-bold font-mono">
                  v{SDK_VERSION}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                TypeScript SDK for trust infrastructure on Solana — identity, reputation, and programmable escrow.
              </p>
              <dl className="flex flex-col gap-2 pt-3 border-t border-slate-800">
                {([
                  ['network', 'devnet',    'text-cyan-400'],
                  ['chain',   'Solana',    'text-slate-300'],
                  ['anchor',  '0.31.1',    'text-slate-400'],
                  ['audit',   'pre-audit', 'text-amber-400'],
                ] as const).map(([k, v, c]) => (
                  <div key={k} className="flex items-center gap-2 text-xs font-mono">
                    <dt className="text-slate-600 w-14 flex-shrink-0">{k}</dt>
                    <dd className={c}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </div>

        {/* Recent activity */}
        <section aria-label="Recent pact activity">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Recent Pact Activity
            </h2>
            <span className="text-xs font-mono text-slate-600">
              auto-refresh {countdown}s
            </span>
          </div>
          <ActivityFeed events={events} loading={loading} />
        </section>
      </main>
    </div>
  );
}
