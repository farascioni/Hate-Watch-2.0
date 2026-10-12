// Counts every request the server sends to ESPN, by league and kind of read, so what the calls cost is measured rather than
// modeled. `getJson` and `probePng` (espn.ts) record each HTTP attempt here, retries included, since a retry is a request
// ESPN sees. Totals since boot are in `GET /health` (`calls`); once an hour the last hour's busiest reads go to the log
// (`[calls] …`, from `startCallLog`), which is what to read on production: `fly logs -a hate-watch-api | grep '\[calls\]'`.
//
// Not counted: the clips text reads (`liveDeps.getText` in live.ts) and the images the apps fetch from ESPN's CDN themselves.
// Bytes are ESPN's `content-length` (the gzipped size on the wire) and only for responses that send one.

export type CallOutcome = 'ok' | 'notFound' | 'error';

interface Bucket { calls: number; retries: number; errors: number; notFound: number; bytes: number; ms: number; compared: number; same: number }
const blank = (): Bucket => ({ calls: 0, retries: 0, errors: 0, notFound: 0, bytes: 0, ms: 0, compared: 0, same: 0 });

let buckets = new Map<string, Bucket>();
let since = Date.now();
let lastLogged = new Map<string, Bucket>();

/**
 * Off unless `HW_CALLS_FINGERPRINT=1` (the test server that measures what the calls would cost with fewer of them; production
 * leaves it off, since it hashes every response body). With it on, each response is fingerprinted and compared with the last
 * one for the same URL, so a bucket knows how many of its calls returned exactly what the one before did (`unchanged`).
 */
export const FINGERPRINT = process.env.HW_CALLS_FINGERPRINT === '1';
const lastPrint = new Map<string, string>();
const withoutBust = (url: string) => url.replace(/([?&])_hw=\d+&?/, '$1').replace(/[?&]$/, '');

const LEAGUE_NAMES: Record<string, string> = { 'eng.1': 'epl', 'college-football': 'cfb', soccer: 'epl' };
const SPORT_LEAGUE: Record<string, string> = { mma: 'ufc', racing: 'f1' };

/** Which league and which kind of read a URL is: `{ league: 'mlb', kind: 'summary' }`. Anything unrecognized is `other`. */
export function classify(url: string): { league: string; kind: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { league: '?', kind: 'other' }; }
  const segs = u.pathname.split('/').filter(Boolean);

  // ESPN's image CDN: /i/headshots/<league>/players/full/<id>.png, /i/teamlogos/<league>/500/<abbrev>.png
  if (u.hostname.endsWith('espncdn.com')) {
    const i = segs.findIndex((s) => s === 'headshots' || s === 'teamlogos');
    const lg = i >= 0 ? segs[i + 1] : '?';
    return { league: LEAGUE_NAMES[lg] ?? SPORT_LEAGUE[lg] ?? lg, kind: i >= 0 && segs[i] === 'headshots' ? 'headshot check' : 'logo check' };
  }

  // .../sports/<sport>/<league>/<rest> (site API) or .../sports/<sport>/leagues/<league>/<rest> (core API)
  const at = segs.indexOf('sports');
  if (at < 0) return { league: '?', kind: 'other' };
  const sport = segs[at + 1] ?? '?';
  let slug: string, rest: string[];
  if (segs[at + 2] === 'leagues') { slug = segs[at + 3] ?? '?'; rest = segs.slice(at + 4); }
  else if (segs[at + 2] === 'athletes') { slug = ''; rest = segs.slice(at + 2); } // core API: /sports/mma/athletes/<id>
  else { slug = segs[at + 2] ?? '?'; rest = segs.slice(at + 3); }
  const league = SPORT_LEAGUE[sport] ?? LEAGUE_NAMES[slug] ?? slug;

  const r = rest.join('/');
  let kind = 'other';
  if (r === 'scoreboard') kind = 'scoreboard';
  else if (r === 'summary') kind = 'summary';
  else if (/\/plays$/.test(r)) kind = u.searchParams.has('page') ? 'touches' : 'plays'; // soccer reads its touch feed a page at a time
  else if (r === 'standings') kind = 'standings';
  else if (r === 'injuries') kind = 'injuries';
  else if (r === 'news') kind = 'news';
  else if (r === 'teams') kind = 'teams';
  else if (/^teams\/[^/]+\/roster$/.test(r)) kind = 'roster';
  else if (/^teams\/[^/]+\/schedule$/.test(r)) kind = 'schedule';
  else if (/^teams\/[^/]+\/statistics$/.test(r)) kind = 'team stats';
  else if (/^teams\/[^/]+$/.test(r)) kind = 'team';
  else if (/athletes\/[^/]+\/overview$/.test(r)) kind = 'athlete overview';
  else if (/athletes\/[^/]+\/stats$/.test(r)) kind = 'athlete stats';
  else if (/competitors\/[^/]+\/(status|statistics)$/.test(r)) kind = 'timing';
  else if (/competitors$/.test(r)) kind = 'entry list';
  else if (/competitions\/[^/]+\/(status|statistics)$/.test(r)) kind = 'session';
  else if (/^events\/[^/]+\/competitions\/[^/]+$/.test(r)) kind = 'fight';
  else if (r === 'rankings') kind = 'rankings';
  else if (/athletes/.test(r)) kind = 'athlete';
  else if (/fightcenter/.test(r)) kind = 'fight center';
  else if (/groups/.test(r)) kind = 'groups';
  return { league, kind };
}

/** One HTTP attempt sent to ESPN. `retry`: not the first attempt at this read. `bytes`: its content-length, 0 when it sent none. */
export function recordCall(url: string, outcome: CallOutcome, ms: number, retry: boolean, bytes = 0, print?: string) {
  const { league, kind } = classify(url);
  const key = `${league}|${kind}`;
  let b = buckets.get(key);
  if (!b) buckets.set(key, (b = blank()));
  b.calls++;
  b.ms += ms;
  b.bytes += bytes;
  if (retry) b.retries++;
  if (outcome === 'error') b.errors++;
  else if (outcome === 'notFound') b.notFound++;
  if (print) {
    const id = withoutBust(url), before = lastPrint.get(id);
    if (before !== undefined) { b.compared++; if (before === print) b.same++; }
    if (lastPrint.size > 20_000) lastPrint.clear(); // a finished game's URL is never read again
    lastPrint.set(id, print);
  }
}

const rowsOf = (from: Map<string, Bucket>, minus?: Map<string, Bucket>) => {
  const out = [];
  for (const [key, b] of from) {
    const p = minus?.get(key) ?? blank();
    const calls = b.calls - p.calls;
    if (!calls) continue;
    const [league, kind] = key.split('|');
    out.push({
      league, kind, calls, retries: b.retries - p.retries, errors: b.errors - p.errors, notFound: b.notFound - p.notFound,
      mb: Math.round(((b.bytes - p.bytes) / 1e6) * 10) / 10, avgMs: Math.round((b.ms - p.ms) / calls),
      compared: b.compared - p.compared, same: b.same - p.same, // only with HW_CALLS_FINGERPRINT=1
    });
  }
  return out.sort((a, b) => b.calls - a.calls);
};

/** Everything since boot (or the last reset), busiest first: what `GET /health` serves. */
export function callStats() {
  const rows = rowsOf(buckets);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    since: new Date(since).toISOString(),
    total: sum((r) => r.calls), retries: sum((r) => r.retries), errors: sum((r) => r.errors), notFound: sum((r) => r.notFound), mb: Math.round(sum((r) => r.mb) * 10) / 10,
    rows,
  };
}

/** Forgets every count (tests). */
export function resetCalls() { buckets = new Map(); lastLogged = new Map(); lastPrint.clear(); since = Date.now(); }

/** The calls since the last time this ran, as the lines logged each hour: a total, then the busiest `top` reads. */
export function callLog(top = 15): string[] {
  const rows = rowsOf(buckets, lastLogged);
  lastLogged = new Map([...buckets].map(([k, b]) => [k, { ...b }]));
  if (!rows.length) return ['[calls] none in the last window'];
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  const n = (x: number) => x.toLocaleString('en-US');
  const lines = [`[calls] ${n(sum((r) => r.calls))} calls (${n(sum((r) => r.retries))} retries, ${n(sum((r) => r.errors))} errors, ${n(sum((r) => r.notFound))} not found), ${n(Math.round(sum((r) => r.mb)))} MB`];
  for (const r of rows.slice(0, top)) lines.push(`[calls]   ${`${r.league} ${r.kind}`.padEnd(26)} ${n(r.calls).padStart(8)} calls ${String(r.mb).padStart(8)} MB  avg ${r.avgMs} ms${r.compared ? `  ${Math.round((100 * r.same) / r.compared)}% unchanged` : ''}${r.retries ? `  ${r.retries} retries` : ''}${r.errors ? `  ${r.errors} errors` : ''}`);
  if (rows.length > top) lines.push(`[calls]   … and ${rows.length - top} more reads`);
  return lines;
}

/** Logs `callLog()` every `HW_CALLS_LOG_MS` (an hour). The timer doesn't keep the process alive. */
export function startCallLog(ms = Number(process.env.HW_CALLS_LOG_MS ?? 3_600_000)) {
  const timer = setInterval(() => { for (const l of callLog()) console.log(new Date().toISOString().slice(11, 23), l); }, ms);
  timer.unref();
  return timer;
}
