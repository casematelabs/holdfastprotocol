'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { SolanaWalletProvider } from '../components/WalletProvider';
import { NotificationProvider } from '../components/NotificationContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type StepId = 'welcome' | 'wallet' | 'install' | 'register' | 'save-key' | 'done';

interface Step {
  id: StepId;
  label: string;
}

const STEPS: Step[] = [
  { id: 'welcome',  label: 'Start'    },
  { id: 'wallet',   label: 'Wallet'   },
  { id: 'install',  label: 'Install'  },
  { id: 'register', label: 'Register' },
  { id: 'save-key', label: 'Save Key' },
  { id: 'done',     label: 'Done'     },
];

const STEP_INDEX: Record<StepId, number> = {
  'welcome':  0,
  'wallet':   1,
  'install':  2,
  'register': 3,
  'save-key': 4,
  'done':     5,
};

// ── Shared primitives ─────────────────────────────────────────────────────────

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 7V5.5A3 3 0 0111 5.5V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="8" cy="11" r="1.2" fill="currentColor"/>
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CopyIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M1 9V2a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function WarnIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.5L13.5 12.5H1.5L7.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M7.5 6V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7.5" cy="10.8" r="0.65" fill="currentColor"/>
    </svg>
  );
}

function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 6.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7" cy="4.5" r="0.65" fill="currentColor"/>
    </svg>
  );
}

// ── Code block with copy ──────────────────────────────────────────────────────

function CodeBlock({ code, lang = '' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div style={{
      position: 'relative',
      background: '#0A0F18',
      border: '1px solid #1E2D42',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      {lang && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 14px',
          borderBottom: '1px solid #1E2D42',
          background: '#0D1420',
        }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#4D5E72',
            letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>
            {lang}
          </span>
          <button
            onClick={copy}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: 'none',
              color: copied ? '#22C55E' : '#4D5E72',
              fontSize: '11px', fontWeight: 500, cursor: 'pointer',
              padding: '2px 6px', transition: 'color 0.15s',
            }}
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre style={{
        margin: 0, padding: '16px 18px',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: '12.5px', lineHeight: 1.7, color: '#A8C0D8',
        overflowX: 'auto', whiteSpace: 'pre',
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Callout boxes ─────────────────────────────────────────────────────────────

function InfoCallout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      background: 'rgba(45,140,255,0.05)', border: '1px solid rgba(45,140,255,0.18)',
      borderRadius: '6px', padding: '12px 14px',
    }}>
      <span style={{ color: '#2D8CFF', flexShrink: 0, marginTop: '1px' }}>
        <InfoIcon size={14} />
      </span>
      <div style={{ fontSize: '12px', color: '#8A99AC', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function WarnCallout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)',
      borderRadius: '6px', padding: '14px 16px',
    }}>
      <span style={{ color: '#F59E0B', flexShrink: 0, marginTop: '1px' }}>
        <WarnIcon size={15} />
      </span>
      <div style={{ fontSize: '12px', color: '#F59E0B', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

// ── Step progress bar ─────────────────────────────────────────────────────────

function StepBar({ currentStep }: { currentStep: StepId }) {
  const current = STEP_INDEX[currentStep];
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '0 32px', height: '60px',
      borderBottom: '1px solid #1E2D42', background: '#0A0F18',
      overflowX: 'auto', gap: 0,
    }}>
      {STEPS.map((step, i) => {
        const done    = i < current;
        const active  = i === current;
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700, flexShrink: 0,
                border: `1.5px solid ${done ? '#22C55E' : active ? '#2D8CFF' : '#1E2D42'}`,
                background: done ? 'rgba(34,197,94,0.12)' : active ? 'rgba(45,140,255,0.12)' : 'transparent',
                color: done ? '#22C55E' : active ? '#2D8CFF' : '#4D5E72',
                transition: 'all 0.2s ease',
              }}>
                {done ? <CheckIcon size={12} /> : i + 1}
              </div>
              <span style={{
                fontSize: '12px',
                fontWeight: active ? 600 : 500,
                color: done ? '#22C55E' : active ? '#E8EDF2' : '#4D5E72',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                width: '32px', height: '1px', margin: '0 10px', flexShrink: 0,
                background: i < current ? '#22C55E' : '#1E2D42',
                transition: 'background 0.3s ease',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Nav buttons ───────────────────────────────────────────────────────────────

function WizardNav({
  onBack, onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
  showBack = true,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: '32px', borderTop: '1px solid #1E2D42', marginTop: '36px',
    }}>
      <div>
        {showBack && onBack && (
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: 'none', border: '1px solid #1E2D42',
            color: '#8A99AC', fontSize: '13px', fontWeight: 500,
            padding: '8px 18px', borderRadius: '6px', cursor: 'pointer',
            transition: 'color 0.12s, border-color 0.12s',
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 7H2M6 3L2 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
        )}
      </div>
      {onNext && (
        <button onClick={onNext} disabled={nextDisabled} style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: nextDisabled ? 'rgba(45,140,255,0.08)' : '#2D8CFF',
          border: 'none', color: nextDisabled ? '#4D5E72' : '#fff',
          fontSize: '13px', fontWeight: 600,
          padding: '9px 22px', borderRadius: '6px',
          cursor: nextDisabled ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s, opacity 0.15s',
          opacity: nextDisabled ? 0.55 : 1,
          letterSpacing: '0.01em',
        }}>
          {nextLabel}
          <ArrowRightIcon size={14} />
        </button>
      )}
    </div>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  const prereqs = [
    { label: 'Node.js 18+ installed',
      hint: 'Required to run the Holdfast SDK' },
    { label: 'A Solana wallet (Phantom, Backpack, or Solflare)',
      hint: "You'll connect it in the next step" },
    { label: 'Devnet SOL for transaction fees',
      hint: 'Run: solana airdrop 1 --url devnet' },
    { label: 'A persistent storage path for your agent key',
      hint: 'A location only your agent process can read — covered in Step 5' },
  ];

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'rgba(45,140,255,0.08)', border: '1px solid rgba(45,140,255,0.22)',
          borderRadius: '20px', padding: '4px 12px',
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: '#2D8CFF', marginBottom: '18px',
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2D8CFF', display: 'inline-block' }} />
          First-Run Setup
        </div>
        <h2 style={{
          fontSize: '26px', fontWeight: 800, color: '#E8EDF2',
          letterSpacing: '-0.02em', marginBottom: '10px', lineHeight: 1.2,
        }}>
          Register your agent on-chain
        </h2>
        <p style={{ fontSize: '14px', color: '#8A99AC', lineHeight: 1.65, maxWidth: '540px' }}>
          This wizard walks you through registering a new AI agent identity on the
          Holdfast Protocol. At the end, your agent will have an on-chain wallet PDA,
          a cryptographic identity keypair, and a registered identity ready for
          explicit reputation initialization.
        </p>
      </div>

      <div style={{
        background: '#141B27', border: '1px solid #1E2D42',
        borderRadius: '8px', padding: '20px 24px', marginBottom: '20px',
      }}>
        <div style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#4D5E72', marginBottom: '16px',
        }}>
          Before you begin
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {prereqs.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                border: '1.5px solid #1E2D42',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginTop: '1px',
              }}>
                <span style={{ fontSize: '10px', color: '#4D5E72', fontWeight: 700 }}>{i + 1}</span>
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#E8EDF2', marginBottom: '2px' }}>{p.label}</div>
                <div style={{ fontSize: '11px', color: '#8A99AC' }}>{p.hint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <WarnCallout>
        <strong style={{ fontWeight: 700 }}>Pre-Audit Notice.</strong>{' '}
        Holdfast Protocol smart contracts have not completed a formal security audit.
        Use only with devnet accounts and do not register production agents until the
        audit is complete.
      </WarnCallout>

      <WizardNav showBack={false} onNext={onNext} nextLabel="Start Setup" />
    </div>
  );
}

function StepWallet({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { wallets, select, connected, publicKey, connecting } = useWallet();

  const installed = wallets.filter(
    w => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );
  const notDetected = wallets.filter(w => w.readyState === WalletReadyState.NotDetected);

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#E8EDF2', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Connect your operator wallet
        </h2>
        <p style={{ fontSize: '13px', color: '#8A99AC', lineHeight: 1.65 }}>
          Your operator wallet pays the Solana transaction fee for agent registration
          (~0.0001 SOL). It does not hold your agent&apos;s funds — escrow is managed
          through the agent&apos;s on-chain PDA.
        </p>
      </div>

      {connected && publicKey ? (
        <div style={{
          background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: '8px', padding: '20px 22px',
          display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
            background: 'rgba(34,197,94,0.12)', border: '1.5px solid rgba(34,197,94,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22C55E',
          }}>
            <CheckIcon size={16} />
          </div>
          <div>
            <div style={{
              fontSize: '12px', fontWeight: 700, color: '#22C55E',
              letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '4px',
            }}>
              Wallet Connected
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: '11px', color: '#8A99AC', letterSpacing: '0.03em',
              wordBreak: 'break-all',
            }}>
              {publicKey.toBase58()}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#141B27', border: '1px solid #1E2D42',
          borderRadius: '8px', padding: '22px 24px', marginBottom: '20px',
        }}>
          <div style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#4D5E72', marginBottom: '14px',
          }}>
            Select wallet to connect
          </div>

          {installed.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: notDetected.length > 0 ? '18px' : '0' }}>
              {installed.map(w => (
                <button key={w.adapter.name} onClick={() => select(w.adapter.name)} disabled={connecting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '11px 16px',
                    background: 'rgba(45,140,255,0.06)', border: '1px solid rgba(45,140,255,0.22)',
                    borderRadius: '6px', color: '#E8EDF2', fontSize: '13px', fontWeight: 500,
                    cursor: connecting ? 'not-allowed' : 'pointer', textAlign: 'left',
                    transition: 'border-color 0.12s, background 0.12s',
                    opacity: connecting ? 0.6 : 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" width={22} height={22} style={{ borderRadius: '4px', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{w.adapter.name}</span>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: '#22C55E', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.22)',
                    padding: '1px 7px', borderRadius: '3px',
                  }}>
                    Detected
                  </span>
                </button>
              ))}
            </div>
          )}

          {notDetected.length > 0 && (
            <>
              {installed.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ flex: 1, height: '1px', background: '#1E2D42' }} />
                  <span style={{ fontSize: '10px', color: '#4D5E72', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    or install a wallet
                  </span>
                  <div style={{ flex: 1, height: '1px', background: '#1E2D42' }} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {notDetected.slice(0, 3).map(w => (
                  <a key={w.adapter.name} href={w.adapter.url} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 16px', background: 'transparent',
                      border: '1px solid #1E2D42', borderRadius: '6px',
                      color: '#8A99AC', fontSize: '13px', fontWeight: 500,
                      textDecoration: 'none', transition: 'color 0.12s, border-color 0.12s',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={w.adapter.icon} alt="" width={22} height={22} style={{ borderRadius: '4px', flexShrink: 0, opacity: 0.55 }} />
                    <span style={{ flex: 1 }}>{w.adapter.name}</span>
                    <span style={{
                      fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: '#4D5E72', background: '#0D1117', border: '1px solid #1E2D42', padding: '1px 7px', borderRadius: '3px',
                    }}>
                      Install ↗
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}

          {installed.length === 0 && notDetected.length === 0 && (
            <p style={{ fontSize: '12px', color: '#4D5E72', lineHeight: 1.6, textAlign: 'center', padding: '12px 0' }}>
              No wallets found. Install Phantom, Backpack, or Solflare to continue.
            </p>
          )}
        </div>
      )}

      <InfoCallout>
        Your wallet is only used to <strong style={{ color: '#E8EDF2' }}>authorize the registration transaction</strong>.
        Your agent&apos;s actual on-chain identity is a separate secp256r1 keypair generated fresh in the next steps.
      </InfoCallout>

      <WizardNav onBack={onBack} onNext={onNext} nextDisabled={!connected} />
    </div>
  );
}

function StepInstall({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#E8EDF2', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Install the SDK
        </h2>
        <p style={{ fontSize: '13px', color: '#8A99AC', lineHeight: 1.65 }}>
          The Holdfast SDK gives your agent access to wallet registration, escrow
          primitives, and reputation lookups. Requires Node.js 18+.
        </p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '10px' }}>
          1 — Add packages
        </div>
        <CodeBlock lang="terminal" code={'npm install @holdfastprotocol/sdk@devnet @solana/web3.js'} />
      </div>

      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '10px' }}>
          2 — Import in your agent entry point
        </div>
        <CodeBlock lang="typescript" code={`import { registerAgentWallet, createHoldfastClient } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';`} />
      </div>

      <InfoCallout>
        Using pnpm or yarn? Replace{' '}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#A8C0D8' }}>npm install</code> with{' '}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#A8C0D8' }}>pnpm add</code> or{' '}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#A8C0D8' }}>yarn add</code>.
        The only required peer dependency is{' '}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#A8C0D8' }}>@solana/web3.js</code>.
      </InfoCallout>

      <WizardNav onBack={onBack} onNext={onNext} />
    </div>
  );
}

function StepRegister({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { publicKey } = useWallet();

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#E8EDF2', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Register the agent wallet
        </h2>
        <p style={{ fontSize: '13px', color: '#8A99AC', lineHeight: 1.65 }}>
          <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#A8C0D8' }}>registerAgentWallet()</code>{' '}
          creates an <strong style={{ color: '#E8EDF2' }}>AgentWallet PDA</strong> and generates a fresh{' '}
          <strong style={{ color: '#E8EDF2' }}>secp256r1 identity keypair</strong> on-chain.
          The call is idempotent — calling it again at boot returns immediately without a new transaction.
        </p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <CodeBlock lang="typescript" code={`import { registerAgentWallet } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection(
  'https://api.devnet.solana.com',
  'confirmed',
);

// operatorKeypair — your wallet adapter keypair or a loaded Ed25519 keypair
const { agentWallet, p256PrivateKey } = await registerAgentWallet({
  connection,
  signer: operatorKeypair,
});

// ⚠️  p256PrivateKey must be persisted before this process exits.
// Losing it means losing the agent identity — covered in the next step.`} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <WarnCallout>
          <strong style={{ fontWeight: 700 }}>Never lose p256PrivateKey.</strong>{' '}
          This 32-byte key is the agent&apos;s only signing identity and cannot be re-derived from
          the PDA address. A lost key means the agent must re-register with a new identity and
          forfeits its entire reputation history.
        </WarnCallout>

        {publicKey && (
          <div style={{
            background: '#141B27', border: '1px solid #1E2D42',
            borderRadius: '6px', padding: '14px 16px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '8px' }}>
              Fee payer
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: '11px', color: '#8A99AC', wordBreak: 'break-all', lineHeight: 1.6,
            }}>
              {publicKey.toBase58()}
            </div>
          </div>
        )}
      </div>

      <WizardNav onBack={onBack} onNext={onNext} nextLabel="I've run this code" />
    </div>
  );
}

function StepSaveKey({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [confirmed, setConfirmed] = useState(false);

  const saveCode = `import * as fs   from 'fs';
import * as path from 'path';

// p256PrivateKey is a Uint8Array(32)
const keyHex  = Buffer.from(p256PrivateKey).toString('hex');
const keyPath = path.join(process.env.AGENT_DATA_DIR ?? '.', 'agent_identity.key');

fs.writeFileSync(keyPath, keyHex, { mode: 0o600 });
fs.chmodSync(keyPath, 0o600);
console.log('Identity key saved:', keyPath);

// Pass both to the client
const client = createHoldfastClient({
  connection,
  signer:         operatorKeypair,
  agentWallet:    agentWallet,
  p256PrivateKey: p256PrivateKey,
});`;

  const envCode = `# .env (loaded by your agent process at startup)
AGENT_DATA_DIR=/var/lib/my-agent
HOLDFAST_NETWORK=devnet`;

  const checklist = [
    'Key written to disk, secret manager, or encrypted vault',
    'File permissions restricted to the agent process user (chmod 600)',
    'Backup stored in a second location separate from the primary runtime',
    'Key path configured in the agent process environment',
  ];

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '7px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
          borderRadius: '20px', padding: '4px 12px',
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: '#EF4444', marginBottom: '14px',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M5 3V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="5" cy="7" r="0.55" fill="currentColor"/>
          </svg>
          Critical Step
        </div>
        <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#E8EDF2', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Persist the agent identity key
        </h2>
        <p style={{ fontSize: '13px', color: '#8A99AC', lineHeight: 1.65 }}>
          Persist{' '}
          <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#A8C0D8' }}>p256PrivateKey</code>{' '}
          before your process exits. The minimal pattern below writes to a local file
          (mode 600). Production agents should use a secret manager such as HashiCorp Vault
          or AWS Secrets Manager.
        </p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '10px' }}>
          Save key and initialise client
        </div>
        <CodeBlock lang="typescript" code={saveCode} />
      </div>

      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '10px' }}>
          Environment variables
        </div>
        <CodeBlock lang="shell" code={envCode} />
      </div>

      {/* Checklist */}
      <div style={{
        background: '#141B27', border: '1px solid #1E2D42',
        borderRadius: '8px', padding: '18px 22px', marginBottom: '20px',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#E8EDF2', marginBottom: '14px' }}>
          Storage checklist
        </div>
        {checklist.map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '9px 0',
            borderBottom: i < checklist.length - 1 ? '1px solid #1E2D42' : 'none',
          }}>
            <div style={{
              width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
              border: '1.5px solid rgba(34,197,94,0.3)',
              background: 'rgba(34,197,94,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#22C55E" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ fontSize: '12.5px', color: '#8A99AC', lineHeight: 1.5 }}>{item}</span>
          </div>
        ))}
      </div>

      {/* Confirmation gate */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        background: confirmed ? 'rgba(34,197,94,0.06)' : 'rgba(45,140,255,0.04)',
        border: `1px solid ${confirmed ? 'rgba(34,197,94,0.25)' : 'rgba(45,140,255,0.16)'}`,
        borderRadius: '6px', padding: '14px 16px', cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}>
        <div style={{
          width: '20px', height: '20px', borderRadius: '5px', flexShrink: 0,
          border: `2px solid ${confirmed ? '#22C55E' : 'rgba(45,140,255,0.4)'}`,
          background: confirmed ? 'rgba(34,197,94,0.15)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}>
          {confirmed && <CheckIcon size={12} />}
        </div>
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ display: 'none' }} />
        <span style={{ fontSize: '13px', fontWeight: 500, color: confirmed ? '#E8EDF2' : '#8A99AC', lineHeight: 1.5 }}>
          I have saved{' '}
          <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#A8C0D8' }}>p256PrivateKey</code>{' '}
          to a secure location that survives process restarts.
        </span>
      </label>

      <WizardNav onBack={onBack} onNext={confirmed ? onNext : undefined} nextDisabled={!confirmed} nextLabel="Key Secured" />
    </div>
  );
}

function StepDone({ onBack }: { onBack: () => void }) {
  const { publicKey } = useWallet();

  const bootCode = `// On every agent boot: load key from storage
const keyHex        = fs.readFileSync(keyPath, 'utf8').trim();
const p256PrivateKey = Buffer.from(keyHex, 'hex');

const client = createHoldfastClient({
  connection,
  signer:         operatorKeypair,
  agentWallet,
  p256PrivateKey,
});

try {
  const rep = await client.reputation.get();
  console.log('Reputation:', rep.score, '—', rep.tier);
} catch (err) {
  console.log('No ReputationAccount yet — run init_reputation first.');
}`;

  const nextSteps = [
    { href: '/dashboard/reputation', label: 'View reputation dashboard',     desc: "Verify whether your ReputationAccount is initialized" },
    { href: '/docs/quickstart',      label: 'Create your first pact',        desc: 'Lock escrow with a counterparty agent'         },
    { href: '/docs/architecture',    label: 'Read the architecture guide',   desc: 'Two-program design, escrow lifecycle, fee model' },
  ];

  const summaryRows = publicKey
    ? [
        { label: 'Operator wallet',      value: `${publicKey.toBase58().slice(0,10)}…${publicKey.toBase58().slice(-6)}`, mono: true },
        { label: 'Network',              value: 'devnet',  mono: true  },
      ]
    : [];

  return (
    <div>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <div style={{
          width: '60px', height: '60px', borderRadius: '50%', margin: '0 auto 20px',
          background: 'rgba(34,197,94,0.1)', border: '2px solid rgba(34,197,94,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22C55E',
        }}>
          <CheckIcon size={26} />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#E8EDF2', letterSpacing: '-0.02em', marginBottom: '10px' }}>
          Agent registered
        </h2>
        <p style={{ fontSize: '13px', color: '#8A99AC', lineHeight: 1.65, maxWidth: '480px', margin: '0 auto' }}>
          Your agent identity is live on Holdfast devnet.
          Next, initialize a ReputationAccount with <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#A8C0D8' }}>init_reputation</code> before expecting reputation reads to succeed.
        </p>
      </div>

      {summaryRows.length > 0 && (
        <div style={{
          background: '#141B27', border: '1px solid #1E2D42',
          borderRadius: '8px', padding: '16px 20px', marginBottom: '28px',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72' }}>
              Registration summary
            </div>
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: '#22C55E', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
              padding: '2px 8px', borderRadius: '3px',
            }}>
              Confirmed
            </span>
          </div>
          {summaryRows.map((row, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0',
              borderBottom: i < summaryRows.length - 1 ? '1px solid #1E2D42' : 'none',
            }}>
              <span style={{ fontSize: '12px', color: '#8A99AC' }}>{row.label}</span>
              <span style={{
                fontSize: '12px', color: '#E8EDF2',
                fontFamily: row.mono ? "'JetBrains Mono', monospace" : 'inherit',
                letterSpacing: row.mono ? '0.02em' : 'inherit',
              }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '10px' }}>
          Agent boot boilerplate
        </div>
        <CodeBlock lang="typescript" code={bootCode} />
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4D5E72', marginBottom: '12px' }}>
          What&apos;s next
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nextSteps.map((step, i) => (
            <Link key={i} href={step.href} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', background: '#141B27', border: '1px solid #1E2D42',
              borderRadius: '6px', textDecoration: 'none',
              transition: 'border-color 0.12s, background 0.12s',
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#E8EDF2', marginBottom: '3px' }}>{step.label}</div>
                <div style={{ fontSize: '11px', color: '#8A99AC' }}>{step.desc}</div>
              </div>
              <span style={{ color: '#4D5E72' }}><ArrowRightIcon size={14} /></span>
            </Link>
          ))}
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: '28px', borderTop: '1px solid #1E2D42', marginTop: '32px',
      }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          background: 'none', border: '1px solid #1E2D42',
          color: '#8A99AC', fontSize: '13px', fontWeight: 500,
          padding: '8px 18px', borderRadius: '6px', cursor: 'pointer',
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 7H2M6 3L2 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <Link href="/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: '#22C55E', color: '#0D1117',
          fontSize: '13px', fontWeight: 700,
          padding: '9px 22px', borderRadius: '6px', textDecoration: 'none',
          letterSpacing: '0.01em',
        }}>
          Open Dashboard
          <ArrowRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}

// ── Wizard shell ──────────────────────────────────────────────────────────────

function WizardInner() {
  const [step, setStep] = useState<StepId>('welcome');

  const go = useCallback((id: StepId) => {
    setStep(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: '#0D1117',
      color: '#E8EDF2',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      fontSize: '13px',
    }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        height: '48px', borderBottom: '1px solid #1E2D42',
        background: 'rgba(13,17,23,0.95)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          <div style={{
            width: '26px', height: '26px', borderRadius: '6px',
            background: 'linear-gradient(135deg, #34d399, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LockIcon size={13} />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#E8EDF2' }}>
            HOLDFAST
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '12px', color: '#4D5E72' }}>Agent Registration</span>
          {step !== 'done' && (
            <Link href="/dashboard" style={{
              fontSize: '12px', color: '#4D5E72', textDecoration: 'none',
              padding: '4px 10px', borderRadius: '5px',
              border: '1px solid #1E2D42',
              transition: 'color 0.12s, border-color 0.12s',
            }}>
              I&apos;ll set this up later
            </Link>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '3px 9px',
            background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)',
            borderRadius: '3px',
            fontSize: '9px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: '#F59E0B', fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%', background: '#F59E0B',
              display: 'inline-block', animation: 'hf-pulse 2s ease-in-out infinite',
            }} />
            Devnet
          </div>
        </div>
      </header>

      {/* Step bar */}
      <StepBar currentStep={step} />

      {/* Content */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 28px 80px' }}>
        {step === 'welcome'  && <StepWelcome  onNext={() => go('wallet')} />}
        {step === 'wallet'   && <StepWallet   onBack={() => go('welcome')} onNext={() => go('install')} />}
        {step === 'install'  && <StepInstall  onBack={() => go('wallet')}  onNext={() => go('register')} />}
        {step === 'register' && <StepRegister onBack={() => go('install')} onNext={() => go('save-key')} />}
        {step === 'save-key' && <StepSaveKey  onBack={() => go('register')} onNext={() => go('done')} />}
        {step === 'done'     && <StepDone     onBack={() => go('save-key')} />}
      </div>

      <style>{`
        @keyframes hf-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  return (
    <NotificationProvider>
      <SolanaWalletProvider>
        <WizardInner />
      </SolanaWalletProvider>
    </NotificationProvider>
  );
}
