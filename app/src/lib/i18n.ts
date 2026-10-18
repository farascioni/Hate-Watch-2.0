import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { en, type Key } from './strings/en';
import { es } from './strings/es';

/**
 * The app's own words (docs/i18n.md). English is the source and the fallback: a language file may miss a key and that key shows in English.
 * The language is the device's (read with Intl, no native module, so updates reach old builds) unless Settings → Language picks one.
 * Alert titles and bodies are written by the server in English and are not translated here.
 */
export type Lang = 'en' | 'es';
const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, es };
/** What the picker offers, each in its own language. Add a language here when its file lands in strings/. */
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
];
/** The Intl locale per language (Latin American Spanish for `es`, as the store pages). */
const TAGS: Record<Lang, string> = { en: 'en-US', es: 'es-419' };

export type LangPref = 'auto' | Lang;
const KEY = 'hw.language';
const valid = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

const deviceLang = (): Lang => {
  let tag = 'en';
  try { tag = Intl.DateTimeFormat().resolvedOptions().locale; } catch { /* no Intl: English */ }
  const base = tag.slice(0, 2).toLowerCase();
  return valid(base) ? base : 'en';
};

let pref: LangPref = 'auto';
const listeners = new Set<() => void>();
AsyncStorage.getItem(KEY).then((raw) => {
  if (!valid(raw) || raw === pref) return;
  pref = raw;
  listeners.forEach((l) => l());
}).catch(() => {});

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const setLangPref = (next: LangPref) => {
  pref = next;
  listeners.forEach((l) => l());
  (next === 'auto' ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, next)).catch(() => {});
};
export const useLangPref = () => useSyncExternalStore(subscribe, () => pref);

export const currentLang = (): Lang => (pref === 'auto' ? deviceLang() : pref);
/** The Intl locale for dates and numbers: the picked language's, else undefined (the device's own formatting, as before the picker). */
export const currentLocale = (): string | undefined => (pref === 'auto' ? undefined : TAGS[pref]);

/** `{name}` placeholders are filled from vars; when vars.n is 1 and `key_one` exists, it is used instead of `key`. */
function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang];
  const oneKey = `${key}_one` as Key;
  const raw = (vars?.n === 1 && (dict[oneKey] ?? en[oneKey])) || dict[key] || en[key];
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : raw;
}

export type T = (key: Key, vars?: Record<string, string | number>) => string;
/** For code outside React (Alert.alert, share text): the language as it is now. */
export const tr: T = (key, vars) => translate(currentLang(), key, vars);
/** For components: re-renders when the language changes. */
export function useT(): T {
  const p = useLangPref();
  return useCallback((key, vars) => translate(p === 'auto' ? deviceLang() : p, key, vars), [p]);
}
