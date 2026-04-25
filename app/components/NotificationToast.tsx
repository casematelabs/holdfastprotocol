'use client';

import Link from 'next/link';
import { ToastNotif, NotifCategory, SEVERITY_COLOR, SEVERITY_BG, useNotifications } from './NotificationContext';

const TOAST_DURATION_MS = 5200;

// ── Category icon ─────────────────────────────────────────────────────────────

function CategoryIcon({ category }: { category: NotifCategory }) {
  if (category === 'dispute') return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1.5L13 12H1L7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7" cy="10" r="0.55" fill="currentColor"/>
    </svg>
  );
  if (category === 'score') return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 4L8 6L10 6.3L8.5 7.7L8.8 9.7L7 8.7L5.2 9.7L5.5 7.7L4 6.3L6 6L7 4Z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1L12 3.5V7.5C12 10 9.5 12 7 13C4.5 12 2 10 2 7.5V3.5L7 1Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M5 7L6.5 8.5L9.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Individual toast ──────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }: { toast: ToastNotif; onDismiss: (id: string) => void }) {
  const color = SEVERITY_COLOR[toast.severity];
  const bg = SEVERITY_BG[toast.severity];

  const inner = (
    <div style={{
      width: '320px',
      background: '#141B27',
      border: '1px solid #1E2D42',
      borderLeft: '3px solid ' + color,
      boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      display: 'flex',
      gap: '10px',
      padding: '12px 36px 12px 14px',
      position: 'relative',
      overflow: 'hidden',
      animation: 'vp-toast-in 0.2s ease-out',
    }}>
      {/* Category icon badge */}
      <div style={{
        width: '28px',
        height: '28px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        border: '1px solid ' + color + '33',
        color,
        marginTop: '1px',
      }}>
        <CategoryIcon category={toast.category} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#E8EDF2', marginBottom: '3px' }}>
          {toast.title}
        </div>
        <div style={{ fontSize: '11px', color: '#8A99AC', lineHeight: 1.45 }}>
          {toast.body}
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'none',
          border: 'none',
          color: '#4D5E72',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="Dismiss notification"
      >
        ×
      </button>

      {/* Auto-dismiss progress bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: '2px',
        background: color,
        opacity: 0.4,
        animationName: 'vp-toast-progress',
        animationDuration: TOAST_DURATION_MS + 'ms',
        animationTimingFunction: 'linear',
        animationFillMode: 'forwards',
      }} />
    </div>
  );

  return toast.href ? (
    <Link href={toast.href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </Link>
  ) : inner;
}

// ── Toast container ───────────────────────────────────────────────────────────

export function NotificationToast() {
  const { toasts, dismissToast } = useNotifications();

  return (
    <>
      <style>{`
        @keyframes vp-toast-in {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes vp-toast-progress {
          from { width: 100%; }
          to   { width: 0%;   }
        }
      `}</style>

      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9000,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{ pointerEvents: 'all' }}>
              <Toast toast={t} onDismiss={dismissToast} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
