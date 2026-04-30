'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '../../components/NotificationContext';
import { fetchReputation } from '../../../lib/indexer';
import type { ReputationResponse } from '../../../lib/indexer';

// ── Types ────────────────────────────────────────────────────────────────────

type PactMode = 'task' | 'milestone' | 'timed';
type WizardStep = 1 | 2 | 3 | 4;

interface StepOneState {
  counterparty: string;
  mint: string;
  amount: string;
  initiatorStake: string;
  beneficiaryStake: string;
  slashLoserStake: boolean;
}

interface StepTwoState {
  mode: PactMode;
  deadline: string;
  arbiter: string;
  deliverablesUri: string;
  deliverablesHash: string;
}

interface PactResult {
  pactId: string;
  escrowAddress: string;
  txSig: string;
  amount: string;
  mode: PactMode;
  counterparty: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WSOL_MINT = 'So11111111111111111111111111111111';

const MODE_CARDS: { mode: PactMode; label: string; desc: string; tradeoff: string }[] = [
  {
    mode: 'task',
    label: 'Task',
    desc: 'Single deliverable with manual release by initiator.',
    tradeoff: 'Initiator holds release authority — beneficiary must dispute if withheld.',
  },
  {
    mode: 'milestone',
    label: 'Milestone',
    desc: 'Arbiter-gated release for verified progress.',
    tradeoff: 'Requires a trusted arbiter — neither party can release unilaterally.',
  },
  {
    mode: 'timed',
    label: 'Timed',
    desc: 'Auto-release at expiry if no dispute is raised.',
    tradeoff: 'Requires an on-chain keeper crank — funds stay locked without one.',
  },
];

const MODE_COLORS: Record<PactMode, { color: string; dim: string; border: string }> = {
  task:      { color: '#8A99AC', dim: 'rgba(138,153,172,0.08)', border: 'rgba(138,153,172,0.22)' },
  milestone: { color: '#9F6BFF', dim: 'rgba(159,107,255,0.08)', border: 'rgba(159,107,255,0.22)' },
  timed:     { color: '#F59E0B', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.22)' },
};

const TIER_COLORS: Record<string, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#E5E4E2',
};

const DEVNET_EXPLORER = 'https://explorer.solana.com/tx';

const DEADLINE_LABELS: Record<PactMode, string> = {
  task: 'Work deadline (lock-by date)',
  milestone: 'Milestone deadline (lock-by date)',
  timed: 'Auto-release date',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function isValidBase58(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

function dateToUnixSecs(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function unixToReadable(unix: number): string {
  return new Date(unix * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function hoursUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / 3600000;
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: WizardStep }) {
  const steps = [
    { n: 1, label: 'Counterparty & Amount' },
    { n: 2, label: 'Mode & Configuration' },
    { n: 3, label: 'Review & Sign' },
    { n: 4, label: 'Pact Live' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '28px' }}>
      {steps.map((s, i) => {
        const allDone = current === 4;
        const done = allDone || current > s.n;
        const active = !allDone && current === s.n;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                background: done ? '#22C55E' : active ? '#2D8CFF' : '#1E2D42',
                color: done || active ? '#fff' : '#4D5E72',
                border: `1.5px solid ${done ? '#22C55E' : active ? '#2D8CFF' : '#1E2D42'}`,
                transition: 'all 0.15s',
              }}>
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : s.n}
              </div>
              <span style={{
                fontSize: '11px', fontWeight: active ? 700 : 500,
                color: active ? '#E8EDF2' : '#4D5E72',
                letterSpacing: '-0.01em',
              }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                width: '32px', height: '1px', margin: '0 12px',
                background: done ? '#22C55E' : '#1E2D42',
                transition: 'background 0.15s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Reputation preview ───────────────────────────────────────────────────────

function ReputationPreview({ pubkey }: { pubkey: string }) {
  const [rep, setRep] = useState<ReputationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey || !isValidBase58(pubkey)) {
      setRep(null);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    const timeout = setTimeout(() => {
      fetchReputation(pubkey)
        .then(setRep)
        .catch(() => setErr('Could not fetch reputation'))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [pubkey]);

  if (!pubkey || !isValidBase58(pubkey)) return null;
  if (loading) return (
    <div style={{ fontSize: '10px', color: '#4D5E72', padding: '6px 0' }}>
      Loading reputation…
    </div>
  );
  if (err) return (
    <div style={{ fontSize: '10px', color: '#F59E0B', padding: '6px 0' }}>
      {err}
    </div>
  );
  if (!rep) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px',
      background: 'rgba(45,140,255,0.04)', border: '1px solid rgba(45,140,255,0.12)',
      marginTop: '6px', fontSize: '11px',
    }}>
      <span style={{
        fontWeight: 700, textTransform: 'uppercase', fontSize: '10px',
        letterSpacing: '0.08em',
        color: TIER_COLORS[rep.tier] ?? '#8A99AC',
      }}>
        {rep.tier}
      </span>
      <span style={{ color: '#8A99AC' }}>Score: <strong style={{ color: '#E8EDF2' }}>{rep.score}</strong></span>
      <span style={{ color: '#8A99AC' }}>Pacts: <strong style={{ color: '#E8EDF2' }}>{rep.pactCount}</strong></span>
      <span style={{ color: '#8A99AC' }}>
        Dispute rate: <strong style={{ color: rep.disputeRate > 0.1 ? '#EF4444' : '#E8EDF2' }}>
          {(rep.disputeRate * 100).toFixed(1)}%
        </strong>
      </span>
    </div>
  );
}

// ── Advisory / warning banners ───────────────────────────────────────────────

function Advisory({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      padding: '10px 14px', fontSize: '11px', lineHeight: 1.5,
      color: '#F59E0B', background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.18)', marginTop: '12px',
    }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
        <path d="M7 1L13 12H1L7 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="7" cy="10" r="0.6" fill="currentColor"/>
      </svg>
      <span>{children}</span>
    </div>
  );
}

function ErrorInline({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '10px', color: '#EF4444', marginTop: '4px',
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    }}>
      {children}
    </div>
  );
}

function CopyRow({ value, display, explorerHref }: { value: string; display: string; explorerHref?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {explorerHref ? (
        <a href={explorerHref} target="_blank" rel="noopener noreferrer" style={{
          flex: 1, fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontSize: '11px', color: '#8A99AC', textDecoration: 'underline',
          textDecorationColor: 'rgba(138,153,172,0.3)', wordBreak: 'break-all',
        }}>
          {display}
        </a>
      ) : (
        <span style={{
          flex: 1, fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontSize: '11px', color: '#8A99AC', wordBreak: 'break-all',
        }}>
          {display}
        </span>
      )}
      <button
        onClick={handleCopy}
        title="Copy to clipboard"
        style={{
          all: 'unset', cursor: 'pointer', flexShrink: 0, padding: '3px 8px',
          fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: copied ? '#22C55E' : '#4D5E72',
          border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : '#1E2D42'}`,
          transition: 'color 0.15s, border-color 0.15s',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// ── Form field styles ────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '12px',
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  color: '#E8EDF2',
  background: '#0D1117',
  border: '1px solid #1E2D42',
  outline: 'none',
  boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8A99AC',
  marginBottom: '6px',
};

// ── Main wizard ──────────────────────────────────────────────────────────────

export default function CreatePactPage() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { push: pushNotif } = useNotifications();
  const [step, setStep] = useState<WizardStep>(1);
  const [submitting, setSubmitting] = useState(false);
  const [pactResult, setPactResult] = useState<PactResult | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('holdfast-pact-result');
      if (saved) {
        const result = JSON.parse(saved) as PactResult;
        setPactResult(result);
        setStep(4);
      }
    } catch { /* ignore */ }
  }, []);

  const [s1, setS1] = useState<StepOneState>({
    counterparty: '',
    mint: WSOL_MINT,
    amount: '',
    initiatorStake: '',
    beneficiaryStake: '',
    slashLoserStake: false,
  });

  const [s2, setS2] = useState<StepTwoState>({
    mode: 'task',
    deadline: '',
    arbiter: '',
    deliverablesUri: '',
    deliverablesHash: '',
  });

  // ── Step 1 validation ────────────────────────────────────────────────────

  const s1Errors = {
    counterparty: s1.counterparty && !isValidBase58(s1.counterparty) ? 'Invalid Solana address' : '',
    amount: s1.amount && (isNaN(Number(s1.amount)) || Number(s1.amount) <= 0) ? 'Amount must be greater than 0' : '',
    slashNoStakes: s1.slashLoserStake && (!s1.initiatorStake || !s1.beneficiaryStake || Number(s1.initiatorStake) <= 0 || Number(s1.beneficiaryStake) <= 0)
      ? 'Both stakes must be > 0 when slash is enabled' : '',
  };

  const s1Valid = !!s1.counterparty && isValidBase58(s1.counterparty)
    && !!s1.amount && Number(s1.amount) > 0
    && !s1Errors.slashNoStakes;

  // ── Step 2 validation ────────────────────────────────────────────────────

  const deadlineHours = s2.deadline ? hoursUntil(s2.deadline) : 0;
  const deadlinePast = !!s2.deadline && deadlineHours <= 0;
  const deadlineTooSoon = !!s2.deadline && deadlineHours > 0 && deadlineHours < 1;
  const deadlineNear24h = !!s2.deadline && deadlineHours > 0 && deadlineHours < 24 && s2.mode === 'timed';

  const s2Errors = {
    deadline: deadlinePast ? 'Deadline must be in the future' : deadlineTooSoon ? 'Must be at least 1 hour from now' : '',
    arbiter: s2.mode === 'milestone' && s2.arbiter && !isValidBase58(s2.arbiter) ? 'Invalid Solana address' : '',
    arbiterRequired: s2.mode === 'milestone' && !s2.arbiter ? 'Arbiter is required for milestone mode' : '',
    uri: s2.deliverablesUri && s2.deliverablesUri.length > 200 ? 'Max 200 characters' : '',
    uriInvalid: s2.deliverablesUri && s2.deliverablesUri.length <= 200 && !isValidUrl(s2.deliverablesUri) ? 'Must be a valid URL' : '',
  };

  const s2Valid = !!s2.deadline && !deadlinePast && !deadlineTooSoon
    && (s2.mode !== 'milestone' || (!!s2.arbiter && isValidBase58(s2.arbiter)))
    && !s2Errors.uri && !s2Errors.uriInvalid;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const updateS1 = useCallback(<K extends keyof StepOneState>(k: K, v: StepOneState[K]) => {
    setS1(prev => ({ ...prev, [k]: v }));
  }, []);

  const updateS2 = useCallback(<K extends keyof StepTwoState>(k: K, v: StepTwoState[K]) => {
    setS2(prev => ({ ...prev, [k]: v }));
  }, []);

  const handleModeChange = useCallback((mode: PactMode) => {
    setS2(prev => ({
      ...prev,
      mode,
      arbiter: mode === 'milestone' ? prev.arbiter : '',
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !s1Valid || !s2Valid) return;
    setSubmitting(true);

    try {
      // Build the createPact parameters
      const params = {
        counterparty: s1.counterparty,
        mint: s1.mint,
        amount: Number(s1.amount),
        releaseCondition: {
          kind: s2.mode,
          timeLockExpiresAt: dateToUnixSecs(s2.deadline),
        },
        autoReleaseOnExpiry: s2.mode === 'timed',
        ...(s2.arbiter ? { arbiter: s2.arbiter } : {}),
        ...(s1.initiatorStake && Number(s1.initiatorStake) > 0 ? { stakes: {
          initiator: Number(s1.initiatorStake),
          ...(s1.beneficiaryStake && Number(s1.beneficiaryStake) > 0 ? { beneficiary: Number(s1.beneficiaryStake) } : {}),
        }} : {}),
        ...(s1.slashLoserStake ? { slashLoserStake: true } : {}),
        ...(s2.deliverablesUri ? { deliverablesUri: s2.deliverablesUri } : {}),
        ...(s2.deliverablesHash ? { deliverablesHash: s2.deliverablesHash } : {}),
      };

      // SDK call: client.escrow.createPact(params)
      // Current dashboard mode is simulation-only until live devnet wiring is complete.
      console.log('[CreatePact] SDK call params:', params);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const ts = Date.now();
      const mockTxSig = 'sim' + ts.toString(36) + Math.random().toString(36).slice(2, 10);
      const mockEscrow = '5NjK' + ts.toString(36).toUpperCase().slice(-6) + 'wP' + Math.random().toString(36).slice(2, 12).toUpperCase();
      const mockPactId = '3Pact' + ts.toString(36) + Math.random().toString(36).slice(2, 8);

      pushNotif({
        category: 'pact',
        severity: 'success',
        title: 'Simulated pact draft created',
        body: `${s2.mode.charAt(0).toUpperCase() + s2.mode.slice(1)} flow preview with ${truncAddr(s1.counterparty)} for ${s1.amount} SOL (not sent on-chain)`,
        pactId: mockPactId,
      });

      const result: PactResult = {
        pactId: mockPactId,
        escrowAddress: mockEscrow,
        txSig: mockTxSig,
        amount: s1.amount,
        mode: s2.mode,
        counterparty: s1.counterparty,
      };
      try { sessionStorage.setItem('holdfast-pact-result', JSON.stringify(result)); } catch { /* ignore */ }
      setPactResult(result);
      setStep(4);
    } catch (err) {
      pushNotif({
        category: 'pact',
        severity: 'critical',
        title: 'Pact creation failed',
        body: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, s1, s2, s1Valid, s2Valid, pushNotif, router]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '28px 32px', maxWidth: '720px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '4px' }}>
        {step !== 4 && (
          <button
            onClick={() => router.push('/dashboard/escrow')}
            style={{
              all: 'unset', cursor: 'pointer', display: 'inline-flex',
              alignItems: 'center', gap: '4px', fontSize: '11px',
              color: '#4D5E72', marginBottom: '12px',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 1.5L3.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to Escrow
          </button>
        )}
        <h1 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '4px' }}>
          Create Pact
        </h1>
        <p style={{ fontSize: '12px', color: '#8A99AC', lineHeight: 1.6, marginBottom: '24px' }}>
          Simulation mode: previews a pact setup flow only. No devnet transaction is submitted from this page yet.
        </p>
      </div>

      <StepIndicator current={step} />

      {/* ──────────── Step 1: Counterparty & Amount ──────────── */}
      {step === 1 && (
        <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '24px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '20px', letterSpacing: '-0.01em' }}>
            Counterparty & Amount
          </h2>

          {/* Counterparty */}
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL_STYLE}>Beneficiary wallet address</label>
            <input
              type="text"
              placeholder="Enter Solana pubkey…"
              value={s1.counterparty}
              onChange={e => updateS1('counterparty', e.target.value.trim())}
              style={{
                ...INPUT_STYLE,
                borderColor: s1Errors.counterparty ? '#EF4444' : '#1E2D42',
              }}
            />
            {s1Errors.counterparty && <ErrorInline>{s1Errors.counterparty}</ErrorInline>}
            <ReputationPreview pubkey={s1.counterparty} />
          </div>

          {/* Token mint */}
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL_STYLE}>Token</label>
            <div style={{
              ...INPUT_STYLE,
              display: 'flex', alignItems: 'center', gap: '8px',
              color: '#4D5E72', cursor: 'not-allowed', background: '#0D1117',
            }}>
              <span style={{ color: '#E8EDF2', fontWeight: 600 }}>wSOL</span>
              <span style={{ fontSize: '10px', color: '#4D5E72' }}>
                {truncAddr(WSOL_MINT)}
              </span>
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL_STYLE}>Escrow amount (SOL)</label>
            <input
              type="number"
              min="0"
              step="0.001"
              placeholder="0.00"
              value={s1.amount}
              onChange={e => updateS1('amount', e.target.value)}
              style={{
                ...INPUT_STYLE,
                borderColor: s1Errors.amount ? '#EF4444' : '#1E2D42',
              }}
            />
            {s1Errors.amount && <ErrorInline>{s1Errors.amount}</ErrorInline>}
          </div>

          {/* Stakes (collapsible) */}
          <details style={{ marginTop: '20px' }}>
            <summary style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: '#4D5E72', cursor: 'pointer',
              listStyle: 'none', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M2 3L4 5L6 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Optional: Stakes & Slashing
            </summary>
            <div style={{ padding: '12px 0 0', display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={LABEL_STYLE}>Initiator stake (SOL)</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0.00"
                  value={s1.initiatorStake}
                  onChange={e => updateS1('initiatorStake', e.target.value)}
                  style={INPUT_STYLE}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={LABEL_STYLE}>Beneficiary stake (SOL)</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0.00"
                  value={s1.beneficiaryStake}
                  onChange={e => updateS1('beneficiaryStake', e.target.value)}
                  style={INPUT_STYLE}
                />
              </div>
            </div>
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="slash-toggle"
                checked={s1.slashLoserStake}
                onChange={e => updateS1('slashLoserStake', e.target.checked)}
                style={{ accentColor: '#2D8CFF' }}
              />
              <label htmlFor="slash-toggle" style={{ fontSize: '11px', color: '#8A99AC', cursor: 'pointer' }}>
                Slash loser&apos;s stake on dispute resolution
              </label>
            </div>
            {s1Errors.slashNoStakes && <ErrorInline>{s1Errors.slashNoStakes}</ErrorInline>}
            {s1.slashLoserStake && s2.mode === 'task' && !s2.arbiter && (
              <Advisory>
                Slash requires an arbiter to resolve disputes. Consider adding an arbiter in Step 2 or switching to Milestone mode.
              </Advisory>
            )}
          </details>

          {/* Nav */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
            <button
              disabled={!s1Valid}
              onClick={() => setStep(2)}
              style={{
                padding: '8px 24px', fontSize: '12px', fontWeight: 700,
                color: s1Valid ? '#fff' : '#4D5E72',
                background: s1Valid ? '#2D8CFF' : '#1E2D42',
                border: 'none', cursor: s1Valid ? 'pointer' : 'not-allowed',
                letterSpacing: '0.02em',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ──────────── Step 2: Mode Selection & Configuration ──────────── */}
      {step === 2 && (
        <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '24px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '20px', letterSpacing: '-0.01em' }}>
            Mode Selection & Configuration
          </h2>

          {/* Mode cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '24px' }}>
            {MODE_CARDS.map(({ mode, label, desc, tradeoff }) => {
              const selected = s2.mode === mode;
              const mc = MODE_COLORS[mode];
              return (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode)}
                  style={{
                    all: 'unset',
                    boxSizing: 'border-box',
                    padding: '14px',
                    cursor: 'pointer',
                    background: selected ? mc.dim : '#0D1117',
                    border: `1.5px solid ${selected ? mc.color : '#1E2D42'}`,
                    transition: 'all 0.12s',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      border: `2px solid ${selected ? mc.color : '#4D5E72'}`,
                      background: selected ? mc.color : 'transparent',
                      transition: 'all 0.12s',
                    }} />
                    <span style={{
                      fontSize: '12px', fontWeight: 700,
                      color: selected ? mc.color : '#8A99AC',
                    }}>
                      {label}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', lineHeight: 1.5, color: '#4D5E72' }}>
                    {desc}
                  </span>
                  <span style={{
                    fontSize: '9px', lineHeight: 1.4, color: '#4D5E72',
                    fontStyle: 'italic', marginTop: '2px',
                  }}>
                    {tradeoff}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Mode-specific fields */}
          <div style={{ borderTop: '1px solid #1E2D42', paddingTop: '20px' }}>

            {/* Deadline (all modes) */}
            <div style={{ marginBottom: '16px' }}>
              <label style={LABEL_STYLE}>{DEADLINE_LABELS[s2.mode]}</label>
              <input
                type="datetime-local"
                value={s2.deadline}
                onChange={e => updateS2('deadline', e.target.value)}
                style={{
                  ...INPUT_STYLE,
                  borderColor: s2Errors.deadline ? '#EF4444' : '#1E2D42',
                  colorScheme: 'dark',
                }}
              />
              {s2Errors.deadline && <ErrorInline>{s2Errors.deadline}</ErrorInline>}
              {deadlineNear24h && !s2Errors.deadline && (
                <Advisory>
                  Auto-release date is less than 24 hours from now. Both parties must lock the pact before this time.
                </Advisory>
              )}
            </div>

            {/* Arbiter — shown for task (optional) and milestone (required) */}
            {(s2.mode === 'task' || s2.mode === 'milestone') && (
              <div style={{ marginBottom: '16px' }}>
                <label style={LABEL_STYLE}>
                  Arbiter wallet address
                  {s2.mode === 'milestone' && (
                    <span style={{ color: '#EF4444', marginLeft: '4px' }}>*</span>
                  )}
                  {s2.mode === 'task' && (
                    <span style={{ color: '#4D5E72', fontWeight: 400, marginLeft: '6px', textTransform: 'none', letterSpacing: '0' }}>
                      (optional)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="Enter arbiter Solana pubkey…"
                  value={s2.arbiter}
                  onChange={e => updateS2('arbiter', e.target.value.trim())}
                  style={{
                    ...INPUT_STYLE,
                    borderColor: (s2Errors.arbiter || s2Errors.arbiterRequired) ? '#EF4444' : '#1E2D42',
                  }}
                />
                {s2Errors.arbiter && <ErrorInline>{s2Errors.arbiter}</ErrorInline>}
                {s2Errors.arbiterRequired && <ErrorInline>{s2Errors.arbiterRequired}</ErrorInline>}
              </div>
            )}

            {/* Deliverables URI (all modes) */}
            <div style={{ marginBottom: '16px' }}>
              <label style={LABEL_STYLE}>
                Deliverables URI
                <span style={{ color: '#4D5E72', fontWeight: 400, marginLeft: '6px', textTransform: 'none', letterSpacing: '0' }}>
                  (optional, max 200 chars)
                </span>
              </label>
              <input
                type="text"
                placeholder="https://… or ipfs://…"
                value={s2.deliverablesUri}
                onChange={e => updateS2('deliverablesUri', e.target.value)}
                style={{
                  ...INPUT_STYLE,
                  borderColor: (s2Errors.uri || s2Errors.uriInvalid) ? '#EF4444' : '#1E2D42',
                }}
              />
              {s2Errors.uri && <ErrorInline>{s2Errors.uri}</ErrorInline>}
              {s2Errors.uriInvalid && <ErrorInline>{s2Errors.uriInvalid}</ErrorInline>}
            </div>

            {/* Deliverables hash — milestone only, optional but recommended */}
            {s2.mode === 'milestone' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={LABEL_STYLE}>
                  Deliverables hash
                  <span style={{ color: '#4D5E72', fontWeight: 400, marginLeft: '6px', textTransform: 'none', letterSpacing: '0' }}>
                    (recommended)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="SHA-256 hash of deliverables spec"
                  value={s2.deliverablesHash}
                  onChange={e => updateS2('deliverablesHash', e.target.value.trim())}
                  style={INPUT_STYLE}
                />
              </div>
            )}

            {/* Milestone advisory: no deliverables set */}
            {s2.mode === 'milestone' && !s2.deliverablesUri && !s2.deliverablesHash && s2.arbiter && (
              <Advisory>
                No deliverables hash or URI provided. The arbiter will have no immutable reference to verify milestone criteria against. Strongly consider adding at least one.
              </Advisory>
            )}

            {/* Timed keeper notice */}
            {s2.mode === 'timed' && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '10px 14px', fontSize: '11px', lineHeight: 1.5,
                color: '#2D8CFF', background: 'rgba(45,140,255,0.06)',
                border: '1px solid rgba(45,140,255,0.18)', marginTop: '8px',
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M7 4V7.5L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span>
                  Auto-release requires an on-chain crank. Ensure your integration calls{' '}
                  <code style={{ background: '#0D1117', padding: '1px 5px', fontSize: '10px' }}>autoRelease()</code>{' '}
                  at expiry, or configure a keeper service.
                </span>
              </div>
            )}
          </div>

          {/* Nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
            <button
              onClick={() => setStep(1)}
              style={{
                padding: '8px 24px', fontSize: '12px', fontWeight: 700,
                color: '#8A99AC', background: 'none',
                border: '1px solid #1E2D42', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              disabled={!s2Valid}
              onClick={() => setStep(3)}
              style={{
                padding: '8px 24px', fontSize: '12px', fontWeight: 700,
                color: s2Valid ? '#fff' : '#4D5E72',
                background: s2Valid ? '#2D8CFF' : '#1E2D42',
                border: 'none', cursor: s2Valid ? 'pointer' : 'not-allowed',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ──────────── Step 3: Review & Sign ──────────── */}
      {step === 3 && (
        <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '24px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '20px', letterSpacing: '-0.01em' }}>
            Review & Sign
          </h2>

          {/* Summary rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            <SummaryRow label="Release mode">
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '2px 9px', fontSize: '10px', fontWeight: 800,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: MODE_COLORS[s2.mode].color,
                background: MODE_COLORS[s2.mode].dim,
                border: `1px solid ${MODE_COLORS[s2.mode].border}`,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              }}>
                {s2.mode}
              </span>
            </SummaryRow>
            <SummaryRow label="Counterparty">
              <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '11px' }}>
                {s1.counterparty}
              </span>
            </SummaryRow>
            <SummaryRow label="Token">wSOL</SummaryRow>
            <SummaryRow label="Amount">
              <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontVariantNumeric: 'tabular-nums' }}>
                {s1.amount} SOL
              </span>
            </SummaryRow>
            <SummaryRow label={DEADLINE_LABELS[s2.mode]}>
              {unixToReadable(dateToUnixSecs(s2.deadline))}
            </SummaryRow>
            {s2.arbiter && (
              <SummaryRow label="Arbiter">
                <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '11px' }}>
                  {s2.arbiter}
                </span>
              </SummaryRow>
            )}
            {s2.deliverablesUri && (
              <SummaryRow label="Deliverables URI">
                <span style={{ fontSize: '11px', wordBreak: 'break-all' }}>{s2.deliverablesUri}</span>
              </SummaryRow>
            )}
            {s2.deliverablesHash && (
              <SummaryRow label="Deliverables hash">
                <span style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: '10px', wordBreak: 'break-all' }}>
                  {s2.deliverablesHash}
                </span>
              </SummaryRow>
            )}
            {(Number(s1.initiatorStake) > 0 || Number(s1.beneficiaryStake) > 0) && (
              <>
                <SummaryRow label="Initiator stake">{s1.initiatorStake || '0'} SOL</SummaryRow>
                <SummaryRow label="Beneficiary stake">{s1.beneficiaryStake || '0'} SOL</SummaryRow>
                <SummaryRow label="Slash loser stake">{s1.slashLoserStake ? 'Yes' : 'No'}</SummaryRow>
              </>
            )}
          </div>

          {/* SDK call preview */}
          <details style={{ marginTop: '20px' }}>
            <summary style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: '#4D5E72', cursor: 'pointer',
              listStyle: 'none', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M2 3L4 5L6 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              SDK call preview
            </summary>
            <pre style={{
              marginTop: '8px', padding: '14px', fontSize: '10px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              color: '#8A99AC', background: '#0D1117',
              border: '1px solid #1E2D42', overflow: 'auto',
              lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
{`client.escrow.createPact({
  counterparty: "${s1.counterparty}",
  mint: "${s1.mint}",
  amount: ${s1.amount || 0},
  releaseCondition: {
    kind: "${s2.mode}",
    timeLockExpiresAt: ${s2.deadline ? dateToUnixSecs(s2.deadline) : 0},
  },${s2.arbiter ? `\n  arbiter: "${s2.arbiter}",` : ''}${
  (Number(s1.initiatorStake) > 0 || Number(s1.beneficiaryStake) > 0) ? `\n  stakes: { initiator: ${s1.initiatorStake || 0}, beneficiary: ${s1.beneficiaryStake || 0} },` : ''}${
  s1.slashLoserStake ? '\n  slashLoserStake: true,' : ''}${
  s2.deliverablesUri ? `\n  deliverablesUri: "${s2.deliverablesUri}",` : ''}${
  s2.deliverablesHash ? `\n  deliverablesHash: "${s2.deliverablesHash}",` : ''}
});`}
            </pre>
          </details>

          {/* Nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                padding: '8px 24px', fontSize: '12px', fontWeight: 700,
                color: '#8A99AC', background: 'none',
                border: '1px solid #1E2D42', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              disabled={submitting}
              onClick={handleSubmit}
              style={{
                padding: '8px 28px', fontSize: '12px', fontWeight: 700,
                color: '#fff',
                background: submitting ? '#1E2D42' : '#22C55E',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                letterSpacing: '0.02em',
              }}
            >
              {submitting ? (
                <>
                  <span style={{
                    width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', borderRadius: '50%',
                    animation: 'vp-spin 0.6s linear infinite',
                  }} />
                  Creating…
                </>
              ) : (
                'Create pact'
              )}
            </button>
          </div>
        </div>
      )}

      {/* ──────────── Step 4: Pact Live ──────────── */}
      {step === 4 && pactResult && (
        <div style={{ background: '#141B27', border: '1px solid #1E2D42', padding: '24px' }}>

          {/* Success ring */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{
              width: '60px', height: '60px', borderRadius: '50%', margin: '0 auto 16px',
              background: 'rgba(34,197,94,0.1)', border: '2px solid rgba(34,197,94,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#22C55E', fontSize: '24px',
              animation: 'vp-ring-pulse 2.5s ease-in-out infinite',
            }}>
              ⚡
            </div>
            <h2 style={{
              fontSize: '20px', fontWeight: 800, color: '#E8EDF2',
              letterSpacing: '-0.02em', marginBottom: '8px',
            }}>
              Simulated pact preview ready
            </h2>
            <p style={{
              fontSize: '12px', color: '#8A99AC', lineHeight: 1.65,
              maxWidth: '380px', margin: '0 auto',
            }}>
              This preview shows the payload that would create a {pactResult.amount} SOL escrow on devnet.
              No funds were moved. A live flow will release when both parties fulfil the{' '}
              <span style={{ textTransform: 'capitalize' }}>{pactResult.mode}</span> conditions.
            </p>
          </div>

          {/* Pact details card */}
          <div style={{ background: '#0D1117', border: '1px solid #1E2D42', padding: '16px', marginBottom: '12px' }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={LABEL_STYLE}>Pact ID</span>
                <span style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: '#F59E0B', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                  padding: '2px 8px',
                }}>
                  Simulation
                </span>
              </div>
              <CopyRow value={pactResult.pactId} display={truncAddr(pactResult.pactId)} />
            </div>

            <div style={{ borderTop: '1px solid #1E2D42', paddingTop: '14px', marginBottom: '14px' }}>
              <div style={{ ...LABEL_STYLE, marginBottom: '8px' }}>Counterparty</div>
              <CopyRow value={pactResult.counterparty} display={pactResult.counterparty} />
            </div>

            <div style={{ borderTop: '1px solid #1E2D42', paddingTop: '14px' }}>
              <div style={{ ...LABEL_STYLE, marginBottom: '8px' }}>Escrow address</div>
              <CopyRow
                value={pactResult.escrowAddress}
                display={pactResult.escrowAddress}
              />
            </div>
          </div>

          {/* TX output */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <span
              style={{
                fontSize: '10px', color: '#4D5E72',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                letterSpacing: '0.02em',
              }}
            >
              Simulated signature: {pactResult.txSig}
            </span>
          </div>

          {/* CTAs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={() => router.push('/dashboard/escrow')}
              style={{
                width: '100%', padding: '12px 16px', fontSize: '12px', fontWeight: 600,
                color: '#fff', background: '#2D8CFF', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                textAlign: 'left', boxSizing: 'border-box',
              }}
            >
              <div>
                <div>View in Dashboard →</div>
                <div style={{ fontSize: '10px', fontWeight: 400, color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
                  Monitor escrow status and reputation
                </div>
              </div>
            </button>
            <button
              onClick={() => router.push('/docs/concepts/pact')}
              style={{
                width: '100%', padding: '12px 16px', fontSize: '12px', fontWeight: 600,
                color: '#E8EDF2', background: 'none', border: '1px solid #1E2D42',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', textAlign: 'left', boxSizing: 'border-box',
              }}
            >
              <div>
                <div>Integrate via SDK</div>
                <div style={{ fontSize: '10px', fontWeight: 400, color: '#4D5E72', marginTop: '2px' }}>
                  Auto-sign on task completion
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes vp-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes vp-ring-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
          50%       { box-shadow: 0 0 0 8px rgba(34,197,94,0.1); }
        }
      `}</style>
    </div>
  );
}

// ── Summary row ──────────────────────────────────────────────────────────────

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '10px 0',
      borderBottom: '1px solid #1E2D42',
    }}>
      <span style={{
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#4D5E72',
        flexShrink: 0, marginRight: '16px',
      }}>
        {label}
      </span>
      <span style={{ fontSize: '12px', color: '#E8EDF2', textAlign: 'right' }}>
        {children}
      </span>
    </div>
  );
}
