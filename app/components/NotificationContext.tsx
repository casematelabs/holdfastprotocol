'use client';

import { createContext, useContext, useCallback, useState, useRef } from 'react';

export type NotifCategory = 'dispute' | 'score' | 'pact';
export type NotifSeverity = 'critical' | 'warning' | 'success' | 'info';

export interface Notification {
  id: string;
  category: NotifCategory;
  severity: NotifSeverity;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  href?: string;
  pactId?: string;
}

export interface ToastNotif extends Notification {
  _expiresAt: number;
}

interface NotifCtx {
  notifications: Notification[];
  toasts: ToastNotif[];
  unreadCount: number;
  push(n: Omit<Notification, 'id' | 'timestamp' | 'read'>): void;
  markRead(id: string): void;
  markAllRead(): void;
  dismiss(id: string): void;
  dismissToast(id: string): void;
  clearAll(): void;
}

const TOAST_TTL_MS = 5200;
const MAX_NOTIFICATIONS = 100;
const MAX_TOASTS = 4;

const NotifCtx = createContext<NotifCtx | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<ToastNotif[]>([]);
  const seq = useRef(0);

  const push = useCallback((n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const id = 'n' + Date.now() + String(++seq.current);
    const now = Date.now();
    const notif: Notification = { ...n, id, timestamp: now, read: false };
    setNotifications(prev => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
    const toast: ToastNotif = { ...notif, _expiresAt: now + TOAST_TTL_MS };
    setToasts(prev => [toast, ...prev].slice(0, MAX_TOASTS));
    setTimeout(() => { setToasts(prev => prev.filter(t => t.id !== id)); }, TOAST_TTL_MS + 350);
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    markRead(id);
  }, [markRead]);

  const clearAll = useCallback(() => { setNotifications([]); setToasts([]); }, []);
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotifCtx.Provider value={{ notifications, toasts, unreadCount, push, markRead, markAllRead, dismiss, dismissToast, clearAll }}>
      {children}
    </NotifCtx.Provider>
  );
}

export function useNotifications(): NotifCtx {
  const ctx = useContext(NotifCtx);
  if (!ctx) throw new Error('useNotifications requires NotificationProvider');
  return ctx;
}

export const SEVERITY_COLOR: Record<NotifSeverity, string> = {
  critical: '#EF4444',
  warning: '#F59E0B',
  success: '#22C55E',
  info: '#2D8CFF',
};

export const SEVERITY_BG: Record<NotifSeverity, string> = {
  critical: 'rgba(239,68,68,0.10)',
  warning: 'rgba(245,158,11,0.10)',
  success: 'rgba(34,197,94,0.10)',
  info: 'rgba(45,140,255,0.10)',
};
