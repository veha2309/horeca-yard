import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { api, mutate, type User } from './api.js';

type Notification = {
  id: string;
  entity: string;
  recordId: string;
  message: string;
  createdAt: string;
  unread: boolean;
};
export type LiveEvent = {
  id: string;
  entity: string;
  recordId: string;
  message: string;
  actorId: string | null;
};
type Feed = {
  cursor: string;
  notifications: Notification[];
  unread: number;
  sections: Record<string, number>;
  events: LiveEvent[];
  changed: boolean;
  user: User;
};
export function Notifications({
  user,
  onUpdate,
  onNavigate,
  onUser,
  onExpired,
  onSections,
}: {
  user: User;
  onUpdate: (events: LiveEvent[]) => void;
  onNavigate: (module: string) => void;
  onUser: (user: User) => void;
  onExpired: () => void;
  onSections?: (sections: Record<string, number>) => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null),
    [open, setOpen] = useState(false),
    [connected, setConnected] = useState(true),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const callbacks = useRef({ onUpdate, onNavigate, onUser, onExpired, onSections });
  callbacks.current = { onUpdate, onNavigate, onUser, onExpired, onSections };
  const root = useRef<HTMLDivElement>(null),
    cursor = useRef<string | undefined>(undefined),
    poll = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let live = true,
      inFlight = false;
    cursor.current = undefined;
    const check = async () => {
      if (inFlight || !live) return;
      inFlight = true;
      try {
        const result = await api<Feed>(
          `/api/admin/notifications${cursor.current === undefined ? '' : '?after=' + cursor.current}`,
        );
        if (!live) return;
        const hadCursor = cursor.current !== undefined;
        cursor.current = result.cursor;
        setFeed(result);
        callbacks.current.onSections?.(result.sections || {});
        setConnected(true);
        if (result.user) callbacks.current.onUser(result.user);
        if (hadCursor && result.changed) {
          callbacks.current.onUpdate(result.events);
          const incoming = result.events.filter((e) => e.actorId !== user.id);
          if (incoming.length)
            setMessage(
              incoming.length === 1
                ? incoming[0].message
                : `${incoming.length} new updates. Your workspace is up to date.`,
            );
        }
      } catch (e: any) {
        if (live) {
          setConnected(false);
          if (e.status === 401) callbacks.current.onExpired();
        }
      } finally {
        inFlight = false;
      }
    };
    poll.current = check;
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void check();
    }, 5000);
    const resume = () => {
      if (document.visibilityState !== 'hidden') void check();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [user.id]);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 8000);
      return () => clearTimeout(timer);
    }
  }, [message]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const read = async () => {
    if (!feed) return;
    setError('');
    try {
      await mutate('/api/admin/notifications/read', { cursor: feed.cursor });
      await poll.current();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const navigate = (n: Notification) => {
    const destinations: Record<string, string> = { media: 'products' };
    callbacks.current.onNavigate(destinations[n.entity] || n.entity);
    setOpen(false);
  };
  return (
    <div className="notification-control" ref={root}>
      <span className={`live-status ${connected ? '' : 'offline'}`}>
        <i />
        {connected ? 'Live updates' : 'Reconnecting…'}
      </span>
      <button
        className="notification-bell icon-button"
        aria-label={`Notifications${feed?.unread ? `, ${feed.unread} unread` : ''}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen(!open)}
      >
        <Bell size={19} />
        {!!feed?.unread && <span>{feed.unread > 99 ? '99+' : feed.unread}</span>}
      </button>
      {open && (
        <section className="notification-panel" id="notification-panel" aria-label="Notifications">
          <header>
            <div>
              <h2>Notifications</h2>
              <p>New enquiries and team updates</p>
            </div>
            <button
              className="icon-button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          <div className="notification-toolbar">
            <span>{feed?.unread || 0} unread</span>
            <button disabled={!feed?.unread} onClick={() => void read()}>
              <CheckCheck size={15} />
              Mark all read
            </button>
          </div>
          {error && (
            <p role="alert" className="notification-error">
              {error}
            </p>
          )}
          <div className="notification-list">
            {feed?.notifications.length ? (
              feed.notifications.map((n) => (
                <button key={n.id} className={n.unread ? 'unread' : ''} onClick={() => navigate(n)}>
                  <span className="notification-dot" />
                  <div>
                    <p>{n.message}</p>
                    <time>
                      {new Date(n.createdAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </button>
              ))
            ) : (
              <div className="notifications-empty">
                <Bell size={27} />
                <b>You’re all caught up.</b>
                <p>New enquiries and changes will appear here automatically.</p>
              </div>
            )}
          </div>
        </section>
      )}
      {message && (
        <div className="live-toast" role="status">
          <Bell size={18} />
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss update"
            onClick={() => setMessage('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
