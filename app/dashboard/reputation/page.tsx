'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchReputation } from '../../../lib/indexer';
import { AlertBanner } from '../../components/AlertBanner';

// ── Types ────────────────────────────────────────────────────────────────────

type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

interface ReputationData {
  score: number;
  tier: Tier;
  pactCount: number;
  disputeRate: number;
  lastOracleUpdate: string;
  history30d: number[];
  history90d: number[];
}

interface ThresholdConfig {
  minScore: number;
  maxDisputeRate: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<Tier, { label: string; color: string; dim: string; border: string; range: string; tooltip: string }> = {
  bronze:   { label: 'Bronze',   color: '#CD7F32', dim: 'rgba(205,127,50,0.08)',   border: 'rgba(205,127,50,0.28)',   range: '0–249',   tooltip: 'New or unproven operator. Limited protocol access.' },
  silver:   { label: 'Silver',   color: '#9BA5B0', dim: 'rgba(155,165,176,0.08)', border: 'rgba(155,165,176,0.28)', range: '250–499', tooltip: 'Established track record. Standard protocol limits.' },
  gold:     { label: 'Gold',     color: '#D4AF37', dim: 'rgba(212,175,55,0.08)',  border: 'rgba(212,175,55,0.28)',  range: '500–749', tooltip: 'Trusted operator. Expanded escrow capacity.' },
  platinum: { label: 'Platinum', color: '#B8C5D0', dim: 'rgba(184,197,208,0.08)', border: 'rgba(184,197,208,0.28)', range: '750–1000','tooltip': 'Elite status. Maximum protocol privileges.' },
};

const TIER_ICONS: Record<Tier, React.ReactNode> = {
  bronze: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M12 7L13.5 10L17 10.5L14.5 13L15.2 16.5L12 14.8L8.8 16.5L9.5 13L7 10.5L10.5 10L12 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  silver: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 3L14.5 8.5L21 9.27L16.5 13.64L17.76 20L12 17L6.24 20L7.5 13.64L3 9.27L9.5 8.5L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  ),
  gold: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  ),
  platinum: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  ),
};

function tierFromScore(score: number): Tier {
  if (score >= 750) return 'platinum';
  if (score >= 500) return 'gold';
  if (score >= 250) return 'silver';
  return 'bronze';
}


// ── Sparkline component ───────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 400;
  const H = 72;
  const pad = 4;

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  });

  const polyline = pts.join(' ');
  const areaPath = `M${pts[0]} L${pts.join(' L')} L${W - pad},${H} L${pad},${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '72px', display: 'block' }}>
      <defs>
        <linearGradient id={`vp-grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#vp-grad-${color.replace('#', '')})`}/>
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w, h, style }: { w?: string; h?: number; style?: React.CSSProperties }) {
  return (
    <div className="vp-skel" style={{
      width: w || '100%',
      height: h || 14,
      borderRadius: 2,
      ...style,
    }} />
  );
}

// ── Pre-flight indicator ──────────────────────────────────────────────────────

function PreFlightIndicator({ score, disputeRate, thresholds }: {
  score: number;
  disputeRate: number;
  thresholds: ThresholdConfig;
}) {
  const scoreOk = score >= thresholds.minScore;
  const disputeOk = disputeRate <= thresholds.maxDisputeRate;
  const allOk = scoreOk && disputeOk;

  return (
    <div style={{
      background: '#141B27',
      border: `1px solid ${allOk ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)'}`,
      padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A99AC' }}>
          Pre-Flight Check
        </span>
        <span style={{
          fontSize: '10px',
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: allOk ? '#22C55E' : '#EF4444',
          background: allOk ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${allOk ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)'}`,
          padding: '2px 8px',
        }}>
          {allOk ? '✓ Ready' : '✗ Blocked'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <PreFlightRow label="Min reputation score" value={`${score} / ${thresholds.minScore}`} ok={scoreOk} />
        <PreFlightRow label="Max dispute rate" value={`${disputeRate}% / ${thresholds.maxDisputeRate}%`} ok={disputeOk} />
      </div>

      <div style={{ marginTop: '14px', fontSize: '11px', color: '#4D5E72', borderTop: '1px solid #1E2D42', paddingTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M6 4V6.5M6 8H6.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
        Thresholds are operator-configurable and stored locally
      </div>
    </div>
  );
}

function PreFlightRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
      <span style={{ color: '#8A99AC', fontSize: '12px' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontSize: '11px',
          color: ok ? '#22C55E' : '#EF4444',
        }}>{value}</span>
        <span style={{ color: ok ? '#22C55E' : '#EF4444', fontSize: '11px' }}>{ok ? '✓' : '✗'}</span>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function ReputationPage() {
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReputationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyWindow, setHistoryWindow] = useState<'30d' | '90d'>('30d');
  const [thresholds, setThresholds] = useState<ThresholdConfig>({ minScore: 500, maxDisputeRate: 10 });
  const [editingThresholds, setEditingThresholds] = useState(false);
  const [draftThresholds, setDraftThresholds] = useState<ThresholdConfig>({ minScore: 500, maxDisputeRate: 10 });

  // Load persisted threshold config once on mount
  useEffect(() => {
    const saved = localStorage.getItem('holdfast_thresholds');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ThresholdConfig;
        setThresholds(parsed);
        setDraftThresholds(parsed);
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    fetchReputation(publicKey.toBase58())
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load reputation'))
      .finally(() => setLoading(false));
  }, [publicKey]);

  function saveThresholds() {
    setThresholds(draftThresholds);
    localStorage.setItem('holdfast_thresholds', JSON.stringify(draftThresholds));
    setEditingThresholds(false);
  }

  const tier = data ? tierFromScore(data.score) : 'bronze';
  const tc = TIER_CONFIG[tier];
  const historyData = data ? (historyWindow === '30d' ? data.history30d : data.history90d) : [];

  function fmtDelta(history: number[]) {
    if (history.length < 2) return null;
    const delta = history[history.length - 1] - history[0];
    return delta;
  }

  const delta = data ? fmtDelta(historyWindow === '30d' ? data.history30d : data.history90d) : null;

  function formatRelativeTime(iso: string) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '4px' }}>
          Reputation
        </h1>
        <p style={{ fontSize: '12px', color: '#8A99AC', lineHeight: 1.6 }}>
          On-chain reputation score and tier. Live data from the oracle node; updated every oracle cycle.
        </p>
      </div>

      {error && <AlertBanner type="danger" message={error} />}

      {/* Tier badges row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {(['bronze', 'silver', 'gold', 'platinum'] as Tier[]).map(t => {
          const cfg = TIER_CONFIG[t];
          const isActive = tier === t && !loading;
          return (
            <div key={t} style={{
              background: isActive ? cfg.dim : '#141B27',
              border: `1px solid ${isActive ? cfg.border : '#1E2D42'}`,
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
              transition: 'border-color 0.15s, background 0.15s',
              position: 'relative',
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                background: isActive ? cfg.dim : 'transparent',
                border: `1.5px solid ${isActive ? cfg.border : '#1E2D42'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isActive ? cfg.color : '#2D3E52',
              }}>
                {TIER_ICONS[t]}
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: isActive ? cfg.color : '#2D3E52',
              }}>
                {cfg.label}
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '10px',
                color: isActive ? cfg.color : '#2D3E52',
                opacity: 0.7,
                letterSpacing: '0.04em',
              }}>
                {cfg.range}
              </span>
              {loading && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,17,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Skel w="60px" h={10} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Score + sparkline */}
      <div style={{
        background: '#141B27',
        border: '1px solid #1E2D42',
        marginBottom: '20px',
        padding: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            {loading ? (
              <>
                <Skel w="120px" h={38} style={{ marginBottom: '6px' }} />
                <Skel w="80px" h={20} />
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    fontSize: '40px',
                    fontWeight: 700,
                    letterSpacing: '-0.05em',
                    lineHeight: 1,
                    color: tc.color,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {data!.score}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    fontSize: '16px',
                    color: '#4D5E72',
                    letterSpacing: '-0.02em',
                  }}>
                    / 1000
                  </span>
                </div>
                {delta !== null && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    marginTop: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    letterSpacing: '0.03em',
                    background: delta >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    color: delta >= 0 ? '#22C55E' : '#EF4444',
                    border: `1px solid ${delta >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  }}>
                    {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)} pts {historyWindow}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 30D / 90D toggle */}
          <div style={{ display: 'flex', border: '1px solid #1E2D42', overflow: 'hidden' }}>
            {(['30d', '90d'] as const).map(w => (
              <button
                key={w}
                onClick={() => setHistoryWindow(w)}
                style={{
                  background: historyWindow === w ? 'rgba(45,140,255,0.12)' : 'none',
                  border: 'none',
                  padding: '4px 12px',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: historyWindow === w ? '#2D8CFF' : '#4D5E72',
                  cursor: 'pointer',
                  transition: 'background 0.1s, color 0.1s',
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                }}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Sparkline */}
        <div style={{ paddingLeft: '32px', position: 'relative' }}>
          {/* Y-axis labels */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '72px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            pointerEvents: 'none',
          }}>
            {[1000, 500, 0].map(v => (
              <span key={v} style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '9px',
                color: '#4D5E72',
                lineHeight: 1,
              }}>{v}</span>
            ))}
          </div>

          {loading ? (
            <Skel w="100%" h={72} />
          ) : (
            <Sparkline data={historyData} color={tc.color} />
          )}
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        background: '#141B27',
        border: '1px solid #1E2D42',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        marginBottom: '20px',
      }}>
        <StatCell
          label="Pact Count"
          loading={loading}
          value={data ? String(data.pactCount) : ''}
          context="completed pacts"
          dotColor="#22C55E"
        />
        <StatCell
          label="Dispute Rate"
          loading={loading}
          value={data ? `${data.disputeRate}%` : ''}
          context={data ? (data.disputeRate < 5 ? 'low risk' : data.disputeRate < 15 ? 'moderate' : 'high risk') : ''}
          dotColor={data ? (data.disputeRate < 5 ? '#22C55E' : data.disputeRate < 15 ? '#F59E0B' : '#EF4444') : '#22C55E'}
        />
        <StatCell
          label="Last Oracle Update"
          loading={loading}
          value={data ? formatRelativeTime(data.lastOracleUpdate) : ''}
          context="oracle heartbeat"
          dotColor="#2D8CFF"
          mono
        />
      </div>

      {/* Pre-flight + threshold config */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', alignItems: 'start' }}>
        {loading ? (
          <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '20px' }}>
            <Skel w="120px" h={12} style={{ marginBottom: '14px' }} />
            <Skel w="100%" h={10} style={{ marginBottom: '8px' }} />
            <Skel w="100%" h={10} />
          </div>
        ) : (
          <PreFlightIndicator score={data!.score} disputeRate={data!.disputeRate} thresholds={thresholds} />
        )}

        {/* Threshold editor */}
        <div style={{
          background: '#141B27',
          border: '1px solid #1E2D42',
          padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A99AC' }}>
              Thresholds
            </span>
            <button
              onClick={() => editingThresholds ? saveThresholds() : setEditingThresholds(true)}
              style={{
                background: editingThresholds ? 'rgba(45,140,255,0.12)' : 'none',
                border: `1px solid ${editingThresholds ? 'rgba(45,140,255,0.22)' : '#1E2D42'}`,
                color: editingThresholds ? '#2D8CFF' : '#8A99AC',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                padding: '3px 10px',
                cursor: 'pointer',
              }}
            >
              {editingThresholds ? 'Save' : 'Edit'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <ThresholdField
              label="Min Score"
              value={draftThresholds.minScore}
              editing={editingThresholds}
              onChange={v => setDraftThresholds(d => ({ ...d, minScore: v }))}
              min={0}
              max={1000}
            />
            <ThresholdField
              label="Max Dispute Rate (%)"
              value={draftThresholds.maxDisputeRate}
              editing={editingThresholds}
              onChange={v => setDraftThresholds(d => ({ ...d, maxDisputeRate: v }))}
              min={0}
              max={100}
            />
          </div>
          <p style={{ marginTop: '10px', fontSize: '10px', color: '#4D5E72', lineHeight: 1.5 }}>
            Stored in localStorage. Used by pre-flight check only.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, loading, value, context, dotColor, mono }: {
  label: string;
  loading: boolean;
  value: string;
  context: string;
  dotColor: string;
  mono?: boolean;
}) {
  return (
    <div style={{ padding: '14px 20px', borderRight: '1px solid #1E2D42' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '5px' }}>
        {label}
      </div>
      {loading ? (
        <>
          <Skel w="80px" h={18} style={{ marginBottom: '5px' }} />
          <Skel w="60px" h={10} />
        </>
      ) : (
        <>
          <div style={{
            fontFamily: mono ? "'JetBrains Mono', 'Courier New', monospace" : undefined,
            fontSize: '18px',
            color: '#E8EDF2',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
          }}>
            {value}
          </div>
          <div style={{ fontSize: '11px', color: '#8A99AC', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
            {context}
          </div>
        </>
      )}
    </div>
  );
}

function ThresholdField({ label, value, editing, onChange, min, max }: {
  label: string;
  value: number;
  editing: boolean;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '4px' }}>
        {label}
      </div>
      {editing ? (
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            background: '#0D1117',
            border: '1px solid #2D4060',
            color: '#E8EDF2',
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            padding: '5px 10px',
            width: '100%',
            outline: 'none',
          }}
        />
      ) : (
        <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '13px', color: '#8A99AC' }}>
          {value}
        </span>
      )}
    </div>
  );
}
