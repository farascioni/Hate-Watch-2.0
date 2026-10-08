import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventType, F1Weekend, FeedItem, GameCard, GameDetail, HateWatchTally, Leaderboard, League, Prefs, PrefsPatch, Target, Team, Player, NextGame, StatsPage } from './types';

// Point devices at your machine/server with EXPO_PUBLIC_API_URL=http://192.168.x.x:8787
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');
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
  target: (key: string) => request<Target & { roster?: Player[] }>('GET', `/targets/${enc(key)}`, undefined, false),
  /** A player's or team's stats page (not F1). */
  stats: (key: string) => request<StatsPage>('GET', `/targets/${enc(key)}/stats`, undefined, false),
  /** The alert behind a share link (/a/<code>), for the screen that link opens in the app. */
  /** The most hated players and teams. No kind = both; no league = every sport. */
  leaderboard: (f: { kind?: 'team' | 'player'; league?: League }) =>
    request<Leaderboard>('GET', `/leaderboard?limit=100${f.kind ? `&kind=${f.kind}` : ''}${f.league ? `&league=${f.league}` : ''}`, undefined, false),
  shared: (code: string) => request<{ item: FeedItem }>('GET', `/shared/${enc(code)}`, undefined, false),

  /** `trackers`: how many people (devices) track each one, you included. */
  follows: () => request<{ follows: { key: string; followedAt: number; trackers?: number; target: Target | null }[] }>('GET', '/me/follows'),
  follow: (key: string) => request<{ ok: boolean; trackers?: number }>('PUT', `/me/follows/${enc(key)}`),
  unfollow: (key: string) => request<{ ok: boolean; trackers?: number }>('DELETE', `/me/follows/${enc(key)}`),

  prefs: () => request<Prefs>('GET', '/me/prefs'),
  setPrefs: (patch: PrefsPatch) => request<Prefs>('PUT', '/me/prefs', patch),
  setPushToken: (pushToken: string | null) => request('PUT', '/me/push-token', { pushToken }),

  /** One player's or team's alerts since a time, for their page ("Recent misery"). */
  targetFeed: (key: string, after: number) => request<{ items: FeedItem[] }>('GET', `/me/feed?limit=100&target=${enc(key)}&after=${after}`),
  feed: (before?: number) => request<{ items: FeedItem[] }>('GET', `/me/feed?limit=50${before ? `&before=${before}` : ''}`),
  clearFeed: () => request('DELETE', '/me/feed'),
  scores: () => request<{ games: GameCard[]; nextF1?: F1Weekend; upNext?: NextGame[] }>('GET', '/me/scores'),
  /** Every game live now, then every one starting within a day, tracked or not (the Scores tab's All games). */
  allScores: () => request<{ games: GameCard[] }>('GET', '/me/scores/all'),
  hateWatches: () => request<HateWatchTally>('GET', '/me/hate-watches'),
  game: (key: string) => request<GameDetail>('GET', `/me/games/${enc(key)}`),
  deleteMe: () => request('DELETE', '/me'),
  simulate: () => request('POST', '/dev/simulate', {}),
};
