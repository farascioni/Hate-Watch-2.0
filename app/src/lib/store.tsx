import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api, ensureToken, forgetToken, WS_URL } from './api';
import { registerForPush, type PushStatus } from './push';
import { guideSettled } from './guide';
import { trackedEasterEgg } from './easterEggs';
import type { EventType, F1Weekend, FeedItem, GameCard, HateWatchTally, League, Prefs, PrefsPatch, Target, LeagueInfo, NextGame } from './types';

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
  /** Each tracked team's next game (Scores tab, "Up next"). Older servers don't send it. */
  upNext: NextGame[];
  refreshScores: () => Promise<void>;

  /** Successful Hate Watches, for the counter at the top of Settings. The server sends the new tally after each one. */
  hateWatches: HateWatchTally | null;

  follows: Map<string, Target>;
  /** How many people track each of your players and teams, you included (the Tracking tab). */
  trackers: Map<string, number>;
  refreshTrackers: () => Promise<void>;
  /** Newer hater counts from a list the server just sent (Search, a roster): the freshest number wins. */
  noteTrackers: (items: { key: string; haters?: number }[]) => void;
  isFollowing: (key: string) => boolean;
  toggleFollow: (t: Target) => Promise<void>;

  prefs: Prefs | null;
  updatePrefs: (patch: PrefsPatch) => Promise<void>;
  eventTypes: EventType[];
  leagues: LeagueInfo[];
  /** A league's info from the server (name, sport), for leagues this build may not know. */
  leagueInfo: (id: string) => LeagueInfo | undefined;
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

/** A player's team choices, merged like the server's: true/false sets one, null removes it. */
function mergePlayerTeams(cur: NonNullable<Prefs['playerTeams']> = {}, patch?: PrefsPatch['playerTeams']): Prefs['playerTeams'] {
  if (!patch) return cur;
  const out = { ...cur };
  for (const [player, v] of Object.entries(patch)) {
    const merged = { ...out[player] };
    for (const k of ['scores', 'alerts'] as const) { if (v[k] === null) delete merged[k]; else if (v[k] !== undefined) merged[k] = v[k]!; }
    if (Object.keys(merged).length) out[player] = merged; else delete out[player];
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
  const [upNext, setUpNext] = useState<NextGame[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [follows, setFollows] = useState<Map<string, Target>>(new Map());
  const [trackers, setTrackers] = useState<Map<string, number>>(new Map());
  const countsFrom = (list: { key: string; trackers?: number }[]) => new Map(list.filter((x) => x.trackers != null).map((x) => [x.key, x.trackers!]));
  // Merged, not replaced: the map also holds counts for players and teams you looked at but don't track.
  const noteTrackers = useCallback((items: { key: string; haters?: number; trackers?: number }[]) => {
    const counts = items.filter((x) => (x.haters ?? x.trackers) != null);
    if (counts.length) setTrackers((m) => { const n = new Map(m); for (const x of counts) n.set(x.key, (x.haters ?? x.trackers)!); return n; });
  }, []);
  const refreshTrackers = useCallback(async () => { noteTrackers((await api.follows()).follows); }, [noteTrackers]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [leagues, setLeagues] = useState<LeagueInfo[]>([]);
  /** The initial load has worked (see "Initial load"). */
  const loaded = useRef(false);
  const loadCore = useCallback(async () => {
    const [cat, f, p] = await Promise.all([api.eventTypes(), api.follows(), api.prefs()]);
    setEventTypes(cat.types);
    setLeagues(cat.leagues);
    setFollows(new Map(f.follows.filter((x) => x.target).map((x) => [x.key, x.target!])));
    setTrackers(countsFrom(f.follows));
    setPrefs(p);
    loaded.current = true;
  }, []);
  const loadCoreRef = useRef(loadCore);
  loadCoreRef.current = loadCore;
  const leagueInfo = useCallback((id: string) => leagues.find((l) => l.id === id), [leagues]);
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
    const { games: list, nextF1: next, upNext: coming } = await api.scores();
    setUpNext(coming ?? []);
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
      sock.onopen = () => {
        attempt = 0; setLive('live');
        if (!loaded.current) loadCoreRef.current().catch(() => {}); // the server's reachable again: finish the initial load now
        refreshFeed().catch(() => {}); refreshScores().catch(() => {}); api.hateWatches().then(setHateWatches, () => {});
      };
      sock.onmessage = (m) => {
        const frame = JSON.parse(String(m.data));
        // Score frames are everyone's copy of the card: keep this device's own Successful Hate Watch count on it.
        if (frame.kind === 'score') { setGames((cur) => { const had = cur.get(frame.game.key)?.hateWatch; return new Map(cur).set(frame.game.key, had ? { ...frame.game, hateWatch: had } : frame.game); }); return; }
        if (frame.kind === 'hateWatches') { setHateWatches(frame.tally); return; }
        if (frame.kind !== 'event') return;
        // A Successful Hate Watch just landed: its final on the Scores tab says how many others got it too.
        if (frame.item.alsoGot != null && frame.item.gameId) {
          const key = `${frame.item.league}:${frame.item.gameId}`;
          setGames((cur) => { const g = cur.get(key); return g ? new Map(cur).set(key, { ...g, hateWatch: { alsoGot: frame.item.alsoGot } }) : cur; });
        }
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

  // ── Initial load: the leagues and alert types (filters, Settings), your follows and your settings. Until it
  // works it's retried, more slowly each time (opening the app with no signal), and again the moment the
  // live connection opens (the signal is back).
  useEffect(() => {
    let stopped = false;
    (async () => {
      for (let attempt = 0; !stopped && !loaded.current; attempt++) {
        try {
          await loadCore();
          await refreshFeed();
        } catch (e) {
          console.warn('initial load failed, will retry', e);
          setReady(true); // show the app (empty) rather than a spinner forever
          if (attempt === 0) void registerOnce();
          await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));
        }
      }
      setReady(true);
      void registerOnce();
    })();
    return () => { stopped = true; };
  }, [refreshFeed, loadCore]);

  const pushAsked = useRef(false);
  const registerOnce = async () => {
    if (pushAsked.current) return;
    pushAsked.current = true;
    await guideSettled; // on first launch, ask for notification permission after the startup guide, not over it
    const r = await registerForPush();
    setPush({ status: r.status, reason: r.reason });
    if (r.token) api.setPushToken(r.token).catch(() => {});
  };

  const value = useMemo<Store>(() => ({
    ready, live, feed, unseen, eventTypes, leagues, leagueInfo, prefs, follows, push, games, nextF1, upNext, refreshScores, hateWatches, trackers, refreshTrackers, noteTrackers,
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
      try {
        const r = await (was ? api.unfollow(t.key) : api.follow(t.key));
        if (r.trackers != null) setTrackers((m) => new Map(m).set(t.key, r.trackers!));
        if (!was) void trackedEasterEgg(t.key);
        refreshScores().catch(() => {});
      }
      catch { setFollows((m) => { const n = new Map(m); was ? n.set(t.key, t) : n.delete(t.key); return n; }); }
    },
    updatePrefs: async (patch) => {
      // Optimistic: apply locally right away (same merge rules as the server), then take the server's copy.
      setPrefs((p) => (p ? {
        ...p, ...patch,
        types: { ...p.types, ...patch.types }, leagues: { ...p.leagues, ...patch.leagues },
        quietHours: { ...p.quietHours, ...patch.quietHours }, targetTypes: mergeTargetTypes(p.targetTypes, patch.targetTypes),
        pushTypes: { ...p.pushTypes, ...patch.pushTypes }, targetPushTypes: mergeTargetTypes(p.targetPushTypes, patch.targetPushTypes),
        playerTeams: mergePlayerTeams(p.playerTeams, patch.playerTeams),
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
      setTrackers(new Map());
      setFeed([]);
      setUnseen(0);
      setHateWatches({ total: 0, teams: [] });
      setPrefs(await api.prefs());
      const r = await registerForPush();
      if (r.token) api.setPushToken(r.token).catch(() => {});
    },
  }), [ready, live, feed, unseen, eventTypes, leagues, leagueInfo, prefs, follows, push, refreshFeed, games, nextF1, upNext, refreshScores, hateWatches, trackers, refreshTrackers, noteTrackers]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
