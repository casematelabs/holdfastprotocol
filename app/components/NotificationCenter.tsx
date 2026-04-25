'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useNotifications, Notification, NotifCategory, SEVERITY_COLOR, SEVERITY_BG } from './NotificationContext';

// ── Icons ─────────────────────────────────────────────────────────────────────

function BellIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2C5.8 2 4 3.8 4 6V10.5L2.5 12H13.5L12 10.5V6C12 3.8 10.2 2 8 2Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M6.5 12C6.5 12.8 7.2 13.5 8 13.5C8.8 13.5 9.5 12.8 9.5 12"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function CategoryIcon({ category }: { category: NotifCategory }) {
  if (category === 'dispute') return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 1.5L12 11H1L6.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M6.5 5V7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="6.5" cy="9.5" r="0.55" fill="currentColor"/>
    </svg>
  );
  if (category === 'score') return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M6.5 4L7.3 5.7L9.2 5.95L7.85 7.25L8.1 9.15L6.5 8.3L4.9 9.15L5.15 7.25L3.8 5.95L5.7 5.7L6.5 4Z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 1L11 3.5V7C11 9.5 8.5 11.5 6.5 12.5C4.5 11.5 2 9.5 2 7V3.5L6.5 1Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M4.5 6.5L6 8L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  const dt = new Date(ms);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Row ───────────────────────────────────────────────────────────────────────

function NotifRow({ n, onMarkRead, onDismiss }: {
  n: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const color = SEVERITY_COLOR[n.severity];
  const bg = SEVERITY_BG[n.severity];
  const [hovered, setHovered] = useState(false);

  const inner = (
    <div
      onMouseEnter={() => { setHovered(true); if (!n.read) onMarkRead(n.id); }}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        gap: '10px',
        padding: '10px 14px',
        borderLeft: '2px solid ' + (n.read ? 'transparent' : color),
        background: hovered ? '#141B27' : n.read ? 'transparent' : 'rgba(45,140,255,0.025)',
        cursor: n.href ? 'pointer' : 'default',
        transition: 'background 0.1s',
        position: 'relative',
      }}
    >
      <div style={{
        width: '26px',
        height: '26px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        border: '1px solid ' + color + '33',
        color,
        marginTop: '1px',
      }}>
        <CategoryIcon category={n.category} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '2px',
        }}>
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: n.read ? '#8A99AC' : '#E8EDF2',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {n.title}
          </span>
          <span style={{ fontSize: '10px', color: '#4D5E72', flexShrink: 0 }}>
            {timeAgo(n.timestamp)}
          </span>
        </div>
        <p style={{ fontSize: '11px', color: '#8A99AC', margin: 0, lineHeight: 1.45 }}>
          {n.body}
        </p>
      </div>

      {hovered && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(n.id); }}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '16px',
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1E2D42',
            border: '1px solid #334155',
            color: '#8A99AC',
            fontSize: '11px',
            cursor: 'pointer',
            lineHeight: 1,
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );

  return n.href ? (
    <Link href={n.href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </Link>
  ) : inner;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllRead, dismiss, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          position: 'relative',
          background: open ? 'rgba(45,140,255,0.08)' : 'transparent',
          border: '1px solid ' + (open ? 'rgba(45,140,255,0.3)' : '#1E2D42'),
          color: open ? '#2D8CFF' : '#8A99AC',
          cursor: 'pointer',
          transition: 'color 0.12s, border-color 0.12s, background 0.12s',
        }}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            minWidth: '16px',
            height: '16px',
            padding: '0 3px',
            background: '#EF4444',
            border: '2px solid #0D1117',
            borderRadius: '999px',
            fontSize: '9px',
            fontWeight: 700,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          width: '360px',
          background: '#0D1117',
          border: '1px solid #1E2D42',
          boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '480px',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid #1E2D42',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#E8EDF2' }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span style={{
                  padding: '1px 6px',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#EF4444',
                }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  style={{ fontSize: '10px', color: '#2D8CFF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  style={{ fontSize: '10px', color: '#4D5E72', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Notification list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{
                padding: '40px 24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.2 }}>
                  <path d="M12 3C9 3 6 5.7 6 9V15L4 17H20L18 15V9C18 5.7 15 3 12 3Z"
                    stroke="#E8EDF2" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M9.5 17C9.5 18.4 10.6 19.5 12 19.5C13.4 19.5 14.5 18.4 14.5 17"
                    stroke="#E8EDF2" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize: '12px', color: '#4D5E72' }}>No notifications</span>
              </div>
            ) : (
              notifications.map((n, i) => (
                <div
                  key={n.id}
                  style={{ borderBottom: i < notifications.length - 1 ? '1px solid rgba(30,45,66,0.6)' : 'none' }}
                >
                  <NotifRow n={n} onMarkRead={markRead} onDismiss={dismiss} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
