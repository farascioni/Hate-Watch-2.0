// Audits the ingested catalog: uniqueness, every row has an image, image sizes, and that
// every logo fallback is a genuine 404 from ESPN (not a transient network failure).
import { db } from '../src/db.ts';
import { mapLimit } from '../src/espn.ts';
import { urls, type League } from '../src/leagues.ts';

const q = (sql: string) => db.prepare(sql).all() as any[];
console.log('dupe player keys:', q('SELECT key, COUNT(*) c FROM players GROUP BY key HAVING c > 1').length);
console.log('dupe espn ids per league:', q('SELECT league, espn_id, COUNT(*) c FROM players GROUP BY league, espn_id HAVING c > 1').length);
console.log('dupe name+team:', q('SELECT name, team_key, COUNT(*) c FROM players GROUP BY name, team_key HAVING c > 1').map((r) => `${r.name}@${r.team_key}`));
console.log('players missing image:', q("SELECT COUNT(*) c FROM players WHERE image IS NULL OR image = '' OR image_w = 0")[0].c);
console.log('teams missing logo:', q("SELECT COUNT(*) c FROM teams WHERE logo = '' OR logo_w = 0")[0].c);
console.log('headshot sizes:', q("SELECT image_w || 'x' || image_h dims, COUNT(*) c FROM players WHERE image_kind='headshot' GROUP BY dims"));
console.log('logo sizes:', q("SELECT logo_w || 'x' || logo_h dims, COUNT(*) c FROM teams GROUP BY dims"));
console.log('headshot url not keyed by own id:', q("SELECT COUNT(*) c FROM players WHERE image_kind='headshot' AND image NOT LIKE '%/' || espn_id || '.png'")[0].c);

const fallbacks = q("SELECT league, espn_id, name FROM players WHERE image_kind = 'team_logo'");
const statuses = await mapLimit(fallbacks, 16, async (r) => (await fetch(urls.headshot(r.league as League, r.espn_id), { method: 'HEAD' })).status);
const tally: Record<string, number> = {};
statuses.forEach((s) => (tally[s] = (tally[s] ?? 0) + 1));
console.log(`logo fallbacks re-checked (${fallbacks.length}):`, tally);
