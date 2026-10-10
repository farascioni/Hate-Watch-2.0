import { router } from 'expo-router';
import type { FeedItem, Target } from './types';

/**
 * Alerts opened on their own screen (app/alert/[id].tsx), by id: the screen shows the one you tapped, wherever it
 * was listed (the feed, a game's or a player's page, a shared alert), even one the feed doesn't have.
 */
const opened = new Map<string, FeedItem>();

/** An alert's own screen: all of its text (a card in a list shows three lines), its clip, and who it's about. */
export function openAlert(item: FeedItem) {
  opened.set(item.id, item);
  router.push(`/alert/${encodeURIComponent(item.id)}`);
}

export const openedAlert = (id: string) => opened.get(id);

/** Where who an alert is about opens: their player or team page. */
export const targetHref = (target: Target) => `/target/${encodeURIComponent(target.key)}`;
