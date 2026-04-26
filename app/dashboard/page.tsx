'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchReputation, fetchPacts } from '../../lib/indexer';
import type { ReputationResponse, IndexerPact, PactStatus } from '../../lib/indexer';
import { AlertBanner } from '../components/AlertBanner';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

// ── Constants ──────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<Tier, { label: string; color: string; min: number; max: number }> = {
  bronze:   { label: 'Bronze',   color: '#CD7F32', min: 0,   max: 249  },
  silver:   { label: 'Silver',   color: '#9BA5B0', min: 250, max: 499  },
  gold:     { label: 'Gold',     color: '#D4AF37', min: 500, max: 749  },
  platinum: { label: 'Platinum', color: '#B8C5D0', min: 750, max: 1000 },
};

const STATUS_COLORS: Record<PactStatus, { color: string; dim: string; border: string }> = {
  pending:   { color: '#4D5E72', dim: 'rgba(77,94,114,0.08)',    border: 'rgba(77,94,114,0.22)'   },
  funded:    { color: '#2D8CFF', dim: 'rgba(45,140,255,0.10)',   border: 'rgba(45,140,255,0.22)'  },
  locked:    { color: '#9F6BFF', dim: 'rgba(159,107,255,0.08)',  border: 'rgba(159,107,255,0.22)' },
  released:  { color: '#22C55E', dim: 'rgba(34,197,94,0.08)',    border: 'rgba(34,197,94,0.22)'   },
  disputed:  { color: '#EF4444', dim: 'rgba(239,68,68,0.08)',    border: 'rgba(239,68,68,0.22)'   },
  refunded:  { color: '#F59E0B', dim: 'rgba(245,158,11,0.08)',   border: 'rgba(245,158,11,0.22)'  },
  closed:    { color: '#4D5E72', dim: 'rgba(77,94,114,0.08)',    border: 'rgba(77,94,114,0.22)'   },
  claimed:   { color: '#22C55E', dim: 'rgba(34,197,94,0.08)',    border: 'rgba(34,197,94,0.22)'   },
  cancelled: { color: '#4D5E72', dim: 'rgba(77,94,114,0.08)',    border: 'rgba(77,94,114,0.22)'   },
};

const ACTIVE_STATUSES: PactStatus[] = ['pending', 'funded', 'locked', 'disputed'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function tierFromScore(score: number): Tier {
  if (score >= 750) return 'platinum';
  if (score >= 500) return 'gold';
  if (score >= 250) return 'silver';
  return 'bronze';
}

function tierProgress(score: number, tier: Tier): number {
  const { min, max } = TIER_CONFIG[tier];
  const range = max - min;
  const progress = Math.min(Math.max(score - min, 0), range);
  return range > 0 ? progress / range : 0;
}

function truncate(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

function formatSol(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Skel({ w, h, style }: { w?: string; h?: number; style?: React.CSSProperties }) {
  return <div className="vp-skel" style={{ width: w || '100%', height: h || 14, borderRadius: 2, ...style }} />;
}

function StatusPill({ status }: { status: PactStatus }) {
  const sc = STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 9px', fontSize: '10px', fontWeight: 800,
      letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
      color: sc.color, background: sc.dim,
      border: `1px solid ${sc.border}`,
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: sc.color, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function RepRing({ score, tier }: { score: number; tier: Tier }) {
  const pct = Math.min(score / 1000, 1) * 100;
  const tc = TIER_CONFIG[tier];
  return (
    <div style={{
      width: '88px', height: '88px', borderRadius: '50%', flexShrink: 0,
      background: `conic-gradient(${tc.color} 0% ${pct}%, #1E2D42 ${pct}% 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
    }}>
      <div style={{
        width: '66px', height: '66px', borderRadius: '50%',
        background: '#141B27', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1px',
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontSize: '18px', fontWeight: 800, color: tc.color,
          letterSpacing: '-0.04em', lineHeight: 1,
        }}>{score}</span>
        <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>
          score
        </span>
      </div>
    </div>
  );
}

function TierBars({ score }: { score: number }) {
  const currentTier = tierFromScore(score);
  const tiers: Tier[] = ['bronze', 'silver', 'gold', 'platinum'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '2px' }}>
        Tier Progression
      </div>
      {tiers.map(t => {
        const tc = TIER_CONFIG[t];
        const isCurrent = t === currentTier;
        const isPast = score > tc.max;
        const fill = isPast ? 100 : isCurrent ? tierProgress(score, t) * 100 : 0;
        return (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 600, width: '52px',
              color: isCurrent ? tc.color : isPast ? tc.color : '#2D3E52',
            }}>
              {tc.label}
            </span>
            <div style={{ flex: 1, height: '4px', background: '#1E2D42', overflow: 'hidden' }}>
              <div style={{
                width: `${fill}%`, height: '100%', background: tc.color,
                transition: 'width 0.4s ease',
              }} />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '9px', color: '#4D5E72', width: '28px', textAlign: 'right' }}>
              {tc.min}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardHub() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  const [repData, setRepData] = useState<ReputationResponse | null>(null);
  const [pacts, setPacts] = useState<IndexerPact[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [repLoading, setRepLoading] = useState(true);
  const [pactsLoading, setPactsLoading] = useState(true);
  const [balLoading, setBalLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    setRepLoading(true);
    fetchReputation(publicKey.toBase58())
      .then(setRepData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load reputation'))
      .finally(() => setRepLoading(false));
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    setPactsLoading(true);
    fetchPacts(publicKey.toBase58(), 'active', 5)
      .then(r => setPacts(r.pacts))
      .catch(() => setPacts([]))
      .finally(() => setPactsLoading(false));
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    setBalLoading(true);
    connection.getBalance(publicKey)
      .then(lamports => setBalance(lamports / LAMPORTS_PER_SOL))
      .catch(() => setBalance(null))
      .finally(() => setBalLoading(false));
  }, [publicKey, connection]);

  const tier = repData ? tierFromScore(repData.score) : 'bronze';
  const tc = TIER_CONFIG[tier];
  const activePacts = pacts.filter(p => ACTIVE_STATUSES.includes(p.status));
  const escrowSol = activePacts.reduce((sum, p) => sum + p.amountSol, 0);

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>
      <style>{`
        @media (max-width: 768px) {
          .hub-stat-grid { grid-template-columns: 1fr !important; }
          .hub-rep-row { flex-direction: column !important; }
          .hub-rep-ring-block { flex-direction: column !important; }
        }
        @media (max-width: 900px) {
          .hub-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '3px' }}>
            Overview
          </h1>
          <p style={{ fontSize: '12px', color: '#8A99AC' }}>
            {publicKey ? truncate(publicKey.toBase58(), 6) : '—'} · Devnet
          </p>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Link href="/dashboard/create-pact" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)',
            color: '#34D399', padding: '7px 14px', fontSize: '11px', fontWeight: 700,
            letterSpacing: '0.05em', textDecoration: 'none', transition: 'background 0.12s',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            New Pact
          </Link>
          <Link href="/dashboard/escrow?filter=dispute" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: '#141B27', border: '1px solid #1E2D42',
            color: '#8A99AC', padding: '7px 14px', fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.04em', textDecoration: 'none', transition: 'border-color 0.12s, color 0.12s',
          }}>
            View Disputes
          </Link>
          <Link href="/dashboard/escrow" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: '#141B27', border: '1px solid #1E2D42',
            color: '#8A99AC', padding: '7px 14px', fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.04em', textDecoration: 'none', transition: 'border-color 0.12s, color 0.12s',
          }}>
            Request Funds
          </Link>
        </div>
      </div>

      {error && <AlertBanner type="danger" message={error} />}

      {/* Stat cards */}
      <div className="hub-stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {/* Reputation Score */}
        <div style={{
          background: '#141B27',
          border: `1px solid ${repLoading ? '#1E2D42' : 'rgba(52,211,153,0.20)'}`,
          padding: '14px 16px',
          transition: 'border-color 0.2s',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '8px' }}>
            Reputation Score
          </div>
          {repLoading ? (
            <>
              <Skel w="80px" h={26} style={{ marginBottom: '6px' }} />
              <Skel w="100px" h={12} />
            </>
          ) : (
            <>
              <div style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em',
                color: '#34D399', marginBottom: '3px',
              }}>
                {repData?.score ?? 0}
              </div>
              <div style={{ fontSize: '10px', color: '#4D5E72' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '1px 6px', fontSize: '9px', fontWeight: 800,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: tc.color, background: `rgba(${hexToRgb(tc.color)},0.08)`,
                  border: `1px solid rgba(${hexToRgb(tc.color)},0.2)`,
                  marginRight: '6px',
                }}>
                  {tc.label}
                </span>
                {repData?.pactCount ?? 0} pacts
              </div>
            </>
          )}
        </div>

        {/* Active Escrow */}
        <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '14px 16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '8px' }}>
            Active Escrow
          </div>
          {pactsLoading ? (
            <>
              <Skel w="80px" h={26} style={{ marginBottom: '6px' }} />
              <Skel w="110px" h={12} />
            </>
          ) : (
            <>
              <div style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em',
                color: '#22D3EE', marginBottom: '3px',
              }}>
                {formatSol(escrowSol)}
              </div>
              <div style={{ fontSize: '10px', color: '#4D5E72' }}>
                SOL locked in {activePacts.length} pact{activePacts.length !== 1 ? 's' : ''}
              </div>
            </>
          )}
        </div>

        {/* Wallet Balance */}
        <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '14px 16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '8px' }}>
            Wallet Balance
          </div>
          {balLoading ? (
            <>
              <Skel w="80px" h={26} style={{ marginBottom: '6px' }} />
              <Skel w="80px" h={12} />
            </>
          ) : (
            <>
              <div style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em',
                color: '#E8EDF2', marginBottom: '3px',
              }}>
                {balance !== null ? formatSol(balance) : '—'}
              </div>
              <div style={{ fontSize: '10px', color: '#4D5E72' }}>SOL available</div>
            </>
          )}
        </div>
      </div>

      {/* Reputation section */}
      <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '18px 20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#E8EDF2' }}>Reputation</span>
          <Link href="/dashboard/reputation" style={{ fontSize: '10px', color: '#2D8CFF', textDecoration: 'none' }}>
            Full history →
          </Link>
        </div>

        <div className="hub-rep-row" style={{ display: 'flex', alignItems: 'flex-start', gap: '24px' }}>
          {/* Ring + tier details */}
          <div className="hub-rep-ring-block" style={{ display: 'flex', alignItems: 'center', gap: '18px', flexShrink: 0 }}>
            {repLoading ? (
              <Skel w="88px" h={88} style={{ borderRadius: '50%' }} />
            ) : (
              <RepRing score={repData?.score ?? 0} tier={tier} />
            )}
            <div>
              {repLoading ? (
                <>
                  <Skel w="100px" h={14} style={{ marginBottom: '8px' }} />
                  <Skel w="140px" h={11} style={{ marginBottom: '5px' }} />
                  <Skel w="120px" h={11} style={{ marginBottom: '5px' }} />
                  <Skel w="130px" h={11} />
                </>
              ) : (
                <>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#E8EDF2', marginBottom: '6px' }}>
                    {tc.label} Tier
                  </div>
                  <div style={{ fontSize: '11px', color: '#8A99AC', lineHeight: 1.7 }}>
                    Pacts completed: <strong style={{ color: '#E8EDF2' }}>{repData?.pactCount ?? 0}</strong><br />
                    Dispute rate: <strong style={{ color: repData && repData.disputeRate > 0.1 ? '#EF4444' : '#22C55E' }}>
                      {((repData?.disputeRate ?? 0) * 100).toFixed(1)}%
                    </strong><br />
                    Score range: <strong style={{ color: '#E8EDF2', fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '10px' }}>
                      {tc.min}–{tc.max}
                    </strong>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', alignSelf: 'stretch', background: '#1E2D42', flexShrink: 0 }} />

          {/* Tier progression */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {repLoading ? (
              <>
                <Skel w="100px" h={10} style={{ marginBottom: '12px' }} />
                {[0, 1, 2, 3].map(i => <Skel key={i} w="100%" h={10} style={{ marginBottom: '8px' }} />)}
              </>
            ) : (
              <TierBars score={repData?.score ?? 0} />
            )}
          </div>
        </div>
      </div>

      {/* Active escrows table */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#E8EDF2' }}>Active Escrows</span>
          <Link href="/dashboard/escrow" style={{ fontSize: '10px', color: '#2D8CFF', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>

        <div style={{ background: '#141B27', border: '1px solid #1E2D42', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1E2D42' }}>
                {['Pact ID', 'Counterparty', 'Amount', 'Status', 'Release'].map(h => (
                  <th key={h} style={{
                    padding: '9px 14px', textAlign: 'left',
                    fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em',
                    textTransform: 'uppercase', color: '#4D5E72',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pactsLoading ? (
                [0, 1, 2].map(i => (
                  <tr key={i} style={{ borderBottom: '1px solid #1E2D42' }}>
                    {[0, 1, 2, 3, 4].map(j => (
                      <td key={j} style={{ padding: '12px 14px' }}>
                        <Skel w={j === 0 ? '80px' : j === 2 ? '60px' : '100px'} h={12} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : activePacts.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '28px 14px', textAlign: 'center', color: '#4D5E72', fontSize: '12px' }}>
                    No active escrows
                  </td>
                </tr>
              ) : (
                activePacts.map((pact, idx) => (
                  <tr key={pact.id} style={{ borderBottom: idx < activePacts.length - 1 ? '1px solid #1E2D42' : 'none' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '10px', color: '#8A99AC' }}>
                        {truncate(pact.id, 4)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <strong style={{ fontSize: '11px', color: '#E8EDF2', fontWeight: 500 }}>
                        {truncate(pact.counterparty, 6)}
                      </strong>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <strong style={{
                        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                        fontSize: '11px', fontWeight: 700, color: '#34D399',
                      }}>
                        {formatSol(pact.amountSol)} SOL
                      </strong>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusPill status={pact.status} />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '10px', color: '#4D5E72' }}>
                      {pact.autoRelease ? 'Auto' : 'Mutual sig'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// CSS hex to rgb for dynamic opacity
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
