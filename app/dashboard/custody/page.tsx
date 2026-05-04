'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchKeyRotations } from '../../../lib/indexer';
import { AlertBanner } from '../../components/AlertBanner';

// ── Types ────────────────────────────────────────────────────────────────────

type RegistrationState = 'registered' | 'unregistered' | 'revoked';
type AttestationType = 'hardware' | 'software';

interface CustodyData {
  registrationState: RegistrationState;
  attestationType: AttestationType;
  walletAddress: string;
  registrationTx: string;
  registrationSlot: number;
  registrationDate: string;
  revokedAt?: string;
  deregistrationDeadline?: string;
  teeProvider?: string;
  keyRotationCount: number;
  lastRotationDate?: string;
}


const DEVNET_EXPLORER_TX = 'https://explorer.solana.com/tx';
const DEVNET_EXPLORER_ADDR = 'https://explorer.solana.com/address';

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, n = 8) {
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}...${s.slice(-n)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Skel({ w, h, style }: { w?: string; h?: number; style?: React.CSSProperties }) {
  return <div className="vp-skel" style={{ width: w || '100%', height: h || 14, borderRadius: 2, ...style }} />;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      style={{
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: copied ? '#22C55E' : '#4D5E72',
        background: '#0D1117',
        border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : '#1E2D42'}`,
        padding: '2px 7px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        transition: 'color 0.1s, border-color 0.1s',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// ── Registration state badge ──────────────────────────────────────────────────

const REG_STATE_CONFIG: Record<RegistrationState, { label: string; color: string; dim: string; border: string; dotClass: string }> = {
  registered:   { label: 'Registered',   color: '#22C55E', dim: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.22)',   dotClass: 'ok' },
  unregistered: { label: 'Unregistered', color: '#F59E0B', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.22)',  dotClass: 'warn' },
  revoked:      { label: 'Revoked',      color: '#EF4444', dim: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.22)',   dotClass: 'crit' },
};

function RegistrationStatePill({ state }: { state: RegistrationState }) {
  const cfg = REG_STATE_CONFIG[state];
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 14px',
      fontSize: '13px',
      fontWeight: 900,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      lineHeight: 1,
      color: cfg.color,
      background: cfg.dim,
      border: `1px solid ${cfg.border}`,
    }}>
      <span style={{
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: cfg.color,
        flexShrink: 0,
        display: 'inline-block',
        animation: state === 'registered' ? 'vp-pulse 2s ease-in-out infinite' : 'none',
      }} />
      {cfg.label}
    </div>
  );
}

// ── Attestation display ───────────────────────────────────────────────────────

function AttestationBadge({ type, provider }: { type: AttestationType; provider?: string }) {
  const isHw = type === 'hardware';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isHw ? 'rgba(45,140,255,0.10)' : '#18202E',
        border: `1px solid ${isHw ? 'rgba(45,140,255,0.22)' : '#1E2D42'}`,
        fontSize: '20px',
      }}>
        {isHw ? '🔒' : '🔐'}
      </div>
      <div>
        <div style={{
          fontSize: '13px',
          fontWeight: 700,
          color: isHw ? '#2D8CFF' : '#8A99AC',
          marginBottom: '3px',
        }}>
          {isHw ? 'Hardware-Attested' : 'Software-Attested'}
        </div>
        {provider && (
          <div style={{ fontSize: '11px', color: '#4D5E72', marginBottom: '6px' }}>
            {provider}
          </div>
        )}
        <div style={{ fontSize: '11px', color: '#8A99AC', lineHeight: 1.55, maxWidth: '320px' }}>
          {isHw
            ? 'Hardware-backed P-256 key (TPM/TEE/FIDO2). Hardware backing is recognised but not enforced on devnet — full TPM/TEE attestation lands post-audit.'
            : 'Software-held P-256 key. This is the default attestation mode on devnet. Hardware-backed keys (TPM/TEE/FIDO2) are on the post-audit roadmap for production use.'}
        </div>
        {!isHw && (
          <div style={{
            marginTop: '8px',
            padding: '6px 10px',
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.2)',
            fontSize: '11px',
            color: '#F59E0B',
          }}>
            ⚠ Software attestation provides reduced security guarantees
          </div>
        )}
      </div>
    </div>
  );
}

// ── Key rotation section ──────────────────────────────────────────────────────

function KeyRotationSection({ count, lastDate, walletAddress }: {
  count: number;
  lastDate?: string;
  walletAddress: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div>
          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '3px' }}>
            Rotation Count
          </div>
          <span style={{
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontSize: '18px',
            color: '#E8EDF2',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {count}
          </span>
        </div>
        {lastDate && (
          <div>
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '3px' }}>
              Last Rotation
            </div>
            <span style={{ fontSize: '12px', color: '#8A99AC' }}>
              {formatDate(lastDate)}
            </span>
          </div>
        )}
      </div>

      <div style={{
        padding: '10px 14px',
        background: 'rgba(45,140,255,0.05)',
        border: '1px solid rgba(45,140,255,0.15)',
        fontSize: '11px',
        color: '#8A99AC',
        lineHeight: 1.55,
      }}>
        Key rotation re-registers the wallet with a fresh secp256r1 keypair on-chain.
        Existing pacts remain valid; new pacts use the rotated key.
      </div>

      {confirming ? (
        <div style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.22)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ fontSize: '12px', color: '#EF4444', fontWeight: 700 }}>
            Confirm Key Rotation
          </div>
          <p style={{ fontSize: '11px', color: '#8A99AC', lineHeight: 1.55 }}>
            This action cannot be undone on devnet without a new on-chain transaction.
            Active pacts for <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}>{truncate(walletAddress)}</span> will not be affected.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setConfirming(false)}
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.22)',
                color: '#EF4444',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '7px 14px',
                cursor: 'pointer',
              }}
            >
              Initiate Rotation
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                background: 'transparent',
                border: '1px solid #1E2D42',
                color: '#8A99AC',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '7px 14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          style={{
            background: 'transparent',
            border: '1px solid #1E2D42',
            color: '#8A99AC',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '7px 14px',
            cursor: 'pointer',
            width: 'fit-content',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6C2 3.79 3.79 2 6 2C7.5 2 8.82 2.79 9.55 3.99" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M10 6C10 8.21 8.21 10 6 10C4.5 10 3.18 9.21 2.45 8.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M9 2L9.5 4H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 10L2.5 8H4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Initiate Key Rotation
        </button>
      )}
    </div>
  );
}

// ── Address row ───────────────────────────────────────────────────────────────

function AddressRow({ label, value, explorerBase }: { label: string; value: string; explorerBase: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '9px 14px',
      borderBottom: '1px solid #1E2D42',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>
          {label}
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontSize: '10px',
          color: '#8A99AC',
          wordBreak: 'break-all',
        }}>
          {value}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <CopyButton value={value} />
        <a
          href={`${explorerBase}/${value}?cluster=devnet`}
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
          Explorer
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 6.5L6.5 1.5M4 1.5H6.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function CustodyPage() {
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustodyData | null>(null);
  const [txExpanded, setTxExpanded] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    fetchKeyRotations(publicKey.toBase58())
      .then(res => {
        setData({
          registrationState: res.wallet.registrationState,
          attestationType: res.wallet.attestationType,
          walletAddress: res.wallet.address,
          registrationTx: res.wallet.registrationTx,
          registrationSlot: res.wallet.registrationSlot,
          registrationDate: res.wallet.registrationDate,
          teeProvider: res.wallet.teeProvider ?? undefined,
          revokedAt: res.wallet.revokedAt ?? undefined,
          deregistrationDeadline: res.wallet.deregistrationDeadline ?? undefined,
          keyRotationCount: res.rotationCount,
          lastRotationDate: res.rotations[0]?.timestamp,
        });
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load custody data'))
      .finally(() => setLoading(false));
  }, [publicKey]);

  const regCfg = data ? REG_STATE_CONFIG[data.registrationState] : null;

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '4px' }}>
          Custody
        </h1>
        <p style={{ fontSize: '12px', color: '#8A99AC', lineHeight: 1.6 }}>
          Wallet registration status and hardware attestation for this agent identity.
        </p>
      </div>

      {error && <AlertBanner type="danger" message={error} />}

      {!loading && data && data.registrationState !== 'registered' && (
        <AlertBanner
          type={data.registrationState === 'revoked' ? 'danger' : 'warning'}
          title={data.registrationState === 'unregistered' ? 'Wallet Not Registered' : 'Registration Revoked'}
          message={data.registrationState === 'unregistered'
            ? 'This agent cannot participate in Holdfast Protocol escrow or reputation scoring until its wallet is registered on-chain.'
            : "This agent's wallet registration was revoked. Existing pacts are frozen pending protocol resolution."}
        />
      )}

      {/* Main layout: custody grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        border: '1px solid #1E2D42',
        marginBottom: '20px',
      }}>

        {/* Left: wallet registration card */}
        <div style={{ borderRight: '1px solid #1E2D42' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderBottom: '1px solid #1E2D42',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A99AC' }}>
                Wallet Registration
              </span>
            </div>
            {!loading && data && (
              <span style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '9px',
                color: '#4D5E72',
                background: '#0D1117',
                border: '1px solid #1E2D42',
                padding: '1px 6px',
                letterSpacing: '0.05em',
              }}>
                SLOT {data.registrationSlot.toLocaleString()}
              </span>
            )}
          </div>

          <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loading ? (
              <>
                <Skel w="140px" h={28} />
                <Skel w="220px" h={12} />
                <Skel w="180px" h={12} />
              </>
            ) : data ? (
              <>
                <RegistrationStatePill state={data.registrationState} />

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '32px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>
                      Registered
                    </span>
                    <span style={{ fontSize: '12px', color: '#8A99AC' }}>
                      {formatDate(data.registrationDate)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72' }}>
                      Wallet
                    </span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                      fontSize: '11px',
                      color: '#8A99AC',
                    }}>
                      {truncate(data.walletAddress)}
                    </span>
                  </div>
                </div>

                {data.registrationState === 'registered' && (
                  <a
                    href={`${DEVNET_EXPLORER_TX}/${data.registrationTx}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                      fontSize: '11px',
                      color: '#2D8CFF',
                      textDecoration: 'none',
                      width: 'fit-content',
                    }}
                  >
                    {truncate(data.registrationTx, 10)}
                    <span style={{ fontSize: '9px', color: '#4D5E72' }}>↗</span>
                  </a>
                )}
              </>
            ) : null}
          </div>

          {/* Expandable txn detail */}
          {!loading && data && (
            <div>
              <button
                onClick={() => setTxExpanded(o => !o)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '9px 14px',
                  background: '#0D1117',
                  border: 'none',
                  borderTop: '1px solid #1E2D42',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: '#4D5E72',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  style={{ transform: txExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
                >
                  <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                On-chain addresses
              </button>

              {txExpanded && (
                <div style={{ borderTop: '1px solid #1E2D42' }}>
                  <AddressRow
                    label="Wallet Address"
                    value={data.walletAddress}
                    explorerBase={DEVNET_EXPLORER_ADDR}
                  />
                  <div style={{ padding: '9px 14px' }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '2px' }}>
                      Registration Tx
                    </div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                      fontSize: '10px',
                      color: '#8A99AC',
                      wordBreak: 'break-all',
                      marginBottom: '6px',
                    }}>
                      {data.registrationTx}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <CopyButton value={data.registrationTx} />
                      <a
                        href={`${DEVNET_EXPLORER_TX}/${data.registrationTx}?cluster=devnet`}
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
                        }}
                      >
                        Explorer ↗
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: attestation + key rotation */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>

          {/* Attestation type */}
          <div style={{ flex: 'none', borderBottom: '1px solid #1E2D42' }}>
            <div style={{
              padding: '12px 18px',
              borderBottom: '1px solid #1E2D42',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8A99AC',
            }}>
              Attestation
            </div>
            <div style={{ padding: '16px 18px' }}>
              {loading ? (
                <>
                  <Skel w="200px" h={14} style={{ marginBottom: '8px' }} />
                  <Skel w="160px" h={10} />
                </>
              ) : data ? (
                <AttestationBadge type={data.attestationType} provider={data.teeProvider} />
              ) : null}
            </div>
          </div>

          {/* Key rotation */}
          <div style={{ flex: 1 }}>
            <div style={{
              padding: '12px 18px',
              borderBottom: '1px solid #1E2D42',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8A99AC',
            }}>
              Key Rotation
            </div>
            <div style={{ padding: '16px 18px' }}>
              {loading ? (
                <>
                  <Skel w="120px" h={20} style={{ marginBottom: '10px' }} />
                  <Skel w="100%" h={10} style={{ marginBottom: '6px' }} />
                  <Skel w="80%" h={10} />
                </>
              ) : data ? (
                <KeyRotationSection
                  count={data.keyRotationCount}
                  lastDate={data.lastRotationDate}
                  walletAddress={data.walletAddress}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile fallback note */}
      <div style={{
        padding: '12px 16px',
        background: '#141B27',
        border: '1px solid #1E2D42',
        fontSize: '11px',
        color: '#4D5E72',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M6 4V6.5M6 8H6.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        Mobile layout is not supported in this release. Use a desktop browser for the full dashboard experience.
      </div>
    </div>
  );
}
