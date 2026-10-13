// Recent misery (misery.ts): the priority things that happened to a team, player, fighter or driver, the same
// list for everyone. Recorded whether or not anyone tracks the target; one row per loss, its facts as lines;
// a player's page adds their team's losses; the scoreboard records the losses no tracker covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { publish, reviseEvent } = await import('../src/fanout.ts');
const { gameLostEvent, heavyLossEvent, lossFacts } = await import('../src/detectors.ts');
const { miseryRows, recordFinalOnBoard, isMisery, miseryByCode, ratingOf, reviseMisery, MISERY_LIMIT } = await import('../src/misery.ts');
const { startApi } = await import('../src/api.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [
  ['nba', '4', 'Chicago Bulls', 'Bulls', 'CHI'], ['nba', '7', 'Denver Nuggets', 'Nuggets', 'DEN'],
  ['mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD'], ['mlb', '26', 'San Francisco Giants', 'Giants', 'SF'],
  ['epl', '360', 'Manchester United', 'Man United', 'MAN'], ['epl', '379', 'Burnley', 'Burnley', 'BUR'],
  ['f1', 'ferrari', 'Ferrari', 'Ferrari', 'FER'],
]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:nba:1', 'nba', '1', 'Josh Giddey', 'team:nba:4');
player.run('player:mlb:2', 'mlb', '2', 'Shohei Ohtani', 'team:mlb:19');
loadCatalog();

const now = Date.now();
const rows = (key: string) => miseryRows(key, now + 60_000).map((r) => [r.id, r.type, r.title, r.lines ? JSON.parse(r.lines) : []]);

/** The Bulls' 133-128 loss to the Nuggets as the tracker publishes it: the loss, its facts, then each player's "their team lost". */
function bullsLoss(at = now - 3600_000) {
  const g = { league: 'nba' as const, gameId: 'G1', homeId: '7', awayId: '4' };
  const lost = gameLostEvent(g, { home: 133, away: 128 }, at)!;
  const facts = lossFacts(g, lost, { home: 133, away: 128 }, { pre: { chance: { home: 23, away: 77 } } as any });
  const copy = { ...lost, id: 'G1:final:player.team_lost:1', type: 'player.team_lost', targetKey: 'player:nba:1', title: 'Successful Hate Watch! Josh Giddey and the Bulls lost to the Nuggets' };
  return { lost, facts, all: [lost, ...facts, copy] };
}

test('a loss nobody tracks is recorded once, with its facts as lines, and sends nothing', () => {
  const { lost, facts, all } = bullsLoss();
  assert.ok(facts.length, 'the fixture has a fact (lost as the favorite)');
  publish(all, 'nba');
  assert.deepEqual(rows('team:nba:4'), [[lost.id, 'team.lost', lost.title.replace('Successful Hate Watch! ', ''), ['Lost as 77% favorites.']]]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events').get() as any).n, 0, 'the alert path is as before: nobody tracks it, so nothing is stored there');
  publish(all, 'nba'); // a restart finds the same final
  assert.deepEqual(rows('team:nba:4'), [[lost.id, 'team.lost', lost.title.replace('Successful Hate Watch! ', ''), ['Lost as 77% favorites.']]], 'the same row, the line not doubled');
});

test("a player's page has their team's losses, not a copy per player", () => {
  const { lost } = bullsLoss();
  assert.deepEqual(rows('player:nba:1').map((r) => r[0]), [lost.id], "Giddey's page: the Bulls' loss");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM misery WHERE target_key LIKE 'player:%'").get() as any).n, 0, "'their team lost' is not stored per player");
  assert.deepEqual(rows('player:mlb:2'), [], "Ohtani's page doesn't show the Bulls");
  assert.deepEqual(rows('team:nba:7'), [], 'the winner has nothing');
});

test('only priority alerts are kept: an ejection and a serious injury, not a strikeout or a questionable tag', () => {
  const e = (id: string, type: string, key: string, title: string, meta = {}) => ({ id, type, targetKey: key, title, body: '', at: now - 1000, meta });
  publish([
    e('K1', 'mlb.batter.strikeout', 'player:mlb:2', 'Shohei Ohtani struck out looking'),
    e('E1', 'player.ejected', 'player:mlb:2', 'Shohei Ohtani was ejected'),
    e('I1', 'player.injured', 'player:mlb:2', 'Shohei Ohtani is injured (Out)', { status: 'Out' }),
    e('I2', 'player.injured', 'player:mlb:2', 'Shohei Ohtani is injured (Questionable)', { status: 'Questionable' }),
    e('I3', 'player.injured', 'player:mlb:2', 'Shohei Ohtani downgraded to Injured Reserve'),
  ], 'mlb');
  assert.deepEqual(rows('player:mlb:2').map((r) => r[0]).sort(), ['E1', 'I1', 'I3']);
  assert.equal(isMisery({ type: 'mlb.pitcher.home_run_allowed', title: '', targetKey: 'x' }), false);
});

test('an alert is judged by its aliases too: a pitcher\'s loss folded under "no quality start" is still a loss on the page', () => {
  publish([{ id: 'P1:mlb.pitcher.no_quality_start:7', type: 'mlb.pitcher.no_quality_start', aliases: ['mlb.pitcher.loss'], targetKey: 'player:mlb:2',
    title: 'Shohei Ohtani took the loss', body: '3.2 IP, 6 ER', at: now - 2000, meta: { gameId: 'P1' } }], 'mlb');
  const row = rows('player:mlb:2').find((r) => r[0] === 'P1:mlb.pitcher.no_quality_start:7')!;
  assert.equal(row[1], 'mlb.pitcher.loss', 'shown as the loss it is');
  assert.equal(isMisery({ type: 'mlb.pitcher.no_quality_start', title: '', targetKey: 'x' }), false, 'alone, no quality start is not');
});

test("soccer's 3+ goal loss is the loss's row with its own title, in either order", () => {
  const g = { league: 'epl' as const, gameId: 'S1', homeId: '379', awayId: '360' };
  const lost = gameLostEvent(g, { home: 4, away: 1 }, now - 5000)!, heavy = heavyLossEvent(g, lost, { home: 4, away: 1 })!;
  publish([heavy, lost], 'epl'); // the order the tracker publishes
  assert.deepEqual(rows('team:epl:360').map((r) => [r[0], r[1]]), [[lost.id, 'epl.team.heavy_loss']]);
  assert.match(rows('team:epl:360')[0][2] as string, /thrashed 4-1/);
  const g2 = { ...g, gameId: 'S2' }, lost2 = gameLostEvent(g2, { home: 5, away: 0 }, now - 4000)!;
  publish([lost2, heavyLossEvent(g2, lost2, { home: 5, away: 0 })!], 'epl');
  assert.equal(rows('team:epl:360')[0][1], 'epl.team.heavy_loss', 'the heavy one wins whichever comes first');
});

test('a withdrawn alert comes off the list', () => {
  db.prepare("INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES ('d', 's', 't', '{}', 0)").run();
  db.prepare("INSERT INTO follows (device_id, target_key, created_at) VALUES ('d', 'team:f1:ferrari', 0)").run();
  const e = { id: 'R1:f1.team.no_points:team:f1:ferrari', type: 'f1.team.no_points', targetKey: 'team:f1:ferrari', title: 'Ferrari scored no points', body: '', at: now - 1000, meta: { compId: 'R1' } };
  publish([e], 'f1');
  assert.deepEqual(rows('team:f1:ferrari').map((r) => r[0]), [e.id]);
  reviseEvent(e.id, { type: e.type, title: 'Correction: Ferrari scored no points', body: '', meta: {}, withdrawn: true });
  assert.deepEqual(rows('team:f1:ferrari'), []);
});

/** A scoreboard event for a final, as ESPN sends it. */
const board = (id: string, homeId: string, awayId: string, home: number, away: number, date = new Date(now - 4 * 3600_000).toISOString()) => ({
  id, date, season: { type: 2 }, status: { type: { completed: true, state: 'post' } },
  competitions: [{ competitors: [{ homeAway: 'home', id: homeId, score: String(home) }, { homeAway: 'away', id: awayId, score: String(away) }] }],
});

test("the scoreboard records a final no tracker covers, worded as the tracker would, and a tracker's row wins", () => {
  assert.equal(recordFinalOnBoard('mlb', board('M1', '26', '19', 3, 0), now), true);
  assert.deepEqual(rows('team:mlb:19').map((r) => [r[0], r[1], r[2]]), [['M1:final:team.lost:19', 'team.lost', 'Dodgers lost to the Giants']]);
  assert.equal(recordFinalOnBoard('mlb', board('M1', '26', '19', 3, 0), now), false, 'read once');
  assert.equal(recordFinalOnBoard('mlb', board('M2', '26', '19', 4, 4), now), false, 'a tie has no loser');
  // The tracker comes later (someone followed): its row, with its text and facts, replaces the scoreboard's.
  const g = { league: 'mlb' as const, gameId: 'M1', homeId: '26', awayId: '19' };
  const lost = gameLostEvent(g, { home: 3, away: 0 }, now - 3000, null, { loserId: '19', line: 'Down 0-1 in the NLCS.' })!;
  publish([lost, ...lossFacts(g, lost, { home: 3, away: 0 }, {})], 'mlb');
  assert.match(rows('team:mlb:19')[0][2] as string, /Dodgers lost/);
  assert.match((miseryRows('team:mlb:19', now + 60_000)[0] as any).body, /Down 0-1 in the NLCS/);
  assert.equal((db.prepare("SELECT source FROM misery WHERE id = 'M1:final:team.lost:19'").get() as any).source, 'tracker');
});

test('GET /targets/:key/misery is public and the same for everyone; a share link opens a row nobody was sent', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/targets/${encodeURIComponent('team:mlb:19')}/misery`); // no device token
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.days, 30);
  assert.equal(j.items[0].title, 'Dodgers lost to the Giants');
  assert.equal(j.items[0].emoji, '🪦');
  assert.equal(j.items[0].loss, true, 'a loss says so, for the app to put "Successful Hate Watch!" back for someone who tracks the team');
  assert.equal(j.items[0].target.key, 'team:mlb:19');
  assert.equal(j.items[0].alsoGot, undefined, 'no per-device counts on a list everyone shares');
  const bulls = await (await fetch(`${base}/targets/${encodeURIComponent('team:nba:4')}/misery`)).json();
  assert.ok(bulls.items.some((i: any) => i.body.startsWith('Lost as 77% favorites.')), 'the facts are lines in front of the body, as in the feed');
  assert.equal((await fetch(`${base}/targets/${encodeURIComponent('team:nba:999')}/misery`)).status, 404);
  const code = j.items[0].shareUrl.split('/a/')[1];
  assert.equal((await (await fetch(`${base}/shared/${code}`)).json()).item.id, j.items[0].id);
  assert.ok(miseryByCode(code));
  server.close();
});

test('a page shows the last 30 days, newest first, at most 30', () => {
  const old = gameLostEvent({ league: 'nba', gameId: 'OLD', homeId: '7', awayId: '4' }, { home: 100, away: 90 }, now - 31 * 24 * 3600_000)!;
  publish([old], 'nba');
  assert.ok(!rows('team:nba:4').some((r) => r[0] === old.id), '31 days ago is off the page');
  for (let i = 0; i < 40; i++) publish([gameLostEvent({ league: 'nba', gameId: `N${i}`, homeId: '7', awayId: '4' }, { home: 100, away: 90 }, now - i * 60_000 - 10_000)!], 'nba');
  const page = rows('team:nba:4');
  assert.equal(page.length, MISERY_LIMIT);
  assert.equal(page[0][0], 'N0:final:team.lost:4', 'newest first');
});

// ─── How bad a loss was (loss-rating.ts): internal, from the margin, never shown ─────────────────────────────────────────────

const metaOf = (id: string) => JSON.parse((db.prepare('SELECT meta FROM misery WHERE id = ?').get(id) as { meta: string }).meta);

async function served(key: string) {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try { return (await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/targets/${encodeURIComponent(key)}/misery`)).json()).items as any[]; }
  finally { server.close(); }
}

test('the rating is internal: no endpoint item, title, line or body carries it, and it can still be worked out from a row', async () => {
  const lost = gameLostEvent({ league: 'mlb', gameId: 'R1', homeId: '19', awayId: '26' }, { home: 8, away: 0 }, now - 500_000)!; // the Giants lose by 8 runs
  publish([lost], 'mlb');
  const items = [...await served('team:mlb:26'), ...await served('team:mlb:19'), ...await served('player:mlb:2')];
  assert.ok(items.some((i) => i.id === lost.id), 'the loss is on the page');
  for (const i of items) {
    assert.equal(i.rating, undefined, `${i.id}: no rating field`);
    assert.doesNotMatch(`${i.title} ${i.body}`, /Loss rating|Disaster|\bUgly\b|\bRough\b|\/100/, `${i.id}: nothing about it in the words`);
  }
  const giants = items.find((i) => i.id === lost.id);
  assert.match(giants.body, /^Final Score: 8 to 0/, 'the body is the alert\'s own');
  assert.doesNotMatch(String(miseryByCode(giants.shareUrl.split('/a/')[1])?.extra ?? ''), /Loss rating/);
  assert.doesNotMatch((db.prepare('SELECT lines FROM misery WHERE id = ?').get(lost.id) as { lines: string | null }).lines ?? '', /Loss rating/);
  // Still there for code that ranks losses: 8 runs against a 7-run blowout.
  assert.deepEqual(ratingOf(db.prepare('SELECT * FROM misery WHERE id = ?').get(lost.id) as any), { score: 65, label: 'Ugly' });
});

test("a soccer 3+ goal loss keeps the loss's margin and score in either publish order, from the tracker and the scoreboard, and is rated", () => {
  const g3 = { league: 'epl' as const, gameId: 'S3', homeId: '379', awayId: '360' }, g4 = { ...g3, gameId: 'S4' };
  const lost3 = gameLostEvent(g3, { home: 4, away: 1 }, now - 7000)!, lost4 = gameLostEvent(g4, { home: 5, away: 0 }, now - 6000)!;
  publish([heavyLossEvent(g3, lost3, { home: 4, away: 1 })!, lost3], 'epl'); // the order the tracker publishes
  publish([lost4, heavyLossEvent(g4, lost4, { home: 5, away: 0 })!], 'epl'); // the heavy one second still wins the row
  recordFinalOnBoard('epl', board('S5', '379', '360', 4, 1), now);
  for (const [id, margin, score] of [[lost3.id, 3, '4-1'], [lost4.id, 5, '5-0'], ['S5:final:team.lost:360', 3, '4-1']] as const) {
    const row = db.prepare('SELECT * FROM misery WHERE id = ?').get(id) as any;
    assert.equal(row.type, 'epl.team.heavy_loss', id);
    assert.equal(metaOf(id).margin, margin, `${id} keeps its margin`);
    assert.equal(metaOf(id).score, score);
    assert.deepEqual(ratingOf(row), margin === 3 ? { score: 57, label: 'Ugly' } : { score: 85, label: 'Disaster' }, id);
  }
});

test("a loss row that lost its margin is rated from the loss alert's own body, and never guessed", () => {
  const row = (league: string, body: string, meta: string | null, kind: 'loss' | 'event' = 'loss') => ({ kind, league, body, meta });
  assert.deepEqual(ratingOf(row('epl', 'Final Score: 4 to 1', '{"gameId":"X","winnerId":"388"}')), { score: 57, label: 'Ugly' }, "Newcastle's 4-1: a soccer row stored before it kept a margin");
  assert.deepEqual(ratingOf(row('mlb', 'Down 0-1 in the NLCS. Final Score: 2 to 1', '{"gameId":"401908030"}')), { score: 8, label: null }, 'a backfilled row with only its game');
  assert.deepEqual(ratingOf(row('mlb', 'Final Score: 9 to 3', '{"margin":6}')), ratingOf(row('mlb', 'Final Score: 9 to 3', null)), 'the meta and the body agree');
  assert.equal(ratingOf(row('mlb', 'Final Score: 9 to 3', '{"margin":2}'))!.score, 16, "the row's own margin wins over its body");
  assert.equal(ratingOf(row('mlb', '', '{"gameId":"401908015"}')), null, 'no margin anywhere: nothing is guessed');
  assert.equal(ratingOf(row('mlb', 'Swept 3-0 by the Rays in the ALDS.', null)), null);
  assert.deepEqual(ratingOf(row('mlb', 'Final Score: 9 to 3', 'not json')), ratingOf(row('mlb', 'Final Score: 9 to 3', null)), 'unreadable meta falls back to the body');
  assert.equal(ratingOf(row('mlb', 'Final Score: 9 to 3', '{"margin":6}', 'event')), null, 'an event is not a loss');
  assert.equal(ratingOf(row('ufc', 'Final Score: 9 to 3', '{"margin":6}')), null, 'the UFC has no margin');
  assert.equal(ratingOf(row('f1', '', '{"gameId":"401839115"}')), null);
});

test('a preseason loss is recorded like any other and never rated (a 53-point preseason blowout is no disaster)', () => {
  const pre = { ...board('P1', '22', '134478', 119, 66), season: { type: 1 } }; // the Trail Blazers beat a team not in the catalog, as on October 12 2026
  assert.equal(recordFinalOnBoard('nba', pre, now), true, 'still recorded');
  const row = db.prepare("SELECT * FROM misery WHERE id = 'P1:final:team.lost:134478'").get() as any;
  assert.ok(row, 'the row exists');
  assert.equal(metaOf(row.id).margin, 53);
  assert.equal(metaOf(row.id).preseason, true);
  assert.equal(ratingOf(row), null, 'but it has no rating');
  recordFinalOnBoard('nba', board('P2', '22', '134478', 119, 66), now); // the same score in the regular season (type 2)
  const reg = db.prepare("SELECT * FROM misery WHERE id = 'P2:final:team.lost:134478'").get() as any;
  assert.equal(metaOf(reg.id).preseason, undefined);
  assert.deepEqual(ratingOf(reg), { score: 85, label: 'Disaster' });
  // The tracker marks it on the alert (live.ts): the row follows.
  const lost = gameLostEvent({ league: 'nba', gameId: 'P3', homeId: '7', awayId: '4' }, { home: 120, away: 90 }, now - 3000)!;
  publish([{ ...lost, meta: { ...lost.meta, preseason: true } }], 'nba');
  assert.equal(ratingOf(db.prepare('SELECT * FROM misery WHERE id = ?').get(lost.id) as any), null);
});

test("an ESPN score correction refreshes the row's margin and score (reviseMisery), and a revision without them keeps the row's", () => {
  db.prepare("INSERT INTO follows (device_id, target_key, created_at) VALUES ('d', 'team:mlb:19', 0)").run();
  const lost = gameLostEvent({ league: 'mlb', gameId: 'V1', homeId: '26', awayId: '19' }, { home: 5, away: 2 }, now - 2000)!;
  publish([lost], 'mlb');
  assert.ok(db.prepare('SELECT 1 FROM events WHERE id = ?').get(lost.id), 'someone tracks it, so the alert path has it too');
  assert.equal(metaOf(lost.id).margin, 3);
  assert.equal(reviseEvent(lost.id, { type: 'team.lost', title: lost.title, body: 'Final Score: 12 to 2. A 10-run blowout.', meta: { margin: 10, score: '12-2' } }), true);
  assert.equal(metaOf(lost.id).margin, 10, 'the corrected margin');
  assert.equal(metaOf(lost.id).score, '12-2');
  assert.equal(metaOf(lost.id).gameId, 'V1', 'the rest of the row stays');
  assert.deepEqual(ratingOf(db.prepare('SELECT * FROM misery WHERE id = ?').get(lost.id) as any), { score: 81, label: 'Disaster' });
  reviseMisery(lost.id, { type: 'team.lost', targetKey: lost.targetKey, title: lost.title, body: 'Final Score: 12 to 2. A 10-run blowout.', meta: {} });
  assert.equal(metaOf(lost.id).margin, 10, 'a revision that does not carry the margin keeps it');
});
