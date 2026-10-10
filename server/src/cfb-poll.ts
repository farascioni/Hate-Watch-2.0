// College football's AP Top 25: when a new poll comes out (Sunday afternoons in the season), a tracked team
// that fell in it, or fell out of it. ESPN's rankings have each team's rank in this poll and the last one, and
// who dropped out, so the poll alone says what changed; the week last seen (kv `cfb:ap:week`) keeps a deploy
// or restart from announcing a poll already out (the first read is a silent baseline).
import { getJson as espnGetJson } from './espn.ts';
import { kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { teamKey, urls } from './leagues.ts';
import { publish } from './fanout.ts';
import type { Detected } from './detectors.ts';

/** Seam for tests (test/cfb.test.ts). */
export const cfbPollDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any>, now: () => Date.now() };
export const POLL_MS = 30 * 60_000;

/** A poll's alerts: each team lower than last week ("fell to No. 14"), and each that dropped out. Pure. */
export function pollEvents(poll: any, at: number): Detected[] {
  const week = `${poll?.season?.year ?? ''}:${poll?.occurrence?.number ?? poll?.date ?? ''}`, label = String(poll?.occurrence?.displayValue ?? '');
  const out: Detected[] = [];
  const make = (teamId: string, type: string, title: (name: string) => string, body: string) => {
    const team = catalog.teamByEspn('cfb', teamId);
    if (team) out.push({ id: `cfbap:${week}:${type}:${teamId}`, type, targetKey: teamKey('cfb', teamId), title: title(team.shortName), body: [body, label].filter(Boolean).join(' · '), at });
  };
  for (const r of poll?.ranks ?? []) {
    const now = Number(r.current), was = Number(r.previous);
    if (was > 0 && now > was) make(String(r.team?.id), 'cfb.poll_drop', (n) => `${n} fell to No. ${now} in the AP poll`, `Down from No. ${was}`);
  }
  for (const r of poll?.droppedOut ?? []) {
    const was = Number(r.previous);
    if (was > 0) make(String(r.team?.id), 'cfb.poll_out', (n) => `${n} dropped out of the AP Top 25`, `Was No. ${was}`);
  }
  return out;
}

/** Reads ESPN's rankings; a new AP poll's alerts, once a week. */
export async function scanCfbPoll() {
  const res = await cfbPollDeps.getJson(urls.cfbRankings(), { timeoutMs: 8000 });
  const poll = (res?.rankings ?? []).find((x: any) => x.type === 'ap' || /^AP\b/.test(String(x.name ?? '')));
  if (!poll?.ranks?.length) return;
  const week = `${poll.season?.year ?? ''}:${poll.occurrence?.number ?? poll.date ?? ''}`;
  const seen = kvGet<string>('cfb:ap:week');
  kvSet('cfb:ap:week', week);
  if (!seen || seen === week) return; // the first read is the baseline; the same poll again is nothing new
  const events = pollEvents(poll, cfbPollDeps.now());
  if (events.length) publish(events, 'cfb');
}
