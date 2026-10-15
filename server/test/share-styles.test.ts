// Share styles (ticket stub, void, boarding pass, parking ticket, scratch-off, torn in half): which styles an alert
// can be shared in, that each draws a 1200×630 card, and that the link's ?s= is never trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db, shareCode } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { feedItem } = await import('../src/fanout.ts');
const { shareLink, shareCard } = await import('../src/share.ts');
const { shareStyles } = await import('../src/share-styles.ts');

globalThis.fetch = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="18" fill="#FFCC4D"/></svg>');

const team = (lg: string, id: string, name: string, short: string, ab: string, color: string) =>
  db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`).run(`team:${lg}:${id}`, lg, id, name, short, ab, color);
const player = (lg: string, id: string, name: string, teamKey: string) =>
  db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`).run(`player:${lg}:${id}`, lg, id, name, teamKey);
team('mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD', '#005a9c');
team('mlb', '26', 'San Francisco Giants', 'Giants', 'SF', '#fd5a1e');
team('nba', '4', 'Chicago Bulls', 'Bulls', 'CHI', '#ce1141');
team('nba', '7', 'Denver Nuggets', 'Nuggets', 'DEN', '#0e2240');
team('nba', '2', 'Boston Celtics', 'Celtics', 'BOS', '#007a33');
team('cfb', '84', 'Indiana Hoosiers', 'Hoosiers', 'IND', '#990000');
team('nhl', '5', 'Pittsburgh Penguins', 'Penguins', 'PIT', '#fcb514');
team('f1', '106842', 'Ferrari', 'Ferrari', 'FER', '#e8002d');
player('nhl', '3124', 'Evgeni Malkin', 'team:nhl:5');
player('nba', '4065648', 'Jayson Tatum', 'team:nba:2');
player('f1', '5498', 'Charles Leclerc', 'team:f1:106842');
loadCatalog();

const insert = (id: string, type: string, league: string, target: string, title: string, body: string, meta: object | null = null) =>
  db.prepare('INSERT INTO events (id, type, league, target_key, title, body, occurred_at, detected_at, share_code, meta) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)')
    .run(id, type, league, target, title, body, shareCode(id), meta && JSON.stringify(meta));
const row = (id: string) => db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
const ids = (id: string) => shareStyles(row(id)).map((s) => s.id);

insert('g:final:team.lost:19', 'team.lost', 'mlb', 'team:mlb:19', 'Successful Hate Watch! Dodgers lost to the Giants', 'Final Score: 3 to 0', { winnerId: '26' });
insert('g:final:team.lost_as_favorite:19', 'team.lost_as_favorite', 'mlb', 'team:mlb:19', 'Successful Hate Watch! Dodgers lost to the Giants as 64% favorites', 'Final Score: 3 to 0', { winnerId: '26', chance: 64 });
insert('g2:final:team.lost_as_favorite:19', 'team.lost_as_favorite', 'mlb', 'team:mlb:19', 'Successful Hate Watch! Dodgers lost as favorites', 'Final Score: 3 to 0', { chance: 64 }); // no winner id
insert('g:final:team.shut_out:19', 'team.shut_out', 'mlb', 'team:mlb:19', 'Successful Hate Watch! Dodgers were shut out by the Giants', 'Final Score: 3 to 0', { winnerId: '26' });
insert('n:final:team.blew_lead:4', 'team.blew_lead', 'nba', 'team:nba:4', 'Successful Hate Watch! Bulls blew a 15-point lead and lost to the Nuggets', 'Final Score: 133 to 128', { winnerId: '7', led: 15 });
insert('n:live:team.blew_lead:4', 'team.blew_lead', 'nba', 'team:nba:4', 'Bulls just blew a 15-point lead', 'Nuggets lead 100-99', { led: 15 }); // live: no final score
insert('n:final:team.blew_lead:4:2595516', 'team.blew_lead', 'nba', 'player:nba:4065648', 'Successful Hate Watch! Tatum blew a lead', 'Final Score: 133 to 128', { winnerId: '7', led: 15 }); // not a team target
insert('elim:mlb:26:2026', 'team.eliminated', 'mlb', 'team:mlb:26', 'Giants are ELIMINATED ⚰️', 'Officially out of playoff contention. See you next year.', { teamId: '26' });
insert('f:f1.places:5498', 'f1.driver.lost_places', 'f1', 'player:f1:5498', 'Charles Leclerc is down to P5 from P3 on the grid', 'Singapore GP: lap 34');
insert('f2:f1.places:5498', 'f1.driver.lost_places', 'f1', 'player:f1:5498', 'Charles Leclerc is out of position', 'Singapore GP: lap 34'); // no places in the title
insert('h:player.ejected:3124', 'player.ejected', 'nhl', 'player:nhl:3124', 'Evgeni Malkin got ejected (game misconduct)', 'Evgeni Malkin Game Misconduct — BUF 1, PIT 1');
insert('t:nba.technical:4065648', 'nba.technical', 'nba', 'player:nba:4065648', 'Jayson Tatum picked up a technical', 'Jayson Tatum makes technical free throw — PHI 63, BOS 88');
insert('c:cfb.team.penalty:84', 'cfb.team.penalty', 'cfb', 'team:cfb:84', 'Indiana was flagged: False Start', 'PENALTY IND False Start (#70 A.Leibfried) 5 yards from NEB37 to NEB42. NO PLAY — IU 20, NEB 17');
insert('c2:nfl.penalty:84', 'nfl.penalty', 'cfb', 'team:cfb:84', 'Indiana was flagged', 'PENALTY'); // no violation in the title
insert('m:mlb.batter.strikeout:1', 'mlb.batter.strikeout', 'mlb', 'team:mlb:19', 'A strikeout', 'He struck out.');
insert('notice:1', 'app.notice', 'mlb', 'app:notice', 'A notice', 'Body', {});

test('which styles each alert can be shared in', () => {
  assert.deepEqual(ids('g:final:team.lost:19'), ['classic', 'ticket']);
  assert.deepEqual(ids('g:final:team.lost_as_favorite:19'), ['classic', 'ticket', 'scratch']);
  assert.deepEqual(ids('g:final:team.shut_out:19'), ['classic', 'ticket']);
  assert.deepEqual(ids('n:final:team.blew_lead:4'), ['classic', 'ticket', 'torn']);
  assert.deepEqual(ids('elim:mlb:26:2026'), ['classic', 'void']);
  assert.deepEqual(ids('f:f1.places:5498'), ['classic', 'boarding']);
  for (const id of ['h:player.ejected:3124', 't:nba.technical:4065648', 'c:cfb.team.penalty:84']) assert.deepEqual(ids(id), ['classic', 'citation'], id);
  assert.deepEqual(ids('m:mlb.batter.strikeout:1'), ['classic'], 'a type with no layout is classic only');
});

test('a style applies only when everything it prints is there', () => {
  assert.deepEqual(ids('g2:final:team.lost_as_favorite:19'), ['classic', 'ticket'], 'no winner id: no scratch-off');
  assert.deepEqual(ids('n:live:team.blew_lead:4'), ['classic', 'torn'], 'no final score: no ticket, and the torn ticket says "lead gone"');
  assert.deepEqual(ids('n:final:team.blew_lead:4:2595516'), ['classic'], 'a player-form blown lead is no team ticket');
  assert.deepEqual(ids('f2:f1.places:5498'), ['classic'], 'no places in the title: no boarding pass');
  assert.deepEqual(ids('c2:nfl.penalty:84'), ['classic'], 'no violation in the title: no parking ticket');
});

test('every style draws a 1200×630 PNG', async () => {
  for (const r of db.prepare('SELECT * FROM events').all() as any[]) {
    for (const s of shareStyles(r)) {
      const png = (await shareCard(r.share_code, s.id))!;
      assert.equal(png.subarray(1, 4).toString(), 'PNG', `${r.id} ${s.id}`);
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), 630);
    }
  }
});

test('styles cache apart, and a style that is unknown or does not apply draws the classic card', async () => {
  const c = shareCode('g:final:team.lost_as_favorite:19');
  const [classic, ticket, scratch] = await Promise.all([shareCard(c), shareCard(c, 'ticket'), shareCard(c, 'scratch')]);
  assert.notDeepEqual(classic, ticket);
  assert.notDeepEqual(ticket, scratch);
  for (const bad of ['torn', 'nope', '', '__proto__', 'constructor']) assert.deepEqual(await shareCard(c, bad), classic, bad);
  assert.equal(await shareCard('nope', 'ticket'), null);
});

test('a share link carries its style to the page and the preview picture', () => {
  const c = shareCode('g:final:team.lost_as_favorite:19'), og = (html: string) => html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  const origin = 'https://hate-watch-api.fly.dev';
  assert.equal(og(String(shareLink(c, 'Twitterbot/1.0', origin).body)), `${origin}/a/${c}/card.png`);
  assert.equal(og(String(shareLink(c, 'Twitterbot/1.0', origin, 'scratch').body)), `${origin}/a/${c}/card.png?s=scratch`);
  assert.equal(og(String(shareLink(c, 'Twitterbot/1.0', origin, 'torn').body)), `${origin}/a/${c}/card.png`, 'a style that does not apply is classic');
});

test('feed items list their styles only when there is a choice, and notices have none', () => {
  const c = shareCode('g:final:team.lost_as_favorite:19'), url = `https://hate-watch-api.fly.dev/a/${c}`;
  assert.deepEqual(feedItem(row('g:final:team.lost_as_favorite:19')).shareStyles, [
    { id: 'classic', label: 'Classic', url, image: `${url}/card.png` },
    { id: 'ticket', label: 'Ticket stub', url: `${url}?s=ticket`, image: `${url}/card.png?s=ticket` },
    { id: 'scratch', label: 'Scratch-off', url: `${url}?s=scratch`, image: `${url}/card.png?s=scratch` },
  ]);
  assert.equal(feedItem(row('m:mlb.batter.strikeout:1')).shareStyles, undefined);
  assert.equal(feedItem(row('notice:1')).shareStyles, undefined);
});
