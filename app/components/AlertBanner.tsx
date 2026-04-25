'use client';

import { useState } from 'react';

const TYPE_CONFIG = {
  danger:  { color: '#EF4444', bg: 'rgba(239,68,68,0.06)',  dim: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)', icon: '✕' },
  warning: { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', dim: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.22)', icon: '⚠' },
  info:    { color: '#2D8CFF', bg: 'rgba(45,140,255,0.08)', dim: 'rgba(45,140,255,0.08)', border: 'rgba(45,140,255,0.22)', icon: 'ℹ' },
} as const;

interface AlertBannerProps {
  type: 'info' | 'warning' | 'danger';
  title?: React.ReactNode;
  message: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  sticky?: boolean;
  dismissible?: boolean;
}

export function AlertBanner({ type, title, message, action, sticky, dismissible }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const cfg = TYPE_CONFIG[type];
  const hasTitle = title != null;
  const background = hasTitle && !sticky
    ? `linear-gradient(135deg, ${cfg.dim} 0%, transparent 100%)`
    : cfg.bg;

  return (
    <div style={{
      padding: sticky ? '14px 18px' : '12px 16px',
      background,
      border: `1px solid ${cfg.border}`,
      display: 'flex',
      alignItems: 'flex-start',
      gap: hasTitle ? (sticky ? '12px' : '10px') : undefined,
      fontSize: '12px',
      color: cfg.color,
      marginBottom: sticky ? 0 : '20px',
      ...(sticky ? { position: 'sticky', top: 0, zIndex: 10 } : {}),
    }}>
      {hasTitle && (
        sticky ? (
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: cfg.color,
            animation: 'vp-pulse 1.2s ease-in-out infinite',
            display: 'inline-block',
            flexShrink: 0,
            marginTop: '3px',
          }} />
        ) : (
          <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px', color: cfg.color }}>
            {cfg.icon}
          </span>
        )
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {hasTitle && (
          <div style={{
            fontSize: '12px',
            fontWeight: 700,
            color: cfg.color,
            ...(sticky ? { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' } : {}),
          }}>
            {title}
          </div>
        )}
        <p style={{
          margin: 0,
          fontSize: hasTitle ? '11px' : '12px',
          color: hasTitle ? '#8A99AC' : cfg.color,
          lineHeight: hasTitle ? 1.55 : undefined,
        }}>
          {message}
        </p>
        {action && (
          <div style={{ marginTop: '4px' }}>
            {action.href ? (
              <a
                href={action.href}
                style={{ fontSize: '11px', fontWeight: 700, color: cfg.color, textDecoration: 'none' }}
              >
                {action.label}
              </a>
            ) : (
              <button
                onClick={action.onClick}
                style={{
                  background: 'none',
                  border: `1px solid ${cfg.border}`,
                  color: cfg.color,
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>

      {dismissible && (
        <button
          onClick={() => setDismissed(true)}
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
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
