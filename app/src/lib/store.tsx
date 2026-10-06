import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api, ensureToken, forgetToken, WS_URL } from './api';
import { registerForPush, type PushStatus } from './push';
import { guideSettled } from './guide';
import type { EventType, F1Weekend, FeedItem, GameCard, HateWatchTally, League, Prefs, PrefsPatch, Target } from './types';

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

  /** Scores tab: today's games for the teams (and players' teams) you track, kept live over the socket. */
  games: Map<string, GameCard>;
  /** F1's race weekend under way, or the next one: what the Scores tab says when no session is on. */
  nextF1: F1Weekend | null;
  refreshScores: () => Promise<void>;

  /** Successful Hate Watches, for the counter at the top of Settings. The server sends the new tally after each one. */
  hateWatches: HateWatchTally | null;

  follows: Map<string, Target>;
  isFollowing: (key: string) => boolean;
  toggleFollow: (t: Target) => Promise<void>;

  prefs: Prefs | null;
  updatePrefs: (patch: PrefsPatch) => Promise<void>;
  eventTypes: EventType[];
  leagues: { id: League; name: string }[];
  push: { status: PushStatus | 'unknown'; reason?: string };
  enablePush: () => Promise<void>;
  deleteAllData: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
};

/** true/false sets a per-target choice, null removes it (back to global); a target with none left disappears. */
function mergeTargetTypes(cur: Prefs['targetTypes'] = {}, patch?: PrefsPatch['targetTypes']): Prefs['targetTypes'] {
  if (!patch) return cur;
  const out = { ...cur };
  for (const [target, types] of Object.entries(patch)) {
    const merged = { ...out[target] };
    for (const [typeId, v] of Object.entries(types)) { if (v === null) delete merged[typeId]; else merged[typeId] = v; }
    if (Object.keys(merged).length) out[target] = merged; else delete out[target];
  }
  return out;
}

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
  const [games, setGames] = useState<Map<string, GameCard>>(new Map());
  const [hateWatches, setHateWatches] = useState<HateWatchTally | null>(null);
  const [nextF1, setNextF1] = useState<F1Weekend | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [follows, setFollows] = useState<Map<string, Target>>(new Map());
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [leagues, setLeagues] = useState<{ id: League; name: string }[]>([]);
  const [push, setPush] = useState<Store['push']>({ status: 'unknown' });
  const ws = useRef<WebSocket | null>(null);
  // Read inside the socket handler (which outlives renders), so it must be a ref, not state.
  const mutedRef = useRef<Set<string>>(new Set());
  useEffect(() => { mutedRef.current = new Set(prefs?.muted ?? []); }, [prefs]);

  const refreshFeed = useCallback(async () => {
    const { items } = await api.feed();
    setFeed((cur) => mergeFeed(cur, items));
  }, []);

  // The server decides which games are yours today; live frames then update them in place.
  const refreshScores = useCallback(async () => {
    const { games: list, nextF1: next } = await api.scores();
    setGames(new Map(list.map((g) => [g.key, g])));
    setNextF1(next ?? null);
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
      sock.onopen = () => { attempt = 0; setLive('live'); refreshFeed().catch(() => {}); refreshScores().catch(() => {}); api.hateWatches().then(setHateWatches, () => {}); };
      sock.onmessage = (m) => {
        const frame = JSON.parse(String(m.data));
        if (frame.kind === 'score') { setGames((cur) => new Map(cur).set(frame.game.key, frame.game)); return; }
        if (frame.kind === 'hateWatches') { setHateWatches(frame.tally); return; }
        if (frame.kind !== 'event') return;
        setFeed((cur) => mergeFeed(cur, [frame.item]));
        setUnseen((n) => n + 1);
        // Muted (🔕) targets still land in the feed, just silently.
        if (!mutedRef.current.has(frame.item.target.key)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
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
  }, [refreshFeed, refreshScores]);

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
      await guideSettled; // on first launch, ask for notification permission after the startup guide, not over it
      const r = await registerForPush();
      setPush({ status: r.status, reason: r.reason });
      if (r.token) api.setPushToken(r.token).catch(() => {});
    })();
  }, [refreshFeed]);

  const value = useMemo<Store>(() => ({
    ready, live, feed, unseen, eventTypes, leagues, prefs, follows, push, games, nextF1, refreshScores, hateWatches,
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
      try { await (was ? api.unfollow(t.key) : api.follow(t.key)); refreshScores().catch(() => {}); }
      catch { setFollows((m) => { const n = new Map(m); was ? n.set(t.key, t) : n.delete(t.key); return n; }); }
    },
    updatePrefs: async (patch) => {
      // Optimistic: apply locally right away (same merge rules as the server), then take the server's copy.
      setPrefs((p) => (p ? {
        ...p, ...patch,
        types: { ...p.types, ...patch.types }, leagues: { ...p.leagues, ...patch.leagues },
        quietHours: { ...p.quietHours, ...patch.quietHours }, targetTypes: mergeTargetTypes(p.targetTypes, patch.targetTypes),
        pushTypes: { ...p.pushTypes, ...patch.pushTypes }, targetPushTypes: mergeTargetTypes(p.targetPushTypes, patch.targetPushTypes),
      } : p));
      setPrefs(await api.setPrefs(patch));
    },
    enablePush: async () => {
      const r = await registerForPush();
      setPush({ status: r.status, reason: r.reason });
      if (r.token) await api.setPushToken(r.token);
    },
    deleteAllData: async () => {
      // Server deletes the device (follows, prefs, feed, push token) and drops our socket;
      // we then start over as a brand-new anonymous device.
      await api.deleteMe();
      await forgetToken();
      setFollows(new Map());
      setFeed([]);
      setUnseen(0);
      setHateWatches({ total: 0, teams: [] });
      setPrefs(await api.prefs());
      const r = await registerForPush();
      if (r.token) api.setPushToken(r.token).catch(() => {});
    },
  }), [ready, live, feed, unseen, eventTypes, leagues, prefs, follows, push, refreshFeed, games, nextF1, refreshScores, hateWatches]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
