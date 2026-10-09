// The game screen's Highlights (highlights.ts): ESPN's clips, newest first and only while ESPN still has
// them up, and the key plays from the play-by-play, newest first, in ESPN's shapes (2025-26 games).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { clipsOf, highlights, forDevice } = await import('../src/highlights.ts');
/** A device's key plays, `alerts` the plays that sent it alerts (here, the only alerts in the game). */
const keyPlays = (g: any, s: any, w: any, alerts: string[] = []) => forDevice(highlights(g, s, w, new Set(alerts)), new Set(alerts));

const side = (abbrev: string, espnId: string) => ({ team: { abbrev, espnId } });
const game = (league: string) => ({ league, away: side('CLE', '5'), home: side('CHW', '4') }) as any;
const when = (_lg: string, p: any) => String(p.when ?? '');
const play = (id: string, text: string, away: number, home: number, x: object = {}) => ({ id, text, awayScore: away, homeScore: home, when: id, type: { text: 'Play' }, ...x });

test('clips: newest first, HLS and MP4, and none once ESPN takes them down', () => {
  const clip = (id: string, at: string, expires: string) => ({
    id, headline: `Clip ${id}`, duration: 21, thumbnail: `https://img/${id}.jpg`, originalPublishDate: at, timeRestrictions: { expirationDate: expires },
    links: { source: { href: `https://cdn/${id}.mp4`, HLS: { href: `https://hls/${id}/playlist.m3u8` } } },
  });
  const now = Date.parse('2026-10-09T20:00:00Z');
  const clips = clipsOf({ videos: [clip('1', '2026-10-09T01:42:57Z', '2026-10-11T01:42:00Z'), clip('2', '2026-10-09T03:42:37Z', '2026-10-11T03:42:00Z'), clip('3', '2026-10-06T01:00:00Z', '2026-10-08T01:00:00Z')] }, now);
  assert.deepEqual(clips.map((c) => [c.id, c.title, c.seconds, c.hls, c.mp4]), [
    ['2', 'Clip 2', 21, 'https://hls/2/playlist.m3u8', 'https://cdn/2.mp4'],
    ['1', 'Clip 1', 21, 'https://hls/1/playlist.m3u8', 'https://cdn/1.mp4'],
  ], 'clip 3 expired');
  assert.deepEqual(clipsOf({}), []);
});

test('MLB: the runs (once, though ESPN posts a wild pitch twice) and ejections, newest first, with the score', () => {
  const s = { plays: [
    play('a', 'Murakami walked, C. Montgomery scored.', 0, 1, { scoringPlay: true }),
    play('b', 'Meidroth grounded out to second.', 0, 1),
    play('c', 'Kwan scored on Smith wild pitch.', 1, 1, { scoringPlay: true, type: { text: 'Wild Pitch' } }),
    play('d', 'Kwan scored on Smith wild pitch.', 1, 1, { scoringPlay: true }),
    play('e', 'Manager Will Venable ejected by HP umpire.', 1, 1),
  ] };
  assert.deepEqual(keyPlays(game('mlb'), s, when).map((k) => [k.id, k.score, k.tag]), [['e', 'CLE 1, CHW 1', 'Ejection'], ['c', 'CLE 1, CHW 1', undefined], ['a', 'CLE 0, CHW 1', undefined]]);
});

test("the plays that sent you alerts: tagged when they're key plays, added in order when they aren't, once for ESPN's duplicates", () => {
  const s = { plays: [
    play('a', 'Murakami walked, C. Montgomery scored.', 0, 1, { scoringPlay: true }),
    play('k', 'Judge struck out swinging.', 0, 1),
    play('c', 'Kwan scored on Smith wild pitch.', 1, 1, { scoringPlay: true, type: { text: 'Wild Pitch' } }),
    play('d', 'Kwan scored on Smith wild pitch.', 1, 1, { scoringPlay: true }),
  ] };
  assert.deepEqual(keyPlays(game('mlb'), s, when, ['k', 'd']).map((k) => [k.id, k.alerted ?? false]), [['c', true], ['k', true], ['a', false]],
    "Judge's strikeout joins them; the alert on ESPN's second copy of the wild pitch marks the one line");
  const everyone = highlights(game('mlb'), s, when, new Set(['k']));
  assert.deepEqual(forDevice(everyone, new Set()).map((k) => k.id), ['c', 'a'], "someone else's alert isn't in your key plays");
});

test('basketball: lead changes (not every basket, not a tie), flagrants, quarter ends but not the game end', () => {
  const s = { plays: [
    play('1', 'Home layup', 0, 2, { scoringPlay: true }),
    play('2', 'Away three', 3, 2, { scoringPlay: true }),
    play('3', 'Away layup', 5, 2, { scoringPlay: true }),
    play('4', 'Home three', 5, 5, { scoringPlay: true }),
    play('5', 'Home free throw', 5, 6, { scoringPlay: true }),
    play('6', 'Gobert flagrant foul type 1', 5, 6, { type: { text: 'Flagrant Foul Type 1' } }),
    play('7', 'End of the 1st Quarter', 5, 6, { type: { text: 'End Period' } }),
    play('8', 'End of Game', 5, 6, { type: { text: 'End Game' } }),
  ] };
  assert.deepEqual(keyPlays(game('nba'), s, when).map((k) => [k.id, k.tag]), [['7', undefined], ['6', 'Flagrant'], ['5', 'Lead change'], ['2', 'Lead change']]);
});

test('NHL: goals, fights and majors, period ends; shootout attempts without the shootout tally as a score', () => {
  const s = { plays: [
    play('g1', 'Tavares Goal (15) Wrist Shot', 0, 1, { scoringPlay: true, type: { text: 'Goal' } }),
    play('p1', 'Zetterlund Interference against Matthews', 0, 1, { type: { text: 'Penalty', penaltyMinutes: 2 } }),
    play('p2', 'Olivier Fighting against Xhekaj', 0, 1, { type: { text: 'Penalty', penaltyMinutes: 5 } }),
    play('e3', 'End of 3rd Period', 1, 1, { type: { text: 'Period End' } }),
    play('so', 'Start of Shootout', 0, 2, { type: { text: 'Period Start' } }),
    play('s1', 'Batherson Goal Snap Shot', 0, 2, { scoringPlay: true, type: { text: 'Goal' } }),
    play('s2', 'Frost Wrist Shot saved by Ullmark', 0, 2, { type: { text: 'Shot' } }),
  ] };
  assert.deepEqual(keyPlays(game('nhl'), s, when).map((k) => [k.id, k.tag, k.score]), [
    ['s2', 'Shootout', undefined], ['s1', 'Shootout', undefined], ['e3', undefined, 'CLE 1, CHW 1'], ['p2', 'Fight', 'CLE 0, CHW 1'], ['g1', undefined, 'CLE 0, CHW 1'],
  ]);
});

test('NFL: scores and turnovers from the drives; soccer: goals and cards (not subs), the score counted from the goals', () => {
  const nfl = { drives: { previous: [{ plays: [
    play('td', 'Samuel 19 yd run, TOUCHDOWN', 0, 7, { scoringPlay: true, type: { text: 'Rushing Touchdown' } }),
    play('run', 'Wilson up the middle for 3', 0, 7, { type: { text: 'Rush' } }),
    play('int', 'Wilson pass INTERCEPTED by Whyte', 0, 7, { type: { text: 'Pass Interception Return' } }),
  ] }], current: { plays: [play('fg', 'Gano 55 yd field goal is No Good', 0, 7, { type: { text: 'Field Goal Missed' } })] } } };
  assert.deepEqual(keyPlays(game('nfl'), nfl, when).map((k) => [k.id, k.tag]), [['fg', 'Missed kick'], ['int', 'Interception'], ['td', undefined]]);
  const epl = { keyEvents: [
    { id: 'k', type: { type: 'kickoff', text: 'Kickoff' }, text: 'First Half begins.' },
    { id: 'g', type: { type: 'goal', text: 'Goal' }, scoringPlay: true, team: { id: '4' }, text: 'Goal! Chicago 1, Cleveland 0.', when: "37'" },
    { id: 's', type: { type: 'substitution', text: 'Substitution' }, text: 'Substitution, Cleveland.' },
    { id: 'y', type: { type: 'yellow-card', text: 'Yellow Card' }, text: 'Evanilson is shown the yellow card.', when: "81'" },
    { id: 'v', type: { type: 'goal---volley', text: 'Goal - Volley' }, scoringPlay: true, team: { id: '5' }, text: 'Goal! Chicago 1, Cleveland 1.', when: "88'" },
  ] };
  assert.deepEqual(keyPlays(game('epl'), epl, when).map((k) => [k.id, k.score ?? null]), [['v', 'CLE 1, CHW 1'], ['y', null], ['g', 'CLE 0, CHW 1']]);
});
