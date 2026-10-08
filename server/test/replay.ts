// Replays real, finished ESPN games through the detectors exactly as the live tracker would,
// printing what would have been sent. Usage: node test/replay.ts [league:eventId ...]
import { loadCatalog } from '../src/catalog.ts';
import { getJson } from '../src/espn.ts';
import { urls, type League } from '../src/leagues.ts';
import { PLAYER_DETECTORS, fromCorePlay, fromSitePlay, mlbFinalHalfInning, nextScore, observePlay, teamScoreEvents, type GameCtx, type Detected } from '../src/detectors.ts';

loadCatalog();
const games = process.argv.slice(2).length ? process.argv.slice(2) : ['mlb:401907973', 'nfl:401872963', 'nhl:401891781', 'nba:401811026'];

for (const g of games) {
  const [league, gameId] = g.split(':') as [League, string];
  const s = await getJson(urls.summary(league, gameId));
  const comp = s.header.competitions[0];
  const ctx: GameCtx = {
    league, gameId, goalies: new Map(),
    homeId: comp.competitors.find((c: any) => c.homeAway === 'home').id,
    awayId: comp.competitors.find((c: any) => c.homeAway === 'away').id,
  };
  if (league === 'nhl') for (const t of s.boxscore.players) {
    const gl = t.statistics.find((x: any) => x.name === 'goalies')?.athletes?.[0]?.athlete?.id;
    if (gl) ctx.goalies.set(String(t.team.id), String(gl));
  }
  const plays = league === 'nfl' ? (await getJson(urls.corePlays(league, gameId))).items.map(fromCorePlay) : s.plays.map(fromSitePlay);
  let score = { home: 0, away: 0 };
  const events: Detected[] = [];
  for (const p of plays) {
    const prev = score;
    score = nextScore(prev, p);
    events.push(...PLAYER_DETECTORS[league](ctx, p));
    if (score.home !== prev.home || score.away !== prev.away) events.push(...teamScoreEvents(ctx, prev, p));
    observePlay(ctx, p);
  }
  events.push(...mlbFinalHalfInning(ctx)); // what the live tracker does at the final
  // publish() stores each id once, so same-id detections become one notification. Mirror that.
  const raw = events.length;
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];
  events.length = 0;
  events.push(...unique);
  const spotlight: Record<string, string> = { 'nfl.team.onside_recovered': '😱', 'mlb.team.opponent_risp': '😰', 'mlb.team.stranded_risp': '🏝️', 'mlb.runner.caught_stealing': '🚔', 'nfl.safety': '😵', 'nfl.qb.delay_of_game': '⏱️', 'mlb.team.down_in_order': '😴' };
  for (const e of events.filter((x) => spotlight[x.type])) console.log(`  ${spotlight[e.type]}  ${e.title}${e.aliases ? ` [also counts as: ${e.aliases}]` : ''} | ${e.body.slice(0, e.type === 'mlb.team.down_in_order' ? 240 : 100)}`);
  // Every lead change: the scored-on alert for that play must yield to the combined fell-behind alert.
  const behind = events.filter((e) => e.type === 'team.fell_behind');
  const merged = behind.filter((b) => league === 'nba' || events.some((e) => e !== b && e.targetKey === b.targetKey && e.meta?.playId === b.meta?.playId && e.unless === 'team.fell_behind'));
  console.log(`${merged.length === behind.length ? 'PASS' : 'FAIL'} lead changes merged into one alert: ${merged.length}/${behind.length}${behind[0] ? ` e.g. "${behind[0].title}"` : ''}`);
  if (merged.length !== behind.length) process.exitCode = 1;
  const finalHome = Number(comp.competitors.find((c: any) => c.homeAway === 'home').score);
  const finalAway = Number(comp.competitors.find((c: any) => c.homeAway === 'away').score);
  const ok = score.home === finalHome && score.away === finalAway;
  console.log(`${ok ? 'PASS' : 'FAIL'} tracked score ${score.away}-${score.home} vs final ${finalAway}-${finalHome}`);
  if (!ok) process.exitCode = 1;
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  console.log(`\n=== ${league.toUpperCase()} ${s.header.competitions[0].competitors.map((c: any) => `${c.team.abbreviation} ${c.score}`).join(' – ')} | ${plays.length} plays → ${events.length} notifications (${raw - events.length} same-id detections collapsed)`);
  console.log(byType);
  const unknownTargets = events.filter((e) => /Your guy/.test(e.title)).length;
  console.log(`events naming an athlete not in current catalog: ${unknownTargets}`);
  const seenTypes = new Set<string>();
  for (const e of events) if (!seenTypes.has(e.type)) { seenTypes.add(e.type); console.log(`  • [${e.type}] ${e.title}\n      ${e.body.slice(0, 140)}`); }
}
