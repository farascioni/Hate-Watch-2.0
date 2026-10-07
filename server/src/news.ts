// Off-the-field alerts from ESPN's league news: legal trouble, and fines and suspensions. Every few
// minutes each league's news feed is read; a news item about a tracked player or team becomes an alert.
import { getJson } from './espn.ts';
import { kvGet, kvSet } from './db.ts';
import { catalog, normalize } from './catalog.ts';
import { playerKey, teamKey, urls, type League } from './leagues.ts';
import { publish } from './fanout.ts';
import type { Detected } from './detectors.ts';

/** Seam for tests (test/news.test.ts feeds fake news). Production never changes it. */
export const newsDeps = { getJson: getJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };

export const OFF_FIELD = 'off_field';
export const FINE_SUSPENSION = 'fine_suspension';

// ─── What an item is about ────────────────────────────────────────────────────────────────────
/** Fines, suspensions, bans. */
const DISCIPLINE = [
  /\bfined\b/i,
  /\bfines? (?:of|for|totaling)\b/i,
  /\bfines \w+(?: \w+)? [$€£]/i, // "NBA fines Knicks $25K"
  /[$€£][\d,.]+\s?(?:[KkMm]\b|million|thousand)?\s*fine\b/i,
  /\bsuspen(?:ded|ds|d|sion)\b/i,
  /\bbann?ed (?:for|from|by)\b|\b(?:lifetime|\d+-(?:game|match|race|year|month)) ban\b/i,
  /\bcommissioner'?s exempt list\b/i,
];
/** Legal and off-field trouble: arrests, charges, lawsuits, allegations, investigations. */
const TROUBLE = [
  /\barrest(?:ed|s)?\b/i,
  /\bcharged with\b|\bcharges? (?:filed|against)\b|\bindict(?:ed|ment)\b/i,
  /\blawsuit\b|\bsued\b|\bsues\b|\bsuing\b/i,
  /\ballegation|\balleged(?:ly)?\b|\baccus(?:ed|es|ation)\b/i,
  /\bunder investigation\b|\binvestigat(?:ing|ion into|ion of)\b|\bprobe\b/i,
  /\bDUI\b|\bDWI\b|\bdriving under the influence\b|\bdomestic (?:violence|abuse|assault|dispute|incident)\b|\bsexual (?:assault|misconduct|harassment)\b|\bassault(?:ed|ing)?\b/i,
  /\bwarrant\b|\bplead(?:s|ed)? (?:not )?guilty\b|\bsentenced\b|\bjail\b|\bprison\b|\bfelony\b|\bmisdemeanor\b|\bcourt (?:records|documents|filing|date|appearance|hearing)\b|\bin court\b/i,
  /\baltercation\b|\b(?:gambling|betting) (?:probe|investigation|scandal|violation|policy)\b|\bpersonal conduct policy\b|\bplaced on (?:administrative|paid) leave\b/i,
];
/** Not a suspension: a game stopped by rain or darkness. */
const SUSPENDED_GAME = /\b(?:game|play|match)\s+(?:is\s+|was\s+|has been\s+)?suspended\b|\bsuspended\s+(?:game|in the|due to|because|until|by rain|for rain)\b|\bsuspends? (?:the )?game\b/i;
/** Good news for them, not trouble: it's over or it went their way. */
const RESOLVED = /\breinstat\w*|\bsuspension\b.{0,40}?\b(?:lifted|overturned|reduced|rescinded|ends)\b|\blifts? (?:\w+ )?suspension\b|\breturns? from (?:\w+ )?suspension\b|\bcharges (?:were |are |have been )?(?:dropped|dismissed)\b|\bcleared of\b|\bacquitted\b|\bwon'?t face charges\b|\bno charges\b|\blawsuit (?:dismissed|settled)\b/i;

/** Someone's opinion or a maybe, not a ruling: "Norris: Colapinto should be banned", "calls for a suspension". */
const SPECULATIVE = /\b(?:should|could|would|might|may|must)\s+(?:not\s+)?(?:be|have|get|face|receive)\s+(?:been\s+)?(?:an?\s+)?(?:[\w-]+\s+)?(?:fined|suspended|banned|ban|suspension|fine)\b|\bcalls? for\b.{0,40}?\b(?:ban|suspension|fine)\b|\b(?:possible|potential)\s+(?:ban|suspension|fine)\b/gi;

/**
 * Someone running someone else down, not an accusation of wrongdoing: "Fred has accused ex-boss Erik ten
 * Hag of being a 'piece of crap'", "Arteta accuses referee of bias". (Being accused of something still counts.)
 */
const CRITICISM = /\baccus(?:es|ed|ing)\s+(?:[\w'’-]+\s+){1,5}?of being\b|\baccus(?:es|ed|ing)\s+(?:the\s+)?(?:referees?|refs?|officials|officiating|var|umpires?)\b/gi;

/** Which of the two an item is: a fine or suspension (also counting as off-field trouble when it's for that), or trouble. */
export function classify(text: string): { type: string; aliases?: string[] } | null {
  if (RESOLVED.test(text)) return null;
  const ruling = text.replace(SPECULATIVE, ' ');
  const discipline = DISCIPLINE.some((re) => re.test(ruling)) && !(SUSPENDED_GAME.test(ruling) && !/\bfined\b|\bbann?ed\b/i.test(ruling));
  const said = text.replace(CRITICISM, ' ');
  const trouble = TROUBLE.some((re) => re.test(said));
  if (discipline) return trouble ? { type: FINE_SUSPENSION, aliases: [OFF_FIELD] } : { type: FINE_SUSPENSION };
  return trouble ? { type: OFF_FIELD } : null;
}

// ─── Who an item is about ─────────────────────────────────────────────────────────────────────
/**
 * The (normalized) text right before a mention names them as a former member ("Ex-Bears LB", which
 * normalizes to "ex bears"), or as on the receiving end ("a hit on Bengals QB Joe Burrow").
 */
const FORMER = /\b(?:ex|former)\s+$/;
/** A team named as the game something happened after: "charged for comments after Man United draw". */
const AFTER_THEIR_GAME = /\b(?:after|following)\s+(?:the\s+)?$/;
const ON_THE_RECEIVING_END = /\b(?:on|toward|towards|involving|vs|(?:collision|crash|contact|altercation|fight|clash|scuffle|incident)s?\s+with)\s+(?:[a-z0-9]+\s+){0,3}$/;
const WORD = (s: string) => new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'g');

/** Each place `name` is mentioned in `text` (both normalized), with the text before it. */
function mentions(text: string, name: string): string[] {
  const out: string[] = [];
  if (!name) return out;
  for (const m of text.matchAll(WORD(name))) out.push(text.slice(0, (m.index ?? 0) + m[1].length));
  return out;
}

export interface Article { id: number | string; type?: string; headline?: string; description?: string; published?: string; categories?: any[]; links?: any }

/**
 * Tracked-target candidates for an item. A tagged athlete counts when their name (full, or last name) is
 * in the headline or description, and not only as the one something happened to. Their team counts too.
 * A tagged team counts when it's named and not as a former team ("Ex-Bears LB") or the game something
 * happened after ("after Man United draw"), or when it's the only team tagged and no athlete is (minor
 * leaguers aren't tagged: "Nationals catcher Francisco Rivero"). When the headline names a team, teams
 * named only further down don't count: "FA charges Fulham boss … after Man United draw" is about Fulham,
 * though the story goes on to quote him saying officials "would not let Manchester United lose".
 */
export function affected(lg: League, a: Article): { players: string[]; teams: string[] } {
  const text = normalize(`${a.headline ?? ''}. ${a.description ?? ''}`);
  const players: string[] = [], teams = new Set<string>();
  for (const c of a.categories ?? []) {
    if (c.type !== 'athlete' || c.athleteId == null) continue;
    const p = catalog.playerByEspn(lg, String(c.athleteId));
    if (!p) continue;
    const full = normalize(p.name), last = full.split(' ').filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/.test(w)).at(-1) ?? full;
    const seen = [...mentions(text, full), ...(last.length > 2 ? mentions(text, last) : [])];
    if (seen.length && seen.some((before) => !ON_THE_RECEIVING_END.test(before))) {
      players.push(p.key);
      teams.add(p.teamKey);
    }
  }
  const tagged = (a.categories ?? []).filter((c) => c.type === 'team' && c.teamId != null);
  const headline = normalize(a.headline ?? '').length; // the text starts with it
  const named: { key: string; inHeadline: boolean }[] = [];
  for (const c of tagged) {
    const t = catalog.team(teamKey(lg, String(c.teamId)));
    if (!t) continue;
    const seen = [...new Set([t.name, t.shortName].map((n) => normalize(n ?? '')))].flatMap((n) => mentions(text, n));
    const fair = seen.filter((before) => !FORMER.test(before) && !ON_THE_RECEIVING_END.test(before) && !AFTER_THEIR_GAME.test(before));
    if (fair.length) named.push({ key: t.key, inHeadline: fair.some((before) => before.length < headline) });
    else if (!seen.length && !players.length && tagged.length === 1) teams.add(t.key);
  }
  const headlined = named.some((n) => n.inHeadline);
  for (const n of named) if (n.inHeadline || !headlined) teams.add(n.key);
  return { players, teams: [...teams] };
}

/**
 * The alerts for a batch of news items. Only ESPN's news items (HeadlineNews) count, not the videos and
 * columns about the same story, and only ones published since `since`. One item can concern a player and
 * their team: every alert from it shares a `moment`, so someone tracking both gets one (the player's).
 */
export function newsEvents(lg: League, articles: Article[], since: number): Detected[] {
  const out: Detected[] = [];
  for (const a of articles) {
    const at = Date.parse(a.published ?? '');
    if (a.type !== 'HeadlineNews' || !a.headline || !Number.isFinite(at) || at < since) continue;
    const kind = classify(`${a.headline}. ${a.description ?? ''}`);
    if (!kind) continue;
    const { players, teams } = affected(lg, a);
    const headline = normalize(a.headline);
    const titled = (name: string) => (mentions(headline, normalize(name)).length ? a.headline! : `${name}: ${a.headline}`);
    const base = { ...kind, moment: `news:${lg}:${a.id}`, body: a.description && a.description !== a.headline ? a.description : 'ESPN', at, meta: { articleId: String(a.id), link: a.links?.web?.href } };
    for (const key of players) {
      const p = catalog.player(key)!;
      const last = p.name.split(' ').filter((w) => !/^(Jr|Sr|II|III|IV)\.?$/.test(w)).at(-1) ?? p.name;
      out.push({ id: `news:${lg}:${a.id}:${key}`, targetKey: key, title: titled(last), ...base });
    }
    // Teams have their own two switches (in Settings → Team alerts): the same alerts, under team.* types.
    const forTeam = { type: `team.${kind.type}`, ...(kind.aliases ? { aliases: kind.aliases.map((t) => `team.${t}`) } : {}) };
    for (const key of teams) {
      const t = catalog.team(key)!;
      out.push({ id: `news:${lg}:${a.id}:${key}`, targetKey: key, title: titled(t.shortName ?? t.name), ...base, ...forTeam });
    }
  }
  return out;
}

/** Each league's news, every few minutes. What was already in a feed when this first ran is history, not news. */
export async function scanNews(lg: League) {
  const res = await newsDeps.getJson(urls.news(lg), { timeoutMs: 8000 });
  const key = `news_since:${lg}`;
  let since = kvGet<number>(key);
  if (since == null) { since = Date.now(); kvSet(key, since); }
  const events = newsEvents(lg, res.articles ?? [], Math.max(since, Date.now() - 24 * 3600_000));
  if (events.length) publish(events, lg);
}
