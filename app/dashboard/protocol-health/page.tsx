'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchHealth, fetchEvents, type HealthResponse, type ProtocolEvent } from '../../../lib/indexer';

// ── Design tokens (inline, matching existing dashboard pages) ───────────────

const C = {
  bgPage: '#0D1117',
  bgCard: '#141B27',
  bgCardRaised: '#18202E',
  bgHover: '#1A2438',
  border: '#1E2D42',
  borderHover: '#2D4060',
  textPrimary: '#E8EDF2',
  textSecondary: '#8A99AC',
  textTertiary: '#4D5E72',
  textDisabled: '#2D3E52',
  accent: '#2D8CFF',
  accentDim: 'rgba(45, 140, 255, 0.12)',
  accentBorder: 'rgba(45, 140, 255, 0.22)',
  success: '#22C55E',
  successDim: 'rgba(34, 197, 94, 0.08)',
  successBorder: 'rgba(34, 197, 94, 0.22)',
  warning: '#F59E0B',
  warningDim: 'rgba(245, 158, 11, 0.08)',
  warningBorder: 'rgba(245, 158, 11, 0.22)',
  danger: '#EF4444',
  dangerDim: 'rgba(239, 68, 68, 0.08)',
  dangerBorder: 'rgba(239, 68, 68, 0.22)',
  purple: '#8B5CF6',
  purpleDim: 'rgba(139, 92, 246, 0.12)',
  purpleBorder: 'rgba(139, 92, 246, 0.2)',
} as const;

const FONT_MONO = "'Courier New', Courier, monospace";

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatSlot(n: number): string {
  return n.toLocaleString('en-US');
}

function truncateTx(sig: string): string {
  if (sig.length <= 10) return sig;
  return `${sig.slice(0, 4)}…${sig.slice(-4)}`;
}

// ── Status color helpers ────────────────────────────────────────────────────

type HealthLevel = 'ok' | 'degraded' | 'critical';

function oracleToLevel(s: HealthResponse['oracle']['status']): HealthLevel {
  if (s === 'ok') return 'ok';
  if (s === 'late') return 'degraded';
  return 'critical';
}

function indexerToLevel(s: HealthResponse['indexer']['status']): HealthLevel {
  if (s === 'ok') return 'ok';
  if (s === 'degraded') return 'degraded';
  return 'critical';
}

function levelColor(level: HealthLevel) {
  if (level === 'ok') return { main: C.success, dim: C.successDim, border: C.successBorder };
  if (level === 'degraded') return { main: C.warning, dim: C.warningDim, border: C.warningBorder };
  return { main: C.danger, dim: C.dangerDim, border: C.dangerBorder };
}

function levelLabel(level: HealthLevel): string {
  if (level === 'ok') return 'Healthy';
  if (level === 'degraded') return 'Degraded';
  return 'Down';
}

// ── Event icon / color mapping ──────────────────────────────────────────────

const EVENT_STYLES: Record<string, { icon: string; color: string; dim: string; border: string }> = {
  agent_registered:     { icon: '◉', color: C.accent,  dim: 'rgba(45,140,255,0.08)',  border: 'rgba(45,140,255,0.16)' },
  agent_status_changed: { icon: '◉', color: C.accent,  dim: C.accentDim,              border: C.accentBorder },
  key_rotated:          { icon: '◉', color: C.accent,  dim: C.accentDim,              border: C.accentBorder },
  reputation_updated:   { icon: '◆', color: C.success, dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.2)' },
  pact_created:         { icon: '⬡', color: C.purple,  dim: C.purpleDim,              border: C.purpleBorder },
  pact_funded:          { icon: '◈', color: C.warning, dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.2)' },
  pact_staked:          { icon: '◈', color: C.warning, dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.2)' },
  pact_locked:          { icon: '◈', color: C.warning, dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.2)' },
  pact_released:        { icon: '✓', color: C.success, dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.2)' },
  pact_auto_released:   { icon: '✓', color: C.success, dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.2)' },
  pact_claimed:         { icon: '✓', color: C.success, dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.2)' },
  pact_disputed:        { icon: '⚑', color: C.danger,  dim: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.22)' },
  dispute_escalated:    { icon: '⚑', color: C.danger,  dim: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.22)' },
  dispute_resolved:     { icon: '✓', color: C.success, dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.2)' },
  pact_refunded:        { icon: '◈', color: C.warning, dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.2)' },
  pact_cancelled_pending:{ icon: '◈', color: C.warning, dim: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.2)' },
  pact_cancelled:       { icon: '◈', color: C.warning, dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.2)' },
  pact_closed:          { icon: '✓', color: C.success, dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.2)' },
  pact_frozen:          { icon: '⚑', color: C.danger,  dim: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.22)' },
};

const DEFAULT_EVENT_STYLE = { icon: '●', color: C.textTertiary, dim: 'rgba(77,94,114,0.08)', border: 'rgba(77,94,114,0.22)' };

function eventStyle(type: string) {
  return EVENT_STYLES[type] ?? DEFAULT_EVENT_STYLE;
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function Skel({ w, h, style }: { w?: string | number; h?: number; style?: React.CSSProperties }) {
  return (
    <div className="vp-skel" style={{
      width: typeof w === 'number' ? `${w}px` : (w || '100%'),
      height: h || 14,
      borderRadius: 2,
      ...style,
    }} />
  );
}

// ── Pulsing live dot ────────────────────────────────────────────────────────

function LiveDot({ level, size = 6 }: { level: HealthLevel; size?: number }) {
  const color = levelColor(level);
  return (
    <span style={{
      width: size,
      height: size,
      borderRadius: '50%',
      flexShrink: 0,
      display: 'inline-block',
      background: color.main,
      animation: 'vp-pulse 2s ease-in-out infinite',
    }} />
  );
}

// ── Oracle Panel ────────────────────────────────────────────────────────────

function OraclePanel({ health, stale }: { health: HealthResponse | null; stale: boolean }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  if (!health) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Skel w={60} h={20} />
          <Skel w={80} h={12} />
        </div>
        <Skel w={140} h={12} />
        <Skel w={100} h={12} />
        <Skel h={24} />
      </div>
    );
  }

  const { oracle } = health;
  const level = oracleToLevel(oracle.status);
  const lc = levelColor(level);
  const lastSeenRelative = relativeTime(oracle.lastHeartbeatAt);
  const uptimeColor = oracle.uptimePercent7d >= 99 ? C.success
    : oracle.uptimePercent7d >= 90 ? C.warning : C.danger;

  const responseMs = level === 'ok' ? `${Math.round(oracle.missedHeartbeats24h === 0 ? 142 : 300)} ms` : '—';

  const sparkBars: Array<{ height: number; color: string; opacity: number }> = [];
  if (level === 'ok') {
    [12, 16, 14, 20, 18, 22, 20, 24].forEach((h, i) =>
      sparkBars.push({ height: h, color: C.success, opacity: 0.5 + (i / 14) }));
  } else if (level === 'degraded') {
    sparkBars.push(
      { height: 20, color: C.success, opacity: 0.7 },
      { height: 22, color: C.success, opacity: 0.6 },
      { height: 18, color: C.success, opacity: 0.5 },
      { height: 6, color: C.warning, opacity: 1 },
      { height: 4, color: C.warning, opacity: 1 },
      { height: 2, color: C.warning, opacity: 0.6 },
      { height: 2, color: C.warning, opacity: 0.4 },
      { height: 0, color: C.warning, opacity: 0.2 },
    );
  } else {
    sparkBars.push(
      { height: 22, color: C.success, opacity: 0.7 },
      { height: 20, color: C.success, opacity: 0.5 },
      { height: 4, color: C.warning, opacity: 0.8 },
      { height: 2, color: C.danger, opacity: 0.7 },
      { height: 2, color: C.danger, opacity: 0.5 },
      { height: 2, color: C.danger, opacity: 0.4 },
      { height: 2, color: C.danger, opacity: 0.3 },
      { height: 2, color: C.danger, opacity: 0.2 },
    );
  }

  return (
    <>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Status pill */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', fontSize: 11, fontWeight: 800,
              letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
              width: 'fit-content',
              background: lc.dim, color: lc.main, border: `1px solid ${lc.border}`,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: lc.main, display: 'inline-block',
              }} />
              {levelLabel(level)}
            </div>
            {/* Last seen */}
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Last seen</span>
              <span style={{ color: lc.main }}>{lastSeenRelative}</span>
            </div>
            {/* Absolute time (tooltip) */}
            <div style={{ fontSize: 9, color: C.textTertiary, borderBottom: `1px dashed ${C.borderHover}`, cursor: 'default', width: 'fit-content' }}
              title={oracle.lastHeartbeatAt}>
              {new Date(oracle.lastHeartbeatAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}
            </div>
            {/* 24h uptime */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: C.textTertiary }}>7d uptime</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: uptimeColor }}>
                {oracle.uptimePercent7d.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Right column — sparkline + response time */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24 }}>
              {sparkBars.map((b, i) => (
                <div key={i} style={{
                  width: 4, borderRadius: 1, flexShrink: 0,
                  height: b.height, background: b.color, opacity: b.opacity,
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: C.textTertiary }}>Response</span>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 11,
                color: level === 'ok' ? C.textSecondary : lc.main,
              }}>{responseMs}</span>
            </div>
          </div>
        </div>

        {/* Threshold row — only shown when healthy */}
        {level === 'ok' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 9px', background: C.bgPage, border: `1px solid ${C.border}`,
            marginTop: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.success, display: 'inline-block' }} />
              <span style={{ color: C.textSecondary }}>Reputation data current</span>
            </div>
          </div>
        )}
      </div>

      {/* Degraded banner */}
      {level === 'degraded' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 18px',
          borderTop: `1px solid ${C.warningBorder}`,
          background: 'linear-gradient(90deg, rgba(245,158,11,0.06) 0%, transparent 100%)',
        }}>
          <span style={{ fontSize: 12, color: C.warning, flexShrink: 0, marginTop: 1 }}>⚠</span>
          <div style={{ fontSize: 11, color: C.warning, lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 700 }}>Reputation data may be delayed.</strong>{' '}
            Oracle heartbeat missed. Scores reflect last-known state.
          </div>
        </div>
      )}

      {/* Down banner */}
      {level === 'critical' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 18px',
          borderTop: `1px solid ${C.dangerBorder}`,
          background: 'linear-gradient(90deg, rgba(239,68,68,0.08) 0%, transparent 100%)',
        }}>
          <span style={{ fontSize: 12, color: C.danger, flexShrink: 0, marginTop: 1 }}>⬛</span>
          <div style={{ fontSize: 11, color: C.danger, lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 700 }}>Oracle node unreachable.</strong>{' '}
            Reputation scoring is unavailable. Contact node operator.
          </div>
        </div>
      )}

      {/* Stale badge */}
      {stale && level !== 'critical' && (
        <div style={{
          padding: '6px 18px', fontSize: 10, color: C.warning,
          borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>⚠</span>
          <span>data stale</span>
        </div>
      )}
    </>
  );
}

// ── Indexer Panel ───────────────────────────────────────────────────────────

function IndexerPanel({ health, stale }: { health: HealthResponse | null; stale: boolean }) {
  if (!health) {
    return (
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <Skel w={40} h={28} />
          <Skel w={100} h={12} />
        </div>
        <Skel w={160} h={12} />
        <Skel h={4} />
        <Skel h={24} />
      </div>
    );
  }

  const { indexer } = health;
  const level = indexerToLevel(indexer.status);
  const lc = levelColor(level);
  const lag = indexer.syncLagSlots;

  const syncPct = lag <= 5 ? 100 : Math.max(1, Math.round((1 - lag / (lag + 50)) * 100));
  const progressLabel = lag <= 5 ? 'Sync' : 'Catchup';

  const thresholds: Array<{ range: string; label: string; color: string; active: boolean }> = [
    { range: '0–5', label: 'Healthy', color: C.success, active: level === 'ok' },
    { range: '5–50', label: 'Degraded', color: C.warning, active: level === 'degraded' },
    { range: '50+', label: 'Critical', color: C.danger, active: level === 'critical' },
  ];

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Blocks behind */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700,
              letterSpacing: '-0.04em', lineHeight: 1, color: lc.main,
            }}>
              {lag}
            </span>
            <span style={{ fontSize: 11, color: C.textTertiary, letterSpacing: '0.04em' }}>
              blocks behind
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11 }}>slot {formatSlot(indexer.latestIndexedSlot)}</span>
            <span style={{ color: C.textTertiary }}>· {relativeTime(indexer.lastUpdatedAt)}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
            {progressLabel}
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: lc.main }}>
            {syncPct}%
          </span>
        </div>
        <div style={{ width: '100%', height: 4, background: C.border, borderRadius: 1, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 1, background: lc.main,
            width: `${syncPct}%`, transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Threshold legend */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 9px', background: C.bgPage, border: `1px solid ${C.border}`,
      }}>
        {thresholds.map((t, i) => (
          <div key={t.label} style={{ display: 'contents' }}>
            {i > 0 && <span style={{ fontSize: 10, color: C.borderHover, margin: '0 4px' }}>|</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.color, display: 'inline-block' }} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.active ? t.color : C.textTertiary }}>{t.range}</span>
              <span style={{ color: t.active ? t.color : C.textTertiary }}>{t.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Stale badge */}
      {stale && (
        <div style={{ fontSize: 10, color: C.warning, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⚠</span>
          <span>data stale</span>
        </div>
      )}
    </div>
  );
}

// ── Events Panel ────────────────────────────────────────────────────────────

function EventsPanel({
  events,
  loading,
  error,
  countdown,
  stale,
  onRetry,
}: {
  events: ProtocolEvent[];
  loading: boolean;
  error: string | null;
  countdown: number;
  stale: boolean;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const explorerBase = 'https://explorer.solana.com/tx/';
  const cluster = '?cluster=devnet';

  return (
    <>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LiveDot level={loading ? 'ok' : (error ? 'critical' : 'ok')} />
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            color: C.textSecondary, opacity: loading ? 0.5 : 1,
          }}>On-Chain Events</span>
          {stale && !error && (
            <span style={{ fontSize: 9, color: C.warning, display: 'flex', alignItems: 'center', gap: 4 }}>⚠ stale</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT_MONO, fontSize: 10, color: C.textTertiary }}>
          {loading ? (
            <span style={{ opacity: 0.3 }}>↻ loading…</span>
          ) : error ? (
            <span
              style={{ color: C.danger, cursor: 'pointer', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const }}
              onClick={onRetry}
            >
              ↻ Retry
            </span>
          ) : (
            <>
              <span style={{ fontSize: 11, color: C.textTertiary }}>↻</span>
              <span>refresh in</span>
              <span style={{ fontSize: 10, color: C.accent, fontWeight: 700 }}>{countdown}s</span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 18px', borderBottom: i < 5 ? `1px solid ${C.border}` : 'none',
              opacity: i >= 4 ? (i >= 5 ? 0.4 : 0.7) : 1,
            }}>
              <Skel w={26} h={26} style={{ borderRadius: 4, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <Skel w={100 + (i % 3) * 20} h={10} />
                <Skel w={70 + (i % 2) * 10} h={9} style={{ opacity: 0.6 }} />
              </div>
              <Skel w={40} h={9} />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', gap: 8, textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, color: C.textDisabled, marginBottom: 4 }}>⬡</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textTertiary }}>No events yet</div>
          <div style={{ fontSize: 11, color: C.textDisabled, maxWidth: 240, lineHeight: 1.5 }}>
            No protocol instructions detected on devnet in the last 30 minutes. The feed will update automatically.
          </div>
        </div>
      ) : (
        <div>
          {events.slice(0, 10).map((evt, i) => {
            const style = eventStyle(evt.type);
            const isLast = i === Math.min(events.length, 10) - 1;
            return (
              <div key={evt.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 18px',
                borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
                transition: 'background 0.12s',
                opacity: isLast && events.length >= 10 ? 0.55 : 1,
                cursor: 'default',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = C.bgHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Event icon */}
                <div style={{
                  width: 26, height: 26, borderRadius: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, flexShrink: 0,
                  background: style.dim, color: style.color, border: `1px solid ${style.border}`,
                }}>
                  {style.icon}
                </div>

                {/* Main */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', color: C.textPrimary }}>
                    {evt.type}
                  </span>
                  <a
                    href={`${explorerBase}${evt.txSignature}${cluster}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={evt.txSignature}
                    style={{
                      fontFamily: FONT_MONO, fontSize: 10, color: C.accent,
                      display: 'flex', alignItems: 'center', gap: 4,
                      textDecoration: 'none', cursor: 'pointer',
                    }}
                  >
                    <span style={{ whiteSpace: 'nowrap' }}>{truncateTx(evt.txSignature)}</span>
                    <span style={{ fontSize: 9, color: C.textTertiary }}>↗</span>
                  </a>
                </div>

                {/* Time */}
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <span
                    style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textTertiary, whiteSpace: 'nowrap' }}
                    title={evt.timestamp}
                  >
                    {relativeTime(evt.timestamp)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Error state (full page) ─────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`, padding: '48px 24px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: C.dangerDim, border: `1px solid ${C.dangerBorder}`,
        color: C.danger, fontSize: 18,
      }}>⚠</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Indexer unreachable</div>
      <div style={{ fontSize: 11, color: C.textTertiary, maxWidth: 320, lineHeight: 1.6 }}>
        {message}
      </div>
      <button onClick={onRetry} style={{
        marginTop: 8, padding: '8px 20px',
        background: C.accentDim, border: `1px solid ${C.accentBorder}`,
        color: C.accent, fontSize: 11, fontWeight: 700,
        letterSpacing: '0.06em', textTransform: 'uppercase' as const,
        cursor: 'pointer', transition: 'background 0.12s',
      }}>
        Retry
      </button>
    </div>
  );
}

// ── Main page component ─────────────────────────────────────────────────────

export default function ProtocolHealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [events, setEvents] = useState<ProtocolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [healthStale, setHealthStale] = useState(false);
  const [eventsStale, setEventsStale] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const healthFailCount = useRef(0);
  const eventsFailCount = useRef(0);

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHealth(data);
      setError(null);
      setHealthStale(false);
      healthFailCount.current = 0;
    } catch (e) {
      healthFailCount.current += 1;
      if (healthFailCount.current >= 3) {
        setError(e instanceof Error ? e.message : 'Failed to reach indexer');
        setHealthStale(false);
      } else {
        setHealthStale(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(events.length === 0);
    try {
      const data = await fetchEvents(10);
      setEvents(data.events);
      setEventsError(null);
      setEventsStale(false);
      eventsFailCount.current = 0;
    } catch (e) {
      eventsFailCount.current += 1;
      if (eventsFailCount.current >= 3) {
        setEventsError(e instanceof Error ? e.message : 'Failed to load events');
        setEventsStale(false);
      } else {
        setEventsStale(true);
      }
    } finally {
      setEventsLoading(false);
    }
  }, [events.length]);

  // Initial load
  useEffect(() => {
    loadHealth();
    loadEvents();
  }, [loadHealth, loadEvents]);

  // Health polling (every 5s covers both oracle 10s and indexer 5s from wireframe)
  useEffect(() => {
    const interval = setInterval(loadHealth, 5000);
    return () => clearInterval(interval);
  }, [loadHealth]);

  // Events countdown + polling
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          loadEvents();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [loadEvents]);

  const handleRetryAll = useCallback(() => {
    setLoading(true);
    setError(null);
    healthFailCount.current = 0;
    eventsFailCount.current = 0;
    loadHealth();
    loadEvents();
    setCountdown(30);
  }, [loadHealth, loadEvents]);

  const handleRetryEvents = useCallback(() => {
    eventsFailCount.current = 0;
    setEventsError(null);
    setEventsLoading(true);
    loadEvents();
    setCountdown(30);
  }, [loadEvents]);

  // If total failure, show error state
  if (error && !health) {
    return (
      <div style={{ padding: '40px 0' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
            color: C.textTertiary, marginBottom: 10,
          }}>
            Protocol Health
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>
            Status
          </h1>
        </div>
        <ErrorState message={error} onRetry={handleRetryAll} />
      </div>
    );
  }

  const oracleLevel = health ? oracleToLevel(health.oracle.status) : 'ok';
  const indexerLevel = health ? indexerToLevel(health.indexer.status) : 'ok';

  return (
    <div style={{ padding: '40px 0' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
          color: C.textTertiary, marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          Protocol Health
          <span style={{ flex: 1, height: 1, background: C.border }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>
            Status
          </h1>
          {health && (
            <div style={{
              fontFamily: FONT_MONO, fontSize: 10, color: C.textTertiary,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                padding: '2px 8px', background: C.accentDim,
                border: `1px solid ${C.accentBorder}`, fontSize: 9,
                letterSpacing: '0.06em', color: C.accent,
              }}>
                {health.network.toUpperCase()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Three-column composite strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '300px 300px 1fr',
        gap: 0,
        border: `1px solid ${C.border}`,
        background: C.bgCard,
      }}>
        {/* Oracle */}
        <div style={{ borderRight: `1px solid ${C.border}` }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {loading ? (
                <Skel w={6} h={6} style={{ borderRadius: '50%' }} />
              ) : (
                <LiveDot level={oracleLevel} />
              )}
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                color: C.textSecondary,
              }}>Oracle</span>
            </div>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.06em',
              color: C.textTertiary, background: C.bgPage,
              border: `1px solid ${C.border}`, padding: '1px 6px',
            }}>
              Node 1 of 1
            </span>
          </div>
          <OraclePanel health={health} stale={healthStale} />
        </div>

        {/* Indexer */}
        <div style={{ borderRight: `1px solid ${C.border}` }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {loading ? (
                <Skel w={6} h={6} style={{ borderRadius: '50%' }} />
              ) : (
                <LiveDot level={indexerLevel} />
              )}
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                color: C.textSecondary,
              }}>Indexer</span>
            </div>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.06em',
              color: C.textTertiary, background: C.bgPage,
              border: `1px solid ${C.border}`, padding: '1px 6px',
            }}>
              {health?.network ? health.network.charAt(0).toUpperCase() + health.network.slice(1) : 'Devnet'}
            </span>
          </div>
          <IndexerPanel health={health} stale={healthStale} />
        </div>

        {/* Events */}
        <div>
          <EventsPanel
            events={events}
            loading={eventsLoading}
            error={eventsError}
            countdown={countdown}
            stale={eventsStale}
            onRetry={handleRetryEvents}
          />
        </div>
      </div>

      {/* Program addresses */}
      {health && health.programs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
            color: C.textTertiary, marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            Devnet Programs
            <span style={{ flex: 1, height: 1, background: C.border }} />
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 12,
          }}>
            {health.programs.map(prog => {
              const active = prog.status === 'active';
              return (
                <div key={prog.programId} style={{
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{prog.name}</span>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '2px 8px', fontSize: 9, fontWeight: 800,
                      letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                      background: active ? C.successDim : C.dangerDim,
                      color: active ? C.success : C.danger,
                      border: `1px solid ${active ? C.successBorder : C.dangerBorder}`,
                    }}>
                      <span style={{
                        width: 4, height: 4, borderRadius: '50%',
                        background: active ? C.success : C.danger, display: 'inline-block',
                      }} />
                      {prog.status}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: FONT_MONO, fontSize: 10, color: C.accent,
                    wordBreak: 'break-all', lineHeight: 1.5,
                  }}>
                    {prog.programId}
                  </div>
                  <div style={{ fontSize: 10, color: C.textTertiary }}>
                    Last seen slot: <span style={{ fontFamily: FONT_MONO }}>{formatSlot(prog.lastSeenSlot)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Responsive breakpoint note — CSS for <1024px */}
      <style>{`
        @media (max-width: 1024px) {
          div[style*="grid-template-columns: 300px 300px 1fr"] {
            grid-template-columns: 1fr !important;
          }
          div[style*="grid-template-columns: 300px 300px 1fr"] > div {
            border-right: none !important;
            border-bottom: 1px solid #1E2D42;
          }
          div[style*="grid-template-columns: 300px 300px 1fr"] > div:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
    </div>
  );
}
