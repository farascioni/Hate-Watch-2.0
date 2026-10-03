import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api, ensureToken, WS_URL } from './api';
import { registerForPush, type PushStatus } from './push';
import type { EventType, FeedItem, League, Prefs, Target } from './types';

type LiveState = 'connecting' | 'live' | 'offline';

interface Store {
  ready: boolean;
  live: LiveState;
  feed: FeedItem[];
  unseen: number;
  markSeen: () => void;
  refreshFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
  clearFeed: () => Promise<void>;

  follows: Map<string, Target>;
  isFollowing: (key: string) => boolean;
  toggleFollow: (t: Target) => Promise<void>;

  prefs: Prefs | null;
  updatePrefs: (patch: Partial<Prefs>) => Promise<void>;
  eventTypes: EventType[];
  leagues: { id: League; name: string }[];
  push: { status: PushStatus | 'unknown'; reason?: string };
  enablePush: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
};

const mergeFeed = (a: FeedItem[], b: FeedItem[]) => {
  const byId = new Map<string, FeedItem>();
  for (const x of [...a, ...b]) byId.set(x.id, x);
  // "In the order in which they happened": sort by ESPN's wallclock for the play, not by arrival.
  return [...byId.values()].sort((x, y) => y.occurredAt - x.occurredAt || y.detectedAt - x.detectedAt);
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState<LiveState>('connecting');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [follows, setFollows] = useState<Map<string, Target>>(new Map());
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [leagues, setLeagues] = useState<{ id: League; name: string }[]>([]);
  const [push, setPush] = useState<Store['push']>({ status: 'unknown' });
  const ws = useRef<WebSocket | null>(null);

  const refreshFeed = useCallback(async () => {
    const { items } = await api.feed();
    setFeed((cur) => mergeFeed(cur, items));
  }, []);

  // ── Realtime socket with backoff; on every (re)connect we re-sync the feed to close any gap.
  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      if (closed) return;
      setLive('connecting');
      const token = await ensureToken().catch(() => null);
      if (!token) { timer = setTimeout(connect, 3000); return; }
      const sock = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      ws.current = sock;
      sock.onopen = () => { attempt = 0; setLive('live'); refreshFeed().catch(() => {}); };
      sock.onmessage = (m) => {
        const frame = JSON.parse(String(m.data));
        if (frame.kind !== 'event') return;
        setFeed((cur) => mergeFeed(cur, [frame.item]));
        setUnseen((n) => n + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      };
      sock.onclose = () => {
        if (ws.current === sock) ws.current = null;
        setLive('offline');
        if (!closed) timer = setTimeout(connect, Math.min(15000, 500 * 2 ** attempt++));
      };
      sock.onerror = () => sock.close();
    };
    connect();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !ws.current) { clearTimeout(timer); attempt = 0; connect(); }
    });
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); sub.remove(); };
  }, [refreshFeed]);

  // ── Initial load
  useEffect(() => {
    (async () => {
      try {
        const [cat, f, p] = await Promise.all([api.eventTypes(), api.follows(), api.prefs()]);
        setEventTypes(cat.types);
        setLeagues(cat.leagues);
        setFollows(new Map(f.follows.filter((x) => x.target).map((x) => [x.key, x.target!])));
        setPrefs(p);
        await refreshFeed();
      } catch (e) {
        console.warn('initial load failed', e);
      } finally {
        setReady(true);
      }
      const r = await registerForPush();
      setPush({ status: r.status, reason: r.reason });
      if (r.token) api.setPushToken(r.token).catch(() => {});
    })();
  }, [refreshFeed]);

  const value = useMemo<Store>(() => ({
    ready, live, feed, unseen, eventTypes, leagues, prefs, follows, push,
    markSeen: () => setUnseen(0),
    refreshFeed,
    loadMore: async () => {
      const oldest = feed.at(-1)?.occurredAt;
      if (!oldest) return;
      const { items } = await api.feed(oldest);
      setFeed((cur) => mergeFeed(cur, items));
    },
    clearFeed: async () => { await api.clearFeed(); setFeed([]); setUnseen(0); },
    isFollowing: (key) => follows.has(key),
    toggleFollow: async (t) => {
      const was = follows.has(t.key);
      // Optimistic: flip immediately, roll back if the server says no.
      setFollows((m) => { const n = new Map(m); was ? n.delete(t.key) : n.set(t.key, t); return n; });
      Haptics.selectionAsync().catch(() => {});
      try { await (was ? api.unfollow(t.key) : api.follow(t.key)); }
      catch { setFollows((m) => { const n = new Map(m); was ? n.set(t.key, t) : n.delete(t.key); return n; }); }
    },
    updatePrefs: async (patch) => {
      setPrefs((p) => (p ? { ...p, ...patch, types: { ...p.types, ...patch.types }, leagues: { ...p.leagues, ...patch.leagues }, quietHours: { ...p.quietHours, ...patch.quietHours } } : p));
      setPrefs(await api.setPrefs(patch));
    },
    enablePush: async () => {
      const r = await registerForPush();
      setPush({ status: r.status, reason: r.reason });
      if (r.token) await api.setPushToken(r.token);
    },
  }), [ready, live, feed, unseen, eventTypes, leagues, prefs, follows, push, refreshFeed]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
