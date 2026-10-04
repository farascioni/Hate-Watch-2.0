// Runs the real detector over recent finished MLB games until it finds a couple of NOBLETIGERs,
// and prints each half-inning that had the bases loaded with nobody out (so near-misses are visible too).
// Usage: node test/find-nobletiger.ts [maxGames=40] [YYYYMMDD start day, counts backwards]
import { loadCatalog } from '../src/catalog.ts';
import { getJson } from '../src/espn.ts';
import { urls } from '../src/leagues.ts';
import { PLAYER_DETECTORS, fromSitePlay, mlbFinalHalfInning, observePlay, type GameCtx } from '../src/detectors.ts';

loadCatalog();
const maxGames = Number(process.argv[2] ?? 40);
let day = new Date(`${(process.argv[3] ?? '20260928').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}T12:00:00Z`);
let games = 0, found = 0;
while (games < maxGames && found < 2) {
  const ymd = day.toISOString().slice(0, 10).replace(/-/g, '');
  const sb = await getJson(urls.scoreboard('mlb', ymd));
  for (const ev of sb.events ?? []) {
    if (games >= maxGames || found >= 2 || !ev.status?.type?.completed) continue;
    const s = await getJson(urls.summary('mlb', ev.id));
    games++;
    const comp = s.header.competitions[0];
    const g: GameCtx = { league: 'mlb', gameId: ev.id, goalies: new Map(), homeId: comp.competitors.find((c: any) => c.homeAway === 'home').id, awayId: comp.competitors.find((c: any) => c.homeAway === 'away').id };
    const loadedHalves = new Set<string>();
    const events = [];
    for (const raw of s.plays ?? []) {
      const p = fromSitePlay(raw);
      events.push(...PLAYER_DETECTORS.mlb(g, p));
      observePlay(g, p);
      if (g.half?.loadedNoOuts && !loadedHalves.has(g.half.key)) {
        loadedHalves.add(g.half.key);
        console.log(`  [${ev.shortName} ${g.half.key}] bases loaded, 0 outs after: "${p.text}"`);
      }
    }
    events.push(...mlbFinalHalfInning(g));
    for (const e of events.filter((e) => e.type === 'mlb.team.nobletiger')) {
      found++;
      const twin = events.find((x) => x.type === 'mlb.team.stranded_risp' && x.targetKey === e.targetKey && x.at === e.at);
      console.log(`🐯 ${ev.shortName}: ${e.title} | ${e.body}\n   stranded alert for that inning: ${twin ? `"${twin.title}" (sent only to users with NOBLETIGER off: unless=${twin.unless})` : 'none'}`);
    }
  }
  day = new Date(day.getTime() - 86400_000);
}
console.log(`\nscanned ${games} games, found ${found} NOBLETIGER(s)`);
