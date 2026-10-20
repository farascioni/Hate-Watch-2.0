import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Choices } from './profileLogic';

/**
 * Hate Watch Plus: saved alert presets. A preset is a named set of alert choices (each alert type off, in the feed only,
 * or pushed) saved from one player's or team's alerts screen and applied to any other target it fits (rules in
 * profileLogic.ts). Kept on this device only; a lapsed subscription only hides the Presets button (the presets return on
 * resubscribing); deleting the device's data clears them.
 */
const KEY = 'hw.alertPresets';
// shortcut: a hard cap and a short name keep the stored list small; raise them if people hit them.
export const MAX_PRESETS = 12;
export const MAX_PRESET_NAME = 24;

export interface AlertPreset { id: string; name: string; choices: Choices }

let presets: AlertPreset[] = [];
const listeners = new Set<() => void>();

const publish = (next: AlertPreset[]) => {
  presets = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
};

export const alertPresetsLoaded = AsyncStorage.getItem(KEY).then((raw) => {
  if (!raw) return;
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) return;
  // Presets saved while this was loading stay after what was stored.
  const stored = list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.choices && typeof p.choices === 'object');
  presets = [...stored.filter((p) => !presets.some((m) => m.id === p.id)), ...presets];
  listeners.forEach((l) => l());
}).catch(() => {});

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Returns false if the name is empty, there's nothing to save, or the cap is hit. */
export const saveAlertPreset = (name: string, choices: Choices): boolean => {
  const clean = name.trim().slice(0, MAX_PRESET_NAME);
  if (!clean || !Object.keys(choices).length || presets.length >= MAX_PRESETS) return false;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  publish([...presets, { id, name: clean, choices }]);
  return true;
};
/** Renames and re-tiers a saved preset in place (same id, same place in the list). False if the name is empty, there are no choices, or the id is gone. */
export const updateAlertPreset = (id: string, name: string, choices: Choices): boolean => {
  const clean = name.trim().slice(0, MAX_PRESET_NAME);
  if (!clean || !Object.keys(choices).length || !presets.some((p) => p.id === id)) return false;
  publish(presets.map((p) => (p.id === id ? { ...p, name: clean, choices } : p)));
  return true;
};
export const deleteAlertPreset = (id: string) => publish(presets.filter((p) => p.id !== id));
export const clearAlertPresets = () => { if (presets.length) publish([]); };

/** The saved presets, replaced (never changed in place) on every change. */
export const useAlertPresets = () => useSyncExternalStore(subscribe, () => presets);
