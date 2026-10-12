// A football tracker goes on reading for a few minutes after the final (live.ts correctionsAfterFinal): ESPN corrects
// plays after END GAME (a lost fumble that was the offense's own recovery, 24 s after it, Browns at Jets, October 11 2026;
// an overtime's last play a sack, 36 s after, Giants at Commanders), and the play ledger turns the correction into a line
// or the alert the play now has. The reads here are fast ones (HW_FINAL_CORRECTIONS_*), on the real clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_FINAL_CORRECTIONS_MS = '400';
process.env.HW_FINAL_CORRECTIONS_POLL_MS = '40';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
for (const [id, name, short, abbr, location] of [['5', 'Cleveland Browns', 'Browns', 'CLE', 'Cleveland'], ['20', 'New York Jets', 'Jets', 'NYJ', 'New York']]) team.run(`team:nfl:${id}`, id, name, short, abbr, location);
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES ('player:nfl:3122840', 'nfl', '3122840', 'Deshaun Watson', 'team:nfl:5', 'QB', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();
setPushSender(() => {});
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('watson', 's', 'ios', 'tok', JSON.stringify(DEFAULT_PREFS));
db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('watson', 'player:nfl:3122840');

const ref = (kind: string, id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/${kind}/${id}` });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('after the final the tracker reads the plays again for a while: a lost fumble corrected to the offense\'s own recovery gets its line without anyone calling poll', async () => {
  const stamp = () => new Date().toISOString();
  const fumble = (type: string, text: string, away: number) => ({ id: '4018729833950', type: { text: type }, text, team: ref('teams', '5'), start: { team: ref('teams', '5') }, end: { team: ref('teams', type.includes('Own') ? '5' : '20') },
    participants: [{ athlete: ref('athletes', '3122840'), type: 'passer' }], awayScore: away, homeScore: 17, period: { number: 4 }, clock: { value: 57, displayValue: '0:57' }, scoringPlay: false, wallclock: stamp() });
  const g = { state: 'in', core: [] as any[] };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.summary('nfl', '401872983'))) return {
      header: { competitions: [{ status: { period: 4, displayClock: '0:00', type: { state: g.state, completed: g.state === 'post', detail: g.state === 'post' ? 'Final' : '' } },
        competitors: [{ homeAway: 'home', id: '20', score: '17' }, { homeAway: 'away', id: '5', score: '12' }] }] }, drives: { previous: [], current: null } };
    if (url.startsWith(urls.corePlays('nfl', '401872983'))) return { items: g.core };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nfl', '401872983', '20', '5');
  await tracker.poll();
  g.core = [fumble('Sack Opp Fumble Recovery', '(Shotgun) D.Watson sacked at CLV 19 for 0 yards (W.McDonald). FUMBLES (W.McDonald), RECOVERED by NYJ-J.Smith at CLV 19.', 12)];
  await tracker.poll();
  g.state = 'post';
  await tracker.poll();
  assert.equal(tracker.finished, true);
  g.core = [fumble('Fumble Recovery (Own)', '(Shotgun) D.Watson sacked at CLV 19 for 0 yards (W.McDonald). FUMBLES (W.McDonald), and recovers at CLV 19. D.Watson to CLV 18 for -1 yards', 12)];
  await wait(250); // the tracker's own reads, a few tens of ms apart
  const row = (db.prepare(`SELECT f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'watson' AND e.type = 'nfl.fumble_lost'`).get() as any);
  assert.ok(row, 'the lost fumble went out');
  assert.ok(JSON.parse(row.extra).includes('ESPN has since corrected it: the Browns kept the ball.'), row.extra);
  await wait(300); // the window is over before the test is: no read of a mock that is gone
});

test('what the reads after the final find goes to the feed and never pushes (a play that becomes an interception, Browns at Jets)', async () => {
  const sent: string[] = [];
  setPushSender((m) => sent.push(...m.map((x: any) => x.title)));
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('watson-pick', 's', 'ios', 'tok2', JSON.stringify(DEFAULT_PREFS));
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('watson-pick', 'player:nfl:3122840');
  const play = (type: string, text: string) => ({ id: '4018729839999', type: { text: type }, text, team: ref('teams', '5'), start: { team: ref('teams', '5') }, end: { team: ref('teams', '5') },
    participants: [{ athlete: ref('athletes', '3122840'), type: 'passer' }], awayScore: 12, homeScore: 17, period: { number: 4 }, clock: { value: 30, displayValue: '0:30' }, scoringPlay: false, wallclock: new Date().toISOString() });
  const g = { state: 'in', core: [] as any[] };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.summary('nfl', '401872984'))) return {
      header: { competitions: [{ status: { period: 4, displayClock: '0:00', type: { state: g.state, completed: g.state === 'post', detail: g.state === 'post' ? 'Final' : '' } },
        competitors: [{ homeAway: 'home', id: '20', score: '17' }, { homeAway: 'away', id: '5', score: '12' }] }] }, drives: { previous: [], current: null } };
    if (url.startsWith(urls.corePlays('nfl', '401872984'))) return { items: g.core };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nfl', '401872984', '20', '5');
  await tracker.poll();
  g.core = [play('Pass Incompletion', 'D.Watson pass incomplete short right.')];
  await tracker.poll();
  g.state = 'post';
  await tracker.poll();
  const before = sent.length;
  g.core = [play('Pass Interception Return', 'D.Watson pass short right intended for D.Boston INTERCEPTED by R.Spears-Jennings at NYJ 30.')];
  await wait(250);
  const pick = db.prepare(`SELECT f.pushed FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'watson-pick' AND e.type = 'nfl.qb.interception'`).get() as any;
  assert.ok(pick, 'the interception is in the feed');
  assert.equal(pick.pushed, 0, 'not pushed');
  assert.equal(sent.slice(before).some((t) => /interception/.test(t)), false);
  await wait(300);
});
