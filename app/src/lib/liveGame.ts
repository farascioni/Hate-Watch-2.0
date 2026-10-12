import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from './api';
import { useStore } from './store';
import type { GameCard, Target } from './types';

/** How often a team page re-reads the live games it has no socket feed for (the Scores tab's "All games" rate). */
const LIVE_GAME_MS = 15_000;

/**
 * The live game a team (or a player's team) is in right now, for the "Live now" card on its Stats tab.
 * A game you track comes from the store, fed by the socket; for any other team the page reads
 * `/me/scores/all` (every game live now) every 15 seconds while it's on screen (not while a game screen is
 * open above it). F1 and the UFC have no team games.
 */
export function useLiveGame(target: Target): GameCard | null {
  const { games, follows } = useStore();
  const teamKey = target.kind === 'team' ? target.key : target.teamKey;
  const eligible = !!teamKey && target.league !== 'f1' && target.league !== 'ufc';
  const ofTeam = (g: GameCard) => g.home?.team.key === teamKey || g.away?.team.key === teamKey;
  // The store holds every game of a team you track (or whose player you track); for any other team it holds
  // only games that happen to involve one you do (a final from yesterday), so those still need the read.
  const tracked = follows.has(teamKey) || [...follows.values()].some((t) => t.kind === 'player' && t.teamKey === teamKey);
  const stored = eligible ? [...games.values()].find((g) => g.state === 'in' && ofTeam(g)) ?? null : null;
  const [read, setRead] = useState<GameCard | null>(null);
  useFocusEffect(useCallback(() => {
    if (!eligible || tracked) { setRead(null); return; }
    let live = true;
    const load = () => api.allScores().then((r) => { if (live) setRead(r.games.find((g) => g.state === 'in' && (g.home?.team.key === teamKey || g.away?.team.key === teamKey)) ?? null); }, () => {});
    load();
    const timer = setInterval(load, LIVE_GAME_MS);
    return () => { live = false; clearInterval(timer); };
  }, [teamKey, eligible, tracked]));
  return useMemo(() => stored ?? read, [stored, read]);
}
