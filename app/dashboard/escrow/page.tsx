'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import DisputeModal from './DisputeModal';
import { AlertBanner } from '../../components/AlertBanner';
import type { DisputePact } from './DisputeModal';
import { fetchPacts } from '../../../lib/indexer';
import type { PactStatus } from '../../../lib/indexer';

// ── Types ────────────────────────────────────────────────────────────────────

interface Pact {
  id: string;
  counterparty: string;
  role: 'initiator' | 'beneficiary';
  amountSol: number;
  status: PactStatus;
  createdAt: string;
  disputeDeadlineAt?: string | null;
  txSignature: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const DEVNET_EXPLORER = 'https://explorer.solana.com/tx';


// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  if (diffD >= 1) return `${diffD}d`;
  if (diffH >= 1) return `${diffH}h`;
  return '<1h';
}

function formatCountdown(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function Skel({ w, h, style }: { w?: string; h?: number; style?: React.CSSProperties }) {
  return <div className="vp-skel" style={{ width: w || '100%', height: h || 14, borderRadius: 2, ...style }} />;
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: PactStatus }) {
  const sc = STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '2px 9px',
      fontSize: '10px',
      fontWeight: 800,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      lineHeight: 1,
      color: sc.color,
      background: sc.dim,
      border: `1px solid ${sc.border}`,
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: sc.color, flexShrink: 0, display: 'inline-block' }} />
      {status}
    </span>
  );
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortKey = 'amount' | 'age';
type SortDir = 'asc' | 'desc';

function sortPacts(pacts: Pact[], key: SortKey | null, dir: SortDir): Pact[] {
  if (!key) return pacts;
  return [...pacts].sort((a, b) => {
    let delta: number;
    if (key === 'amount') {
      delta = a.amountSol - b.amountSol;
    } else {
      // age: older = larger. asc = youngest first (latest createdAt first)
      delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return dir === 'asc' ? delta : -delta;
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  const up = active && dir === 'asc' ? '#E8EDF2' : '#4D5E72';
  const dn = active && dir === 'desc' ? '#E8EDF2' : '#4D5E72';
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M4 1L1.5 4H6.5L4 1Z" fill={up} />
      <path d="M4 9L6.5 6H1.5L4 9Z" fill={dn} />
    </svg>
  );
}

function SortHeader({
  label, sortKey, activeSortKey, sortDir, onSort, style,
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  style?: React.CSSProperties;
}) {
  const active = activeSortKey === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{
        all: 'unset',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: active ? '#E8EDF2' : '#4D5E72',
        userSelect: 'none',
        ...style,
      }}
    >
      {label}
      <SortIcon active={active} dir={sortDir} />
    </button>
  );
}

function pactToDisputePact(p: Pact): DisputePact {
  return {
    id: p.id,
    counterparty: p.counterparty,
    amountSol: p.amountSol,
    releaseCondition: 'Oracle proof-of-delivery',
    createdAt: p.createdAt,
    disputeDeadlineAt: p.disputeDeadlineAt ?? undefined,
    explorerTx: p.txSignature,
  };
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function EscrowPage() {
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePacts, setActivePacts] = useState<Pact[]>([]);
  const [completedPacts, setCompletedPacts] = useState<Pact[]>([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedDispute, setSelectedDispute] = useState<Pact | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sortedActivePacts = sortPacts(activePacts, sortKey, sortDir);

  const disputedPacts = activePacts.filter(p => p.status === 'disputed');
  const firstDisputed = disputedPacts[0];

  useEffect(() => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    const pubkey = publicKey.toBase58();
    Promise.all([
      fetchPacts(pubkey, 'active'),
      fetchPacts(pubkey, 'completed', 20),
    ])
      .then(([activeRes, completedRes]) => {
        setActivePacts(activeRes.pacts.map(p => ({
          id: p.id,
          counterparty: p.counterparty,
          role: p.role,
          amountSol: p.amountSol,
          status: p.status,
          createdAt: p.createdAt,
          disputeDeadlineAt: p.disputeDeadlineAt,
          txSignature: p.txSignature,
        })));
        setCompletedPacts(completedRes.pacts.map(p => ({
          id: p.id,
          counterparty: p.counterparty,
          role: p.role,
          amountSol: p.amountSol,
          status: p.status,
          createdAt: p.createdAt,
          disputeDeadlineAt: p.disputeDeadlineAt,
          txSignature: p.txSignature,
        })));
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load pacts'))
      .finally(() => setLoading(false));
  }, [publicKey]);

  // Live countdown ticker
  useEffect(() => {
    if (!firstDisputed?.disputeDeadlineAt) return;
    const tick = () => setCountdown(formatCountdown(firstDisputed.disputeDeadlineAt!));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [firstDisputed]);

  return (
    <>
    <DisputeModal pact={selectedDispute ? pactToDisputePact(selectedDispute) : null} onClose={() => setSelectedDispute(null)} />
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '4px' }}>
            Escrow Activity
          </h1>
          <p style={{ fontSize: '12px', color: '#8A99AC', lineHeight: 1.6 }}>
            Active pacts and recent settlement history. Data sourced from the Holdfast indexer.
          </p>
        </div>
        <Link
          href="/dashboard/create-pact"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '7px 16px', fontSize: '11px', fontWeight: 700,
            letterSpacing: '0.02em', color: '#fff',
            background: '#2D8CFF', border: 'none',
            textDecoration: 'none', whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Create pact
        </Link>
      </div>

      {error && <AlertBanner type="danger" message={error} />}

      {!loading && disputedPacts.length > 0 && (
        <AlertBanner
          type="danger"
          sticky
          title={
            <>
              {disputedPacts.length} Open Dispute{disputedPacts.length > 1 ? 's' : ''}
              {firstDisputed?.disputeDeadlineAt && (
                <span style={{
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontSize: '11px',
                  color: '#F59E0B',
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.2)',
                  padding: '1px 8px',
                }}>
                  ⏱ {countdown} remaining
                </span>
              )}
            </>
          }
          message={`${disputedPacts.map(p => `${p.counterparty} (${p.amountSol} SOL)`).join(', ')} — resolve before the on-chain deadline to avoid automatic escalation.`}
        />
      )}

      {/* Active pacts table */}
      <div style={{ background: '#141B27', border: '1px solid #1E2D42', marginBottom: '20px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid #1E2D42',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A99AC' }}>
              Active Pacts
            </span>
            {!loading && (
              <span style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '10px',
                color: '#4D5E72',
                background: '#0D1117',
                border: '1px solid #1E2D42',
                padding: '1px 7px',
              }}>
                {activePacts.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: '10px', color: '#4D5E72' }}>
            Funded/Locked=blue · Released=green · Disputed=red
          </span>
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '140px 90px 110px 90px 60px 120px',
          padding: '8px 18px',
          borderBottom: '1px solid #1E2D42',
          gap: '12px',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>Counterparty</span>
          <SortHeader label="Amount" sortKey="amount" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>Status</span>
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>Role</span>
          <SortHeader label="Age" sortKey="age" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72', textAlign: 'right' }}>Explorer</span>
        </div>

        {/* Table rows */}
        {loading ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[1,2,3].map(i => <Skel key={i} w="100%" h={18} />)}
          </div>
        ) : sortedActivePacts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#4D5E72', fontSize: '12px' }}>
            No active pacts
          </div>
        ) : (
          sortedActivePacts.map((pact, idx) => (
            <PactRow key={pact.id} pact={pact} isLast={idx === sortedActivePacts.length - 1} onViewDispute={setSelectedDispute} />
          ))
        )}
      </div>

      {/* Completed pacts collapsible */}
      <div style={{ background: '#141B27', border: '1px solid #1E2D42' }}>
        <button
          onClick={() => setCompletedOpen(o => !o)}
          style={{
            width: '100%',
            background: 'none',
            border: 'none',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            color: '#8A99AC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Recent Completed
            </span>
            <span style={{
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: '10px',
              color: '#4D5E72',
              background: '#0D1117',
              border: '1px solid #1E2D42',
              padding: '1px 7px',
            }}>
              last 20
            </span>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{ transform: completedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
          >
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {completedOpen && (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '140px 90px 110px 90px 60px 120px',
              padding: '8px 18px',
              borderTop: '1px solid #1E2D42',
              borderBottom: '1px solid #1E2D42',
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#4D5E72',
              gap: '12px',
            }}>
              <span>Counterparty</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Role</span>
              <span>Age</span>
              <span style={{ textAlign: 'right' }}>Explorer</span>
            </div>
            {loading ? (
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[1,2,3,4].map(i => <Skel key={i} w="100%" h={18} />)}
              </div>
            ) : (
              completedPacts.slice(0, 20).map((pact, idx) => (
                <PactRow key={pact.id} pact={pact} isLast={idx === Math.min(completedPacts.length, 20) - 1} />
              ))
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}

function PactRow({ pact, isLast, onViewDispute }: { pact: Pact; isLast: boolean; onViewDispute?: (p: Pact) => void }) {
  const isDisputed = pact.status === 'disputed';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '140px 90px 110px 1fr 60px 120px',
      padding: '10px 18px',
      borderBottom: isLast ? 'none' : '1px solid #1E2D42',
      alignItems: 'center',
      gap: '12px',
      background: isDisputed ? 'rgba(239,68,68,0.03)' : 'transparent',
      transition: 'background 0.1s',
    }}>

      <span style={{
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: '11px',
        color: '#E8EDF2',
      }}>
        {pact.counterparty}
      </span>

      <span style={{
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: '12px',
        color: '#E8EDF2',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {pact.amountSol} SOL
      </span>

      <StatusPill status={pact.status} />

      <span style={{ fontSize: '11px', color: '#8A99AC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pact.role}
      </span>

      <span style={{
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: '11px',
        color: '#4D5E72',
      }}>
        {formatAge(pact.createdAt)}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
        {isDisputed && onViewDispute && (
          <button
            onClick={() => onViewDispute(pact)}
            style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#EF4444',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              padding: '2px 8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            }}
          >
            Dispute
          </button>
        )}
        <a
          href={`${DEVNET_EXPLORER}/${pact.txSignature}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: '#2D8CFF',
            background: 'rgba(45,140,255,0.08)',
            border: '1px solid rgba(45,140,255,0.18)',
            padding: '2px 7px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          View
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 6.5L6.5 1.5M4 1.5H6.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      </div>
    </div>
  );
}
