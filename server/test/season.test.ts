// The "season in misery" share card (season.ts): POST /me/share/season answers a link to /a/<code>, whose page and
// picture say the device's totals (Successful Hate Watches, the top teams, alerts, the low point, the team that
// sent the most). It is not an alert: no feed row, no push. A device with no alerts gets a clear 400.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { startApi } = await import('../src/api.ts');
const { seasonCard } = await import('../src/season.ts');

const team = (lg: string, id: string, name: string, short: string, ab: string, color: string) =>
  db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`).run(`team:${lg}:${id}`, lg, id, name, short, ab, color);
team('mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD', '#005a9c');
team('mlb', '26', 'San Francisco Giants', 'Giants', 'SF', '#fd5a1e');
team('nba', '4', 'Chicago Bulls', 'Bulls', 'CHI', '#ce1141');
loadCatalog();

const server = startApi(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.close(); });
const signUp = async () => (await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"platform":"ios"}' })).json() as Promise<{ token: string; deviceId: string }>;
/** The link the server answers is its public address; the test reads the same page from the local server. */
const local = (url: string) => `${base}/a/${url.split('/a/')[1]}`;
const post = (token: string) => fetch(`${base}/me/share/season`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });

const DAY = 86400_000, NOW = Date.now();
let n = 0;
/** One alert in a device's feed (and its Successful Hate Watch tally, for a loss) `daysAgo` days ago. */
function alert(deviceId: string, type: string, target: string, title: string, daysAgo: number, meta: object | null = null) {
  const id = `g${++n}:final:${type}:${target}`, at = NOW - daysAgo * DAY;
  db.prepare('INSERT INTO events (id, type, league, target_key, title, body, occurred_at, detected_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, type, target.split(':')[1], target, title, 'Final Score: 3 to 0', at, at, meta && JSON.stringify(meta));
  db.prepare('INSERT INTO feed (device_id, event_id, occurred_at, pushed) VALUES (?, ?, ?, 0)').run(deviceId, id, at);
  if (type === 'team.lost') db.prepare('INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?, ?, ?, ?)').run(deviceId, id, target, at);
}

test('a device with no alerts gets a clear 400, and nothing is stored', async () => {
  const { token } = await signUp();
  const res = await post(token);
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /no alerts yet/i);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'app.season_card'").get() as { n: number }).n, 0);
  assert.equal((await fetch(`${base}/me/share/season`, { method: 'POST' })).status, 401, 'a device only');
  assert.equal(seasonCard('nobody'), null);
});

test('the link opens a page and a picture with the device\'s season, and it is not an alert', async () => {
  const { token, deviceId } = await signUp();
  alert(deviceId, 'team.lost', 'team:mlb:19', 'Successful Hate Watch! Dodgers lost to the Giants', 9, { margin: 3 });
  alert(deviceId, 'team.lost', 'team:mlb:19', 'Successful Hate Watch! Dodgers lost to the Giants', 5, { margin: 1 });
  alert(deviceId, 'team.lost', 'team:nba:4', 'Successful Hate Watch! Bulls got BLOWN OUT by the Nuggets', 3, { margin: 31 });
  alert(deviceId, 'team.opponent_scored', 'team:mlb:19', 'Giants scored on the Dodgers', 2);
  alert(deviceId, 'team.opponent_scored', 'team:mlb:26', 'Dodgers scored on the Giants', 2);
  alert(deviceId, 'team.opponent_scored', 'team:mlb:26', 'Dodgers scored on the Giants again', 1);
  const feedBefore = (db.prepare('SELECT COUNT(*) AS n FROM feed WHERE device_id = ?').get(deviceId) as { n: number }).n;

  const res = await post(token);
  assert.equal(res.status, 200);
  const { url } = await res.json() as { url: string };
  const code = url.match(/\/a\/([\w-]{11})$/)?.[1];
  assert.ok(code, url);

  const page = await fetch(`${base}/a/${code}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'public, max-age=300');
  const html = await page.text();
  assert.match(html, /My season in misery: 3 Successful Hate Watches/);
  assert.match(html, /Dodgers 2, Bulls 1\./, 'the top teams, most first');
  assert.match(html, /6 alerts, \w{3} \d{1,2}, \d{4} to \w{3} \d{1,2}, \d{4}\./, 'the alerts, with the dates the card covers');
  assert.match(html, /Low point: Bulls got BLOWN OUT by the Nuggets\./, 'the worst loss, the recap\'s pick');
  assert.match(html, /property="og:image" content="[^"]+\/a\/[\w-]{11}\/card\.png"/);
  assert.match(html, /name="robots" content="noindex/);

  const png = await fetch(`${base}/a/${code}/card.png`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(png.headers.get('cache-control'), 'public, max-age=86400');
  assert.deepEqual([...new Uint8Array(await png.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // The one look: a style the link asks for is the same card, never an error.
  assert.equal((await fetch(`${base}/a/${code}?s=ticket`)).status, 200);

  const { item } = await (await fetch(`${base}/shared/${code}`)).json() as { item: { typeLabel: string; title: string } };
  assert.equal(item.typeLabel, 'Season in misery');
  assert.equal(item.title, 'My season in misery: 3 Successful Hate Watches');

  // The loss rating is internal: nothing about it on the page or in the app's JSON.
  assert.doesNotMatch(html + JSON.stringify(item), /rating|lossLabel|loss label/i);

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feed WHERE device_id = ?').get(deviceId) as { n: number }).n, feedBefore, 'no feed row for the card');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hate_watches WHERE device_id = ?').get(deviceId) as { n: number }).n, 3, 'and no Successful Hate Watch');
  // The card is stored on the top team (the app offers "Get alerts like this about" it), yet no list of that team's alerts shows it.
  const types = async (path: string) => ((await (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })).json() as { items: { type: string }[] }).items).map((i) => i.type);
  assert.ok((await types('/me/feed?target=team:mlb:19')).includes('team.lost'), 'the list is not empty');
  for (const path of ['/me/feed', '/me/feed?target=team:mlb:19', '/targets/team:mlb:19/misery']) assert.ok(!(await types(path)).includes('app.season_card'), path);

  // Asking again with nothing new is the same link; one more loss is a new card, and the old link keeps its numbers.
  assert.equal((await (await post(token)).json() as { url: string }).url, url);
  alert(deviceId, 'team.lost', 'team:mlb:26', 'Successful Hate Watch! Giants lost to the Dodgers', 0, { margin: 2 });
  const next = (await (await post(token)).json() as { url: string }).url;
  assert.notEqual(next, url);
  assert.match(await (await fetch(local(next))).text(), /My season in misery: 4 Successful Hate Watches/);
  assert.match(await (await fetch(`${base}/a/${code}`)).text(), /3 Successful Hate Watches/);

  // "Delete all my data" takes the cards and their links with it.
  assert.equal((await fetch(`${base}/me`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await fetch(`${base}/a/${code}`)).status, 404);
  assert.equal((await fetch(local(next))).status, 404);
});

test('alerts without a Successful Hate Watch still make a card, on the team that sent the most', async () => {
  const { token, deviceId } = await signUp();
  alert(deviceId, 'team.opponent_scored', 'team:mlb:26', 'Dodgers scored on the Giants', 4);
  alert(deviceId, 'team.opponent_scored', 'team:mlb:26', 'Dodgers scored on the Giants again', 3);
  alert(deviceId, 'team.fell_behind', 'team:mlb:19', 'Giants took the lead over the Dodgers', 2);
  const { url } = await (await post(token)).json() as { url: string };
  const html = await (await fetch(local(url))).text();
  assert.match(html, /My season in misery: 0 Successful Hate Watches/);
  assert.match(html, /3 alerts, /);
  assert.doesNotMatch(html, /Low point/);
  const code = url.split('/a/')[1];
  assert.equal((await fetch(`${base}/a/${code}/card.png`)).headers.get('content-type'), 'image/png');
});
