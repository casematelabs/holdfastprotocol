'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DisputePact {
  id: string;
  counterparty: string;
  amountSol: number;
  releaseCondition: string;
  createdAt: string;
  disputeDeadlineAt?: string;
  explorerTx: string;
}

interface DisputeModalProps {
  pact: DisputePact | null;
  onClose: () => void;
}

type Tab = 'overview' | 'evidence' | 'timeline';

interface EvidenceItem {
  id: string;
  name: string;
  fileType: 'pdf' | 'image' | 'text' | 'other';
  sizeKb: number;
  uploadedAt: string;
  uploader: 'you' | 'counterparty';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEVNET_EXPLORER = 'https://explorer.solana.com/tx';
const MONO = "'JetBrains Mono', 'Courier New', monospace";

const INITIAL_EVIDENCE: EvidenceItem[] = [
  {
    id: 'e1',
    name: 'delivery_confirmation.pdf',
    fileType: 'pdf',
    sizeKb: 142,
    uploadedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    uploader: 'counterparty',
  },
  {
    id: 'e2',
    name: 'original_agreement.txt',
    fileType: 'text',
    sizeKb: 8,
    uploadedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    uploader: 'you',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function phaseColor(state: 'complete' | 'active' | 'pending') {
  if (state === 'complete') return '#22C55E';
  if (state === 'active') return '#F59E0B';
  return '#2D3E52';
}

function fileTypeFromName(name: string): EvidenceItem['fileType'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['txt', 'md', 'json', 'csv'].includes(ext)) return 'text';
  return 'other';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FileTypeIcon({ type }: { type: EvidenceItem['fileType'] }) {
  if (type === 'pdf') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="#EF4444" strokeWidth="1.3" />
        <path d="M5 6h6M5 9h6M5 12h3" stroke="#EF4444" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'image') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="#2D8CFF" strokeWidth="1.3" />
        <circle cx="5.5" cy="6.5" r="1.2" stroke="#2D8CFF" strokeWidth="1.1" />
        <path d="M1.5 11l3.5-3.5 3 3 2.5-2.5 4 4" stroke="#2D8CFF" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'text') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="#8A99AC" strokeWidth="1.3" />
        <path d="M5 5.5h6M5 8.5h6M5 11.5h4" stroke="#8A99AC" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="#4D5E72" strokeWidth="1.3" />
      <path d="M5 6h6M5 9h4" stroke="#4D5E72" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DisputeModal({ pact, onClose }: DisputeModalProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [evidence, setEvidence] = useState<EvidenceItem[]>(INITIAL_EVIDENCE);
  const [dragOver, setDragOver] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!pact) return null;

  const phases: {
    id: string;
    label: string;
    description: string;
    state: 'complete' | 'active' | 'pending';
    date?: string;
  }[] = [
    {
      id: 'opened',
      label: 'Dispute Opened',
      description: 'On-chain dispute initiated. Both parties have been notified via wallet event.',
      state: 'complete',
      date: new Date(new Date(pact.createdAt).getTime() - 18 * 3600000).toISOString(),
    },
    {
      id: 'evidence',
      label: 'Evidence Period',
      description: '72-hour window for both parties to submit supporting evidence and context.',
      state: 'active',
      date: pact.disputeDeadlineAt,
    },
    {
      id: 'review',
      label: 'Arbitration Review',
      description: 'Oracle-selected panel of staked validators reviews all submitted evidence.',
      state: 'pending',
    },
    {
      id: 'resolution',
      label: 'Resolution',
      description: 'Final ruling recorded on-chain. Escrow released to winner or refunded.',
      state: 'pending',
    },
  ];

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  function addFiles(files: File[]) {
    const items: EvidenceItem[] = files.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      name: f.name,
      fileType: fileTypeFromName(f.name),
      sizeKb: Math.round(f.size / 1024) || 1,
      uploadedAt: new Date().toISOString(),
      uploader: 'you' as const,
    }));
    setEvidence(prev => [...prev, ...items]);
  }

  function removeEvidence(id: string) {
    setEvidence(prev => prev.filter(e => e.id !== id));
  }

  const detailRows = [
    { label: 'Counterparty', value: pact.counterparty, mono: true },
    { label: 'Escrow Amount', value: `${pact.amountSol} SOL`, mono: true },
    { label: 'Release Condition', value: pact.releaseCondition, mono: false },
    { label: 'Opened', value: formatDate(pact.createdAt), mono: true },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(2,6,23,0.78)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dispute Details"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'calc(100vw - 40px)',
          maxWidth: '640px',
          maxHeight: '90vh',
          background: '#141B27',
          border: '1px solid #1E2D42',
          boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #1E2D42',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: '#EF4444',
              animation: 'vp-pulse 1.2s ease-in-out infinite',
              display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em' }}>
              Dispute Details
            </span>
            <span style={{
              fontFamily: MONO, fontSize: '10px', color: '#4D5E72',
              background: '#0D1117', border: '1px solid #1E2D42', padding: '1px 8px',
            }}>
              {pact.id}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dispute modal"
            style={{
              background: 'none', border: 'none', color: '#4D5E72',
              cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1E2D42', flexShrink: 0 }}>
          {(['overview', 'evidence', 'timeline'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 20px',
                background: 'none', border: 'none',
                borderBottom: tab === t ? '2px solid #2D8CFF' : '2px solid transparent',
                color: tab === t ? '#E8EDF2' : '#4D5E72',
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase', cursor: 'pointer',
                transition: 'color 0.12s, border-color 0.12s',
                marginBottom: '-1px',
              }}
            >
              {t === 'overview' ? 'Overview'
                : t === 'evidence' ? `Evidence (${evidence.length})`
                : 'Timeline'}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {pact.disputeDeadlineAt && (
                <div style={{
                  background: 'rgba(245,158,11,0.06)',
                  border: '1px solid rgba(245,158,11,0.22)',
                  padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <circle cx="7" cy="7" r="5.5" stroke="#F59E0B" strokeWidth="1.2" />
                    <path d="M7 4V7.5" stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round" />
                    <circle cx="7" cy="9.5" r="0.65" fill="#F59E0B" />
                  </svg>
                  <span style={{ fontSize: '11px', color: '#8A99AC', flex: 1 }}>
                    Evidence window closes in
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, color: '#F59E0B' }}>
                    {formatCountdown(pact.disputeDeadlineAt)}
                  </span>
                </div>
              )}

              <div style={{
                background: '#0D1117', border: '1px solid #1E2D42',
                display: 'grid', gridTemplateColumns: '1fr 1fr',
              }}>
                {detailRows.map((row, idx) => (
                  <div
                    key={row.label}
                    style={{
                      padding: '12px 14px',
                      borderBottom: idx < detailRows.length - 2 ? '1px solid #1E2D42' : 'none',
                      borderRight: idx % 2 === 0 ? '1px solid #1E2D42' : 'none',
                    }}
                  >
                    <div style={{
                      fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: '#4D5E72', marginBottom: '5px',
                    }}>
                      {row.label}
                    </div>
                    <div style={{
                      fontSize: '12px', color: '#E8EDF2', lineHeight: 1.4,
                      fontFamily: row.mono ? MONO : 'inherit',
                    }}>
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: '#4D5E72', marginBottom: '8px',
                }}>
                  Stated Dispute Reason
                </div>
                <div style={{
                  background: 'rgba(239,68,68,0.04)',
                  border: '1px solid rgba(239,68,68,0.18)',
                  padding: '12px 14px',
                  fontSize: '12px', color: '#E8EDF2', lineHeight: 1.7,
                }}>
                  Deliverable not completed within the agreed timeframe. Release condition
                  requires task completion proof, but no verifiable proof-of-work was
                  submitted by the counterparty before the stated deadline.
                </div>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: '#0D1117', border: '1px solid #1E2D42',
              }}>
                <div>
                  <div style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: '#4D5E72', marginBottom: '4px',
                  }}>
                    On-Chain Transaction
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: '10px', color: '#8A99AC' }}>
                    {pact.explorerTx.length > 20
                      ? `${pact.explorerTx.slice(0, 8)}…${pact.explorerTx.slice(-8)}`
                      : pact.explorerTx}
                  </div>
                </div>
                <a
                  href={`${DEVNET_EXPLORER}/${pact.explorerTx}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em',
                    textTransform: 'uppercase', color: '#2D8CFF',
                    background: 'rgba(45,140,255,0.08)',
                    border: '1px solid rgba(45,140,255,0.18)',
                    padding: '3px 10px', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  View
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                    <path d="M1.5 6.5L6.5 1.5M4 1.5H6.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </div>

            </div>
          )}

          {/* ── EVIDENCE ──────────────────────────────────────────────────── */}
          {tab === 'evidence' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              <div>
                <div style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: '#4D5E72', marginBottom: '8px',
                }}>
                  Submit New Evidence
                </div>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload evidence files"
                  onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                  style={{
                    border: `1px dashed ${dragOver ? '#2D8CFF' : '#2D4060'}`,
                    background: dragOver ? 'rgba(45,140,255,0.05)' : 'rgba(13,17,23,0.4)',
                    padding: '30px 20px',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '8px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <path
                      d="M16 21V9M11 14L16 9L21 14"
                      stroke={dragOver ? '#2D8CFF' : '#4D5E72'}
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                    />
                    <rect x="4" y="22" width="24" height="7" rx="2"
                      stroke={dragOver ? '#2D8CFF' : '#4D5E72'} strokeWidth="1.8"
                    />
                  </svg>
                  <span style={{
                    fontSize: '12px', fontWeight: 500,
                    color: dragOver ? '#2D8CFF' : '#8A99AC',
                  }}>
                    {dragOver ? 'Drop files to upload' : 'Drag files here, or click to browse'}
                  </span>
                  <span style={{ fontSize: '10px', color: '#4D5E72' }}>
                    PDF · PNG · JPG · TXT · max 10 MB per file
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.json,.csv"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div>
                <div style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: '#4D5E72', marginBottom: '6px',
                }}>
                  Submission Note{' '}
                  <span style={{ fontWeight: 400, color: '#2D3E52', letterSpacing: '0' }}>optional</span>
                </div>
                <textarea
                  value={submitNote}
                  onChange={e => setSubmitNote(e.target.value)}
                  placeholder="Briefly describe the evidence and how it supports your position…"
                  rows={3}
                  style={{
                    width: '100%',
                    background: '#0D1117',
                    border: '1px solid #2D4060',
                    color: '#E8EDF2',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                    padding: '10px 12px',
                    resize: 'vertical',
                    outline: 'none',
                    lineHeight: 1.65,
                    boxSizing: 'border-box',
                    minHeight: '80px',
                  }}
                />
              </div>

              <div>
                <div style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', marginBottom: '8px',
                }}>
                  <div style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: '#4D5E72',
                  }}>
                    Submitted Evidence
                  </div>
                  <span style={{
                    fontFamily: MONO, fontSize: '10px', color: '#4D5E72',
                    background: '#0D1117', border: '1px solid #1E2D42', padding: '1px 7px',
                  }}>
                    {evidence.length}
                  </span>
                </div>

                {evidence.length === 0 ? (
                  <div style={{
                    padding: '24px', textAlign: 'center',
                    color: '#4D5E72', fontSize: '12px',
                    border: '1px solid #1E2D42',
                  }}>
                    No evidence submitted yet
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {evidence.map((item, idx) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 14px',
                          background: '#0D1117',
                          border: '1px solid #1E2D42',
                          borderTop: idx > 0 ? 'none' : undefined,
                        }}
                      >
                        <FileTypeIcon type={item.fileType} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: MONO, fontSize: '11px', color: '#E8EDF2',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {item.name}
                          </div>
                          <div style={{ fontSize: '10px', color: '#4D5E72', marginTop: '3px' }}>
                            {item.sizeKb} KB · {formatDate(item.uploadedAt)} · by{' '}
                            <span style={{ color: item.uploader === 'you' ? '#22C55E' : '#2D8CFF' }}>
                              {item.uploader === 'you' ? 'You' : 'Counterparty'}
                            </span>
                          </div>
                        </div>
                        {item.uploader === 'you' && (
                          <button
                            onClick={() => removeEvidence(item.id)}
                            aria-label={`Remove ${item.name}`}
                            style={{
                              background: 'none', border: 'none',
                              color: '#4D5E72', cursor: 'pointer',
                              fontSize: '15px', lineHeight: 1, padding: '2px 5px',
                              flexShrink: 0,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                style={{
                  width: '100%', padding: '12px',
                  background: '#10b981', border: 'none',
                  color: '#000', fontSize: '12px', fontWeight: 700,
                  letterSpacing: '0.04em', cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
              >
                Submit Evidence to Arbitration
              </button>

            </div>
          )}

          {/* ── TIMELINE ──────────────────────────────────────────────────── */}
          {tab === 'timeline' && (
            <div>
              <p style={{
                fontSize: '12px', color: '#8A99AC', lineHeight: 1.7, marginBottom: '24px',
              }}>
                The arbitration process follows a four-phase sequence. Each gate is
                enforced by the Holdfast oracle network and recorded on-chain.
              </p>

              {phases.map((phase, idx) => {
                const color = phaseColor(phase.state);
                const isLast = idx === phases.length - 1;
                return (
                  <div key={phase.id} style={{ display: 'flex', gap: '16px' }}>
                    <div style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', flexShrink: 0, width: '14px',
                    }}>
                      <div style={{
                        width: '14px', height: '14px', borderRadius: '50%',
                        background: phase.state === 'pending' ? 'transparent' : color,
                        border: `2px solid ${color}`,
                        boxShadow: phase.state === 'active' ? `0 0 10px ${color}50` : 'none',
                        animation: phase.state === 'active' ? 'vp-pulse 1.5s ease-in-out infinite' : 'none',
                        flexShrink: 0, marginTop: '3px',
                      }} />
                      {!isLast && (
                        <div style={{
                          width: '2px', flex: 1, minHeight: '32px',
                          background: phase.state === 'complete' ? '#22C55E40' : '#1E2D42',
                          marginTop: '4px', marginBottom: '4px',
                        }} />
                      )}
                    </div>

                    <div style={{ flex: 1, paddingBottom: isLast ? '0' : '24px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center',
                        gap: '10px', marginBottom: '5px', flexWrap: 'wrap',
                      }}>
                        <span style={{
                          fontSize: '13px', fontWeight: 700,
                          color, letterSpacing: '-0.01em',
                        }}>
                          {phase.label}
                        </span>
                        <span style={{
                          fontSize: '9px', fontWeight: 800, letterSpacing: '0.1em',
                          textTransform: 'uppercase', fontFamily: MONO,
                          color: phase.state === 'active' ? '#F59E0B'
                            : phase.state === 'complete' ? '#22C55E' : '#4D5E72',
                          background: phase.state === 'active' ? 'rgba(245,158,11,0.10)'
                            : phase.state === 'complete' ? 'rgba(34,197,94,0.08)' : '#0D1117',
                          border: `1px solid ${
                            phase.state === 'active' ? 'rgba(245,158,11,0.25)'
                            : phase.state === 'complete' ? 'rgba(34,197,94,0.2)' : '#1E2D42'
                          }`,
                          padding: '1px 7px',
                        }}>
                          {phase.state === 'active' ? 'In Progress'
                            : phase.state === 'complete' ? 'Complete'
                            : 'Pending'}
                        </span>
                      </div>
                      <p style={{
                        fontSize: '11px', color: '#8A99AC', lineHeight: 1.65,
                        marginBottom: phase.date ? '6px' : '0',
                      }}>
                        {phase.description}
                      </p>
                      {phase.date && (
                        <div style={{
                          fontFamily: MONO, fontSize: '10px',
                          color: phase.state === 'active' ? '#F59E0B' : '#4D5E72',
                        }}>
                          {phase.state === 'active'
                            ? `Closes ${formatDate(phase.date)} · ${formatCountdown(phase.date)} remaining`
                            : `Completed ${formatDate(phase.date)}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div style={{
                marginTop: '24px', padding: '12px 14px',
                background: 'rgba(45,140,255,0.04)',
                border: '1px solid rgba(45,140,255,0.15)',
                display: 'flex', gap: '10px', alignItems: 'flex-start',
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <circle cx="7" cy="7" r="5.5" stroke="#2D8CFF" strokeWidth="1.2" />
                  <path d="M7 6.5V10" stroke="#2D8CFF" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="7" cy="4.5" r="0.65" fill="#2D8CFF" />
                </svg>
                <p style={{ fontSize: '11px', color: '#8A99AC', lineHeight: 1.65 }}>
                  Arbitration is handled by the{' '}
                  <span style={{ color: '#2D8CFF' }}>Holdfast Oracle Network</span> — a
                  decentralized panel of staked validators. Decisions are binding and
                  recorded immutably on Solana devnet.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #1E2D42',
          padding: '12px 20px',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0, background: '#0D1117',
        }}>
          <div style={{ fontSize: '10px', color: '#4D5E72', fontFamily: MONO }}>
            <span style={{ color: '#EF4444' }}>● </span>
            Disputed
            {pact.disputeDeadlineAt && (
              <> · <span style={{ color: '#F59E0B' }}>{formatCountdown(pact.disputeDeadlineAt)}</span> remaining</>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '7px 20px',
              background: 'transparent',
              border: '1px solid #1E2D42',
              color: '#8A99AC', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer',
              transition: 'border-color 0.12s, color 0.12s',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
