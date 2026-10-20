import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Target } from './types';
import { usePlus } from './plus';
import { profileScope, type Profile } from './profileLogic';

/**
 * Hate Watch Plus: tracking profiles. A profile is a named subset of the players and teams you track ("Playoff teams", "Work
 * rivals"); the active one narrows the Feed and the Tracking tab to it (rules in profileLogic.ts). It never changes which
 * notifications you get. Kept on this device only; a lapsed subscription only hides the profiles (the Feed and Tracking go
 * back to everyone, and they return on resubscribing); deleting the device's data clears them.
 */
const KEY = 'hw.profiles';
// shortcut: a hard cap and a short name keep the stored list small; raise them if people hit them.
export const MAX_PROFILES = 12;
export const MAX_NAME = 24;

interface State { list: Profile[]; active: string | null }
let state: State = { list: [], active: null };
const listeners = new Set<() => void>();

const publish = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
};

export const profilesLoaded = AsyncStorage.getItem(KEY).then((raw) => {
  if (!raw) return;
  const stored: unknown = JSON.parse(raw);
  const list = (stored as State)?.list;
  if (!Array.isArray(list)) return;
  const valid = list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.keys));
  // Profiles made while this was loading stay on top of what was stored.
  const next = [...valid.filter((p) => !state.list.some((m) => m.id === p.id)), ...state.list];
  const active = state.active ?? ((stored as State).active && next.some((p) => p.id === (stored as State).active) ? (stored as State).active : null);
  state = { list: next, active };
  listeners.forEach((l) => l());
}).catch(() => {});

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const cleanName = (name: string) => name.trim().slice(0, MAX_NAME);

/** Creates a profile (and makes it the active one) or, with an id, renames and re-members it. Returns false if the name is empty or the cap is hit. */
export const saveProfile = (input: { id?: string; name: string; keys: string[] }): boolean => {
  const name = cleanName(input.name);
  if (!name) return false;
  if (input.id) {
    if (!state.list.some((p) => p.id === input.id)) return false;
    publish({ ...state, list: state.list.map((p) => (p.id === input.id ? { ...p, name, keys: input.keys } : p)) });
    return true;
  }
  if (state.list.length >= MAX_PROFILES) return false;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  publish({ list: [...state.list, { id, name, keys: input.keys }], active: id });
  return true;
};
export const deleteProfile = (id: string) => publish({ list: state.list.filter((p) => p.id !== id), active: state.active === id ? null : state.active });
/** Null goes back to everyone. */
export const setActiveProfile = (id: string | null) => { if (id !== state.active) publish({ ...state, active: id }); };
export const clearProfiles = () => { if (state.list.length || state.active) publish({ list: [], active: null }); };

/** The profiles, replaced (never changed in place) on every change. */
export const useProfiles = () => useSyncExternalStore(subscribe, () => state);

/** The active profile's scope for the Feed and Tracking tab: null (no narrowing) for Everyone, a lapsed subscription, or a profile that's gone. */
export function useProfileScope(follows: ReadonlyMap<string, Target>): { scope: Set<string> | null; profile: Profile | null } {
  const { active: plus } = usePlus();
  const { list, active } = useProfiles();
  const profile = plus ? list.find((p) => p.id === active) ?? null : null;
  const scope = useMemo(() => profileScope(profile, follows), [profile, follows]);
  return { scope, profile };
}
