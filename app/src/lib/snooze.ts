// Snoozing a tracked player or team (Prefs.snoozed, server/src/fanout.ts isMuted): muted until a time instead of for
// good. The server decides the push; the app only shows it and lets you set or end it. An end in the past counts for nothing.
import { currentLocale } from './i18n';
import type { Prefs } from './types';

export const DAY_MS = 86_400_000;

/** Unix ms this target's snooze ends, or 0 when it has none or it has ended. */
export const snoozeEnd = (p: Pick<Prefs, 'snoozed'> | null | undefined, key: string, now = Date.now()) => {
  const until = p?.snoozed?.[key] ?? 0;
  return until > now ? until : 0;
};

/** "Tue, Oct 20": the weekday and the date, since a week-long snooze ends on the weekday it began. */
export const snoozeDay = (until: number) => new Date(until).toLocaleDateString(currentLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
