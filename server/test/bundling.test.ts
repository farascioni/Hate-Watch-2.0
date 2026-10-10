// One alert per play for a device: a team's alerts and its players' alerts on one play are one alert, the
// others its lines (bundleByPlay), alternatives give one line (`alt`), and a fact that comes in a later
// publish goes on the alert already sent, without a push.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, publish, setPushSender, feedItem, addSocket } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS, observePlay, teamScoreEvents, bundleByPlay } = await import('../src/detectors.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:10', '10', 'New York Yankees', 'Yankees', 'NYY');
team.run('team:mlb:30', '30', 'Tampa Bay Rays', 'Rays', 'TB');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:mlb:32081', '32081', 'Gerrit Cole', 'team:mlb:10');
player.run('player:mlb:33192', '33192', 'Aaron Judge', 'team:mlb:10');
player.run('player:mlb:4683371', '4683371', 'Junior Caminero', 'team:mlb:30');
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const fan = (id: string, keys: string[], prefs: object = {}) => { device.run(id, 's', 'ios', `tok-${id}`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs })); for (const k of keys) follow.run(id, k); };
fan('yankees-and-cole', ['team:mlb:10', 'player:mlb:32081']);
fan('yankees-only', ['team:mlb:10']);
fan('cole-only', ['player:mlb:32081']);
fan('scored-on-only', ['team:mlb:10', 'player:mlb:32081'], { types: { 'team.fell_behind': false } });
const pushes: { to: string; body: string }[] = [];
setPushSender((m) => pushes.push(...m));
const frames: any[] = [];
addSocket('yankees-and-cole', { on() {}, send: (f: string) => frames.push(JSON.parse(f)) } as any);
const got = (dev: string) => (db.prepare('SELECT e.*, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(dev) as any[])
  .map(feedItem).map((i) => `${i.title} | ${i.body}`);
const pushed = (dev: string) => pushes.filter((p) => p.to === `tok-${dev}`).length;

const ctx = (): any => ({ league: 'mlb', gameId: 'G1', homeId: '10', awayId: '30', goalies: new Map() });
const play = (id: string, half: string, text: string, x: object = {}) => ({ id, type: 'Play Result', typeSlug: 'play-result', text, period: { type: half.split(' ')[0], number: Number(half.split(' ')[1]) },
  participants: [{ id: '32081', role: 'pitcher' }, { id: '4683371', role: 'batter' }], scoring: false, scoreValue: 0, home: 1, away: 1, at: Date.now(), shooting: false, ...x });
/** What the tracker does with a play: the player alerts, then the team's, bundled, published. */
const poll = (g: any, p: any, prev?: { home: number; away: number }) => {
  const es = [...PLAYER_DETECTORS.mlb(g, p), ...(prev ? teamScoreEvents(g, prev, p) : [])];
  observePlay(g, p);
  publish(bundleByPlay(es), 'mlb');
};

test("a homer that gives the Rays the lead: Cole's alert and the Yankees' are one, for someone tracking both", () => {
  poll(ctx(), play('hr1', 'Top 6', 'Caminero homered to left (402 feet).', { scoring: true, scoreValue: 1, home: 1, away: 2 }), { home: 1, away: 1 });
  const line = 'Caminero homered to left (402 feet). — TB 2, NYY 1';
  assert.deepEqual(got('yankees-and-cole'), [`Gerrit Cole gave up a solo homer | Rays took the lead. ${line}`]);
  assert.deepEqual(got('yankees-only'), [`Rays scored 1 run to take the lead over the Yankees | ${line}`]);
  assert.deepEqual(got('cole-only'), [`Gerrit Cole gave up a solo homer | ${line}`]);
  assert.deepEqual(got('scored-on-only'), [`Gerrit Cole gave up a solo homer | Rays scored 1 run. ${line}`], '"falls behind" off: the scored-on line instead, one of the two');
  assert.equal(pushed('yankees-and-cole'), 1);
});

test("a fact that comes a poll later goes on the alert already sent: a line, no push (the inning ends on Judge's strikeout)", () => {
  fan('yankees-and-judge', ['team:mlb:10', 'player:mlb:33192']);
  const judgeFrames: any[] = [];
  addSocket('yankees-and-judge', { on() {}, send: (f: string) => judgeFrames.push(JSON.parse(f)) } as any);
  const g = ctx();
  // Bottom 7: three up, three down, the third out Judge's strikeout. The half-inning's end ("End Inning") comes a poll later.
  for (const [i, [who, text]] of ([['1', 'Wells grounded out to second.'], ['2', 'Volpe grounded out to short.'], ['33192', 'Judge struck out swinging.']] as const).entries()) {
    poll(g, { ...play(`b7-${i}`, 'Bottom 7', text, { outs: i + 1 }), teamId: '10', participants: [{ id: '4683371', role: 'pitcher' }, { id: who, role: 'batter' }] });
  }
  assert.deepEqual(got('yankees-and-judge'), ['Aaron Judge struck out swinging | Judge struck out swinging. — TB 1, NYY 1']);
  poll(g, { ...play('end7', 'Bottom 7', 'End of the 7th'), typeSlug: 'end-inning', type: 'End Inning', participants: [] });
  assert.deepEqual(got('yankees-and-judge'), ['Aaron Judge struck out swinging | Yankees went down in order. Judge struck out swinging. — TB 1, NYY 1'],
    'the inning is a line on the strikeout alert, not a second alert');
  assert.equal(pushed('yankees-and-judge'), 1, 'and no second push');
  assert.equal(judgeFrames.filter((f) => f.kind === 'event').length, 1);
  assert.match(judgeFrames.find((f) => f.kind === 'eventUpdate').item.body, /^Yankees went down in order\. Judge struck out/, 'the app gets the alert with its new line');
  assert.equal(got('yankees-only').at(-1)?.split(' | ')[0], 'Yankees went down in order', 'tracking only the team: the team alert itself');
});

test('a late fact for an alert they cleared from their feed is dropped', () => {
  const g = ctx();
  poll(g, { ...play('c1', 'Bottom 8', 'Judge struck out swinging.', { outs: 3 }), teamId: '10', participants: [{ id: '4683371', role: 'pitcher' }, { id: '33192', role: 'batter' }, { id: '1', role: 'onSecond' }] });
  db.prepare("DELETE FROM feed WHERE device_id = 'yankees-and-judge'").run();
  poll(g, { ...play('end8', 'Bottom 8', 'End of the 8th'), typeSlug: 'end-inning', type: 'End Inning', participants: [] });
  assert.deepEqual(got('yankees-and-judge'), []);
  assert.equal(got('yankees-only').at(-1)?.split(' | ')[0], 'Yankees stranded a runner on second');
});

test('the bases loading after "runners in scoring position": a line on that alert, live, no second push (once a half-inning)', () => {
  fan('yankees-risp', ['team:mlb:10'], { types: { 'mlb.team.opponent_risp': true } });
  const riskFrames: any[] = [];
  addSocket('yankees-risp', { on() {}, send: (f: string) => riskFrames.push(JSON.parse(f)) } as any);
  const g = ctx();
  const batter = (id: string, bases: [string, string][]) => [{ id: '32081', role: 'pitcher' }, { id, role: 'batter' }, ...bases.map(([who, role]) => ({ id: who, role }))];
  poll(g, { ...play('r1', 'Top 4', 'Caminero doubled to left.', { outs: 0 }), teamId: '30', participants: batter('4683371', [['4683371', 'onSecond']]) });
  poll(g, { ...play('r2', 'Top 4', 'Diaz walked.', { outs: 0 }), teamId: '30', participants: batter('5', [['5', 'onFirst'], ['4683371', 'onSecond']]) });
  poll(g, { ...play('r3', 'Top 4', 'Arozarena flied out to center.', { outs: 1 }), teamId: '30', participants: batter('6', [['5', 'onFirst'], ['4683371', 'onSecond']]) });
  const before = pushed('yankees-risp');
  poll(g, { ...play('r4', 'Top 4', 'Lowe walked, Diaz to second, Caminero to third.', { outs: 1 }), teamId: '30', participants: batter('7', [['7', 'onFirst'], ['5', 'onSecond'], ['4683371', 'onThird']]) });
  assert.deepEqual(got('yankees-risp'), ['Rays have a runner on second against the Yankees | Bases loaded now, 1 out. Top 4th: Caminero doubled to left. — TB 1, NYY 1']);
  assert.equal(pushed('yankees-risp'), before, 'no second notification');
  assert.match(riskFrames.find((f) => f.kind === 'eventUpdate')?.item.body ?? '', /^Bases loaded now, 1 out\./, 'the app gets it live');
  // Still loaded after the next batter: nothing new, and once a half-inning.
  poll(g, { ...play('r5', 'Top 4', 'Lowe struck out swinging.', { outs: 2 }), teamId: '30', participants: batter('8', [['7', 'onFirst'], ['5', 'onSecond'], ['4683371', 'onThird']]) });
  assert.equal(got('yankees-risp').length, 1);
  assert.equal(got('yankees-risp')[0].match(/Bases loaded/g)?.length, 1);
});

test('loaded on the play that first puts a runner in scoring position: the alert says so, no line; and nothing for those with the alert off', () => {
  const g = ctx();
  poll(g, { ...play('l1', 'Top 6', 'Caminero walked.', { outs: 0 }), teamId: '30', participants: [{ id: '32081', role: 'pitcher' }, { id: '4683371', role: 'batter' }, { id: '4683371', role: 'onFirst' }] });
  poll(g, { ...play('l2', 'Top 6', 'Diaz singled to left, Caminero to second.', { outs: 0 }), teamId: '30', participants: [{ id: '32081', role: 'pitcher' }, { id: '5', role: 'batter' }, { id: '5', role: 'onFirst' }, { id: '4683371', role: 'onSecond' }] });
  assert.equal(got('yankees-risp').at(-1), 'Rays have runners on first and second against the Yankees | Top 6th: Diaz singled to left, Caminero to second. — TB 1, NYY 1');
  const h = ctx();
  poll(h, { ...play('m1', 'Top 7', 'Lowe walked, Diaz to second, Caminero to third.', { outs: 0 }), teamId: '30', participants: [{ id: '32081', role: 'pitcher' }, { id: '7', role: 'batter' }, { id: '7', role: 'onFirst' }, { id: '5', role: 'onSecond' }, { id: '4683371', role: 'onThird' }] });
  assert.equal(got('yankees-risp').at(-1), 'Rays have the bases loaded against the Yankees | Top 7th: Lowe walked, Diaz to second, Caminero to third. — TB 1, NYY 1');
  assert.ok(got('yankees-only').every((x) => !/scoring|loaded/i.test(x)), "the alert's off by default");
});

test('the same late fact twice (from two of its sources): one line on the alert', () => {
  fan('yankees-twice', ['team:mlb:10']);
  const at = Date.now();
  const alert = (id: string, x: object = {}) => ({ id, type: 'team.fell_behind', targetKey: 'team:mlb:10', title: 'Rays took the lead over the Yankees', body: 'TB 2, NYY 1', at, ...x });
  publish([alert('twice-1')], 'mlb');
  const late = (id: string) => alert(id, { lateOn: { targetKey: 'team:mlb:10', since: at - 1000, types: ['team.fell_behind'], line: 'Third straight game behind.' } });
  publish([late('twice-2')], 'mlb');
  publish([late('twice-3')], 'mlb');
  assert.deepEqual(got('yankees-twice'), ['Rays took the lead over the Yankees | Third straight game behind. TB 2, NYY 1']);
});
