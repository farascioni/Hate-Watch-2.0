// Do core-API plays yield the same detections as site-API plays? (Core publishes plays sooner.)
import { loadCatalog } from '../src/catalog.ts';
import { getJson } from '../src/espn.ts';
import { urls, type League } from '../src/leagues.ts';
import { PLAYER_DETECTORS, fromCorePlay, fromSitePlay, type GameCtx, type NPlay } from '../src/detectors.ts';

loadCatalog();
for (const g of ['mlb:401907973', 'nhl:401891781', 'nba:401811026']) {
  const [league, gameId] = g.split(':') as [League, string];
  const s = await getJson(urls.summary(league, gameId));
  const comp = s.header.competitions[0];
  const mkCtx = (): GameCtx => ({ league, gameId, goalies: new Map(), homeId: comp.competitors.find((c: any) => c.homeAway === 'home').id, awayId: comp.competitors.find((c: any) => c.homeAway === 'away').id });
  const run = (plays: NPlay[]) => { const ctx = mkCtx(); return plays.flatMap((p) => PLAYER_DETECTORS[league](ctx, p)).map((e) => `${e.type}|${e.targetKey}|${e.id.split(':')[1]}`); };
  const site = run(s.plays.map(fromSitePlay));
  const coreRaw = (await getJson(urls.corePlays(league, gameId))).items;
  const core = run(coreRaw.map(fromCorePlay));
  const siteSet = new Set(site), coreSet = new Set(core);
  const onlySite = site.filter((x) => !coreSet.has(x)), onlyCore = core.filter((x) => !siteSet.has(x));
  console.log(`${league}: site ${site.length} events, core ${core.length}; same play ids: ${s.plays[5].id === coreRaw[5].id}; only-site ${onlySite.length}, only-core ${onlyCore.length}`);
  for (const x of [...onlySite.slice(0, 3), ...onlyCore.slice(0, 3)]) console.log('   ', onlySite.includes(x) ? 'site-only' : 'core-only', x);
  const c = coreRaw.find((p: any) => p.participants?.length);
  console.log('    core sample type:', JSON.stringify(c.type), 'participants:', JSON.stringify(c.participants.map((x: any) => x.type)), 'team:', c.team?.$ref?.match(/teams\/(\d+)/)?.[1], 'shootingPlay' in c);
}
