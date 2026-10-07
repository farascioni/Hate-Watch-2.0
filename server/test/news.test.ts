// Off-field trouble and fines/suspensions from ESPN's league news. The first three items are as ESPN
// published them (NBA 2026-09-30, MLB 2026-10-04, NFL 2026-10-06); the rest are typical shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db, kvGet } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { classify, newsEvents, scanNews, newsDeps } = await import('../src/news.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [['nba', '21', 'Phoenix Suns', 'Suns', 'PHX'], ['nba', '18', 'New York Knicks', 'Knicks', 'NY'], ['mlb', '20', 'Washington Nationals', 'Nationals', 'WSH'],
  ['nfl', '3', 'Chicago Bears', 'Bears', 'CHI'], ['nfl', '33', 'Baltimore Ravens', 'Ravens', 'BAL'], ['nfl', '4', 'Cincinnati Bengals', 'Bengals', 'CIN'], ['nfl', '6', 'Dallas Cowboys', 'Cowboys', 'DAL'],
  ['epl', '370', 'Fulham', 'Fulham', 'FUL'], ['epl', '360', 'Manchester United', 'Man United', 'MAN']]) {
  team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
}
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [lg, id, name, t] of [['nba', '3155526', 'Dillon Brooks', '21'], ['nfl', '50', 'Roquan Smith', '33'], ['nfl', '51', 'Joe Burrow', '4'], ['nfl', '52', 'George Pickens', '6']]) {
  player.run(`player:${lg}:${id}`, lg, id, name, `team:${lg}:${t}`);
}
loadCatalog();

const T = Date.parse('2026-10-06T12:00:00Z');
const at = (hoursAgo: number) => new Date(T - hoursAgo * 3600_000).toISOString();
const athlete = (id: string, description: string) => ({ type: 'athlete', athleteId: Number(id), description });
const teamTag = (id: string, description: string) => ({ type: 'team', teamId: Number(id), description });
const brooks = {
  id: 50068731, type: 'HeadlineNews', published: at(1),
  headline: "Suns' Dillon Brooks charged with DUI from March arrest",
  description: 'Suns forward Dillon Brooks was charged Monday with driving under the influence following his March arrest in Scottsdale, Arizona, according to court records.',
  categories: [athlete('3155526', 'Dillon Brooks'), teamTag('21', 'Phoenix Suns')],
};
const rivero = {
  id: 50096881, type: 'HeadlineNews', published: at(2),
  headline: 'Francisco Rivero, Raudi Perez suspended for positive drug tests',
  description: 'Washington Nationals catcher Francisco Rivero and free agent pitcher Raudi Perez have been suspended for 56 games each following positive tests for a performance-enhancing substance under baseball\'s minor league drug programs.',
  categories: [teamTag('20', 'Washington Nationals')],
};
const exBears = {
  id: 50112984, type: 'HeadlineNews', published: at(1),
  headline: 'Ex-Bears LB Wilson in altercation with security at Soldier Field',
  description: 'Former Bears Super Bowl champion linebacker Otis Wilson was involved in an altercation with a female and male security officer at Soldier Field on Sunday after a dispute about elevator usage.',
  categories: [teamTag('3', 'Chicago Bears')],
};
const view = (es: any[]) => es.map((e) => [e.type, e.targetKey, e.title]);

test('what an item is: trouble, a fine or suspension, both, or neither', () => {
  assert.deepEqual(classify(brooks.headline), { type: 'off_field' });
  assert.deepEqual(classify(rivero.headline), { type: 'fine_suspension' });
  assert.deepEqual(classify('Cowboys WR suspended six games for violating personal conduct policy'), { type: 'fine_suspension', aliases: ['off_field'] }, 'a suspension for off-field conduct counts as both');
  assert.deepEqual(classify('NBA fines Knicks $25K for violating injury reporting rules'), { type: 'fine_suspension' });
  assert.deepEqual(classify('Sources: Ravens LB to be suspended two games for hit'), { type: 'fine_suspension' }, 'a reported suspension still counts');
  for (const t of ["Spurs' Victor Wembanyama not interested in promoting betting sites", 'Rain suspends game in the 5th; resumes Tuesday', 'Charges dropped against Bills LB',
    'Suspension of Pacers guard reduced to two games on appeal', 'Sources: Ravens QB Lamar Jackson dealing with ankle sprain', 'Rookie is fine after scare in practice',
    // As ESPN had it on 2026-10-06: an opinion, not a ban. Then name-calling, not an accusation of wrongdoing (EPL).
    "Erik ten Hag 'was a piece of crap' with Man United squad - Fred. Former Manchester United midfielder Fred has accused ex-boss Erik ten Hag of being a 'piece of crap' when it came to squad management.",
    'Arteta accuses referee of bias after Arsenal loss',
    "Lando Norris: Drivers should have 'one-race ban' after collision with Franco Colapinto at Azerbaijan GP. Lando Norris has said Franco Colapinto should be banned for the pile-up which ended his Azerbaijan Grand Prix."]) {
    assert.equal(classify(t), null, t);
  }
  assert.deepEqual(classify('Winger accused of racist abuse by opponent'), { type: 'off_field' }, 'being accused still counts');
});

test('who it is about (teams under their own team.* switches): the tagged player and the team, a lone tagged team, never a former team or the one on the receiving end', () => {
  assert.deepEqual(view(newsEvents('nba', [brooks], 0)), [
    ['off_field', 'player:nba:3155526', "Suns' Dillon Brooks charged with DUI from March arrest"],
    ['team.off_field', 'team:nba:21', "Suns' Dillon Brooks charged with DUI from March arrest"],
  ]);
  const [p, t] = newsEvents('nba', [brooks], 0);
  assert.equal(p.moment, t.moment, 'one item: the player and team alerts share a moment');
  assert.deepEqual(newsEvents('nfl', [{ ...brooks, id: 3, headline: "Cowboys' George Pickens suspended two games for violating personal conduct policy", categories: [athlete('52', 'George Pickens'), teamTag('6', 'Dallas Cowboys')] }], 0).map((e) => [e.type, e.aliases]),
    [['fine_suspension', ['off_field']], ['team.fine_suspension', ['team.off_field']]], 'a conduct suspension counts as both, for players and for teams');
  assert.equal(p.body, brooks.description);
  assert.deepEqual(view(newsEvents('mlb', [rivero], 0)), [['team.fine_suspension', 'team:mlb:20', 'Nationals: Francisco Rivero, Raudi Perez suspended for positive drug tests']],
    'minor leaguers are not tagged: their team, named in the description, is');
  assert.deepEqual(newsEvents('nfl', [exBears], 0), [], 'a former Bear: not the Bears');
  const hit = { id: 1, type: 'HeadlineNews', published: at(1), headline: "Ravens' Roquan Smith fined $25K for hit on Bengals QB Joe Burrow", description: '',
    categories: [athlete('50', 'Roquan Smith'), athlete('51', 'Joe Burrow'), teamTag('33', 'Baltimore Ravens'), teamTag('4', 'Cincinnati Bengals')] };
  assert.deepEqual(view(newsEvents('nfl', [hit], 0)), [['fine_suspension', 'player:nfl:50', hit.headline], ['team.fine_suspension', 'team:nfl:33', hit.headline]], 'Burrow and the Bengals took the hit');
  const knicks = { id: 2, type: 'HeadlineNews', published: at(1), headline: 'NBA fines Knicks $25K for violating injury reporting rules', categories: [teamTag('18', 'New York Knicks')] };
  assert.deepEqual(view(newsEvents('nba', [knicks], 0)), [['team.fine_suspension', 'team:nba:18', knicks.headline]]);
  // As ESPN had it on 2026-10-06 (EPL): about Fulham. Man United are only the game, and his quote.
  const arbeloa = { id: 4, type: 'HeadlineNews', published: at(1), headline: 'FA charges Fulham boss Álvaro Arbeloa with misconduct for comments after Man United draw',
    description: 'Fulham boss Alvaro Arbeloa has been charged with misconduct by the FA  for claiming officials would "not let Manchester United lose" after Michael Carrick\'s side scored a late equaliser to draw their Premier League match at Craven Cottage.',
    categories: [teamTag('360', 'Manchester United'), teamTag('370', 'Fulham')] };
  assert.deepEqual(view(newsEvents('epl', [arbeloa], 0)), [['team.off_field', 'team:epl:370', arbeloa.headline]]);
});

test('only ESPN news items, only new ones', () => {
  assert.deepEqual(newsEvents('nba', [{ ...brooks, type: 'Media' }, { ...brooks, type: 'Story' }], 0), [], 'videos and columns about the same story');
  assert.deepEqual(newsEvents('nba', [brooks], T), [], 'published before `since`');
});

test('one alert per device and item; the first scan is history', async () => {
  const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
  const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
  const setup: [string, object, string[]][] = [
    ['both', {}, ['player:nba:3155526', 'team:nba:21']],
    ['team-only', {}, ['team:nba:21']],
    ['trouble-off', { types: { off_field: false } }, ['player:nba:3155526']],
    ['cowboys', { types: { fine_suspension: false } }, ['player:nfl:52']],
    ['players-off', { types: { off_field: false } }, ['player:nba:3155526', 'team:nba:21']],
    ['teams-off', { types: { 'team.off_field': false } }, ['team:nba:21']],
  ];
  for (const [id, prefs, targets] of setup) { device.run(id, 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, ...prefs })); for (const t of targets) follow.run(id, t); }
  const feeds: Record<string, any[]> = { nba: [{ ...brooks, published: new Date(Date.now() - 3600_000).toISOString() }], nfl: [] };
  newsDeps.getJson = async (url: string) => ({ articles: feeds[url.includes('/nba/') ? 'nba' : 'nfl'] });
  const feed = (dev: string) => (db.prepare('SELECT e.target_key, e.type FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(dev) as any[]).map((r) => `${r.type} ${r.target_key}`);

  await scanNews('nba');
  assert.ok(kvGet('news_since:nba'), 'the first scan sets the starting line');
  assert.deepEqual(feed('both'), [], 'what was already in the feed is history');

  feeds.nba.push({ ...brooks, id: 9, published: new Date(Date.now() + 1000).toISOString() });
  await scanNews('nba');
  await scanNews('nba'); // a re-scan
  assert.deepEqual(feed('both'), ['off_field player:nba:3155526'], 'tracking him and the Suns: one alert, his');
  assert.deepEqual(feed('team-only'), ['team.off_field team:nba:21']);
  assert.deepEqual(feed('players-off'), ['team.off_field team:nba:21'], 'his switch is off, the team one is on: the team alert comes instead');
  assert.deepEqual(feed('teams-off'), [], 'team alerts off, tracking only the Suns');
  assert.deepEqual(feed('trouble-off'), []);

  await scanNews('nfl');
  feeds.nfl.push({ id: 10, type: 'HeadlineNews', published: new Date(Date.now() + 1000).toISOString(), headline: "Cowboys' George Pickens suspended two games for violating personal conduct policy", categories: [athlete('52', 'George Pickens'), teamTag('6', 'Dallas Cowboys')] });
  await scanNews('nfl');
  assert.deepEqual(feed('cowboys'), ['fine_suspension player:nfl:52'], 'fines/suspensions off, off-field trouble on: a conduct suspension still comes');
});
