// College football (FBS, teams only), in ESPN's shapes and wording from October 3 2026's games: the league's
// URLs; the catalog (each conference's teams, every school's names: "Nebraska", not "Cornhuskers"); a game read
// from its summary alone, plays from its drives; the football alerts as college's own types (a touchdown wiped
// out, an onside kick, three-and-out, the red zone with field codes that aren't the abbreviation); cards with the
// top-25 rank; the AP poll; a ranked team losing to an unranked one; a bowl game isn't an elimination.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db, kvSet } = await import('../src/db.ts');
const { loadCatalog, ingestCfb, cfbSeason } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls, LEAGUE_IDS, TEAMS_ONLY } = await import('../src/leagues.ts');
const D = await import('../src/detectors.ts');
const { gameCard } = await import('../src/scores.ts');
const { divisionsOf } = await import('../src/divisions.ts');
const P = await import('../src/cfb-poll.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'cfb', ?, ?, ?, ?, 'x', 500, 500, 0)`);
for (const [id, name, short, abbr] of [['61', 'Georgia Bulldogs', 'Georgia', 'UGA'], ['238', 'Vanderbilt Commodores', 'Vanderbilt', 'VAN'], ['2005', 'Air Force Falcons', 'Air Force', 'AFA'],
  ['2426', 'Navy Midshipmen', 'Navy', 'NAVY'], ['25', 'California Golden Bears', 'California', 'CAL'], ['2439', 'UNLV Rebels', 'UNLV', 'UNLV'], ['2579', 'South Carolina Gamecocks', 'South Carolina', 'SC'], ['96', 'Kentucky Wildcats', 'Kentucky', 'UK']])
  team.run(`team:cfb:${id}`, id, name, short, abbr);
loadCatalog();

test('the league: ESPN\'s college-football, every FBS game on its scoreboard; teams only; after the UFC on the chips', () => {
  assert.equal(urls.scoreboard('cfb'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300');
  assert.equal(urls.scoreboard('cfb', '20261010'), 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261010&groups=80&limit=300');
  assert.equal(urls.scoreboard('nfl', '20261011'), 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261011', 'others as they were');
  assert.deepEqual([LEAGUE_IDS.at(-1), TEAMS_ONLY.has('cfb'), TEAMS_ONLY.has('nfl')], ['cfb', true, false]);
  assert.deepEqual([cfbSeason(new Date('2026-10-10')), cfbSeason(new Date('2027-01-05')), cfbSeason(new Date('2027-07-02'))], [2026, 2026, 2027], 'a season runs August to January');
});

test("the catalog: the FBS's teams from its conferences, each school's short name; no rosters, no logo checks", async () => {
  const season = cfbSeason();
  const confTeams = (n: number, from: number) => ({ items: Array.from({ length: n }, (_, i) => ({ $ref: `http://sports.core.api.espn.pvt/v2/sports/football/leagues/college-football/seasons/${season}/teams/${from + i}?lang=en` })) });
  const school = (id: number, name: string, short: string, mascot: string) => ({ team: { id: String(id), displayName: name, shortDisplayName: short, name: mascot, location: short, abbreviation: short.slice(0, 4).toUpperCase(), color: 'e31937',
    logos: [{ href: `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`, rel: ['full', 'default'], width: 500, height: 500 }] } });
  const reads: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    reads.push(String(url));
    const body = String(url) === urls.cfbConferences(season) ? { items: [{ $ref: 'http://x/groups/5?lang=en' }, { $ref: 'http://x/groups/8?lang=en' }] }
      : String(url) === urls.cfbGroup(season, '5') ? { name: 'Big Ten Conference', shortName: 'Big Ten' }
      : String(url) === urls.cfbGroup(season, '8') ? { name: 'Southeastern Conference', shortName: 'SEC' }
      : String(url) === urls.cfbConferenceTeams(season, '5') ? confTeams(60, 1000)
      : String(url) === urls.cfbConferenceTeams(season, '8') ? confTeams(60, 2000)
      : String(url) === urls.cfbAllTeams() ? { sports: [{ leagues: [{ teams: [school(1000, 'Nebraska Cornhuskers', 'Nebraska', 'Cornhuskers'),
        ...Array.from({ length: 119 }, (_, i) => school(i < 59 ? 1001 + i : 2000 + i - 59, `School ${i}`, `School ${i}`, 'Mascots')), school(3000, 'Montana Grizzlies', 'Montana', 'Grizzlies')] }] }] }
      : null;
    return { ok: !!body, status: body ? 200 : 404, json: async () => body, headers: new Headers() } as any;
  }) as typeof fetch;
  try {
    const stats: any = { teams: 0, players: 0 };
    const { teams, conferences } = await ingestCfb(stats);
    const neb = teams.find((t) => t.espnId === '1000')!;
    assert.deepEqual([teams.length, stats.teams, neb.name, neb.shortName, neb.logoW, conferences['1000'], conferences['2005']], [120, 120, 'Nebraska Cornhuskers', 'Nebraska', 500, 'Big Ten', 'SEC']);
    assert.ok(!teams.some((t) => t.espnId === '3000'), 'an FCS school (Montana) isn\'t one');
    assert.ok(!reads.some((u) => /roster|\.png/.test(u)), 'no rosters, no logo checks');
  } finally { globalThis.fetch = realFetch; }
  kvSet('cfb:conferences', { '61': 'SEC', '238': 'SEC', '2005': 'Mountain West', '2426': 'American' });
  const div = await divisionsOf('cfb');
  assert.deepEqual([div.get('61'), div.get('2005'), div.get('2426')], [{ name: 'SEC', order: 2 }, { name: 'Mountain West', order: 1 }, { name: 'American', order: 0 }], 'Search\'s "by division": conferences A to Z, no read of ESPN');
});

// ESPN's drive plays (a summary's drives): the team with the ball under `start`, no players.
const play = (id: string, type: string, text: string, team: string, away: number, home: number, x: Record<string, unknown> = {}) =>
  ({ id, type: { text: type }, text, start: { team: { id: team } }, end: { team: { id: team } }, awayScore: away, homeScore: home, period: { number: 1 }, clock: { displayValue: '10:00' }, scoringPlay: false, wallclock: new Date().toISOString(), ...x });

test("a game's plays from its drives: each once (the drive under way is in both as it ends), the team with the ball, the score", () => {
  const a = play('1', 'Kickoff', '(15:00) #91 P.Woodring kickoff 65 yards to the VAN00, Touchback', '61', 0, 0);
  const b = play('2', 'Passing Touchdown', '(10:00) #3 G.Stockton pass complete to #1 Z.Branch for 20 yds for a TD', '61', 0, 7, { scoringPlay: true, period: { number: 2 }, clock: { displayValue: '4:12' } });
  const plays = D.fromDrivePlays({ drives: { previous: [{ plays: [a] }, { plays: [b] }], current: { plays: [b] } } });
  assert.deepEqual(plays.map((p) => [p.id, p.teamId, p.home, p.away, p.scoring, p.periodNum, p.clockSec, p.participants.length]), [['1', '61', 0, 0, false, 1, 600, 0], ['2', '61', 7, 0, true, 2, 252, 0]]);
});

test('an end-of-period marker ESPN lists first in its drive goes last ("End of Game" atop the overtime drive that won it)', () => {
  const end = play('e', 'End of Game', 'End of OT.', '96', 35, 34);
  const td = play('t', 'Passing Touchdown', '(00:00) pass for 6 yards, TOUCHDOWN', '96', 35, 34, { scoringPlay: true });
  const run = play('r', 'Rush', '(00:00) rush for 5 yards', '96', 27, 34);
  assert.deepEqual(D.fromDrivePlays({ drives: { previous: [{ plays: [end, run, td] }] } }).map((p) => p.type), ['Rush', 'Passing Touchdown', 'End of Game']);
});

test("an opponent's score on a school: no \"the\" (\"Vanderbilt scored 7 on Georgia\")", () => {
  const ctx: any = { league: 'cfb', gameId: 'G6', homeId: '61', awayId: '238', goalies: new Map() };
  const td = D.fromSitePlay({ ...play('s1', 'Passing Touchdown', 'pass for a TD', '238', 7, 0, { scoringPlay: true }), team: { id: '238' } });
  assert.deepEqual(D.teamScoreEvents(ctx, { home: 0, away: 0 }, td).map((e) => e.title), ['Vanderbilt scored 7 to take the lead over Georgia', 'Vanderbilt scored 7 on Georgia']);
});

test("a game read from its summary alone: no read of the play-by-play with players; scores by school name; a finished drive's alert as college's own", async () => {
  db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('fan', 's', 'test', JSON.stringify(DEFAULT_PREFS));
  for (const t of ['team:cfb:61', 'team:cfb:238']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', t);
  const reads: string[] = [];
  const drives: any = { previous: [], current: null };
  liveDeps.getJson = async (url: string) => {
    reads.push(url.replace(/[?&]_hw=\d+/, ''));
    if (url.startsWith(urls.summary('cfb', 'G1'))) return { header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [] }] }, drives };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('cfb', 'G1', '61', '238'); // Georgia (home) and Vanderbilt
  await tracker.poll(); // the baseline
  drives.current = { id: 'd1', plays: [play('p1', 'Rush', '(12:10) run for 2', '238', 0, 0)] };
  await tracker.poll();
  const td = play('p2', 'Passing Touchdown', '(9:40) pass for 30 yds for a TD', '61', 0, 7, { scoringPlay: true });
  drives.previous = [{ id: 'd1', team: { id: '238', abbreviation: 'VAN' }, result: 'PUNT', displayResult: 'Punt', description: '3 plays, 3 yards, 0:51', offensivePlays: 3, yards: 3,
    plays: [play('p1', 'Rush', '(12:10) run for 2', '238', 0, 0), play('p1b', 'Punt', '(10:55) punt 40 yards', '238', 0, 0)] }];
  drives.current = { id: 'd2', plays: [td] };
  await tracker.poll();
  await tracker.poll();
  const alerts = (db.prepare(`SELECT e.type, e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'fan' AND e.game_id = 'G1' ORDER BY f.rowid`).all() as any[]).map((r) => `${r.type} | ${r.title}`);
  assert.deepEqual(alerts, ['team.fell_behind | Georgia scored 7 to take the lead over Vanderbilt', 'cfb.team.three_and_out | Vanderbilt went three-and-out'], 'no "the" before a school');
  assert.ok(reads.length && reads.every((u) => u === urls.summary('cfb', 'G1')), 'the summary alone');
});

test("college's wording: a touchdown nullified by its own team's penalty (the play's team, not the penalty's code: \"USC\" is South Carolina), an onside kick kept", () => {
  const ctx: any = { league: 'cfb', gameId: 'G2', homeId: '96', awayId: '2579', goalies: new Map() }; // Kentucky (home), South Carolina
  const nullified = D.fromSitePlay({ ...play('n1', 'Rush', '(13:56) Shotgun #16 L.Sellers rush right for 2 yards gain to the UKY00 TOUCHDOWN nullified by penalty, clock 13:51 PENALTY USC Personal Foul (#83 D.Black) 15 yards from UKY02 to UKY17. NO PLAY.', '2579', 3, 7), team: { id: '2579' } });
  assert.deepEqual(D.PLAYER_DETECTORS.cfb(ctx, nullified).map((e) => [e.type, e.targetKey, e.title]), [['cfb.td_wiped_out', 'team:cfb:2579', 'South Carolina had a touchdown wiped out by a penalty']]);
  const kickRet = D.fromSitePlay({ ...play('n2', 'Kickoff', '(13:33) kickoff 50 yards to the UK30, return for a TOUCHDOWN nullified by penalty, clock 13:20 PENALTY UK Holding 10 yards. NO PLAY.', '2579', 3, 7), team: { id: '2579' } });
  assert.deepEqual(D.PLAYER_DETECTORS.cfb(ctx, kickRet).map((e) => e.targetKey), ['team:cfb:96'], 'on a kickoff, the receiving side\'s');
  const g: any = { league: 'cfb', gameId: 'G3', homeId: '2439', awayId: '25', goalies: new Map() }; // UNLV (home), California
  const onside = D.fromSitePlay({ ...play('o1', 'Kickoff', '(15:00) #33 T.McGough onside kickoff 14 yards to the CAL49, End Of Play', '25', 7, 24), team: { id: '25' }, end: { team: { id: '25' } } });
  assert.deepEqual(D.PLAYER_DETECTORS.cfb(g, onside).map((e) => [e.type, e.targetKey, e.title]), [['cfb.team.onside_recovered', 'team:cfb:2439', 'California recovered an onside kick against UNLV']]);
  const lost = D.fromSitePlay({ ...play('o2', 'Kickoff', '(03:18) #80 S.Starzyk onside kickoff 18 yards to the CAL32, End Of Play', '25', 7, 24), team: { id: '25' }, end: { team: { id: '2439' } } });
  assert.deepEqual(D.PLAYER_DETECTORS.cfb(g, lost), [], 'recovered by the other side: nothing');
});

test('the red zone from the down and distance, with field codes that aren\'t the abbreviation ("AF" for Air Force\'s AFA)', () => {
  const ctx: any = { league: 'cfb', gameId: 'G4', homeId: '2426', awayId: '2005', goalies: new Map() };
  const snap = (id: string, dd: string) => ({ id, start: { team: { id: '2005' }, downDistanceText: dd }, type: { text: 'Rush' }, homeScore: 0, awayScore: 0 });
  const drive = (plays: any[], result: string) => ({ id: `dr-${result}-${plays.length}`, team: { id: '2005', abbreviation: 'AFA' }, result, displayResult: result.toLowerCase(), plays });
  assert.deepEqual(D.nflDriveEvents(ctx, drive([snap('a', '1st & 10 at AF 15'), snap('b', '2nd & 8 at AF 17')], 'PUNT')).filter((e) => /red_zone/.test(e.type)), [], 'their own 15: not the red zone');
  assert.deepEqual(D.nflDriveEvents(ctx, drive([snap('c', '1st & 10 at NAVY 15'), snap('d', '4th & 3 at NAVY 8')], 'DOWNS')).map((e) => e.type), ['cfb.team.turnover_on_downs', 'cfb.team.red_zone_empty']);
});

test('a card: a top-25 team\'s rank on its name ("#2 Georgia", every build shows it), the catalog\'s name as it was; who has the ball', () => {
  const comp = (id: string, homeAway: string, rank: number, score = '7') => ({ id, homeAway, score, curatedRank: { current: rank }, team: { id } });
  const ev = { id: 'E1', date: '2026-10-03T16:00Z', status: { type: { state: 'in', shortDetail: '2nd 4:12' } },
    competitions: [{ competitors: [comp('61', 'home', 2), comp('238', 'away', 99, '0')], situation: { possession: '238', downDistanceText: '3rd & 7 at VAN 23', homeTimeouts: 3, awayTimeouts: 2 } }] };
  const card = gameCard('cfb', ev)!;
  assert.deepEqual([card.home!.team.shortName, card.home!.rank, card.away!.team.shortName, card.away!.rank, card.possession, card.downDistance, card.timeouts], ['#2 Georgia', 2, 'Vanderbilt', undefined, 'team:cfb:238', '3rd & 7 at VAN 23', { home: 3, away: 2 }]);
  assert.equal((db.prepare(`SELECT short_name FROM teams WHERE key = 'team:cfb:61'`).get() as any).short_name, 'Georgia');
});

test("the AP poll: a new week's drops and teams out, once; the first read (a deploy) and the same poll again are nothing", async () => {
  const poll = (week: number, ranks: [string, number, number][], out: [string, number][]) => ({ rankings: [{ name: 'AP Top 25', type: 'ap', season: { year: 2026 }, occurrence: { number: week, displayValue: `Week ${week}` },
    ranks: ranks.map(([id, current, previous]) => ({ current, previous, team: { id } })), droppedOut: out.map(([id, previous]) => ({ current: 0, previous, team: { id } })) }] });
  let res = poll(6, [['61', 2, 2], ['96', 20, 24]], []);
  P.cfbPollDeps.getJson = async () => res;
  const published = () => (db.prepare(`SELECT type, title, body FROM events WHERE id LIKE 'cfbap:%' ORDER BY rowid`).all() as any[]).map((r) => `${r.type} | ${r.title} | ${r.body}`);
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', 'team:cfb:96');
  await P.scanCfbPoll();
  assert.deepEqual(published(), [], 'the first read: the baseline');
  res = poll(7, [['61', 5, 2], ['238', 25, 0]], [['96', 20]]);
  await P.scanCfbPoll();
  await P.scanCfbPoll();
  assert.deepEqual(published(), ['cfb.poll_drop | Georgia fell to No. 5 in the AP poll | Down from No. 2 · Week 7', 'cfb.poll_out | Kentucky dropped out of the AP Top 25 | Was No. 20 · Week 7'],
    "once; Vanderbilt's into it isn't news");
});

test("a ranked team beaten by an unranked one: a line on its loss (the ranking going in); not if both are ranked, not the NFL's", () => {
  const ctx: any = { league: 'cfb', gameId: 'G5', homeId: '61', awayId: '238' };
  const lost: any = { id: 'G5:final:team.lost:61', type: 'team.lost', targetKey: 'team:cfb:61', title: 'x', body: 'Final', at: 0, moment: 'G5:lost' };
  const upset = (ranks: any, league = 'cfb') => D.lossFacts({ ...ctx, league }, lost, { home: 17, away: 20 }, { pre: { ranks } }).filter((e) => e.type === 'cfb.upset_loss').map((e) => [e.title, e.fold]);
  assert.deepEqual(upset({ home: 2 }), [['Successful Hate Watch! No. 2 Georgia lost to unranked Vanderbilt', 'Lost to unranked Vanderbilt as the No. 2 team.']]);
  assert.deepEqual([upset({ home: 2, away: 14 }), upset({}), upset({ home: 2 }, 'nfl')], [[], [], []]);
});

test('the postseason: a bowl game lost isn\'t an elimination, a College Football Playoff game is', () => {
  const ev = (headline: string) => ({ season: { type: 3 }, status: { type: { completed: true } }, competitions: [{ notes: [{ headline }], competitors: [{ id: '61', score: '17' }, { id: '238', score: '20' }] }] });
  assert.equal(D.eliminationOf('cfb', ev("Duke's Mayo Bowl")), null);
  assert.equal(D.eliminationOf('cfb', ev('College Football Playoff Quarterfinal at the Rose Bowl'))?.loserId, '61');
});

test("standings: a conference by its short name (ESPN's abbreviation is a slug, \"big10\"), a team's place in it", async () => {
  const { parseStandings } = await import('../src/live.ts');
  const conf = (abbreviation: string, name: string, shortName: string, ids: string[]) => ({ abbreviation, name, shortName,
    standings: { entries: ids.map((id, i) => ({ team: { id }, stats: [{ name: 'playoffSeed', value: i + 1 }, { name: 'streak', displayValue: 'W1' }] })) } });
  const snap = parseStandings({ children: [conf('big10', 'Big Ten Conference', 'Big Ten', ['158', '84']), conf('sec', 'Southeastern Conference', 'SEC', ['61'])] });
  assert.deepEqual([snap.get('84'), snap.get('61')?.group], [{ rank: 2, group: 'Big Ten', clincher: '', streak: 'W1' }, 'SEC']);
});
