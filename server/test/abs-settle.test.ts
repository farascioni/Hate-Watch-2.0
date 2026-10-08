// A lost ABS challenge waits until the review is over. ESPN posts every challenged pitch as its call
// "- Confirmed" at once and, if the call is overturned, swaps in an "- Overturned" pitch in the same place
// under a new id. On 2026-10-07 that sent three alerts for challenges that were won (Rays @ Yankees,
// CLE @ CHW). The plays here are the ones ESPN sent, with their real ids, through a live game tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_ABS_SETTLE_MS = '100';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS, observePlay } = await import('../src/detectors.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['10', 'New York Yankees', 'Yankees', 'NYY'], ['30', 'Tampa Bay Rays', 'Rays', 'TB'], ['5', 'Cleveland Guardians', 'Guardians', 'CLE'],
  ['4', 'Chicago White Sox', 'White Sox', 'CHW'], ['15', 'Atlanta Braves', 'Braves', 'ATL'], ['19', 'Los Angeles Dodgers', 'Dodgers', 'LAD']]) team.run(`team:mlb:${id}`, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, t] of [['1', 'George Lombard Jr.', '10'], ['2', 'Austin Wells', '10'], ['3', 'Griffin Jax', '30'], ['4', 'Sam Antonacci', '4'], ['5', 'Cade Smith', '5']]) player.run(`player:mlb:${id}`, id, name, `team:mlb:${t}`);
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
for (const k of ['team:mlb:10', 'team:mlb:30', 'team:mlb:5', 'team:mlb:4']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', k);

const challenges = () => (db.prepare(`SELECT e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'fan' AND e.type = 'mlb.challenge_lost' ORDER BY f.rowid`).all() as { title: string; body: string }[])
  .map((r) => `${r.title} | ${r.body.replace(/ — .*/, '')}`);
const wait = () => new Promise((r) => setTimeout(r, 150));

// A play as the game summary has it.
const play = (id: string, type: string, text: string, half: string, pitcher: string, batter: string, typeSlug = '') => ({
  id, type: { text: type, type: typeSlug }, text, period: { type: half.split(' ')[0], number: Number(half.split(' ')[1]) },
  participants: [{ athlete: { id: pitcher }, type: 'pitcher' }, { athlete: { id: batter }, type: 'batter' }], wallclock: new Date().toISOString(), homeScore: 0, awayScore: 0,
});
/** A live game whose summary serves whatever `plays` holds on each poll. */
function game(id: string, home: string, away: string) {
  const state = { plays: [] as any[] };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', id).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', id))) return { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: state.plays };
    return prev(url, o);
  };
  return { state, tracker: new GameTracker('mlb', id, home, away) };
}

test('a challenge ESPN first posts as confirmed, then overturns, sends nothing (Lombard Jr.: strike 2 became ball 4)', async () => {
  const before = challenges().length;
  const { state, tracker } = game('401907987', '10', '30');
  const strike1 = play('4019079871102050036', 'Strike Looking', 'Pitch 4 : Strike 1 Looking', 'Bottom 6', '3', '1');
  state.plays = [strike1, play('4019079871102060092', 'Strike Looking - Confirmed', 'Pitch 5 : Strike 2 Looking', 'Bottom 6', '3', '1')];
  await tracker.poll();
  await wait();
  state.plays = [strike1, play('4019079871102060089', 'Ball - Overturned', 'Pitch 5 : Ball 4', 'Bottom 6', '3', '1'),
    play('4019079871102990057', 'Play Result', 'Lombard Jr. walked. New York Yankees challenged: call on the field was overturned.', 'Bottom 6', '3', '1', 'play-result')];
  await tracker.poll();
  await wait();
  await tracker.poll();
  assert.deepEqual(challenges().slice(before), [], 'the Yankees won it');
});

test("a challenge that stays confirmed goes out once the game has moved on and the review's had time (Wells: strike 2)", async () => {
  const before = challenges().length;
  const { state, tracker } = game('401907987', '10', '30');
  const lost = play('4019079870303050092', 'Strike Looking - Confirmed', 'Pitch 4 : Strike 2 Looking', 'Bottom 2', '3', '2');
  state.plays = [lost];
  await tracker.poll();
  await wait();
  await tracker.poll();
  assert.deepEqual(challenges().slice(before), [], 'still the latest play: the review may not be over');
  state.plays = [lost, play('4019079870303060005', 'Ball', 'Pitch 5 : Ball 2', 'Bottom 2', '3', '2')];
  await tracker.poll();
  assert.deepEqual(challenges().slice(before), ['Yankees lost an ABS challenge | Bottom 2nd: Austin Wells challenged strike 2 looking, and the call stands']);
});

test('two challenges in one at-bat: the lost one goes out, the one overturned later does not (Antonacci, CLE @ CHW)', async () => {
  const before = challenges().length;
  const { state, tracker } = game('401907992', '4', '5');
  const ball1 = play('4019079921702030090', 'Ball - Confirmed', 'Pitch 2 : Ball 1', 'Bottom 9', '5', '4');
  const strike = play('4019079921702040036', 'Strike Looking', 'Pitch 3 : Strike 1 Looking', 'Bottom 9', '5', '4');
  state.plays = [ball1];
  await tracker.poll();
  state.plays = [ball1, strike, play('4019079921702060090', 'Ball - Confirmed', 'Pitch 5 : Ball 2', 'Bottom 9', '5', '4')];
  await tracker.poll();
  await wait();
  state.plays = [ball1, strike, play('4019079921702060091', 'Strike Looking - Overturned', 'Pitch 5 : Strike 3 Looking', 'Bottom 9', '5', '4'),
    play('4019079921702990057', 'Play Result', 'Antonacci struck out looking. Cleveland Guardians challenged: call on the field was overturned.', 'Bottom 9', '5', '4', 'play-result')];
  await tracker.poll();
  await wait();
  await tracker.poll();
  assert.deepEqual(challenges().slice(before), ['Guardians lost an ABS challenge | Bottom 9th: ball 1 to Sam Antonacci stands (Cade Smith pitching)'],
    "the at-bat's result is about its last pitch, not the ball 1 challenge");
});

test("an at-bat's last pitch still reads confirmed, but its result says overturned: nothing", async () => {
  const before = challenges().length;
  const { state, tracker } = game('401907988', '10', '30');
  state.plays = [play('4019079880308080090', 'Ball - Confirmed', 'Pitch 7 : Ball 3', 'Bottom 2', '3', '2')];
  await tracker.poll();
  await wait();
  state.plays.push(play('4019079880308990057', 'Play Result', 'Wells struck out looking. Tampa Bay Rays challenged: call on the field was overturned.', 'Bottom 2', '3', '2', 'play-result'));
  await tracker.poll();
  assert.deepEqual(challenges().slice(before), []);
});

test("a called third strike whose challenge was upheld is an ABS challenge, even when ESPN didn't mark the pitch", () => {
  const g: any = { league: 'mlb', gameId: '401908016', homeId: '15', awayId: '19', goalies: new Map() };
  const p = { id: '4019080161503990057', type: 'Play Result', typeSlug: 'play-result', text: 'Baldwin struck out looking. Atlanta Braves challenged: call on the field was upheld.',
    period: { type: 'Bottom', number: 8 }, participants: [{ id: '9', role: 'pitcher' }, { id: '8', role: 'batter' }], scoring: false, scoreValue: 0, home: 1, away: 3, at: 0, shooting: false };
  const [e] = PLAYER_DETECTORS.mlb(g, p as any).filter((x) => x.type === 'mlb.challenge_lost');
  observePlay(g, p as any);
  assert.equal(e.title, 'Braves lost an ABS challenge');
});
