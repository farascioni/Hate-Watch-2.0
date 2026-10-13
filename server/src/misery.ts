// Recent misery: the priority things that happened to a team, player, fighter or driver, the same list for
// everyone. A player's or team's page shows it on its second tab (GET /targets/:key/misery, api.ts).
//
// It is not anybody's feed. The feed is per device (its alert settings, what it tracks); this is one table,
// `misery`, written once per happening whether or not anyone tracks the target:
//   - publish() (fanout.ts) hands every alert it is given to recordMisery() first, before it drops the ones nobody
//     tracks. Only PRIORITY types are kept, and a loss and its facts become ONE row per team (see below).
//   - The scoreboard loop (live.ts) records the loss of every final no tracker covers (recordFinalOnBoard), from the
//     scoreboard it has already read: no ESPN call is added for this. Finals the server never reads (a league
//     with no tracked team on the day it was off, F1 and the UFC when nobody tracks a driver or fighter) have no row.
// The alert path never reads this table, and recording never changes whether, when or to whom an alert goes out
// (docs/duplicate-alerts.md: this is a separate table, written from the alert's own id, idempotent).
//
// One loss, one row. The detectors make a loss as several alerts sharing a moment: the team's `team.lost`, soccer's
// 3+ goal `<league>.team.heavy_loss`, facts that carry `meta.lostId` (a walk-off, "lost as 64% favorites"), and each
// player's `player.team_lost`. Here the loss is the row (id = the loss's id, `${gameId}:final:team.lost:${teamId}`),
// the facts' `fold` sentences are its `lines`, a heavy loss gives it its title, and `player.team_lost` is not stored:
// a player's page finds their team's losses through `players.team_key` (miseryRows).
//
// How bad a loss was: a loss row's severity (loss-rating.ts) is internal: it is shown nowhere and not stored. `ratingOf`
// works it out when something needs it, from the margin the row kept in its meta (or, for a row that lost it, the body's
// "Final Score: 4 to 1"), so every row has one. The row keeps only what it needs (`metaOf`: the margin, the score, and
// `preseason`, which is never rated).
//
// Retention: rows older than KEEP_DAYS go; a page shows the last MISERY_DAYS, at most MISERY_LIMIT.
import { db, kvGet, kvSet, shareCode, tx } from './db.ts';
import { eliminationOf, gameLostEvent, heavyLossEvent, seriesStanding, type Detected } from './detectors.ts';
import { SOCCER, type League } from './leagues.ts';
import { marginFromBody, rateLoss, type LossRating } from './loss-rating.ts';

export const MISERY_DAYS = 30;
export const MISERY_LIMIT = 30;
const KEEP_DAYS = 60;
const DAY_MS = 24 * 3600_000;

/** The loss itself, for the alerts that are one: a team's, a UFC fighter's, an F1 constructor's bad race. */
const LOSSES = new Set(['team.lost', 'ufc.lost', 'f1.team.no_points', 'f1.team.double_dnf']);
const isHeavy = (type: string) => type.endsWith('.team.heavy_loss');

/**
 * Every other alert worth a line on someone's page, by type: the ones that are a bad day or a bad turn, not a bad
 * play (no strikeouts, misses, fouls, turnovers or incompletions: they are what Alerts are for). Soccer's are
 * `<league>.<key>` for every soccer league. Extend here and nowhere else; docs/recent-misery.md lists them.
 */
const SOCCER_KEYS = ['red_card', 'own_goal', 'penalty_missed', 'team.relegation_zone'];
export const PRIORITY = new Set([
  // Teams
  'team.eliminated', 'team.swept', 'team.below_500', 'team.losing_streak', 'team.off_field', 'team.fine_suspension',
  'mlb.team.no_hit', 'nfl.safety', 'cfb.safety', 'cfb.poll_out', 'cfb.poll_drop', 'cfb.team.qb_pulled', 'cfb.team.ejection',
  // Players
  'player.injured', 'player.ejected', 'off_field', 'fine_suspension',
  'mlb.pitcher.blown_save', 'mlb.pitcher.loss', 'mlb.pitcher.chased',
  'nfl.qb.pulled', 'nhl.goalie.pulled',
  'nba.technical', 'nba.fouled_out', 'wnba.technical', 'wnba.fouled_out',
  // F1 drivers
  'f1.driver.dnf', 'f1.driver.out_of_points', 'f1.driver.lost_places', 'f1.driver.beaten_by_teammate', 'f1.driver.lapped', 'f1.driver.quali_knockout',
  ...[...SOCCER].flatMap((lg) => SOCCER_KEYS.map((k) => `${lg}.${k}`)),
]);

/** ESPN's injury statuses worth a line: Out, injured reserve, out for the season (parseInjuryReport's wording). */
const SERIOUS_INJURY = /\b(out|injured reserve|ir|60-day|season|suspension)\b/i;

db.exec(`
CREATE TABLE IF NOT EXISTS misery (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, type TEXT NOT NULL, league TEXT NOT NULL, game_id TEXT,
  target_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, lines TEXT,
  occurred_at INTEGER NOT NULL, meta TEXT, share_code TEXT NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS misery_target ON misery(target_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS misery_share ON misery(share_code);
`);

export interface MiseryRow {
  id: string; kind: 'loss' | 'event'; type: string; league: string; game_id: string | null; target_key: string; title: string; body: string;
  lines: string | null; occurred_at: number; meta: string | null; share_code: string; source: 'tracker' | 'board' | 'backfill';
}

type Judged = Pick<Detected, 'type' | 'title' | 'meta' | 'targetKey'> & { aliases?: string[] };

/**
 * The alert's own type, or the first of its aliases, that a page shows: facts that land in one read are one alert
 * under the first in their order, the rest its `aliases` (a pitcher's "no quality start" and "took the loss"), so
 * an alert is judged by all of them, the way a device's settings do (`isHateWatch`).
 */
function shownType(e: Judged): string | null {
  return [e.type, ...(e.aliases ?? [])].find((t) => LOSSES.has(t) || isHeavy(t) || PRIORITY.has(t)) ?? null;
}

/** Is this alert one a page shows? (A loss is, as is anything in PRIORITY; an injury only when serious.) */
export function isMisery(e: Judged): boolean {
  if (e.meta?.withdrawn || e.type === 'player.team_lost') return false;
  if (LOSSES.has(e.type) || isHeavy(e.type)) return true;
  if (typeof e.meta?.lostId === 'string') return e.targetKey === e.meta.teamKey; // a fact of the loss; a player's copy of it isn't
  if (e.type === 'player.injured') return SERIOUS_INJURY.test(String(e.meta?.status ?? e.title.match(/\(([^)]*)\)$|to (.+)$/)?.slice(1).find(Boolean) ?? ''));
  return shownType(e) !== null;
}

/**
 * "Successful Hate Watch!" is what a loss is to someone who tracks the team: the list is the same for everyone, so a
 * loss is stored without it and the app puts it back for a viewer who tracks the team or player (the row's `loss` flag).
 */
const HATE_WATCH = /^Successful Hate Watch! /;
const plain = (title: string) => title.replace(HATE_WATCH, '');

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

/**
 * What a row keeps of its alert's meta: the game, who won, the score and margin (the loss rating reads the margin),
 * whether it ended a season, and whether it was a preseason game (`preseason`, set by the tracker and the scoreboard
 * path: a preseason loss is recorded like any other but never rated).
 */
const metaOf = (m: Detected['meta']) => ({ gameId: m?.gameId, winnerId: m?.winnerId, score: m?.score, margin: m?.margin, eliminated: m?.eliminated, preseason: m?.preseason });

/**
 * Put one alert, as publish() was given it, on the list. Safe to call twice with the same alert, and never throws:
 * a failure here must not cost anyone an alert.
 */
export function recordMisery(e: Detected, league: League, source: MiseryRow['source'] = 'tracker', now = Date.now()) {
  try { record(e, league, source, now); } catch (err) { console.error('[misery]', e.id, err); }
}

function record(e: Detected, league: League, source: MiseryRow['source'], now: number) {
  if (!isMisery(e)) return;
  if (e.at < now - KEEP_DAYS * DAY_MS) return;
  const lostId = typeof e.meta?.lostId === 'string' ? e.meta.lostId : null;
  if (lostId && !isHeavy(e.type)) { // a fact of a loss: a line on its row
    const row = db.prepare('SELECT lines FROM misery WHERE id = ?').get(lostId) as { lines: string | null } | undefined;
    if (!row || !e.fold) return; // no loss row yet (the loss comes first in a publish), or a fact with nothing to say
    const lines: string[] = row.lines ? JSON.parse(row.lines) : [];
    if (!lines.includes(e.fold)) db.prepare('UPDATE misery SET lines = ? WHERE id = ?').run(JSON.stringify([...lines, e.fold]), lostId);
    return;
  }
  const loss = LOSSES.has(e.type) || isHeavy(e.type);
  const type = shownType(e) ?? e.type; // a pitcher's loss folded under "no quality start" is a loss on the page
  const id = loss ? lostId ?? e.id : e.id; // soccer's heavy loss is the row of the loss it belongs to
  db.prepare(`INSERT INTO misery (id, kind, type, league, game_id, target_key, title, body, lines, occurred_at, meta, share_code, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET type = excluded.type, title = excluded.title, body = excluded.body, meta = excluded.meta, source = excluded.source
      WHERE (misery.source != 'tracker' AND excluded.source = 'tracker')
         OR (excluded.type LIKE '%.team.heavy_loss' AND misery.type NOT LIKE '%.team.heavy_loss')`)
    .run(id, loss ? 'loss' : 'event', type, league, ((e.meta?.gameId ?? e.meta?.compId) as string | undefined) ?? null, e.targetKey, plain(e.title), e.body,
      e.at, json(metaOf(e.meta)), shareCode(id), source);
  prune(now);
}

/**
 * An alert changed after it went out (fanout.ts reviseEvent: an F1 result a penalty changed): the row takes the new
 * words and facts, or goes if the alert no longer stands or is no longer one a page shows. Its facts are refreshed key
 * by key, only the ones the revision has, so a corrected score gives a corrected margin (the loss rating reads it) and a
 * revision that doesn't carry the margin keeps the row's own.
 */
export function reviseMisery(id: string, e: Judged & Pick<Detected, 'body'> & { withdrawn?: boolean }) {
  if (e.withdrawn || !isMisery({ ...e, meta: { ...e.meta, withdrawn: e.withdrawn } })) { db.prepare('DELETE FROM misery WHERE id = ?').run(id); return; }
  const was = db.prepare('SELECT meta FROM misery WHERE id = ?').get(id) as { meta: string | null } | undefined;
  const fresh = Object.fromEntries(Object.entries(metaOf(e.meta)).filter(([, v]) => v !== undefined));
  db.prepare('UPDATE misery SET type = ?, title = ?, body = ?, meta = ? WHERE id = ?')
    .run(shownType(e) ?? e.type, plain(e.title), e.body, json({ ...(was?.meta ? JSON.parse(was.meta) : {}), ...fresh }), id);
}

/**
 * The loss of a final the scoreboard shows and no tracker covers, written exactly as a tracker would word it
 * (gameLostEvent, heavyLossEvent) from the scoreboard event the loop already has. A tracked game's own row, with its
 * facts, replaces this one (`source`), so it is no worse for being second. Returns whether it recorded one.
 */
const onBoard = new Set<string>();
export function recordFinalOnBoard(lg: League, ev: any, now = Date.now()): boolean {
  try { return board(lg, ev, now); } catch (err) { console.error('[misery]', lg, ev?.id, err); return false; }
}

function board(lg: League, ev: any, now: number): boolean {
  const comp = ev?.competitions?.[0];
  const [home, away] = [comp?.competitors?.find((c: any) => c.homeAway === 'home'), comp?.competitors?.find((c: any) => c.homeAway === 'away')];
  if (!home || !away || !ev.status?.type?.completed || onBoard.has(`${lg}:${ev.id}`)) return false;
  onBoard.add(`${lg}:${ev.id}`);
  if (onBoard.size > 5000) onBoard.clear();
  const final = { home: Number(home.score), away: Number(away.score) };
  if (!Number.isFinite(final.home) || !Number.isFinite(final.away)) return false;
  const g = { league: lg, gameId: String(ev.id), homeId: String(home.id), awayId: String(away.id) };
  const at = Math.min(now, Date.parse(ev.date) + 3.5 * 3600_000); // the scoreboard has no end time: about when it ended
  const out = eliminationOf(lg, ev);
  const lost = gameLostEvent(g, final, at, out, out ? null : seriesStanding(ev));
  if (!lost) return false; // a tie
  if (ev.season?.type === 1) lost.meta = { ...lost.meta, preseason: true }; // recorded like any other, never rated (ratingOf)
  const heavy = heavyLossEvent(g, lost, final);
  if (heavy && lost.meta?.preseason) heavy.meta = { ...heavy.meta, preseason: true };
  recordMisery(heavy ?? lost, lg, 'board', now);
  if (heavy) recordMisery(lost, lg, 'board', now);
  return true;
}

let pruned = 0;
function prune(now: number) {
  if (now - pruned < 6 * 3600_000) return;
  pruned = now;
  db.prepare('DELETE FROM misery WHERE occurred_at < ?').run(now - KEEP_DAYS * DAY_MS);
}

/**
 * What a page shows, newest first: the target's own rows, and for a player their team's losses too (a player's page
 * says their team lost, as "their team lost" alerts do). Public: it is the same for everyone.
 */
export function miseryRows(targetKey: string, now = Date.now(), days = MISERY_DAYS, limit = MISERY_LIMIT): MiseryRow[] {
  const player = targetKey.startsWith('player:');
  return db.prepare(`SELECT * FROM misery WHERE occurred_at > ? AND (target_key = ?${player ? ` OR (kind = 'loss' AND target_key = (SELECT team_key FROM players WHERE key = ?))` : ''})
    ORDER BY occurred_at DESC, id LIMIT ?`).all(now - days * DAY_MS, targetKey, ...(player ? [targetKey] : []), limit) as unknown as MiseryRow[];
}

/**
 * How bad a loss row was (loss-rating.ts), internal (shown nowhere), worked out from the row's own facts, so every row
 * stored since the table began has one if it has a margin. Null for anything that isn't a rated loss: an event, a league with
 * no blowout size (UFC, F1), a preseason game, and a loss with no margin. The margin is the one the alert kept; failing
 * that, the one in the body's "Final Score: 4 to 1" (backfilled rows and 3+ goal soccer losses stored before they kept it).
 * A margin is never guessed at.
 */
export function ratingOf(r: Pick<MiseryRow, 'kind' | 'league' | 'body' | 'meta'>): LossRating | null {
  if (r.kind !== 'loss') return null;
  let meta: { margin?: unknown; preseason?: unknown } = {};
  try { meta = r.meta ? JSON.parse(r.meta) : {}; } catch { /* a row with unreadable meta falls back to its body */ }
  if (meta.preseason) return null;
  return rateLoss(r.league, { margin: typeof meta.margin === 'number' ? meta.margin : marginFromBody(r.body) });
}

/** A row by its share link's code, shaped like an `events` row (share.ts): a shared alert nobody tracked still opens. */
export function miseryByCode(code: string) {
  const r = db.prepare('SELECT * FROM misery WHERE share_code = ?').get(code) as MiseryRow | undefined;
  return r ? { id: r.id, type: r.type, league: r.league, game_id: r.game_id, target_key: r.target_key, title: r.title, body: r.body, meta: r.meta,
    occurred_at: r.occurred_at, detected_at: r.occurred_at, share_code: r.share_code, extra: r.lines } : undefined;
}

// Recent misery came after launch: the priority alerts and losses already stored become rows (once), so the
// pages are not empty on the day it ships. Facts' lines weren't kept with the alert, so these rows have none.
if (!kvGet<boolean>('misery_backfilled')) {
  const since = Date.now() - KEEP_DAYS * DAY_MS;
  const rows = db.prepare('SELECT * FROM events WHERE occurred_at > ? ORDER BY occurred_at, detected_at').all(since) as any[];
  tx(() => { for (const r of rows) {
    const meta = r.meta ? JSON.parse(r.meta) : null;
    recordMisery({ id: r.id, type: r.type, targetKey: r.target_key, title: r.title, body: r.body, at: r.occurred_at, aliases: meta?.aliases ?? undefined, meta: { ...meta, gameId: r.game_id ?? meta?.gameId } }, r.league, 'backfill');
  } });
  kvSet('misery_backfilled', true);
}
