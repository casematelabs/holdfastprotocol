'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { SolanaWalletProvider } from '../components/WalletProvider';
import { NotificationProvider } from '../components/NotificationContext';
import { NotificationCenter } from '../components/NotificationCenter';
import { NotificationToast } from '../components/NotificationToast';

const NAV_ITEMS = [
  {
    href: '/dashboard/reputation',
    label: 'Reputation',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 5.5L10.03 7.6L12.35 7.93L10.68 9.56L11.06 11.87L9 10.79L6.94 11.87L7.32 9.56L5.65 7.93L7.97 7.6L9 5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/escrow',
    label: 'Escrow',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2.5" y="5.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5.5 5.5V4.5C5.5 3.4 6.4 2.5 7.5 2.5H10.5C11.6 2.5 12.5 3.4 12.5 4.5V5.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2.5 9H15.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="7.5" y="8" width="3" height="2" rx="0.5" fill="currentColor"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/custody',
    label: 'Custody',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2L14.5 4.5V9C14.5 12 11.5 14.5 9 16C6.5 14.5 3.5 12 3.5 9V4.5L9 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M6.5 9L8.5 11L11.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/protocol-health',
    label: 'Health',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M2 9H4.5L6.5 4L9 14L11.5 6.5L13.5 9H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

// ── Wallet icon ───────────────────────────────────────────────────────────────

function WalletIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3.5" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M1 6.5h12" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="10.5" cy="8.75" r="0.9" fill="currentColor"/>
    </svg>
  );
}

// ── Full-page connect prompt ──────────────────────────────────────────────────

function ConnectWalletPrompt() {
  const { wallets, select, connecting } = useWallet();

  const installedWallets = wallets.filter(
    w => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );
  const notDetectedWallets = wallets.filter(
    w => w.readyState === WalletReadyState.NotDetected,
  );

  return (
    <div style={{
      minHeight: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 24px',
      background: '#0D1117',
    }}>
      <div style={{
        maxWidth: '380px',
        width: '100%',
        background: '#141B27',
        border: '1px solid #1E2D42',
        padding: '36px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0',
      }}>
        {/* Icon */}
        <div style={{
          width: '48px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(45,140,255,0.08)',
          border: '1px solid rgba(45,140,255,0.2)',
          marginBottom: '20px',
          color: '#2D8CFF',
        }}>
          <WalletIcon size={22} />
        </div>

        <h2 style={{
          fontSize: '15px',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          marginBottom: '8px',
          textAlign: 'center',
        }}>
          Connect Operator Wallet
        </h2>
        <p style={{
          fontSize: '12px',
          color: '#8A99AC',
          lineHeight: 1.6,
          textAlign: 'center',
          marginBottom: '28px',
        }}>
          Connect your Solana wallet to view reputation scores, escrow activity,
          and custody status for your agent.
        </p>

        {/* Installed wallets */}
        {installedWallets.length > 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: notDetectedWallets.length > 0 ? '16px' : '0' }}>
            {installedWallets.map(w => (
              <button
                key={w.adapter.name}
                onClick={() => select(w.adapter.name)}
                disabled={connecting}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  background: 'rgba(45,140,255,0.06)',
                  border: '1px solid rgba(45,140,255,0.22)',
                  color: '#E8EDF2',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: connecting ? 'not-allowed' : 'pointer',
                  opacity: connecting ? 0.6 : 1,
                  textAlign: 'left',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" width={22} height={22} style={{ borderRadius: '4px', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{w.adapter.name}</span>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#22C55E',
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.2)',
                  padding: '1px 6px',
                }}>
                  Detected
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Not-installed wallets */}
        {notDetectedWallets.length > 0 && (
          <>
            {installedWallets.length > 0 && (
              <div style={{ width: '100%', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ flex: 1, height: '1px', background: '#1E2D42' }} />
                <span style={{ fontSize: '10px', color: '#4D5E72', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  or get a wallet
                </span>
                <div style={{ flex: 1, height: '1px', background: '#1E2D42' }} />
              </div>
            )}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {notDetectedWallets.map(w => (
                <a
                  key={w.adapter.name}
                  href={w.adapter.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 16px',
                    background: 'transparent',
                    border: '1px solid #1E2D42',
                    color: '#8A99AC',
                    fontSize: '13px',
                    fontWeight: 500,
                    textDecoration: 'none',
                    transition: 'color 0.12s, border-color 0.12s',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" width={22} height={22} style={{ borderRadius: '4px', flexShrink: 0, opacity: 0.6 }} />
                  <span style={{ flex: 1 }}>{w.adapter.name}</span>
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: '#4D5E72',
                    background: '#0D1117',
                    border: '1px solid #1E2D42',
                    padding: '1px 6px',
                  }}>
                    Get
                    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ marginLeft: '3px', verticalAlign: 'middle' }}>
                      <path d="M1 6L6 1M4 1H6V3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </a>
              ))}
            </div>
          </>
        )}

        {installedWallets.length === 0 && notDetectedWallets.length === 0 && (
          <p style={{ fontSize: '12px', color: '#4D5E72', textAlign: 'center', lineHeight: 1.6 }}>
            Install Phantom, Backpack, or Solflare to continue.
          </p>
        )}

        <p style={{ marginTop: '20px', fontSize: '10px', color: '#4D5E72', textAlign: 'center', lineHeight: 1.6 }}>
          Supported: Phantom · Backpack · Solflare · any Wallet Standard wallet
        </p>
      </div>
    </div>
  );
}

// ── Inner layout (uses wallet context) ───────────────────────────────────────

function DashboardContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(true);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);

  const { wallets, publicKey, connected, connecting, select, disconnect } = useWallet();

  const installedWallets = wallets.filter(
    w => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  useEffect(() => {
    const dismissed = localStorage.getItem('holdfast_disclaimer_dismissed');
    if (!dismissed) setDisclaimerDismissed(false);
  }, []);

  // Close wallet menu on outside click
  useEffect(() => {
    if (!walletMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [walletMenuOpen]);

  function dismissDisclaimer() {
    localStorage.setItem('holdfast_disclaimer_dismissed', '1');
    setDisclaimerDismissed(true);
  }

  function truncatePubkey(pk: string) {
    return `${pk.slice(0, 4)}...${pk.slice(-4)}`;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      background: '#0D1117',
      color: '#E8EDF2',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      fontSize: '13px',
    }}>

      {/* Pre-audit disclaimer */}
      {!disclaimerDismissed && (
        <div style={{
          background: 'rgba(245,158,11,0.08)',
          borderBottom: '1px solid rgba(245,158,11,0.22)',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          fontSize: '12px',
          color: '#F59E0B',
          zIndex: 60,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              <path d="M7 1L13 12H1L7 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="7" cy="10" r="0.6" fill="currentColor"/>
            </svg>
            <strong style={{ fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '10px' }}>
              Pre-Audit Notice:
            </strong>
            <span style={{ color: '#8A99AC' }}>
              This dashboard connects to a devnet deployment. Smart contracts have not been audited. Do not use with production funds.
            </span>
          </div>
          <button
            onClick={dismissDisclaimer}
            style={{
              background: 'none',
              border: 'none',
              color: '#4D5E72',
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
              padding: '2px 4px',
              flexShrink: 0,
            }}
            aria-label="Dismiss disclaimer"
          >
            ×
          </button>
        </div>
      )}

      {/* Top bar */}
      <header style={{
        height: '48px',
        borderBottom: '1px solid #1E2D42',
        background: 'rgba(13,17,23,0.95)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {/* Sidebar toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            style={{
              width: collapsed ? '64px' : '240px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'space-between',
              padding: collapsed ? '0' : '0 16px',
              background: 'none',
              border: 'none',
              borderRight: '1px solid #1E2D42',
              cursor: 'pointer',
              color: '#E8EDF2',
              transition: 'width 0.2s ease',
              flexShrink: 0,
            }}
            aria-label="Toggle sidebar"
          >
            {!collapsed && (
              <span style={{ fontWeight: 800, fontSize: '13px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Holdfast Protocol
              </span>
            )}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.5 }}>
              <rect y="3" width="16" height="1.5" rx="0.75" fill="currentColor"/>
              <rect y="7.25" width="16" height="1.5" rx="0.75" fill="currentColor"/>
              <rect y="11.5" width="16" height="1.5" rx="0.75" fill="currentColor"/>
            </svg>
          </button>

          <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#8A99AC' }}>Agent Operator Dashboard</span>
          </div>
        </div>

        {/* Right side: wallet button + DEVNET badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 20px' }}>

          {/* Wallet connect / status button */}
          <div ref={walletMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setWalletMenuOpen(o => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '5px 11px',
                background: connected ? 'rgba(45,140,255,0.08)' : 'transparent',
                border: `1px solid ${connected ? 'rgba(45,140,255,0.3)' : '#1E2D42'}`,
                color: connected ? '#2D8CFF' : '#8A99AC',
                fontSize: '12px',
                fontFamily: connected ? "'JetBrains Mono', 'Courier New', monospace" : 'inherit',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'color 0.12s, border-color 0.12s, background 0.12s',
                letterSpacing: connected ? '0.03em' : 'inherit',
              }}
            >
              <WalletIcon size={13} />
              {connecting
                ? 'Connecting…'
                : connected && publicKey
                ? truncatePubkey(publicKey.toBase58())
                : 'Connect Wallet'}
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.45 }}>
                <path d="M1.5 3L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Dropdown */}
            {walletMenuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                minWidth: '220px',
                background: '#141B27',
                border: '1px solid #1E2D42',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                zIndex: 51,
              }}>
                {connected && publicKey ? (
                  <>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid #1E2D42' }}>
                      <div style={{ fontSize: '9px', color: '#4D5E72', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '5px' }}>
                        Connected wallet
                      </div>
                      <div style={{
                        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                        fontSize: '10px',
                        color: '#8A99AC',
                        wordBreak: 'break-all',
                        lineHeight: 1.5,
                      }}>
                        {publicKey.toBase58()}
                      </div>
                    </div>
                    <button
                      onClick={() => { disconnect(); setWalletMenuOpen(false); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 14px',
                        background: 'transparent',
                        border: 'none',
                        color: '#EF4444',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M4.5 2H2a1 1 0 00-1 1v6a1 1 0 001 1h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        <path d="M8 4l2.5 2L8 8M10.5 6H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Disconnect
                    </button>
                  </>
                ) : (
                  installedWallets.length > 0 ? (
                    <>
                      <div style={{ padding: '8px 14px 6px', fontSize: '9px', color: '#4D5E72', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                        Select wallet
                      </div>
                      {installedWallets.map((w, i) => (
                        <button
                          key={w.adapter.name}
                          onClick={() => { select(w.adapter.name); setWalletMenuOpen(false); }}
                          disabled={connecting}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '9px 14px',
                            background: 'transparent',
                            border: 'none',
                            borderTop: i === 0 ? 'none' : '1px solid #1E2D42',
                            color: '#E8EDF2',
                            fontSize: '12px',
                            fontWeight: 500,
                            cursor: connecting ? 'not-allowed' : 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={w.adapter.icon} alt="" width={18} height={18} style={{ borderRadius: '3px', flexShrink: 0 }} />
                          {w.adapter.name}
                        </button>
                      ))}
                    </>
                  ) : (
                    <div style={{ padding: '14px', fontSize: '11px', color: '#8A99AC', textAlign: 'center', lineHeight: 1.6 }}>
                      No wallets detected.
                      <br />
                      Install Phantom, Backpack, or Solflare.
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Notification bell */}
          <NotificationCenter />

          {/* DEVNET badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#F59E0B',
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#F59E0B',
              animation: 'vp-pulse 2s ease-in-out infinite',
              display: 'inline-block',
            }} />
            Devnet
          </div>
        </div>
      </header>

      <style>{`
        @keyframes vp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes vp-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .vp-nav-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          text-decoration: none;
          color: #8A99AC;
          font-size: 13px;
          font-weight: 500;
          border-left: 2px solid transparent;
          transition: color 0.12s, background 0.12s, border-color 0.12s;
          white-space: nowrap;
          overflow: hidden;
        }
        .vp-nav-link:hover {
          color: #E8EDF2;
          background: #141B27;
        }
        .vp-nav-link.active {
          color: #2D8CFF;
          background: rgba(45,140,255,0.08);
          border-left-color: #2D8CFF;
        }
        .vp-skel {
          background: linear-gradient(90deg, #1E2D42 0%, #18202E 50%, #1E2D42 100%);
          background-size: 200% 100%;
          animation: vp-shimmer 1.5s ease-in-out infinite;
          border-radius: 2px;
        }
      `}</style>

      {/* Body: sidebar + main */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left sidebar */}
        <nav style={{
          width: collapsed ? '64px' : '240px',
          minWidth: collapsed ? '64px' : '240px',
          borderRight: '1px solid #1E2D42',
          background: '#0D1117',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease, min-width 0.2s ease',
          overflow: 'hidden',
          position: 'sticky',
          top: '48px',
          height: 'calc(100vh - 48px)',
        }}>
          <div style={{ padding: '12px 0', flex: 1 }}>
            {NAV_ITEMS.map(item => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`vp-nav-link${isActive ? ' active' : ''}`}
                  style={collapsed ? { justifyContent: 'center', padding: '10px 0' } : {}}
                  title={collapsed ? item.label : undefined}
                >
                  <span style={{ flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>

          {!collapsed && (
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #1E2D42',
              fontSize: '11px',
              color: '#4D5E72',
              lineHeight: 1.5,
            }}>
              <Link
                href="/"
                style={{ color: '#4D5E72', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back to site
              </Link>
            </div>
          )}
        </nav>

        {/* Main content */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          background: '#0D1117',
        }}>
          {connected ? children : <ConnectWalletPrompt />}
        </main>
      </div>

      {/* Fixed toast stack — renders above all layout layers */}
      <NotificationToast />
    </div>
  );
}

// ── Root layout export ────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <SolanaWalletProvider>
        <DashboardContent>{children}</DashboardContent>
      </SolanaWalletProvider>
    </NotificationProvider>
  );
}
