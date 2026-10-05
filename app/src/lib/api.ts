import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventType, FeedItem, League, Prefs, PrefsPatch, Target, Team, Player } from './types';

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
  teams: (league?: League) => request<{ teams: Team[] }>('GET', `/teams${league ? `?league=${league}` : ''}`, undefined, false),
  target: (key: string) => request<Target & { roster?: Player[] }>('GET', `/targets/${enc(key)}`, undefined, false),
  /** The alert behind a share link (/a/<code>), for the screen that link opens in the app. */
  shared: (code: string) => request<{ item: FeedItem }>('GET', `/shared/${enc(code)}`, undefined, false),

  follows: () => request<{ follows: { key: string; followedAt: number; target: Target | null }[] }>('GET', '/me/follows'),
  follow: (key: string) => request('PUT', `/me/follows/${enc(key)}`),
  unfollow: (key: string) => request('DELETE', `/me/follows/${enc(key)}`),

  prefs: () => request<Prefs>('GET', '/me/prefs'),
  setPrefs: (patch: PrefsPatch) => request<Prefs>('PUT', '/me/prefs', patch),
  setPushToken: (pushToken: string | null) => request('PUT', '/me/push-token', { pushToken }),

  feed: (before?: number) => request<{ items: FeedItem[] }>('GET', `/me/feed?limit=50${before ? `&before=${before}` : ''}`),
  clearFeed: () => request('DELETE', '/me/feed'),
  deleteMe: () => request('DELETE', '/me'),
  simulate: () => request('POST', '/dev/simulate', {}),
};
