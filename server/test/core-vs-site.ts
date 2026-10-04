// Do core-API plays yield the same detections, in the same order, as site-API plays?
// (The live tracker merges both: core publishes plays sooner.)
import { loadCatalog } from '../src/catalog.ts';
import { getJson } from '../src/espn.ts';
import { urls, type League } from '../src/leagues.ts';
import { PLAYER_DETECTORS, fromCorePlay, fromSitePlay, mergePlays, observePlay, type GameCtx, type NPlay } from '../src/detectors.ts';

loadCatalog();
for (const g of ['mlb:401907973', 'nhl:401891781', 'nba:401811026']) {
  const [league, gameId] = g.split(':') as [League, string];
  const s = await getJson(urls.summary(league, gameId));
  const comp = s.header.competitions[0];
  const mkCtx = (): GameCtx => ({ league, gameId, goalies: new Map(), homeId: comp.competitors.find((c: any) => c.homeAway === 'home').id, awayId: comp.competitors.find((c: any) => c.homeAway === 'away').id });
  const run = (plays: NPlay[]) => {
    const ctx = mkCtx();
    return plays.flatMap((p) => { const e = PLAYER_DETECTORS[league](ctx, p); observePlay(ctx, p); return e; }).map((e) => `${e.type}|${e.targetKey}|${e.id.split(':')[1]}`);
  };
  const sitePlays: NPlay[] = s.plays.map(fromSitePlay);
  const corePlays: NPlay[] = (await getJson(urls.corePlays(league, gameId))).items.map(fromCorePlay);
  const merged = mergePlays(corePlays, sitePlays); // exactly what the live tracker does
  const sameOrder = merged.map((p) => p.id).join() === sitePlays.map((p) => p.id).join();
  const site = run(sitePlays), core = run(corePlays), live = run(merged);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const ok = sameOrder && same(site, core) && same(site, live);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${league}: ${site.length} events | core identical: ${same(site, core)} | merged order == site order: ${sameOrder} | merged identical: ${same(site, live)}`);
  if (!ok) process.exitCode = 1;
}
