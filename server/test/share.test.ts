// Share links: the page behind /a/<code>, its link-preview picture, the iPhone → App Store redirect,
// and the migration that gives alerts from before share links their codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.HW_DB = ':memory:';
const { db, shareCode } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { feedItem } = await import('../src/fanout.ts');
const { shareLink, shareCard, sharedAlert, appSiteAssociation, APP_STORE_URL } = await import('../src/share.ts');

// Offline: emoji images come from a stub instead of the Twemoji CDN.
globalThis.fetch = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="18" fill="#FFCC4D"/></svg>');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES ('team:mlb:15', 'mlb', '15', 'Atlanta Braves', 'Braves', 'ATL', '#0c2340', 'x', 1, 1, 0)`).run();
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:mlb:1', 'mlb', '1', 'Ronald Acuña Jr.', 'team:mlb:15', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();
const insert = (id: string, type: string, target: string, title: string, body: string) =>
  db.prepare('INSERT INTO events (id, type, league, target_key, title, body, occurred_at, detected_at, share_code) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)')
    .run(id, type, 'mlb', target, title, body, shareCode(id));
insert('G1:final:team.lost:15', 'team.lost', 'team:mlb:15', 'Successful Hate Watch! Braves lost to the Dodgers', 'Final Score: 3 to 2');
insert('G1:p7:mlb.batter.strikeout:1', 'mlb.batter.strikeout', 'player:mlb:1', 'Ronald Acuña Jr. struck out looking 👀', 'Acuña Jr. struck out looking. — ATL 0, LAD 1');
const code = shareCode('G1:final:team.lost:15');

const ORIGIN = 'https://hate-watch-api.fly.dev';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
// What Messages sends when it builds a link preview (also covers Facebook's crawler).
const MESSAGES_PREVIEW = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const meta = (html: string, prop: string) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];

test('feed items carry their share link', () => {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get('G1:final:team.lost:15') as any;
  assert.equal(feedItem(row).shareUrl, `${ORIGIN}/a/${code}`);
  assert.match(code, /^[\w-]{11}$/);
});

test('tapping a share link on an iPhone goes straight to the App Store', () => {
  const r = shareLink(code, IPHONE, ORIGIN);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, APP_STORE_URL);
  assert.equal(shareLink('nope', IPHONE, ORIGIN).status, 302, 'even for an alert that no longer exists');
});

test('link previews get a page whose preview image is the alert card', () => {
  for (const ua of [MESSAGES_PREVIEW, DESKTOP, `${IPHONE} WhatsApp/2.25`]) {
    const r = shareLink(code, ua, ORIGIN);
    assert.equal(r.status, 200, ua);
    const html = String(r.body);
    assert.equal(meta(html, 'og:image'), `${ORIGIN}/a/${code}/card.png`);
    assert.equal(meta(html, 'og:title'), 'Successful Hate Watch! Braves lost to the Dodgers');
    assert.equal(meta(html, 'og:description'), 'Final Score: 3 to 2');
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
    assert.equal(meta(html, 'apple-itunes-app'), 'app-id=6819054268');
    assert.match(html, new RegExp(`href="${APP_STORE_URL}"`), 'a download button for desktop and Android visitors');
  }
  const gone = shareLink('nope', DESKTOP, ORIGIN);
  assert.equal(gone.status, 404);
  assert.equal(meta(String(gone.body), 'og:image'), undefined);
});

test('the card is a 1200×630 PNG, for teams and players (emoji and accents included)', async () => {
  for (const id of ['G1:final:team.lost:15', 'G1:p7:mlb.batter.strikeout:1']) {
    const png = (await shareCard(shareCode(id)))!;
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  }
  assert.equal(await shareCard('nope'), null);
});

test('universal links: iOS is told Hate Watch opens /a/* links, and the app can fetch the alert', () => {
  assert.deepEqual(appSiteAssociation(), {
    applinks: { details: [{ appIDs: ['G9V9266QK5.com.hatewatch.app'], components: [{ '/': '/a/*', comment: 'Shared alerts' }] }] },
  });
  const item = sharedAlert(code)!;
  assert.equal(item.title, 'Successful Hate Watch! Braves lost to the Dodgers');
  assert.equal(item.target.key, 'team:mlb:15');
  assert.equal(item.shareUrl, `${ORIGIN}/a/${code}`);
  assert.equal(sharedAlert('nope'), null);
});

test('alerts from before share links get codes when the server starts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hw-share-'));
  const file = join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, type TEXT NOT NULL, league TEXT NOT NULL, game_id TEXT, target_key TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, occurred_at INTEGER NOT NULL, detected_at INTEGER NOT NULL, meta TEXT)`);
  old.prepare("INSERT INTO events VALUES ('old:1', 'team.lost', 'mlb', NULL, 'team:mlb:15', 't', 'b', 0, 0, NULL)").run();
  old.close();
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', "await import('./src/db.ts')"], { env: { ...process.env, HW_DB: file } });
  const migrated = new DatabaseSync(file);
  assert.equal((migrated.prepare("SELECT share_code FROM events WHERE id = 'old:1'").get() as any).share_code, shareCode('old:1'));
  migrated.close();
  rmSync(dir, { recursive: true, force: true });
});
