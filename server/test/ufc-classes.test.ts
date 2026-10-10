// The UFC's weight classes (ufc-classes.ts): who's in which, and who heads each (its champion, an interim
// champion, then whoever has headlined and won the most lately), from cards in ESPN's scoreboard shape; and
// /ufc/weight-classes, Search's "Weight classes" for the UFC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db, kvSet } = await import('../src/db.ts');
const { loadCatalog, UFC_TEAM } = await import('../src/catalog.ts');
const { startApi } = await import('../src/api.ts');
const { rankFighters, titleOf, fiveRoundFights, weightName } = await import('../src/ufc-classes.ts');

const NOW = Date.parse('2026-10-09T00:00Z');
let n = 0;
/** A fight, `a` and `b` by name (their id is their name); `winner` a name, null for a no contest, absent for one not fought yet. */
const bout = (weight: string, a: string, b: string, o: { winner?: string | null; rounds?: number; status?: string; title?: string } = {}) => ({
  id: `f${++n}`, title: o.title, type: { abbreviation: weight }, format: { regulation: { periods: o.rounds ?? (o.title ? 5 : 3) } },
  status: { type: { name: o.status ?? (o.winner === undefined ? 'STATUS_SCHEDULED' : 'STATUS_FINAL'), completed: o.winner !== undefined } },
  competitors: [a, b].map((id) => ({ id, athlete: { displayName: id }, ...(o.winner === undefined ? {} : { winner: o.winner === id }) })),
});
/** A card on `date`, its fights in ESPN's order: the main event last. */
const card = (date: string, ...fights: ReturnType<typeof bout>[]) => ({ id: `e${++n}`, name: `UFC ${n}`, date, competitions: fights.map((f) => ({ ...f, date })) });
const rank = (...cards: ReturnType<typeof card>[]) => {
  const titles = Object.fromEntries(cards.flatMap((c) => c.competitions).map((f) => [f.id, f.title ?? null]));
  return rankFighters([{ events: cards }], titles, NOW, (id) => id);
};
const keys = (r: ReturnType<typeof rank>, w: string) => r.classes.find((c) => c.name === w)?.keys;

test("a class's champion first and an interim champion second, whoever's busier; then who has headlined and won the most lately", () => {
  const r = rank(
    card('2025-10-01T22:00Z', bout('Lightweight', 'Champ', 'Old', { winner: 'Champ', title: 'UFC Lightweight Title' })),
    card('2026-02-01T22:00Z', bout('Lightweight', 'Interim', 'Contender', { winner: 'Interim', title: 'UFC Interim Lightweight Title' })),
    card('2026-09-01T22:00Z', bout('Lightweight', 'Busy', 'Opp', { winner: 'Busy' })),
    card('2026-09-15T22:00Z', bout('Lightweight', 'Busy', 'Opp 2', { winner: 'Busy' })),
  );
  assert.deepEqual(keys(r, 'Lightweight')?.slice(0, 3), ['Champ', 'Interim', 'Busy'], 'two main event wins this autumn outscore a year-old title win, but not the belts');
  assert.deepEqual(keys(r, 'Lightweight')?.slice(3), ['Contender', 'Old'], 'five a class: not the main events they lost (Opp, Opp 2)');
  assert.deepEqual(r.belts, { Lightweight: { champion: 'Champ', interim: 'Interim' } }, 'who to say "lost the title" of (ufc.ts)');
});

test('a no contest for the belt crowns nobody, and ends the interim belt; a champion who moved up heads nothing they left', () => {
  const r = rank(
    card('2025-10-01T22:00Z', bout('Heavyweight', 'HW Champ', 'X', { winner: 'HW Champ', title: 'UFC Heavyweight Title' }), bout('Featherweight', 'Mover', 'F1', { winner: 'Mover', title: 'UFC Featherweight Title' })),
    card('2026-01-01T22:00Z', bout('Heavyweight', 'HW Interim', 'Y', { winner: 'HW Interim', title: 'UFC Interim Heavyweight Title' })),
    card('2026-08-01T22:00Z', bout('Featherweight', 'F2', 'F3', { winner: 'F2' }), bout('Lightweight', 'Mover', 'L1', { winner: 'L1' })),
    card('2026-09-01T22:00Z', bout('Heavyweight', 'HW Busy', 'W', { winner: 'HW Busy' })),
    card('2026-09-20T22:00Z', bout('Heavyweight', 'HW Busy', 'V', { winner: 'HW Busy' })),
    card('2026-10-01T22:00Z', bout('Heavyweight', 'HW Champ', 'Z', { winner: null, title: 'UFC Heavyweight Title' })),
  );
  assert.deepEqual(keys(r, 'Heavyweight')?.slice(0, 4), ['HW Champ', 'HW Busy', 'Z', 'HW Interim'], 'the champion keeps the belt; the interim one is just a fighter now');
  assert.equal(r.fighters.get('Mover')?.weight, 'Lightweight', 'the class of their latest fight');
  assert.deepEqual(keys(r, 'Featherweight'), ['F1', 'F2', 'F3'], "the belt's old class lists no champion");
  assert.equal(keys(r, 'Lightweight')?.[0], 'Mover', 'ranked where they fight now, on what they did');
});

test("a belt that changes hands outside a fight: a champion's claim ends at a title fight without them, fought or scheduled", () => {
  const r = rank(
    card('2024-11-16T22:00Z', bout('Heavyweight', 'Retired', 'Old', { winner: 'Retired', title: 'UFC Heavyweight Title' }), bout('Flyweight', 'Fly Champ', 'Fly Old', { winner: 'Fly Champ', title: 'UFC Flyweight Title' })),
    card('2025-10-25T22:00Z', bout('Heavyweight', 'Promoted', 'Gane', { winner: null, title: 'UFC Heavyweight Title' })),
    card('2026-06-15T22:00Z', bout('Heavyweight', 'Gane', 'Pereira', { winner: 'Gane', title: 'UFC Interim Heavyweight Title' })),
    card('2026-09-01T22:00Z', bout('Flyweight', 'Fly Busy', 'Fly Opp', { winner: 'Fly Busy' }), bout('Heavyweight', 'Busy', 'Opp', { winner: 'Busy' })),
    card('2026-11-14T22:00Z', bout('Heavyweight', 'Hokit', 'Gane', { title: 'UFC Heavyweight Title' }), bout('Flyweight', 'Fly A', 'Fly B', { title: 'UFC Flyweight Title' })),
  );
  assert.equal(keys(r, 'Heavyweight')?.[0], 'Gane', 'not the retired champion (a title fight without them since), and the interim belt holds until the title fight is fought');
  assert.notEqual(keys(r, 'Flyweight')?.[0], 'Fly Champ', 'a title fight on the schedule without them says the belt is vacant');
  assert.deepEqual(r.belts, { Heavyweight: { interim: 'Gane' } }, 'nobody holds either undisputed belt');
});

test("who's in which class: the women's named, not a catch weight or a fight called off; the classes heaviest first, men's then women's", () => {
  const r = rank(
    { id: 'dwcs', name: "Dana White's Contender Series: Week 7", date: '2026-09-01T00:00Z', competitions: [{ ...bout('Welterweight', 'Prospect', 'Prospect 2', { winner: 'Prospect' }), date: '2026-09-01T00:00Z' }] },
    card('2026-01-10T22:00Z', bout('Welterweight', 'Called Off', 'A', { winner: 'Called Off' }), ...Array.from({ length: 5 }, (_, i) => bout('Flyweight', `Fly ${i}`, `Fly ${i}b`, { winner: `Fly ${i}` }))),
    card('2026-03-01T22:00Z', bout('Welterweight', 'McGee', 'B', { winner: 'McGee' })),
    card('2026-06-01T22:00Z', bout('Catch Weight', 'McGee', 'Only Catch', { winner: 'Only Catch' })),
    card('2026-09-01T22:00Z', bout('Welterweight', 'Prelim', 'C', { winner: 'Prelim' }), ...Array.from({ length: 5 }, (_, i) => bout('W Strawweight', `Straw ${i}`, `Straw ${i}b`, { winner: `Straw ${i}` })),
      bout('Middleweight', 'Called Off', 'D', { status: 'STATUS_CANCELED' }), bout('W Flyweight', 'Silva', 'Wang', { winner: 'Silva' }), bout('Super Heavyweight', 'Big', 'Bigger', { winner: 'Big' })),
    card('2026-11-14T22:00Z', bout('Bantamweight', 'Debut', 'E')),
  );
  assert.equal(r.fighters.has('Prospect'), false, 'not the Contender Series');
  assert.equal(r.fighters.get('McGee')?.weight, 'Welterweight', 'a catch weight bout says nothing about their class');
  assert.equal(r.fighters.get('Only Catch')?.weight, null);
  assert.equal(r.fighters.get('Called Off')?.weight, 'Welterweight', 'a fight called off neither moves them…');
  assert.ok(keys(r, 'Welterweight')!.indexOf('Prelim') < keys(r, 'Welterweight')!.indexOf('Called Off'), '…nor scores: it would have outscored a prelim');
  assert.equal(r.fighters.get('Silva')?.weight, "Women's Flyweight");
  assert.equal(r.fighters.get('Debut')?.weight, 'Bantamweight', 'a fight on the schedule puts them in its class');
  assert.deepEqual(r.classes.map((c) => c.name), ['Welterweight', 'Bantamweight', 'Flyweight', "Women's Flyweight", "Women's Strawweight", 'Super Heavyweight'],
    "the UFC's order, and a class it doesn't list after them");
  assert.equal(keys(r, "Women's Strawweight")?.length, 5, 'ten in the class, five listed');
  assert.deepEqual([weightName('W Bantamweight'), weightName('Lightweight'), weightName(null)], ["Women's Bantamweight", 'Lightweight', null]);
  assert.deepEqual([titleOf("UFC Women's Flyweight Title"), titleOf('UFC Interim Heavyweight Title'), titleOf('Main Card'), titleOf(null)],
    [{ weight: "Women's Flyweight", interim: false }, { weight: 'Heavyweight', interim: true }, null, null]);
});

test("the fights read for their title: five-rounders only, each once, saying if it's over", () => {
  const done = bout('Lightweight', 'A', 'B', { winner: 'A', rounds: 5 }), next = bout('Lightweight', 'C', 'D', { rounds: 5 }), three = bout('Lightweight', 'E', 'F', { winner: 'E' });
  const ev = { id: 'E9', name: 'UFC 340', competitions: [three, done, next] };
  assert.deepEqual(fiveRoundFights([{ events: [ev] }, { events: [ev, { id: 'DW', name: 'Contender Series', competitions: [bout('Lightweight', 'G', 'H', { rounds: 5 })] }] }]),
    [{ eventId: 'E9', fightId: done.id, done: true }, { eventId: 'E9', fightId: next.id, done: false }]);
});

test("/ufc/weight-classes: each class's fighters as Search lists them, with their haters; ones gone from the catalog left out", async () => {
  db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, 'ufc', 'ufc', ?, 'UFC', 'UFC', '#D20A0A', 'badge://ufc', 512, 512, 0)`).run(UFC_TEAM.key, UFC_TEAM.name);
  const fighter = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'ufc', ?, ?, ?, ?, 'badge://ufc', 512, 512, 'team_logo', 0)`);
  fighter.run('player:ufc:1', '1', 'Ciryl Gane', 'Heavyweight', UFC_TEAM.key);
  fighter.run('player:ufc:2', '2', 'Alex Pereira', 'Heavyweight', UFC_TEAM.key);
  loadCatalog();
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('fan', 's', 'ios', null, '{}');
  db.prepare("INSERT INTO follows (device_id, target_key, created_at) VALUES ('fan', 'player:ufc:2', 0)").run();
  kvSet('ufc:weight-classes', [{ name: 'Heavyweight', keys: ['player:ufc:1', 'player:ufc:gone', 'player:ufc:2'] }, { name: 'Flyweight', keys: ['player:ufc:gone 2'] }]);
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const { classes } = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ufc/weight-classes`)).json();
    assert.deepEqual(classes.map((c: any) => [c.name, c.fighters.map((f: any) => [f.kind, f.name, f.position, f.haters])]),
      [['Heavyweight', [['player', 'Ciryl Gane', 'Heavyweight', 0], ['player', 'Alex Pereira', 'Heavyweight', 1]]]], 'a class with nobody left is left out');
  } finally { server.close(); }
});
