import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventType, F1Weekend, Favorite, FavoritePatch, FeedItem, GameCard, GameDetail, LiveBoard, HateWatchTally, Leaderboard, League, Prefs, PrefsPatch, Target, UpcomingEvent, Team, Player, NextGame, StatsPage, WeightClass, F1Preview, UfcCard } from './types';

// Point devices at your machine/server with EXPO_PUBLIC_API_URL=http://192.168.x.x:8787
// Without it, a release build (a TestFlight build, or an over-the-air update published without it) uses production's,
// never localhost: only a development build falls back to this machine.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:8787' : 'https://hate-watch-api.fly.dev')).replace(/\/$/, '');
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

const TOKEN_KEY = 'hatewatch.token';
const storage = {
  get: (k: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

let token: string | null = null;

/** Anonymous account: the server mints a device token on first launch; it lives in the keychain/keystore. */
export async function ensureToken(): Promise<string> {
  if (token) return token;
  token = await storage.get(TOKEN_KEY);
  if (!token) {
    const res = await request<{ token: string }>('POST', '/devices', { platform: Platform.OS }, false);
    token = res.token;
    await storage.set(TOKEN_KEY, token);
  }
  return token;
}

/** Drop the stored identity; the next request registers a fresh anonymous device. */
export async function forgetToken() {
  token = null;
  await storage.del(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${await ensureToken()}`;
  const res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && auth) {
    // Server lost our device (fresh DB). Re-register once.
    token = null;
    await storage.del(TOKEN_KEY);
    return request(method, path, body, auth);
  }
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const api = {
  eventTypes: () => request<{ leagues: { id: League; name: string }[]; types: EventType[] }>('GET', '/catalog/event-types', undefined, false),
  search: (q: string, league?: League, kind?: 'team' | 'player') =>
    request<{ results: Target[] }>('GET', `/search?q=${enc(q)}${league ? `&league=${league}` : ''}${kind ? `&kind=${kind}` : ''}&limit=50`, undefined, false),
  /** Every team (in a league): A-Z, or by league and division (each with its `division`). */
  teams: (league?: League, byDivision = false) => {
    const q = [league && `league=${league}`, byDivision && 'by=division'].filter(Boolean).join('&');
    return request<{ teams: Team[] }>('GET', `/teams${q ? `?${q}` : ''}`, undefined, false);
  },
  /** The UFC's weight classes, heaviest first, each its champion and top five fighters. */
  weightClasses: () => request<{ classes: WeightClass[] }>('GET', '/ufc/weight-classes', undefined, false),
  target: (key: string) => request<Target & { roster?: Player[] }>('GET', `/targets/${enc(key)}`, undefined, false),
  /** A player's or team's stats page (every league: F1's from f1-stats.ts, the UFC's from ufc.ts). */
  stats: (key: string) => request<StatsPage>('GET', `/targets/${enc(key)}/stats`, undefined, false),
  /** The newest iOS build (null until the server has one recorded) and the TestFlight or App Store link that gets it, for the "update available" alert (lib/updates.ts). */
  latestBuild: () => request<{ ios: number | null; url: string }>('GET', '/app/latest-build', undefined, false),
  /** The alert behind a share link (/a/<code>), for the screen that link opens in the app. */
  /** The most hated players and teams. No kind = both; no league = every sport. */
  leaderboard: (f: { kind?: 'team' | 'player'; league?: League }) =>
    request<Leaderboard>('GET', `/leaderboard?limit=100${f.kind ? `&kind=${f.kind}` : ''}${f.league ? `&league=${f.league}` : ''}`, undefined, false),
  shared: (code: string) => request<{ item: FeedItem }>('GET', `/shared/${enc(code)}`, undefined, false),

  /** `trackers`: how many people (devices) track each one, you included. */
  follows: () => request<{ follows: { key: string; followedAt: number; trackers?: number; target: Target | null }[] }>('GET', '/me/follows'),
  follow: (key: string) => request<{ ok: boolean; trackers?: number }>('PUT', `/me/follows/${enc(key)}`),
  unfollow: (key: string) => request<{ ok: boolean; trackers?: number }>('DELETE', `/me/follows/${enc(key)}`),

  /** Hate Watch Plus favorites: a team you root for. Its current opponent's alerts reach you for that game only. */
  favorites: () => request<{ favorites: Favorite[] }>('GET', '/me/favorites'),
  addFavorite: (key: string) => request<{ favorite: Favorite }>('PUT', `/me/favorites/${enc(key)}`),
  /** null removes a choice (back to the global setting). */
  updateFavorite: (key: string, patch: FavoritePatch) => request<{ favorite: Favorite }>('PUT', `/me/favorites/${enc(key)}/settings`, patch),
  removeFavorite: (key: string) => request('DELETE', `/me/favorites/${enc(key)}`),
  clearFavorites: () => request('DELETE', '/me/favorites'),
  /** The lock screen scoreboard: send what the server can't know (most hated, the activity's push token); it answers with the board now. */
  putLiveActivity: (body: { mostHated?: string[]; layout?: 'compact' | 'detailed' | 'grid' | 'hero'; activityToken?: string; sandbox?: boolean; pins?: string[]; hides?: string[] }) =>
    request<{ board: LiveBoard | null }>('PUT', '/me/live-activity', body),
  deleteLiveActivity: () => request('DELETE', '/me/live-activity'),

  prefs: () => request<Prefs>('GET', '/me/prefs'),
  setPrefs: (patch: PrefsPatch) => request<Prefs>('PUT', '/me/prefs', patch),
  resetPrefs: () => request<Prefs>('DELETE', '/me/prefs'),
  setPushToken: (pushToken: string | null) => request('PUT', '/me/push-token', { pushToken }),

  /** One player's or team's alerts to this device since a time: Recent misery's fallback for a server without /misery. */
  /** Recent misery: the priority things that happened to one player or team in the last 30 days, the same for everyone (server misery.ts). */
  misery: (key: string) => request<{ items: FeedItem[]; days: number }>('GET', `/targets/${enc(key)}/misery`),
  targetFeed: (key: string, after: number) => request<{ items: FeedItem[] }>('GET', `/me/feed?limit=100&target=${enc(key)}&after=${after}`),
  feed: (before?: number) => request<{ items: FeedItem[] }>('GET', `/me/feed?limit=50${before ? `&before=${before}` : ''}`),
  clearFeed: () => request('DELETE', '/me/feed'),
  scores: () => request<{ games: GameCard[]; nextF1?: F1Weekend; upNext?: NextGame[] }>('GET', '/me/scores'),
  /** Every game live now, then every one starting within a day, tracked or not (the Scores tab's All games). */
  allScores: () => request<{ games: GameCard[] }>('GET', '/me/scores/all'),
  /** Playoff games and series starting within 7 days, with the vote on who loses (a server from before it answers 404). */
  upcomingEvents: () => request<{ events: UpcomingEvent[]; started?: UpcomingEvent[] }>('GET', '/me/events/upcoming'),
  alertEvent: (voteKey: string, on: boolean) => request<{ event: UpcomingEvent }>('PUT', `/me/events/${enc(voteKey)}/alert`, { on }),
  voteEvent: (voteKey: string, team: string) => request<{ event: UpcomingEvent }>('PUT', `/me/events/${enc(voteKey)}/vote`, { team }),
  hateWatches: () => request<HateWatchTally>('GET', '/me/hate-watches'),
  game: (key: string) => request<GameDetail>('GET', `/me/games/${enc(key)}`),
  /** Every F1 driver, by constructor (a server from before it answers 404). */
  f1Drivers: () => request<{ drivers: Player[] }>('GET', '/f1/drivers', undefined, false),
  /** An F1 weekend's preview (a server from before it answers 404). */
  f1Preview: (eventId: string) => request<F1Preview>('GET', `/f1/events/${enc(eventId)}/preview`, undefined, false),
  /** The UFC's next card (tonight's until the night's over) and the one after. */
  ufcCards: () => request<{ cards: UfcCard[] }>('GET', '/ufc/cards', undefined, false),
  ufcCard: (eventId: string) => request<UfcCard>('GET', `/ufc/cards/${enc(eventId)}`, undefined, false),
  deleteMe: () => request('DELETE', '/me'),
  // Dev only (the Settings button is __DEV__ too); the guard keeps '/dev/simulate' out of release builds.
  simulate: () => (__DEV__ ? request('POST', '/dev/simulate', {}) : Promise.reject(new Error('dev only'))),
};
