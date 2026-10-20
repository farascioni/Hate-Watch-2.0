import type { FeedItem, Target } from './types';

/**
 * Hate Watch Plus: the rules behind tracking profiles and saved alert presets, with no storage and no React so a plain node
 * script can check them (app/scripts/check-profiles.mjs). Profiles are stored by profiles.ts, presets by alertPresets.ts.
 * A profile narrows the Feed and the Tracking tab only; it never touches push notifications or `prefs.muted`.
 */

/** A named subset of the players and teams you track. */
export interface Profile { id: string; name: string; keys: string[] }

/** The target keys a profile shows, or null for no narrowing. A tracked player brings their team's key so the team's alerts about them still pass. */
export function profileScope(profile: Profile | null | undefined, follows: ReadonlyMap<string, Target>): Set<string> | null {
  if (!profile) return null;
  const scope = new Set<string>();
  for (const key of profile.keys) {
    const t = follows.get(key);
    if (!t) continue; // unfollowed since: no longer a member, though it stays listed in the profile
    scope.add(key);
    if (t.kind === 'player') scope.add(t.teamKey);
  }
  return scope;
}

/** One predicate for the Feed. Notices from Hate Watch and favorites' alerts always pass. */
export const inProfile = (scope: Set<string> | null, item: Pick<FeedItem, 'type' | 'target' | 'fav'>) =>
  !scope || item.type === 'app.notice' || !!item.fav || scope.has(item.target.key);

/** How loud one alert type is for a target: off, in the feed only, or pushed too. */
export type Tier = 'off' | 'feed' | 'push';
export type Choices = Record<string, Tier>;
export const tierOf = (on: boolean, push: boolean): Tier => (!on ? 'off' : push ? 'push' : 'feed');

/** A target's custom choices as tiers, each resolved against the global setting it would otherwise follow. */
export function snapshotChoices(
  own: Record<string, boolean>, ownPush: Record<string, boolean>,
  globalOn: (id: string) => boolean, globalPush: (id: string) => boolean,
): Choices {
  const out: Choices = {};
  for (const id of new Set([...Object.keys(own), ...Object.keys(ownPush)])) out[id] = tierOf(own[id] ?? globalOn(id), ownPush[id] ?? globalPush(id));
  return out;
}

export const uniformChoices = (ids: string[], tier: Tier): Choices => Object.fromEntries(ids.map((id) => [id, tier]));

/**
 * What applying a preset writes for one target: every current custom entry cleared, then the preset's tiers laid over
 * the alert types that exist for this target. Both maps go in one updatePrefs call (rapid calls race).
 */
export function presetPatch(choices: Choices, applicable: string[], own: Record<string, boolean>, ownPush: Record<string, boolean>) {
  const types: Record<string, boolean | null> = Object.fromEntries(Object.keys(own).map((id) => [id, null]));
  const push: Record<string, boolean | null> = Object.fromEntries(Object.keys(ownPush).map((id) => [id, null]));
  for (const id of applicable) {
    const tier = choices[id];
    if (!tier) continue;
    types[id] = tier !== 'off';
    push[id] = tier === 'off' ? null : tier === 'push';
  }
  return { types, push };
}

/** How many of a preset's alert types exist for a target; 0 means the preset can't do anything there. */
export const fitCount = (choices: Choices, applicable: string[]) => applicable.filter((id) => choices[id]).length;
