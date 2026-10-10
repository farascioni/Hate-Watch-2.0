// A UFC card's preview (ufc-preview.ts), in ESPN's fight center's shapes, trimmed from real cards: one before it
// starts (Allen vs. Duncan, October 10 2026: odds, tape, a fight without odds, a fighter without every stat) and one
// that's over (UFC 332: a title fight to a decision, finishes); the calendar picking the next card through fight
// night; and the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db, kvSet } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { urls } = await import('../src/leagues.ts');
const U = await import('../src/ufc-preview.ts');
const { startApi } = await import('../src/api.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:ufc:ufc', 'ufc', 'ufc', 'Ultimate Fighting Championship', 'UFC', 'UFC', 'badge://ufc', 512, 512, 0)`).run();
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:ufc:4025699', 'ufc', '4025699', 'Brendan Allen', 'team:ufc:ufc', 'badge://ufc', 512, 512, 'team_logo', 0)`).run();
loadCatalog();
kvSet('ufc:belts', { Middleweight: { champion: '4848674' }, Lightweight: { interim: '9' } });

const stats = (o: Record<string, number>) => Object.entries(o).map(([name, value]) => ({ name, value, displayValue: value.toFixed(2) }));
const bets = (ml: string, ko?: string, sub?: string, points?: string) => ({ provider: { name: 'DraftKings' }, odds: [
  { type: 'moneyline', values: [{ odds: ml }] }, ...(ko ? [{ type: 'knockout', values: [{ odds: ko }] }] : []),
  ...(sub ? [{ type: 'submission', values: [{ odds: sub }] }] : []), ...(points ? [{ type: 'points', values: [{ odds: points }] }] : []),
] });
const fighter = (id: string, name: string, order: number, x: Record<string, unknown> = {}) => ({ id, order, winner: false, athlete: { id, displayName: name, lastName: name.split(' ').at(-1) }, ...x });
const status = (state = 'pre', extra: Record<string, unknown> = {}) => ({ period: 0, displayClock: '-', type: { state, name: state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED', completed: state === 'post' }, result: {}, ...extra });
const PARAMOUNT = [{ media: { shortName: 'Paramount+' } }];

// Before the night: prelims first in ESPN's object (the main card goes first anyway), fights out of order.
const TONIGHT = {
  event: { id: '600061541', name: 'UFC Fight Night: Allen vs. Duncan', date: '2026-10-10T21:00:00.000+00:00' },
  venue: { fullName: 'Meta APEX', address: { city: 'Las Vegas', state: 'NV', country: 'USA' } },
  cards: {
    prelims1: { displayName: 'Prelims', broadcasts: PARAMOUNT, competitions: [
      { id: 'P2', matchNumber: 7, date: '2026-10-10T21:00Z', type: { abbreviation: 'W Flyweight' }, note: "Women's Flyweight", status: status(),
        competitors: [fighter('3', 'Melissa Gatto', 2), fighter('4', 'Ernesta Kareckaite', 1)] }, // no odds at all
      { id: 'P3', matchNumber: 8, date: '2026-10-10T21:00Z', type: { abbreviation: 'Flyweight' }, note: 'Flyweight', status: status(), competitors: [fighter('10', 'One Side', 1)] }, // an opponent not named yet: not shown
      { id: 'P1', matchNumber: 6, date: '2026-10-10T21:00Z', type: { abbreviation: 'Heavyweight' }, note: 'Heavyweight', status: status(),
        competitors: [fighter('5', 'Allen Frye Jr.', 1, { stats: stats({ strikeLPM: 2.2, takedownAvg: 0 }), bets: bets('+280') }), fighter('6', 'RJ Harris', 2, { stats: stats({ strikeLPM: 9, takedownAvg: 0, takedownAccuracy: 50 }), bets: bets('-360') })] },
    ] },
    main: { displayName: 'Main Card', broadcasts: PARAMOUNT, competitions: [
      { id: 'M2', matchNumber: 2, date: '2026-10-11T00:00Z', type: { abbreviation: 'Lightweight' }, note: 'Lightweight', status: status(),
        competitors: [fighter('7', 'Matheus Camilo', 1, { bets: bets('-192') }), fighter('8', 'Jai Herbert', 2, { bets: bets('+160') })] },
      { id: 'M1', matchNumber: 1, date: '2026-10-11T00:00Z', type: { abbreviation: 'Middleweight' }, note: 'Middleweight - Main Event', status: status(),
        competitors: [
          fighter('4848674', 'Christian Leroy Duncan', 2, { displayRecord: '15-2-0', athlete: { id: '4848674', displayName: 'Christian Leroy Duncan', lastName: 'Duncan', age: 31, displayHeight: `6' 2"`, displayReach: '79"', stance: { text: 'Switch' } },
            stats: stats({ strikeLPM: 4.45, strikeAccuracy: 63.95, takedownAvg: 0.43, takedownAccuracy: 20, submissionAvg: 0 }), bets: bets('+102', '+200', '+2200', '+450') }),
          fighter('4025699', 'Brendan Allen', 1, { displayRecord: '27-7-0', athlete: { id: '4025699', displayName: 'Brendan Allen', lastName: 'Allen', age: 30, displayHeight: `6' 2"`, displayReach: '75"', stance: { text: 'Orthodox' } },
            stats: stats({ strikeLPM: 3.75, strikeAccuracy: 58.87, takedownAvg: 1.52, takedownAccuracy: 41.07, submissionAvg: 1.06 }), bets: bets('-122', '+800', '+300', '+250') }),
        ] },
    ] },
  },
};
// ESPN's dated scoreboard: the rounds (not in the fight center). P2 isn't on it: three, as any non-main fight.
const TONIGHT_BOARD = { events: [{ id: '600061541', competitions: [{ id: 'M1', format: { regulation: { periods: 5 } } }, { id: 'M2', format: { regulation: { periods: 3 } } }, { id: 'P1', format: { regulation: { periods: 3 } } }] }] };

// Over: a title fight to the judges, a knockout, a submission for an interim belt, a fight called off.
const UFC332 = {
  event: { id: '600061182', name: 'UFC 332: Silva vs. Wang', date: '2026-10-03T23:00:00.000+00:00' },
  venue: { fullName: 'T-Mobile Arena', address: { city: 'Las Vegas', state: 'NV' } },
  cards: { main: { displayName: 'Main Card', competitions: [
    { id: 'T1', matchNumber: 1, date: '2026-10-04T02:00Z', type: { abbreviation: 'W Flyweight' }, note: "Women's Flyweight - Main Event - Title Fight", types: [{ text: "UFC Women's Flyweight Title" }],
      status: status('post', { period: 5, displayClock: '5:00', result: { name: 'decision---unanimous', displayName: 'Decision - Unanimous' } }),
      competitors: [fighter('20', 'Wang Cong', 2), fighter('21', 'Natalia Silva', 1, { winner: true })] },
    { id: 'T2', matchNumber: 2, date: '2026-10-04T02:00Z', type: { abbreviation: 'Bantamweight' }, note: 'Bantamweight - Co-Main Event',
      status: status('post', { period: 1, displayClock: '2:09', result: { name: 'kotko', displayName: 'KO/TKO', description: 'Punches', target: { description: 'Head' } } }),
      competitors: [fighter('22', 'Payton Talbott', 2, { winner: true }), fighter('23', 'Deiveson Figueiredo', 1)] },
    { id: 'T3', matchNumber: 3, date: '2026-10-04T02:00Z', type: { abbreviation: 'Lightweight' }, note: 'Lightweight - Title Fight', types: [{ text: 'UFC Interim Lightweight Title' }],
      status: status('post', { period: 2, displayClock: '1:30', result: { name: 'submission', displayName: 'Submission', description: 'Rear Naked Choke' } }),
      competitors: [fighter('9', 'Interim Champ', 1, { winner: true }), fighter('24', 'Challenger', 2)] },
    { id: 'T4', matchNumber: 4, date: '2026-10-04T02:00Z', type: { abbreviation: 'Welterweight' }, note: 'Welterweight', status: { ...status(), type: { state: 'post', name: 'STATUS_CANCELED' } },
      competitors: [fighter('25', 'A One', 1), fighter('26', 'B Two', 2)] },
  ] } },
};

test("before the night: the segments main card first, each its fights top of the bill first, when and where they're on", () => {
  const card = U.cardOf(TONIGHT, TONIGHT_BOARD)!;
  assert.deepEqual(card.event, { id: '600061541', name: 'UFC Fight Night: Allen vs. Duncan', startsAt: Date.parse('2026-10-10T21:00Z'), venue: 'Meta APEX', place: 'Las Vegas, NV' });
  assert.deepEqual(card.segments.map((s) => [s.id, s.name, new Date(s.startsAt).toISOString(), s.broadcast, s.bouts.map((b) => b.id).join(' ')]),
    [['main', 'Main card', '2026-10-11T00:00:00.000Z', 'Paramount+', 'M1 M2'], ['prelims1', 'Prelims', '2026-10-10T21:00:00.000Z', 'Paramount+', 'P1 P2']]);
});

test("the main event: five rounds, ESPN's order, odds each way, the chances margin out (adding to 100), the belt holder, who has a page", () => {
  const b = U.cardOf(TONIGHT, TONIGHT_BOARD)!.segments[0].bouts[0];
  assert.deepEqual([b.weight, b.rounds, b.title, b.billing, b.state, b.canceled, b.oddsBy], ['Middleweight', 5, null, 'Main event', 'pre', false, 'DraftKings']);
  const [allen, duncan] = b.corners;
  assert.deepEqual(allen, { key: 'player:ufc:4025699', name: 'Brendan Allen', last: 'Allen', linked: true, record: '27-7-0', winner: null,
    odds: { win: '-122', ko: '+800', sub: '+300', decision: '+250' }, chance: 53 });
  assert.deepEqual([duncan.name, duncan.linked, duncan.belt, duncan.chance, duncan.odds?.ko, duncan.winner], ['Christian Leroy Duncan', false, 'champion', 47, '+200', null], "before the fight, ESPN's winner: false isn't a loss");
});

test('the tale of the tape: each side, the side ahead on a more-is-better number, a row only where either has a value', () => {
  const card = U.cardOf(TONIGHT, TONIGHT_BOARD)!;
  assert.deepEqual(card.segments[0].bouts[0].tape, [
    { label: 'Age', values: ['30', '31'] },
    { label: 'Height', values: [`6' 2"`, `6' 2"`] },
    { label: 'Reach', values: ['75"', '79"'], edge: 1 },
    { label: 'Stance', values: ['Orthodox', 'Switch'] },
    { label: 'Sig. strikes / min', values: ['3.75', '4.45'], edge: 1 },
    { label: 'Strike accuracy', values: ['59%', '64%'], edge: 1 },
    { label: 'Takedowns / 15 min', values: ['1.52', '0.43'], edge: 0 },
    { label: 'Takedown accuracy', values: ['41%', '20%'], edge: 0 },
    { label: 'Sub attempts / 15 min', values: ['1.06', '0.00'], edge: 0 },
  ]);
  const [frye, noOdds] = card.segments[1].bouts;
  assert.deepEqual(frye.tape, [
    { label: 'Sig. strikes / min', values: ['2.20', '9.00'], edge: 1 },
    { label: 'Takedowns / 15 min', values: ['0.00', '0.00'] },
    { label: 'Takedown accuracy', values: [null, '50%'] },
  ], "a stat one side lacks is null, with no edge; equal numbers, no edge");
  assert.deepEqual([noOdds.rounds, noOdds.oddsBy, noOdds.corners.map((c) => [c.name, c.odds, c.chance]), noOdds.tape], [3, null, [['Ernesta Kareckaite', undefined, undefined], ['Melissa Gatto', undefined, undefined]], []],
    'a fight without odds or stats: none, not zeros; off the scoreboard: three rounds');
});

test("over: how each fight ended, who won, its belt; the rounds without the scoreboard: five for a title fight or main event", () => {
  const [title, ko, sub, off] = U.cardOf(UFC332, null)!.segments[0].bouts;
  assert.deepEqual([title.title, title.rounds, title.billing, title.result, title.corners.map((c) => `${c.name} ${c.winner}`)],
    ["Women's Flyweight title", 5, 'Main event', { line: 'Unanimous decision' }, ['Natalia Silva true', 'Wang Cong false']]);
  assert.deepEqual([ko.billing, ko.rounds, ko.result], ['Co-main event', 3, { line: 'KO/TKO R1 2:09', detail: 'Punches to the head' }]);
  assert.deepEqual([sub.title, sub.rounds, sub.result, sub.corners[0].belt], ['Interim Lightweight title', 5, { line: 'Submission R2 1:30', detail: 'Rear Naked Choke' }, 'interim']);
  assert.deepEqual([off.canceled, off.result, off.corners.map((c) => c.winner)], [true, undefined, [null, null]]);
});

test('how a fight ended, each way ESPN says it', () => {
  const r = (result: Record<string, unknown>, period = 3, displayClock = '5:00') => U.resultLine({ period, displayClock, result });
  assert.deepEqual(r({ name: 'decision---split', displayName: 'Decision - Split' }), { line: 'Split decision' });
  assert.deepEqual(r({ name: 'decision---majority', displayName: 'Decision - Majority' }), { line: 'Majority decision' });
  assert.deepEqual(r({ name: 'kotko', displayName: 'KO/TKO', description: 'Kick', target: { description: 'Body' } }, 1, '3:11'), { line: 'KO/TKO R1 3:11', detail: 'Kick to the body' });
  assert.deepEqual(r({ name: 'draw', displayName: 'Draw' }), { line: 'Draw' });
  assert.deepEqual(r({ name: 'dq', displayName: 'DQ' }, 2, '0:45'), { line: 'DQ R2 0:45' });
  assert.equal(U.resultLine({ result: {} }), undefined);
});

// ─── The calendar and the routes ──────────────────────────────────────────────────────────────
const cal = (id: string, label: string, start: string, end: string) => ({ label, startDate: start, endDate: end, event: { $ref: `http://sports.core.api.espn.pvt/v2/sports/mma/leagues/ufc/events/${id}?lang=en` } });
const CALENDAR = { leagues: [{ calendar: [
  cal('600061182', 'UFC 332: Silva vs. Wang', '2026-10-03T23:00Z', '2026-10-04T06:59Z'),
  cal('600060740', "Dana White's Contender Series: Season 10, Week 9", '2026-10-07T02:00Z', '2026-10-07T06:59Z'),
  cal('600061541', 'UFC Fight Night: Allen vs. Duncan', '2026-10-11T00:00Z', '2026-10-11T06:59Z'), // the main card's start, not the prelims'
  cal('600060741', "Dana White's Contender Series: Season 10, Week 10", '2026-10-14T02:00Z', '2026-10-14T06:59Z'),
  cal('600060773', 'UFC Fight Night: Buckley vs. Malott', '2026-10-18T00:00Z', '2026-10-18T06:59Z'),
  cal('600060774', 'UFC 333', '2026-10-25T00:00Z', '2026-10-25T06:59Z'),
] }] };
const NEXT_WEEK = { ...TONIGHT, event: { id: '600060773', name: 'UFC Fight Night: Buckley vs. Malott', date: '2026-10-17T21:00:00.000+00:00' } };
const UFC333 = { ...TONIGHT, event: { id: '600060774', name: 'UFC 333', date: '2026-10-24T21:00:00.000+00:00' } };
let reads: string[] = [], phase: 'pre' | 'live' | 'between' = 'pre';
U.ufcPreviewDeps.getJson = async (url: string) => {
  reads.push(url);
  if (url === urls.scoreboard('ufc')) return CALENDAR;
  if (url === urls.scoreboard('ufc', '20261010')) return TONIGHT_BOARD;
  if (url.includes('/scoreboard')) return { events: [] };
  if (url === urls.ufcFightCenter('600061541')) {
    if (phase === 'pre') return TONIGHT;
    // Live: the main event in its second round. Between fights: it's over, the next not started.
    const main = TONIGHT.cards.main.competitions;
    const m1 = phase === 'live' ? status('in', { period: 2 }) : status('post', { period: 3, displayClock: '5:00', result: { name: 'decision---split', displayName: 'Decision - Split' } });
    return { ...TONIGHT, cards: { ...TONIGHT.cards, main: { ...TONIGHT.cards.main, competitions: main.map((c) => (c.id === 'M1' ? { ...c, status: m1 } : c)) } } };
  }
  if (url === urls.ufcFightCenter('600060773')) return NEXT_WEEK;
  if (url === urls.ufcFightCenter('600060774')) return UFC333;
  if (url === urls.ufcFightCenter('nope')) throw new Error(`HTTP 400 ${url}`);
  if (url.includes('/fightcenter/')) return { code: 404, message: 'events/{id}: 404' }; // ESPN's "not found", in a 200
  throw new Error(`unexpected ${url}`);
};

test("the next card is tonight's until the night is over (the main card under way too), the Contender Series aside; then next week's and the one after", async () => {
  const names = async (at: string) => { U.forgetUfcPreview(); U.ufcPreviewDeps.now = () => Date.parse(at); return (await U.ufcCards()).map((c) => c.event.name); };
  assert.deepEqual(await names('2026-10-10T12:00Z'), ['UFC Fight Night: Allen vs. Duncan', 'UFC Fight Night: Buckley vs. Malott']);
  assert.deepEqual(await names('2026-10-11T02:00Z'), ['UFC Fight Night: Allen vs. Duncan', 'UFC Fight Night: Buckley vs. Malott'], 'past its calendar start, the main card on');
  assert.deepEqual(await names('2026-10-11T08:00Z'), ['UFC Fight Night: Buckley vs. Malott', 'UFC 333']);
});

test('served at /ufc/cards and /ufc/cards/:id (404 for a card ESPN lacks); a card read once per 5 minutes, every 20 seconds once the night is under way, between fights too', async () => {
  U.forgetUfcPreview();
  let now = Date.parse('2026-10-11T00:30Z');
  U.ufcPreviewDeps.now = () => now;
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    reads = [];
    const list = await (await fetch(`${base}/ufc/cards`)).json();
    const one = await (await fetch(`${base}/ufc/cards/600061541`)).json();
    assert.deepEqual([list.cards.length, list.cards[0].event.name, one.segments[0].bouts[0].corners[0].name], [2, 'UFC Fight Night: Allen vs. Duncan', 'Brendan Allen']);
    assert.equal(reads.filter((u) => u === urls.ufcFightCenter('600061541')).length, 1, 'the second read from the cache');
    assert.equal((await fetch(`${base}/ufc/cards/123`)).status, 404);
    assert.equal((await fetch(`${base}/ufc/cards/nope`)).status, 404);

    phase = 'live';
    now += 5 * 60_000;
    const during = await (await fetch(`${base}/ufc/cards/600061541`)).json();
    assert.deepEqual([during.segments[0].bouts[0].state, during.segments[0].bouts[0].round], ['in', 2]);
    now += 25_000;
    reads = [];
    await fetch(`${base}/ufc/cards/600061541`);
    assert.equal(reads.filter((u) => u === urls.ufcFightCenter('600061541')).length, 1, 'live: read again after 20 seconds');

    phase = 'between';
    now += 25_000;
    const between = await (await fetch(`${base}/ufc/cards/600061541`)).json();
    assert.deepEqual(between.segments[0].bouts.map((b: any) => b.state), ['post', 'pre']);
    now += 25_000;
    reads = [];
    await fetch(`${base}/ufc/cards/600061541`);
    assert.equal(reads.filter((u) => u === urls.ufcFightCenter('600061541')).length, 1, 'between fights, nothing live: still every 20 seconds');
  } finally { server.close(); phase = 'pre'; }
});

test('under way: from 5 minutes before the start until every fight is over or off', () => {
  const card = U.cardOf(TONIGHT, TONIGHT_BOARD)!, start = Date.parse('2026-10-10T21:00Z');
  assert.deepEqual([U.underway(card, start - 6 * 60_000), U.underway(card, start - 4 * 60_000), U.underway(card, start + 3600_000)], [false, true, true]);
  const over = { ...card, segments: card.segments.map((s) => ({ ...s, bouts: s.bouts.map((b, i) => ({ ...b, state: 'post' as const, canceled: i === 1 })) })) };
  assert.equal(U.underway(over, start + 3600_000), false);
});
