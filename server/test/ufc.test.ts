// The UFC (ufc.ts): fighters as players, a card watched poll by poll, and what a fighter's haters get. Results,
// cards and stats in ESPN's shapes, from UFC 332: Silva vs. Wang and UFC Fight Night: Rosas Jr. vs. Barcelos
// (2026-10-03 and 09-26): McGee knocked out by Nolan (punch, 3:26 of round 3), a rear naked choke, a split decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db, kvSet } = await import('../src/db.ts');
const { loadCatalog, catalog, search, UFC_TEAM } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender, feedItem, addSocket } = await import('../src/fanout.ts');
const { setFlag } = await import('../src/flags.ts');
const { urls, GAME_LEAGUES } = await import('../src/leagues.ts');
const { hateWatchTally } = await import('../src/hate-watches.ts');
const { startApi } = await import('../src/api.ts');
const { recapFor } = await import('../src/recap.ts');
const { refreshUpNext, upNextDeps } = await import('../src/upnext.ts');
const U = await import('../src/ufc.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, 'ufc', 'ufc', 'UFC', 'UFC', 'UFC', '#D20A0A', 'badge://ufc', 512, 512, 0)`).run(UFC_TEAM.key);
const fighter = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'ufc', ?, ?, ?, ?, ?, 512, 512, ?, 0)`);
for (const [id, name, weight] of [['2504639', 'Court McGee', 'Welterweight'], ['5290958', 'Eric Nolan', 'Welterweight'], ['4054605', 'Natalia Silva', 'W Flyweight'], ['4215200', 'Wang Cong', 'W Flyweight'], ['2506549', 'Arman Tsarukyan', 'Lightweight'], ['2504169', 'Islam Makhachev', 'Lightweight']])
  fighter.run(`player:ufc:${id}`, id, name, weight, UFC_TEAM.key, `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`, 'headshot');
loadCatalog();
const pushes: { to: string; title: string }[] = [];
setPushSender((m) => pushes.push(...m));
const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const fan = (id: string, key: string) => { device.run(id, 's', 'ios', `tok-${id}`, JSON.stringify(DEFAULT_PREFS)); follow.run(id, key); };
const feed = (dev: string) => (db.prepare('SELECT e.*, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(dev) as any[]).map(feedItem).map((i) => `${i.type}: ${i.title} | ${i.body}`);
const pushed = (dev: string) => pushes.filter((p) => p.to === `tok-${dev}`).map((p) => p.title);

const mcgee = { id: '2504639', name: 'Court McGee', winner: false, cards: [] as number[] }, nolan = { id: '5290958', name: 'Eric Nolan', winner: true, cards: [] as number[] };
const fight = (x: Partial<import('../src/ufc.ts').Fight> = {}): import('../src/ufc.ts').Fight => ({
  eventId: '600061182', eventName: 'UFC 332: Silva vs. Wang', id: '401907089', weight: 'Welterweight', rounds: 3, state: 'post', status: 'STATUS_FINAL', period: 3, clock: '3:26', fighters: [mcgee, nolan], ...x,
});

test("how they lost, in the loser's words: knocked out, tapped out, the judges' cards, and a finish's how and when; nothing for a draw", () => {
  const say = (r: any, f = fight()) => U.lossAlerts(f, r, {}, 0).map((e) => [e.title, e.body]);
  assert.deepEqual(say({ name: 'kotko', display: 'KO/TKO', desc: 'Punch', target: 'Head', period: 3, clock: '3:26' }), [
    ['Successful Hate Watch! Court McGee got knocked out by Eric Nolan (KO/TKO R3 3:26)', 'KO/TKO (punch to the head) at 3:26 of round 3. Welterweight, UFC 332: Silva vs. Wang.']]);
  assert.deepEqual(say({ name: 'submission', display: 'Submission', desc: 'Rear Naked Choke', period: 2, clock: '4:07' })[0],
    ['Successful Hate Watch! Court McGee tapped out to Eric Nolan (Submission R2 4:07)', 'Submission (rear naked choke) at 4:07 of round 2. Welterweight, UFC 332: Silva vs. Wang.']);
  const cards = fight({ fighters: [{ ...mcgee, cards: [28, 29, 28] }, { ...nolan, cards: [29, 28, 29] }], clock: '5:00' });
  assert.deepEqual(say({ name: 'decision---split', display: 'Decision - Split', period: 3, clock: '5:00' }, cards)[0],
    ['Successful Hate Watch! Court McGee lost a split decision to Eric Nolan', 'Split decision after 3 rounds (29-28, 28-29, 29-28). Welterweight, UFC 332: Silva vs. Wang.']);
  assert.deepEqual(say({ name: 'decision---unanimous', display: 'Decision - Unanimous', period: 5, clock: '5:00' }, fight({ rounds: 5, fighters: [{ ...mcgee, cards: [47, 46, 47] }, { ...nolan, cards: [48, 49, 48] }] }))[0][1],
    'Unanimous decision after 5 rounds (48-47, 49-46, 48-47). Welterweight, UFC 332: Silva vs. Wang.');
  assert.deepEqual(say({ name: 'dq', display: 'DQ', period: 1, clock: '2:19' })[0], ['Successful Hate Watch! Court McGee lost by disqualification to Eric Nolan (DQ R1 2:19)', 'Disqualified at 2:19 of round 1. Welterweight, UFC 332: Silva vs. Wang.']);
  assert.equal(U.fightOf({ id: 'E', name: 'UFC 332' }, { id: 'F', type: { abbreviation: 'W Flyweight' }, competitors: [] }).weight, "Women's Flyweight");
  assert.deepEqual(U.lossAlerts(fight({ fighters: [{ ...mcgee, winner: null }, { ...nolan, winner: null }] }), { name: 'draw', display: 'Draw', period: 3, clock: '5:00' }), [], 'a draw: nobody lost');
});

test("a loss's facts: each a line on it with its own switch (or the alert, with the loss off), counting as the loss; knockdowns only ever lines", () => {
  const es = U.lossAlerts(fight({ rounds: 5 }), { name: 'kotko', display: 'KO/TKO', desc: 'Punch', target: 'Head', period: 3, clock: '3:26' },
    { title: { weight: 'Welterweight', interim: false, held: true }, chance: 66, streak: 3, knockdowns: [{ n: 1, round: 2 }, { n: 2, round: 3 }] }, 0);
  assert.deepEqual(es.map((e) => [e.type, e.fold ?? null, e.foldOnly ?? false]), [
    ['ufc.lost', null, false],
    ['ufc.lost_title', 'Lost the Welterweight title.', false],
    ['ufc.lost_as_favorite', 'Lost as a 66% favorite.', false],
    ['ufc.losing_streak', 'Lost 3 straight.', false],
    ['ufc.knocked_down', 'Knocked down in round 2.', true],
    ['ufc.knocked_down', 'Knocked down in round 3 (2nd time).', true],
  ]);
  assert.ok(es.every((e) => e.moment === es[0].moment), 'one moment: one alert');
  assert.equal(es[1].title, 'Successful Hate Watch! Court McGee lost the Welterweight title to Eric Nolan (KO/TKO R3 3:26)', 'the alert itself, for those with the loss off: the finish too');
  const belt = (title: { weight: string; interim: boolean; held: boolean }) => U.lossAlerts(fight(), { name: 'kotko', display: 'KO/TKO', period: 1, clock: '0:23' }, { title }, 0).map((e) => e.fold).filter(Boolean);
  assert.deepEqual([belt({ weight: "Women's Flyweight", interim: false, held: false }), belt({ weight: 'Lightweight', interim: true, held: true }), belt({ weight: 'Heavyweight', interim: true, held: false })],
    [["Lost a Women's Flyweight title fight."], ['Lost the interim Lightweight title.'], ['Lost an interim Heavyweight title fight.']], "a challenger's, or a vacant belt's: a title fight");
  assert.deepEqual(es[1].meta, { gameId: '401907089', athleteId: '2504639', winnerId: '5290958', lossClip: true, clipFlag: 'clips.loss.ufc', lostId: es[0].id, teamKey: 'player:ufc:2504639' }, 'a fact sent in place of the loss counts as it, under the fighter');
  assert.equal(U.lossAlerts(fight(), { name: 'kotko', display: 'KO/TKO', period: 1, clock: '0:23' }, { chance: 59 }, 0).length, 1, 'a 59% favorite: not "the favorite"');
});

// ─── A card, poll by poll ─────────────────────────────────────────────────────────────────────
const E = '600061182', F = '401907089';
const S = { state: 'pre', period: 0, clock: '5:00', kd: { [mcgee.id]: 0, [nolan.id]: 0 } as Record<string, number>, winner: null as string | null, result: null as any, now: 0, types: [] as { text: string }[] };
const coreRef = (id: string) => `https://core/athletes/${id}`;
U.ufcDeps.now = () => S.now;
const clipJobs: import('../src/ufc.ts').ClipJob[] = [];
U.ufcDeps.watchClip = (job) => { clipJobs.push(job); }; // the card hands each loss to the clip watch: looked at in its own test
U.ufcDeps.getJson = async (url: string) => {
  if (url === urls.scoreboard('ufc', '20261003')) return { events: [{ id: E, name: 'UFC 332: Silva vs. Wang', date: '2026-10-03T22:00Z', competitions: [{
    id: F, type: { abbreviation: 'Welterweight' }, format: { regulation: { periods: 3 } }, status: { type: { state: S.state, completed: S.state === 'post' }, period: S.period, displayClock: S.clock },
    competitors: [mcgee, nolan].map((x) => ({ id: x.id, athlete: { displayName: x.name }, ...(S.winner ? { winner: S.winner === x.id } : {}) })),
  }] }] };
  if (url === urls.ufcFight(E, F)) return { types: S.types, competitors: [mcgee, nolan].map((x) => ({ id: x.id, statistics: { $ref: `stats:${x.id}` } })) };
  if (url.startsWith('stats:')) return { splits: { categories: [{ name: 'general', stats: [{ name: 'knockDowns', value: S.kd[url.slice(6)] }] }] } };
  if (url === `${urls.ufcFight(E, F)}/status`) return { period: S.period, displayClock: S.clock, ...(S.result ? { result: S.result } : {}) };
  if (url === `${urls.ufcFight(E, F)}/odds`) return { items: [{ homeAthleteOdds: { moneyLine: -218, athlete: { $ref: coreRef(nolan.id) } }, awayAthleteOdds: { moneyLine: 180, athlete: { $ref: coreRef(mcgee.id) } } }] };
  if (url === `${urls.mmaAthlete(mcgee.id)}/eventlog`) return { events: { items: [
    { competition: { $ref: `https://core/competitions/${F}` }, competitor: { $ref: 'cp:this' }, played: true },
    { competition: { $ref: 'https://core/competitions/1' }, competitor: { $ref: 'cp:lost' }, played: true },
    { competition: { $ref: 'https://core/competitions/2' }, competitor: { $ref: 'cp:won' }, played: true },
  ] } };
  if (url === 'cp:this' || url === 'cp:lost') return { winner: false };
  if (url === 'cp:won') return { winner: true };
  throw new Error(`unexpected ${url}`);
};

test('a fight, poll by poll: it starts, a knockdown goes out after 30s, the knockout is one alert (its knockdown a line), late stats a line without a push', async () => {
  fan('mcgee-hater', 'player:ufc:2504639');
  fan('nolan-hater', 'player:ufc:5290958');
  const card = new U.CardWatch(E, '20261003', 'UFC 332: Silva vs. Wang');
  const tracked = new Set([mcgee.id, nolan.id]);
  const poll = async (t: number, x: Partial<typeof S>) => { Object.assign(S, x, { now: t * 1000 }); await card.poll(tracked); };
  await poll(0, {});                                                     // before the fight: what is, no alerts
  await poll(10, { state: 'in', period: 1, clock: '5:00' });              // the walk-out's over: it starts
  await poll(20, { kd: { [mcgee.id]: 0, [nolan.id]: 1 } });               // Nolan drops McGee: held
  assert.deepEqual(feed('mcgee-hater').map((x) => x.split(' | ')[0]), ['ufc.fight_start: Hate Watch Starting: Court McGee vs Eric Nolan']);
  await poll(55, {});                                                    // 35s on, the fight goes on: its own alert
  await poll(65, { state: 'post', period: 3, clock: '3:26', kd: { [mcgee.id]: 0, [nolan.id]: 2 }, winner: nolan.id, result: { name: 'kotko', displayName: 'KO/TKO', description: 'Punch', target: { description: 'Head' } } });
  assert.deepEqual(feed('mcgee-hater'), [
    'ufc.fight_start: Hate Watch Starting: Court McGee vs Eric Nolan | Welterweight, 3 rounds. UFC 332: Silva vs. Wang.',
    'ufc.knocked_down: Court McGee got knocked down by Eric Nolan in round 1 | Welterweight, UFC 332: Silva vs. Wang.',
    'ufc.lost: Successful Hate Watch! Court McGee got knocked out by Eric Nolan (KO/TKO R3 3:26) | Lost 2 straight. Knocked down in round 3 (2nd time). KO/TKO (punch to the head) at 3:26 of round 3. Welterweight, UFC 332: Silva vs. Wang.',
  ]);
  assert.deepEqual(pushed('mcgee-hater').length, 3, 'start, the first knockdown, the loss: the finishing knockdown is no push of its own');
  assert.deepEqual(hateWatchTally('mcgee-hater').teams.map((t: any) => [t.target.key, t.count]), [['player:ufc:2504639', 1]], 'a Successful Hate Watch, under the fighter');
  const { EVENT_TYPES } = await import('../src/event-types.ts');
  const start = (id: string) => EVENT_TYPES.find((t) => t.id === id)!;
  assert.equal(start('ufc.fight_start').emoji, start('team.game_start').emoji, "a fight starting looks like any game's: Hate Watch Starting, its emoji");
  assert.deepEqual(feed('nolan-hater').map((x) => x.split(' | ')[0]), ['ufc.fight_start: Hate Watch Starting: Eric Nolan vs Court McGee'], 'he won: nothing more');
  // ESPN's stats count one more after the result: a line on the loss, no push.
  await poll(75, { kd: { [mcgee.id]: 0, [nolan.id]: 3 } });
  assert.match(feed('mcgee-hater')[2], /\| Lost 2 straight\. Knocked down in round 3 \(2nd time\)\. Knocked down in round 3 \(3rd time\)\. KO\/TKO/);
  assert.equal(pushed('mcgee-hater').length, 3);
});

test("attached mid-card (a restart): what already happened sends nothing; the fight ending after it does, with its belt", async () => {
  Object.assign(S, { state: 'in', period: 2, kd: { [mcgee.id]: 0, [nolan.id]: 1 }, winner: null, result: null, now: 0, types: [{ text: '5 Rnd (5-5-5-5-5)' }, { text: 'UFC Welterweight Title' }] });
  kvSet('ufc:belts', { Welterweight: { champion: mcgee.id }, Lightweight: { champion: nolan.id } }); // as the catalog's last refresh had them
  // A device of its own: the one above already had this fight's loss (the server remembers it, to add late lines).
  fan('restart-fan', 'player:ufc:2504639');
  db.prepare('DELETE FROM feed').run();
  db.prepare('DELETE FROM events').run();
  const card = new U.CardWatch(E, '20261003', 'UFC 332');
  await card.poll(new Set([mcgee.id]));
  assert.deepEqual(feed('restart-fan'), [], 'no late start, no old knockdown');
  Object.assign(S, { state: 'post', period: 2, clock: '4:07', winner: nolan.id, result: { name: 'submission', displayName: 'Submission', description: 'Rear Naked Choke' }, now: 10_000 });
  await card.poll(new Set([mcgee.id]));
  assert.deepEqual(clipJobs.at(-1), { eventId: E, fightId: F, loserId: mcgee.id, winnerId: nolan.id, since: 10_000 }, 'its clip looked for, from the result');
  assert.deepEqual(feed('restart-fan'), ['ufc.lost: Successful Hate Watch! Court McGee tapped out to Eric Nolan (Submission R2 4:07) | Lost the Welterweight title. Lost 2 straight. Submission (rear naked choke) at 4:07 of round 2. Welterweight, UFC 332: Silva vs. Wang.']);
  S.types = [];
  const over = new U.CardWatch(E, '20261003', 'UFC 332');
  await over.poll(new Set([mcgee.id]));
  assert.equal(feed('restart-fan').length, 1, 'a fight already over when first read: nothing');
});

test("a fighter's page (the Stats tab every build draws): the record, wins and losses by how, the last fights", async () => {
  const getJson = U.ufcDeps.getJson;
  U.ufcDeps.getJson = async (url: string) => {
    if (url === `${urls.mmaAthlete(mcgee.id)}/records`) return { items: [{ name: 'overall', summary: '23-15-0', stats: ['wins=23', 'losses=15', 'tkos=3', 'submissions=9', 'tkoLosses=4', 'submissionLosses=0'].map((s) => ({ name: s.split('=')[0], value: Number(s.split('=')[1]) })) }] };
    if (url === urls.athleteOverview('ufc', mcgee.id)) return { fightHistory: [`s:3301~l:3321~e:${E}~c:${F}`] };
    if (url === urls.ufcFight(E, F)) return { date: '2026-10-03T22:00Z', competitors: [{ id: mcgee.id, winner: false }, { id: nolan.id, winner: true }] };
    if (url === `${urls.ufcFight(E, F)}/status`) return { period: 3, displayClock: '3:26', result: { name: 'kotko', displayName: 'KO/TKO', shortDisplayName: 'KO/TKO', description: 'Punch' } };
    return getJson(url);
  };
  try {
    const page = await U.fighterPage(mcgee.id);
    assert.equal(page.record?.overall, '23-15-0');
    assert.deepEqual(page.groups[0].tiles.map((t) => `${t.label} ${t.value}${t.bad ? ' (red)' : ''}`), ['W 23', 'L 15 (red)', 'KO W 3', 'SUB W 9', 'KO L 4 (red)', 'SUB L 0']);
    assert.deepEqual(page.recent.map((g) => [g.opponent, g.result, g.score, g.line]), [['Eric Nolan', 'L', 'KO/TKO R3', 'Punch']]);
  } finally { U.ufcDeps.getJson = getJson; }
});

test('fighters are players; no UFC team or fight anywhere a build draws teams (Scores, Up Next, standings, team lists, search)', async () => {
  assert.ok(!(GAME_LEAGUES as string[]).includes('ufc'), 'no game tracker, scoreboard, standings, injuries or Up Next');
  assert.deepEqual(search('mcgee', { league: 'ufc' } as any).map((t: any) => t.key), ['player:ufc:2504639']);
  assert.equal(search('ufc').some((t: any) => t.kind === 'team'), false, 'the placeholder is in no search');
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.deepEqual((await (await fetch(`${base}/teams?league=ufc`)).json()).teams, []);
    const leagues = (await (await fetch(`${base}/catalog/event-types`)).json()).leagues.map((l: any) => l.id);
    assert.ok(leagues.includes('ufc'), 'the app gets its chip and its Settings group from this');
  } finally { server.close(); }
  assert.equal(catalog.player('player:ufc:2504639')?.teamKey, 'team:ufc:ufc');
  kvSet('ufc:rankings', {});
});

test("a card's watch ends: a draw, a no contest, a fight called off or taken off the card, and 12 hours at most", async () => {
  const card = (fights: { id: string; state: string; name?: string; winner?: string | null }[]) => ({ events: [{ id: 'E2', name: 'UFC Fight Night', date: '2026-10-10T21:00Z', competitions: fights.map((f) => ({
    id: f.id, type: { abbreviation: 'Lightweight' }, status: { type: { state: f.state, name: f.name ?? (f.state === 'post' ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS'), completed: f.state === 'post' }, period: 3, displayClock: '5:00' },
    competitors: [mcgee, nolan].map((x) => ({ id: x.id, athlete: { displayName: x.name }, ...(f.winner === undefined ? {} : { winner: f.winner === x.id }) })),
  })) }] });
  let board = card([{ id: 'draw', state: 'in' }, { id: 'nc', state: 'in' }, { id: 'off', state: 'pre' }, { id: 'gone', state: 'pre' }]);
  const getJson = U.ufcDeps.getJson;
  U.ufcDeps.getJson = async (url: string) => {
    if (url === urls.scoreboard('ufc', '20261010')) return board;
    if (url.endsWith('/status')) return { period: 3, displayClock: '5:00', result: { name: url.includes('/draw/') ? 'draw' : 'overturned', displayName: url.includes('/draw/') ? 'Draw' : 'No Contest' } };
    if (url.endsWith('/odds')) return { items: [] };
    if (/competitions\/\w+$/.test(url)) return { competitors: [mcgee, nolan].map((x) => ({ id: x.id, statistics: { $ref: `stats:${x.id}` } })) };
    if (url.startsWith('stats:')) return { splits: { categories: [{ stats: [{ name: 'knockDowns', value: 0 }] }] } };
    throw new Error(`unexpected ${url}`);
  };
  try {
    S.now = 0;
    const w = new U.CardWatch('E2', '20261010', 'UFC Fight Night');
    const tracked = new Set([mcgee.id]);
    await w.poll(tracked);
    S.now = 10_000;
    board = card([{ id: 'draw', state: 'post', winner: null }, { id: 'nc', state: 'post', winner: null }, { id: 'off', state: 'pre', name: 'STATUS_CANCELED' }]);
    for (let i = 0; i < 8 && !w.stopped; i++) { S.now += 10_000; await w.poll(tracked); }
    assert.equal(w.stopped, true, 'no loser, no alert, and still over; the fight taken off the card not waited for');
    S.now = 0;
    const forever = new U.CardWatch('E2', '20261010', 'UFC Fight Night');
    board = card([{ id: 'stuck', state: 'in' }]);
    await forever.poll(tracked);
    S.now = 12 * 3600_000;
    await forever.poll(tracked);
    assert.equal(forever.stopped, true, 'a card ESPN never finishes is let go after 12 hours');
  } finally { U.ufcDeps.getJson = getJson; }
});

test('a fighter tracked mid-fight: no late "starting", no knockdown from before, the loss only if it comes after', async () => {
  Object.assign(S, { state: 'in', period: 1, kd: { [mcgee.id]: 0, [nolan.id]: 1 }, winner: null, result: null, now: 0 });
  fan('late-fan', 'player:ufc:2504639');
  db.prepare("DELETE FROM feed WHERE device_id = 'late-fan'").run();
  const card = new U.CardWatch(E, '20261003', 'UFC 332');
  await card.poll(new Set([nolan.id]));                 // the card's watched for someone else; McGee's fight isn't
  S.now = 10_000;
  await card.poll(new Set([nolan.id, mcgee.id]));       // now someone tracks McGee: his fight is first read, mid-fight
  assert.deepEqual(feed('late-fan'), []);
});

test('tracking a fighter: no UFC on the Scores tab or in Up Next (a build draws every game as two teams); the weekly recap names the fighter', async () => {
  device.run('scores-fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
  follow.run('scores-fan', 'player:ufc:2504639');
  const asked: string[] = [];
  const getJson = upNextDeps.getJson;
  upNextDeps.getJson = async (url: string) => { asked.push(url); throw new Error('no'); };
  try { await refreshUpNext(['team:ufc:ufc', 'team:f1:106']); } finally { upNextDeps.getJson = getJson; }
  assert.deepEqual(asked, [], "no schedule asked for the UFC's placeholder (or an F1 team)");
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { authorization: 'Bearer scores-fan.s' };
    for (const path of ['/me/scores', '/me/scores/all']) {
      const body = await (await fetch(`${base}${path}`, { headers: auth })).text();
      assert.equal(/"league":"ufc"|ufc:/.test(body), false, `${path}: no UFC`);
    }
  } finally { server.close(); }
  // A Monday recap with a fighter's loss in it: named, as a team would be.
  const monday = Date.parse('2026-10-12T13:30:00Z');
  db.prepare('INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?, ?, ?, ?)').run('scores-fan', 'x:ufc.lost:2504639', 'player:ufc:2504639', monday - 2 * 86400_000);
  const recap = recapFor('scores-fan', monday);
  assert.match(recap?.body ?? '', /Court McGee 1/);
});

test("a lost fight's clip: ESPN's video tagged with both fighters, out after the result; on the loss, its feeds told (no push), under its switch", async () => {
  const at = (iso: string) => Date.parse(iso);
  const video = (id: number, published: string, athletes: string[], o: { expires?: string; headline?: string } = {}) => ({
    id, headline: o.headline ?? `Clip ${id}`, duration: 50, originalPublishDate: published, thumbnail: `https://espnmedia/${id}.jpg`,
    timeRestrictions: { expirationDate: o.expires ?? '2029-01-01T00:00:00Z' }, links: { source: { href: `https://espnmedia/${id}.mp4`, HLS: { href: `https://espnmedia/${id}.m3u8` } } },
    categories: [{ type: 'league', description: 'UFC' }, ...athletes.map((a) => ({ type: 'athlete', athleteId: Number(a) }))],
  });
  const since = at('2026-10-04T03:15:00Z'), now = at('2026-10-04T04:00:00Z');
  const videos = [
    video(1, '2026-10-01T20:00:00Z', [mcgee.id, nolan.id], { headline: 'McGee, Nolan face off' }),     // the stare-down: before the fight
    video(2, '2026-10-04T03:40:00Z', [nolan.id], { headline: 'Nolan: I want a ranked opponent' }),    // the winner alone
    video(3, '2026-10-04T03:20:00Z', [mcgee.id, nolan.id], { expires: '2026-10-04T03:59:00Z' }),      // taken down already
    video(5, '2026-10-04T03:50:00Z', [nolan.id, mcgee.id], { headline: 'Nolan on his knockout of McGee' }),
    video(4, '2026-10-04T03:31:00Z', [mcgee.id, nolan.id, '99'], { headline: 'Eric Nolan knocks out Court McGee' }),
  ];
  assert.equal(U.fightClip(videos, mcgee.id, nolan.id, since, now)?.title, 'Eric Nolan knocks out Court McGee', 'the first one out after it, still up');
  assert.equal(U.fightClip(videos.slice(0, 3), mcgee.id, nolan.id, since, now), null, 'not yet');
  assert.equal(U.fightClip([video(6, '2026-10-04T03:14:00Z', [mcgee.id, nolan.id])], mcgee.id, nolan.id, since, now)?.title, 'Clip 6', "ESPN's result can lead ours by a minute");

  // The loss above (restart-fan's), and the job the card handed on for it.
  const job = clipJobs.at(-1)!;
  const card = { videos: videos.slice(0, 3) }, page = { videos: [] as any[] };
  const getJson = U.ufcDeps.getJson;
  U.ufcDeps.getJson = async (url: string) => (url === urls.ufcFightCenter(E) ? card : url === urls.mmaAthletePage(mcgee.id) ? page : getJson(url));
  const nowWas = U.ufcDeps.now;
  U.ufcDeps.now = () => now;
  const frames: string[] = [];
  addSocket('restart-fan', { on() {}, send: (f: string) => frames.push(f), close() {} } as any);
  try {
    const clipOf = () => (db.prepare("SELECT e.*, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'restart-fan'").all() as any[]).map(feedItem)[0]?.clip;
    assert.equal(await U.checkFightClip({ ...job, since }), false, 'nothing yet: looked for again later');
    assert.equal(clipOf(), undefined);
    page.videos = videos;
    for (const flag of ['clips.loss.ufc', 'clips.loss', 'clips'] as const) {
      setFlag(flag, false);
      assert.equal(await U.checkFightClip({ ...job, since }), false, `${flag} off: not even looked for`);
      setFlag(flag, true);
    }
    const pushesBefore = pushes.length;
    assert.equal(await U.checkFightClip({ ...job, since }), true);
    assert.deepEqual([clipOf()?.title, clipOf()?.mp4], ['Eric Nolan knocks out Court McGee', 'https://espnmedia/4.mp4'], 'on the loss, in the feed');
    assert.equal(JSON.parse(frames.find((f) => f.includes('eventUpdate'))!).item.clip.title, 'Eric Nolan knocks out Court McGee', 'sent to the feed live');
    assert.equal(pushes.length, pushesBefore, 'no push: the loss already made its sound');
    setFlag('clips.loss.ufc', false);
    assert.equal(clipOf(), undefined, 'switched off after: gone from the feed (the UFC\'s alone)');
    setFlag('clips.loss.ufc', true);
    assert.equal(clipOf()?.title, 'Eric Nolan knocks out Court McGee');
  } finally { U.ufcDeps.getJson = getJson; U.ufcDeps.now = nowWas; for (const f of ['clips.loss.ufc', 'clips.loss', 'clips'] as const) setFlag(f, true); }
});
