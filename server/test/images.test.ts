// The image switches (images.ts): with player photos or team logos switched off, they come out of what the
// server sends, responses and live frames, and what's left is what every app build already draws without
// them: "badge://" (a badge in the team's colour with its code) for a team or player, no logo elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, addSocket, publish } = await import('../src/fanout.ts');
const { startApi } = await import('../src/api.ts');
const { setFlag } = await import('../src/flags.ts');
const { withoutImages, frameWithoutImages } = await import('../src/images.ts');

const LOGO = 'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png', PHOTO = 'https://a.espncdn.com/i/headshots/mlb/players/full/33192.png';
db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_dark, logo_w, logo_h, updated_at) VALUES ('team:mlb:10', 'mlb', '10', 'New York Yankees', 'Yankees', 'NYY', '#132448', ?, ?, 500, 500, 0)`).run(LOGO, `${LOGO}?dark`);
db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:f1:106', 'f1', '106', 'Ferrari', 'Ferrari', 'FER', 'badge://f1', 512, 512, 0)`).run();
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, 'team:mlb:10', ?, 1, 1, ?, 0)`);
player.run('player:mlb:33192', '33192', 'Aaron Judge', PHOTO, 'headshot');
player.run('player:mlb:99', '99', 'No Photo', LOGO, 'team_logo');
loadCatalog();

const reset = () => { setFlag('images.headshots', true); setFlag('images.logos', true); setFlag('images', true); };
const team = { kind: 'team', key: 'team:mlb:10', abbrev: 'NYY', logo: LOGO, logoDark: `${LOGO}?dark`, logoW: 500, logoH: 500 };
const judge = { kind: 'player', key: 'player:mlb:33192', image: PHOTO, imageKind: 'headshot', teamLogo: LOGO };
const noPhoto = { kind: 'player', key: 'player:mlb:99', image: LOGO, imageKind: 'team_logo', teamLogo: LOGO };
const ferrari = { kind: 'team', key: 'team:f1:106', logo: 'badge://f1', logoDark: null };
const sample = { game: { home: { team }, away: { team: ferrari } }, alerts: [{ target: judge }, { target: noPhoto }], box: { teams: [{ key: 'team:mlb:10', logo: LOGO }] },
  recent: [{ opponent: 'Rays', opponentLogo: LOGO }], clips: [{ thumb: 'https://espnmedia/clip.jpg' }] };

test('all on (the usual): what goes out is untouched, not even copied', () => {
  reset();
  assert.equal(withoutImages(sample), sample);
});

test('photos off: players get the badge (team colour, code, jersey); logos stay', () => {
  reset();
  setFlag('images.headshots', false);
  const out = withoutImages(sample);
  assert.equal(out.alerts[0].target.image, 'badge://hidden');
  assert.equal(out.alerts[1].target.image, LOGO, "a player shown with their team's logo keeps it: that's the logo switch's");
  assert.equal(out.game.home.team.logo, LOGO);
  assert.equal(sample.alerts[0].target.image, PHOTO, 'a copy: what the server holds is untouched');
});

test('logos off: teams get the badge; a logo drawn on its own goes (box score, stats); F1 badges and clip pictures stay', () => {
  reset();
  setFlag('images.logos', false);
  const out = withoutImages(sample);
  assert.deepEqual([out.game.home.team.logo, out.game.home.team.logoDark], ['badge://hidden', null], 'the Avatar draws it as a badge');
  assert.equal(out.game.away.team.logo, 'badge://f1');
  assert.deepEqual([out.alerts[0].target.image, out.alerts[0].target.teamLogo], [PHOTO, null]);
  assert.equal(out.alerts[1].target.image, 'badge://hidden', 'a player shown with the team logo: the badge');
  assert.equal(out.box.teams[0].logo, null, 'the box score draws a team logo only when there is one');
  assert.equal('opponentLogo' in out.recent[0], false);
  assert.equal(out.clips[0].thumb, 'https://espnmedia/clip.jpg', "a clip's picture is the clip switches'");
  const when = new Date(0);
  assert.equal(withoutImages({ at: when }).at, when, 'only plain objects are copied');
  assert.equal(frameWithoutImages('not json'), 'not json', 'a frame that isn\'t JSON goes as it is');
  setFlag('images.logos', true);
  setFlag('images', false);
  const all = withoutImages(sample);
  assert.deepEqual([all.game.home.team.logo, all.alerts[0].target.image], ['badge://hidden', 'badge://hidden'], '"images" is both');
});

test('the switches reach the app: API responses, and live frames', async () => {
  reset();
  setFlag('images', false);
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const teams = (await (await fetch(`${base}/teams?league=mlb`)).json()).teams;
    assert.deepEqual(teams.map((t: any) => [t.abbrev, t.logo, t.logoDark]), [['NYY', 'badge://hidden', null]]);
    const judgePage = await (await fetch(`${base}/targets/${encodeURIComponent('player:mlb:33192')}`)).json();
    assert.equal(JSON.stringify(judgePage).includes('espncdn'), false, 'no photo or logo anywhere on his page');
  } finally { server.close(); }
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
  db.prepare("INSERT INTO follows (device_id, target_key, created_at) VALUES ('fan', 'player:mlb:33192', 0)").run();
  const frames: string[] = [];
  addSocket('fan', { on() {}, send: (f: string) => frames.push(f), close() {} } as any);
  publish([{ id: 'e1', type: 'mlb.batter.strikeout', targetKey: 'player:mlb:33192', title: 'Aaron Judge struck out swinging', body: 'Judge struck out swinging.', at: Date.now() }], 'mlb');
  const event = JSON.parse(frames.find((f) => f.includes('"event"'))!);
  assert.equal(event.item.target.image, 'badge://hidden');
  assert.equal(frames.join('').includes('espncdn'), false);
  reset();
});
