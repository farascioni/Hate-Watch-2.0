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
const { miseryRows, recordFinalOnBoard, isMisery, miseryByCode, MISERY_LIMIT } = await import('../src/misery.ts');
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
