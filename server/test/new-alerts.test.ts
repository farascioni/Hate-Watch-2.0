// The new alerts beyond a loss's facts: blowing a big lead live, a division rival clinching (with the rest of
// a standings read in one alert), ejections, and the weekly misery recap. Each one alert per device.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, publish, setPushSender, feedItem } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS, fromSitePlay, gameLostEvent, playerTeamLostEvents } = await import('../src/detectors.ts');
const { GameTracker, liveDeps, scanStandings } = await import('../src/live.ts');
const { divisionsDeps } = await import('../src/divisions.ts');
const { weeklyRecaps } = await import('../src/recap.ts');
const { urls } = await import('../src/leagues.ts');
const { kvSet } = await import('../src/db.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [
  ['nba', '2', 'Boston Celtics', 'Celtics', 'BOS'], ['nba', '18', 'New York Knicks', 'Knicks', 'NY'],
  ['mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD'], ['mlb', '26', 'San Francisco Giants', 'Giants', 'SF'], ['mlb', '25', 'San Diego Padres', 'Padres', 'SD'],
  ['mlb', '10', 'New York Yankees', 'Yankees', 'NYY'], ['nfl', '20', 'New York Jets', 'Jets', 'NYJ'], ['nfl', '28', 'Washington Commanders', 'Commanders', 'WSH'],
  ['nhl', '5', 'Pittsburgh Penguins', 'Penguins', 'PIT'], ['nhl', '25', 'Minnesota Wild', 'Wild', 'MIN'],
  ['nfl', '10', 'Tennessee Titans', 'Titans', 'TEN'], ['nfl', '7', 'Denver Broncos', 'Broncos', 'DEN'],
]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:nhl:3124', 'nhl', '3124', 'Evgeni Malkin', 'team:nhl:5');
player.run('player:nhl:4064781', 'nhl', '4064781', 'Mathieu Olivier', 'team:nhl:25');
player.run('player:nfl:3115315', 'nfl', '3115315', 'Daron Payne', 'team:nfl:28');
player.run('player:nfl:4361370', 'nfl', '4361370', 'Mike Brown', 'team:nfl:10');
player.run('player:nfl:4040000', 'nfl', '4040000', 'Darrell Baker Jr.', 'team:nfl:10');
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const fan = (id: string, keys: string[], prefs: object = {}) => {
  device.run(id, 's', 'ios', `ExponentPushToken[${id}]`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  for (const k of keys) follow.run(id, k);
};
const pushes: { to: string; title: string; body: string }[] = [];
setPushSender((msgs) => pushes.push(...msgs));
const got = (dev: string) => (db.prepare('SELECT e.*, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(dev) as any[])
  .map(feedItem).map((i) => `${i.type}: ${i.title} | ${i.body}`);
const pushed = (dev: string) => pushes.filter((p) => p.to === `ExponentPushToken[${dev}]`).length;

test('blowing an 18-point lead, live: one alert instead of "falls behind", once a game (Knicks @ Celtics)', async () => {
  fan('celtics-fan', ['team:nba:2']);
  fan('blew-off', ['team:nba:2'], { types: { 'team.blew_lead': false } });
  const state = { plays: [] as any[] };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.summary('nba', 'K1'))) return { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: state.plays };
    if (url.includes('/plays')) return { items: [] }; // the core feed: the summary has it all here
    throw new Error(`no network in tests: ${url}`);
  };
  const tracker = new GameTracker('nba', 'K1', '2', '18');
  let n = 0;
  const shot = (home: number, away: number, text: string, period = 2) => ({ id: `K1-${n++}`, type: { text: 'Jump Shot' }, text, scoringPlay: true, homeScore: home, awayScore: away,
    period: { number: period }, clock: { displayValue: '5:00' }, team: { id: home > away ? '2' : '18' }, participants: [], wallclock: new Date().toISOString() });
  state.plays = [shot(30, 12, 'Jayson Tatum makes 26-foot three point jumper')]; // up 18
  await tracker.poll();
  state.plays.push(shot(30, 30, 'Jalen Brunson makes driving layup', 3), shot(30, 32, 'Jalen Brunson makes 25-foot three point jumper', 3));
  await tracker.poll();
  assert.deepEqual(got('celtics-fan'), [
    'nba.team.opponent_run: Knicks are on an 18-0 run against the Celtics | Jalen Brunson makes driving layup — NY 30, BOS 30', // feed only
    'team.blew_lead: Celtics blew an 18-point lead to the Knicks | Jalen Brunson makes 25-foot three point jumper — NY 32, BOS 30',
  ]);
  assert.deepEqual(got('blew-off').slice(1), ['team.fell_behind: Knicks scored 2 to take the lead over the Celtics | Jalen Brunson makes 25-foot three point jumper — NY 32, BOS 30'],
    'with it off, the plain "falls behind" for that play');
  assert.equal(pushed('celtics-fan'), 1, 'blowing a big lead pushes');
  // They take the lead back, then lose it again: that's falling behind now, not a second blown lead.
  state.plays.push(shot(35, 32, 'Jaylen Brown makes driving dunk', 4), shot(35, 36, 'OG Anunoby makes 24-foot three point jumper', 4));
  await tracker.poll();
  liveDeps.getJson = prev;
  assert.deepEqual(got('celtics-fan').map((x) => x.split(':')[0]), ['nba.team.opponent_run', 'team.blew_lead', 'team.fell_behind']);
});

test('one standings read, one alert: eliminated, a division rival clinched, and the drop in the standings (NL West)', async () => {
  fan('giants-fan', ['team:mlb:26']);
  fan('giants-elim-off', ['team:mlb:26'], { types: { 'team.eliminated': false } });
  fan('padres-fan', ['team:mlb:25']);
  const entry = (id: string, seed: number, clincher = '') => ({ team: { id }, stats: [{ name: 'playoffSeed', value: seed }, { name: 'streak', displayValue: 'W1' }, { name: 'clincher', displayValue: clincher }] });
  kvSet('standings:mlb', { 19: { rank: 1, group: 'NL', clincher: '', streak: 'W1' }, 26: { rank: 2, group: 'NL', clincher: '', streak: 'W1' }, 25: { rank: 3, group: 'NL', clincher: '', streak: 'W1' } });
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string) => ({ children: [{ abbreviation: 'NL', standings: { entries: [entry('19', 1, 'y'), entry('25', 2), entry('26', 3, 'e')] } }] });
  divisionsDeps.getJson = async () => ({ children: [{ name: 'National League West', shortName: 'NL West', standings: { entries: [{ team: { id: '19' } }, { team: { id: '26' } }, { team: { id: '25' } }] } }] });
  await scanStandings('mlb');
  liveDeps.getJson = prev;
  assert.deepEqual(got('giants-fan'), ['team.eliminated: Giants are ELIMINATED ⚰️ | The Dodgers clinched the NL West. Down to 3rd in the NL. Officially out of playoff contention. See you next year.']);
  assert.deepEqual(got('giants-elim-off'), ["team.rival_clinched: The Dodgers clinched the NL West | Down to 3rd in the NL. Giants won't win the division."]);
  assert.deepEqual(got('padres-fan'), ["team.rival_clinched: The Dodgers clinched the NL West | Padres won't win the division."], 'a rival clinching, on its own');
  assert.equal(pushed('padres-fan'), 0, 'feed only by default');
  assert.equal(pushed('giants-fan'), 1);
});

test('a drop in the standings after a loss: a line on the loss alert, not an alert of its own (NFC East)', async () => {
  fan('wsh-fan', ['team:nfl:28']);
  fan('wsh-drop-off', ['team:nfl:28'], { types: { 'team.standings_drop': false } });
  fan('wsh-loss-off', ['team:nfl:28'], { types: { 'team.lost': false } });
  // Tracking a player with "Get their team's alerts" on: the team's loss alert, or with that off, "their team lost".
  fan('payne-team-alerts', ['player:nfl:3115315'], { playerTeams: { 'player:nfl:3115315': { alerts: true } } });
  fan('payne-loss-off', ['player:nfl:3115315'], { playerTeams: { 'player:nfl:3115315': { alerts: true } }, types: { 'team.lost': false } });
  fan('titans-fan', ['team:nfl:10']);
  const g = { league: 'nfl' as const, gameId: 'G-WSH', homeId: '28', awayId: '20' };
  const lost = gameLostEvent(g, { home: 17, away: 20 }, Date.now() - 60_000)!;
  publish([lost, ...playerTeamLostEvents(g, lost, [{ key: 'player:nfl:3115315', espnId: '3115315', name: 'Daron Payne' }])], 'nfl');
  // The Titans lost 7 hours ago: too long ago for their drop to be about it.
  publish([gameLostEvent({ league: 'nfl', gameId: 'G-TEN', homeId: '10', awayId: '7' }, { home: 10, away: 24 }, Date.now() - 7 * 3600_000)!], 'nfl');
  const before = pushes.length;
  const entry = (id: string, seed: number) => ({ team: { id }, stats: [{ name: 'playoffSeed', value: seed }, { name: 'streak', displayValue: 'L1' }, { name: 'clincher', displayValue: '' }] });
  kvSet('standings:nfl', { 28: { rank: 2, group: 'NFC East', clincher: '', streak: 'W2' }, 10: { rank: 1, group: 'AFC South', clincher: '', streak: 'W1' } });
  const prev = liveDeps.getJson;
  liveDeps.getJson = async () => ({ children: [{ abbreviation: 'NFC East', standings: { entries: [entry('28', 3)] } }, { abbreviation: 'AFC South', standings: { entries: [entry('10', 2)] } }] });
  try { await scanStandings('nfl'); } finally { liveDeps.getJson = prev; }
  const loss = 'Successful Hate Watch! Commanders lost to the Jets';
  assert.deepEqual(got('wsh-fan'), [`team.lost: ${loss} | Down from 2nd to 3rd in the NFC East. Final Score: 20 to 17`], 'one alert');
  assert.deepEqual(got('payne-team-alerts'), [`team.lost: ${loss} | Down from 2nd to 3rd in the NFC East. Final Score: 20 to 17`]);
  assert.deepEqual(got('payne-loss-off'), ['player.team_lost: Successful Hate Watch! Daron Payne and the Commanders lost to the Jets | Down from 2nd to 3rd in the NFC East. Final Score: 20 to 17'],
    'on "their team lost" too');
  assert.deepEqual(got('wsh-drop-off'), [`team.lost: ${loss} | Final Score: 20 to 17`], 'drops turned off: no line');
  assert.deepEqual(got('wsh-loss-off'), ['team.standings_drop: Commanders dropped to 3rd in the NFC East | Down from 2nd. Streak: L1'], 'no loss alert to put it on: its own alert, as before');
  assert.deepEqual(got('titans-fan').map((x) => x.split(' | ')[0]), ['team.lost: Successful Hate Watch! Titans lost to the Broncos', 'team.standings_drop: Titans dropped to 2nd in the AFC South']);
  assert.equal(pushes.slice(before).filter((p) => p.to === 'ExponentPushToken[wsh-fan]').length, 0, 'the line makes no sound');
});

test('ejections: an NHL game misconduct, an instigator and game misconduct together, an NFL disqualification', () => {
  fan('malkin-fan', ['player:nhl:3124'], { types: { 'player.ejected': false } }); // only "Takes a penalty" on
  fan('olivier-fan', ['player:nhl:4064781']);
  fan('olivier-penalties-off', ['player:nhl:4064781'], { types: { 'nhl.penalty': false } });
  fan('payne-fan', ['player:nfl:3115315']);
  const nhl = (id: string, type: string, who: string, clock: string, period: number, minutes: number) => ({ id, type: { text: type, penaltyMinutes: minutes }, text: `${type}`, participants: [{ athlete: { id: who } }],
    period: { number: period }, clock: { displayValue: clock }, wallclock: new Date().toISOString() });
  const g = (league: string, home: string, away: string): any => ({ league, gameId: `${league}-E`, homeId: home, awayId: away, goalies: new Map() });
  {
    const ctx = g('nhl', '5', '25');
    const malkin = fromSitePlay(nhl('m1', 'Game Misconduct', '3124', '0:38', 2, 10));
    const es = PLAYER_DETECTORS.nhl(ctx, malkin);
    assert.deepEqual(es.map((e) => [e.type, e.title, e.aliases]), [['player.ejected', 'Evgeni Malkin got ejected (game misconduct)', ['nhl.penalty']]]);
    // Mathieu Olivier, 14:27 of the 3rd: "Instigator - Misconduct", then "Game Misconduct", in one poll.
    const inst = fromSitePlay(nhl('o1', 'Instigator', '4064781', '14:27', 3, 2)), gm = fromSitePlay(nhl('o2', 'Game Misconduct', '4064781', '14:27', 3, 10));
    publish([...es, ...PLAYER_DETECTORS.nhl(ctx, inst), ...PLAYER_DETECTORS.nhl(ctx, gm)], 'nhl');
    assert.deepEqual(got('malkin-fan'), ['player.ejected: Evgeni Malkin got ejected (game misconduct) | Game Misconduct — MIN 0, PIT 0'], 'it counts as their penalty alert');
    assert.deepEqual(got('olivier-fan'), ['nhl.penalty: Mathieu Olivier went to the box (2 min, Instigator) | Ejected (game misconduct). Instigator — MIN 0, PIT 0'],
      'two plays, one moment: the ejection is a line on the first');
    assert.deepEqual(got('olivier-penalties-off'), ['player.ejected: Mathieu Olivier got ejected (game misconduct) | Game Misconduct — MIN 0, PIT 0']);
    // NFL: "PENALTY on WAS-D.Payne, Disqualification" replaces his penalty alert.
    const nfl = { id: 'n1', type: 'Rushing Touchdown', typeSlug: 'rushing-touchdown', text: 'J.Gibbs right end for 13 yards, TOUCHDOWN. PENALTY on WAS-D.Payne, Disqualification, 15 yards, enforced on the kickoff.',
      participants: [{ id: '3115315', role: 'penalized' }], scoring: true, scoreValue: 6, home: 13, away: 7, at: Date.now(), shooting: false };
    const flagged = PLAYER_DETECTORS.nfl(g('nfl', '28', '20'), nfl as any);
    assert.deepEqual(flagged.map((e) => [e.type, e.title, e.aliases]), [['player.ejected', 'Daron Payne got ejected', ['nfl.penalty']]]);
    // Offsetting flags, and ESPN left the penalized players out (Titans, 2025): found on his team by name.
    const punt = { ...nfl, id: 'n2', type: 'Punt', typeSlug: 'punt', scoring: false, participants: [{ id: '3115480', role: 'punter' }],
      text: 'L.Cooke punts 49 yards to TEN 22, Center-R.Matiscik. C.Dike to TEN 35 for 13 yards (J.Kiser; R.Matiscik).Penalty on TEN-M.Brown, Disqualification, offsetting.Penalty on DEN-J.Kiser, Unnecessary Roughness, offsetting.' };
    assert.deepEqual(PLAYER_DETECTORS.nfl(g('nfl', '10', '7'), punt as any).map((e) => [e.type, e.title]), [['player.ejected', 'Mike Brown got ejected']]);
  }
});

test('the weekly recap: Monday 9 am in their time zone, once, and only for a week that had something', () => {
  fan('recap-fan', ['team:mlb:10', 'team:nfl:20']);
  fan('recap-west', ['team:mlb:10'], { quietHours: { enabled: true, start: '23:00', end: '08:00', tz: 'America/Los_Angeles' } });
  fan('recap-off', ['team:mlb:10'], { types: { 'app.weekly_recap': false } });
  fan('quiet-week', ['team:mlb:10']);
  // The week of Monday, October 5, 2026 (Eastern): two Yankees losses and a Jets blowout, six alerts in all.
  const ev = db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta) VALUES (?, ?, ?, NULL, ?, ?, 'x', ?, ?, ?)`);
  const at = Date.parse('2026-10-07T02:00:00Z');
  ev.run('w1', 'team.lost', 'mlb', 'team:mlb:10', 'Successful Hate Watch! Yankees lost to the Rays', at, at, JSON.stringify({ margin: 2 }));
  ev.run('w2', 'team.lost', 'mlb', 'team:mlb:10', 'Successful Hate Watch! Yankees lost to the Rays', at + 1, at, JSON.stringify({ margin: 1 }));
  ev.run('w3', 'team.lost', 'nfl', 'team:nfl:20', 'Successful Hate Watch! Jets got BLOWN OUT by the Bills', at + 2, at, JSON.stringify({ margin: 24 }));
  for (const [i, id] of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].entries()) {
    if (i >= 3) ev.run(id, 'mlb.batter.strikeout', 'mlb', 'team:mlb:10', 'x', at + i, at, '{}');
    for (const dev of ['recap-fan', 'recap-west', 'recap-off']) db.prepare('INSERT INTO feed (device_id, event_id, occurred_at, pushed) VALUES (?, ?, ?, 0)').run(dev, id, at + i);
  }
  const hw = db.prepare('INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?, ?, ?, ?)');
  for (const dev of ['recap-fan', 'recap-west', 'recap-off']) { hw.run(dev, 'w1', 'team:mlb:10', at); hw.run(dev, 'w2', 'team:mlb:10', at + 1); hw.run(dev, 'w3', 'team:nfl:20', at + 2); }
  // recap-west only tracks the Yankees, but its feed had the Jets' loss too: the recap is about the device's week.
  const recaps = (dev: string) => got(dev).filter((x) => x.startsWith('app.weekly_recap'));

  weeklyRecaps(Date.parse('2026-10-11T22:00:00Z')); // Sunday evening
  weeklyRecaps(Date.parse('2026-10-12T12:30:00Z')); // Monday 8:30 am Eastern
  assert.deepEqual(recaps('recap-fan'), []);
  weeklyRecaps(Date.parse('2026-10-12T13:30:00Z')); // 9:30 am Eastern, 6:30 Pacific
  const recap = 'app.weekly_recap: Your week in misery: 3 Successful Hate Watches | Yankees 2, Jets 1. 6 alerts in all. Low point: Jets got BLOWN OUT by the Bills.';
  assert.deepEqual(recaps('recap-fan'), [recap]);
  assert.deepEqual(recaps('recap-west'), [], 'not 9 am in Los Angeles yet');
  weeklyRecaps(Date.parse('2026-10-12T16:30:00Z')); // 9:30 Pacific
  assert.deepEqual(recaps('recap-west'), [recap]);
  assert.deepEqual(recaps('recap-fan'), [recap], 'once a week');
  assert.deepEqual(recaps('recap-off'), [], 'switched off');
  assert.deepEqual(recaps('quiet-week'), [], 'nothing happened to them');
  assert.equal(pushed('recap-fan'), 1);
});
