// A UFC card before and during fight night, as other sports' previews come before a game: the Scores tab's
// UFC chip (the next card, every fight, and the card after) and a card's own screen. From one read of ESPN's
// fight center per card: each fight's segment (main card, prelims, early prelims), its belt (`types`), its state
// and, once it's over, how it ended ("KO/TKO R1 2:09"); each fighter's record, tape, career rates and DraftKings'
// odds, to win and to win each way. The chances are the moneyline's with the bookmaker's margin out (lineChances).
// The rounds are the dated scoreboard's (`format`, as CardWatch reads them), five for a main event or a title
// fight if that read fails. Which card is next is ESPN's calendar: the first card not over (its `endDate`, the
// night's end, not its `startDate`, the main card's start), Dana White's Contender Series aside, as in ufc.ts.
// Who holds a belt is the catalog's (kv `ufc:belts`, ufc-classes.ts), not ESPN's rankings, which are years stale.
import { getJson as espnGetJson } from './espn.ts';
import { catalog } from './catalog.ts';
import { kvGet } from './db.ts';
import { playerKey, urls } from './leagues.ts';
import { lineChances } from './scores.ts';
import { titleOf, weightName, type Belts } from './ufc-classes.ts';
import { cardDay } from './ufc.ts';

/** Seam for tests (test/ufc-preview.test.ts). */
export const ufcPreviewDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>, now: () => Date.now() };
const get = (url: string, bust = false) => ufcPreviewDeps.getJson(url, { timeoutMs: 8000, bust });
const CALENDAR_TTL_MS = 30 * 60_000, CARD_TTL_MS = 5 * 60_000, LIVE_TTL_MS = 20_000, CARDS = 2;

type State = 'pre' | 'in' | 'post';
/** One side of a fight. `linked`: the catalog has them, so their page opens. Each stat or odd only when ESPN has it. */
export interface UfcCorner {
  key: string; name: string; last: string; linked: boolean; record: string | null; winner: boolean | null;
  belt?: 'champion' | 'interim';
  /** DraftKings' American odds ("+102"): to win, and to win by KO/TKO, by submission, on the cards. */
  odds?: { win?: string; ko?: string; sub?: string; decision?: string };
  /** Their chance to win (percent), the moneyline's, margin out; both sides' add up to 100. */
  chance?: number;
}
/** A tale-of-the-tape row: each side's value (null: ESPN hasn't one); `edge`, for a more-is-better number, the side ahead. */
export interface TapeRow { label: string; values: [string | null, string | null]; edge?: 0 | 1 }
export interface UfcBout {
  id: string; weight: string | null; rounds: number;
  /** Its belt: "Women's Flyweight title", "Interim Lightweight title". */
  title: string | null;
  /** "Main event", "Co-main event". */
  billing: string | null;
  state: State; canceled: boolean;
  /** Live: the round. */
  round?: number;
  /** Over: how ("KO/TKO R1 2:09", "Unanimous decision") and with what ("Punches to the head"). */
  result?: { line: string; detail?: string };
  corners: [UfcCorner, UfcCorner];
  tape: TapeRow[];
  oddsBy: string | null;
}
/** "Main card", "Prelims", "Early prelims": when it starts and where it's on. Its fights top of the bill first. */
export interface UfcSegment { id: string; name: string; startsAt: number; broadcast: string | null; bouts: UfcBout[] }
export interface UfcCard { event: { id: string; name: string; startsAt: number; venue: string | null; place: string | null }; segments: UfcSegment[] }

const SEGMENTS = ['main', 'prelims1', 'prelims2'];
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); // "Early Prelims" → "Early prelims"
const num = (s: unknown) => (s == null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const pct = (s: unknown) => (num(s) == null ? null : `${Math.round(num(s)!)}%`);
const fixed = (s: unknown) => (num(s) == null ? null : num(s)!.toFixed(2));

/** How a finished fight ended, from its status: "KO/TKO R1 2:09" (into the round, as the UFC says it), "Split decision". */
export function resultLine(status: any): UfcBout['result'] | undefined {
  const r = status?.result;
  if (!r?.name) return undefined;
  const when = Number(status.period) && status.displayClock ? ` R${Number(status.period)} ${status.displayClock}` : '';
  const detail = [r.description, r.target?.description ? `to the ${String(r.target.description).toLowerCase()}` : ''].filter(Boolean).join(' ') || undefined;
  const kind = String(r.name).match(/^decision-+(\w+)/)?.[1];
  const line = r.name === 'kotko' ? `KO/TKO${when}` : r.name === 'submission' ? `Submission${when}`
    : kind ? `${sentence(kind)} decision` : `${r.displayName ?? r.name}${/draw|no.?contest/i.test(String(r.displayName ?? r.name)) ? '' : when}`;
  return { line, ...(detail && !kind ? { detail } : {}) };
}

/** `over`: ESPN's `winner` is false for both before a fight, so only an over fight's says who won. */
function cornerOf(x: any, belts: Belts, weight: string | null, over: boolean): UfcCorner {
  const a = x.athlete ?? {}, id = String(x.id ?? a.id);
  const o = Object.fromEntries((x.bets?.odds ?? []).map((b: any) => [b.type, b.values?.[0]?.odds]).filter(([, v]: any) => v));
  const odds = { ...(o.moneyline ? { win: o.moneyline } : {}), ...(o.knockout ? { ko: o.knockout } : {}), ...(o.submission ? { sub: o.submission } : {}), ...(o.points ? { decision: o.points } : {}) };
  const belt = weight ? belts[weight] : undefined;
  return {
    key: playerKey('ufc', id), name: String(a.displayName ?? a.fullName ?? '?'), last: String(a.lastName ?? a.displayName ?? '?'), linked: !!catalog.playerByEspn('ufc', id),
    record: x.displayRecord ?? null, winner: over && typeof x.winner === 'boolean' ? x.winner : null,
    ...(belt?.champion === id ? { belt: 'champion' as const } : belt?.interim === id ? { belt: 'interim' as const } : {}),
    ...(Object.keys(odds).length ? { odds } : {}),
  };
}

/** The tale of the tape, rows only where either side has a value. */
function tapeOf(xs: any[]): TapeRow[] {
  const stat = (x: any, n: string) => x.stats?.find((s: any) => s.name === n)?.displayValue;
  const rows: { label: string; v: (x: any) => string | null; n?: (x: any) => number | null }[] = [
    { label: 'Age', v: (x) => (x.athlete?.age ? String(x.athlete.age) : null) },
    { label: 'Height', v: (x) => x.athlete?.displayHeight ?? null },
    { label: 'Reach', v: (x) => x.athlete?.displayReach ?? null, n: (x) => num(String(x.athlete?.displayReach ?? '').replace(/"/g, '')) },
    { label: 'Stance', v: (x) => x.athlete?.stance?.text ?? null },
    { label: 'Sig. strikes / min', v: (x) => fixed(stat(x, 'strikeLPM')), n: (x) => num(stat(x, 'strikeLPM')) },
    { label: 'Strike accuracy', v: (x) => pct(stat(x, 'strikeAccuracy')), n: (x) => num(stat(x, 'strikeAccuracy')) },
    { label: 'Takedowns / 15 min', v: (x) => fixed(stat(x, 'takedownAvg')), n: (x) => num(stat(x, 'takedownAvg')) },
    { label: 'Takedown accuracy', v: (x) => pct(stat(x, 'takedownAccuracy')), n: (x) => num(stat(x, 'takedownAccuracy')) },
    { label: 'Sub attempts / 15 min', v: (x) => fixed(stat(x, 'submissionAvg')), n: (x) => num(stat(x, 'submissionAvg')) },
  ];
  return rows.flatMap(({ label, v, n }) => {
    const values: [string | null, string | null] = [v(xs[0]), v(xs[1])];
    if (values.every((x) => x == null)) return [];
    const [a, b] = n ? [n(xs[0]), n(xs[1])] : [null, null];
    return [{ label, values, ...(a != null && b != null && a !== b ? { edge: (a > b ? 0 : 1) as 0 | 1 } : {}) }];
  });
}

function boutOf(c: any, rounds: Map<string, number>, belts: Belts): UfcBout {
  const weight = weightName(c.type?.abbreviation) ?? c.type?.text ?? null;
  const t = (c.types ?? []).map((x: any) => titleOf(x?.text)).find(Boolean) as ReturnType<typeof titleOf>;
  const state = (['pre', 'in', 'post'].includes(c.status?.type?.state) ? c.status.type.state : 'pre') as State;
  const note = String(c.note ?? '');
  const billing = /co-main/i.test(note) ? 'Co-main event' : /main event/i.test(note) ? 'Main event' : null;
  const xs = [...(c.competitors ?? [])].sort((a, b) => Number(a.order) - Number(b.order));
  const canceled = /cancel|postpon/i.test(String(c.status?.type?.name ?? ''));
  const corners = xs.map((x) => cornerOf(x, belts, weight, state === 'post' && !canceled)) as [UfcCorner, UfcCorner];
  const chance = lineChances(corners[0]?.odds?.win, corners[1]?.odds?.win);
  if (chance) { corners[0].chance = chance.home; corners[1].chance = chance.away; }
  const result = state === 'post' && !canceled ? resultLine(c.status) : undefined;
  return {
    id: String(c.id), weight, rounds: rounds.get(String(c.id)) ?? (t || billing === 'Main event' ? 5 : 3),
    title: t ? `${t.interim ? 'Interim ' : ''}${t.weight} title` : null, billing, state, canceled,
    ...(state === 'in' && Number(c.status?.period) ? { round: Number(c.status.period) } : {}),
    ...(result ? { result } : {}),
    corners, tape: xs.length === 2 ? tapeOf(xs) : [], oddsBy: xs.find((x) => x.bets?.provider?.name)?.bets.provider.name ?? null,
  };
}

/** A card from ESPN's fight center (and the dated scoreboard's rounds); null for one ESPN doesn't have. */
export function cardOf(fc: any, board: any): UfcCard | null {
  if (!fc?.event?.id || !fc.cards) return null;
  const ev = (board?.events ?? []).find((e: any) => String(e.id) === String(fc.event.id));
  const rounds = new Map<string, number>((ev?.competitions ?? []).filter((c: any) => Number(c.format?.regulation?.periods) > 0).map((c: any) => [String(c.id), Number(c.format.regulation.periods)]));
  const belts = kvGet<Belts>('ufc:belts') ?? {};
  const segments = Object.entries<any>(fc.cards)
    .sort(([a], [b]) => (SEGMENTS.indexOf(a) + 1 || 9) - (SEGMENTS.indexOf(b) + 1 || 9))
    .map(([id, s]): UfcSegment => {
      // A fight with one side not named yet isn't a fight to show.
      const comps: any[] = (s.competitions ?? []).filter((c: any) => (c.competitors ?? []).length === 2).sort((a: any, b: any) => Number(a.matchNumber) - Number(b.matchNumber));
      return {
        id, name: sentence(String(s.displayName ?? id)), startsAt: Math.min(...comps.map((c) => Date.parse(c.date) || Infinity)),
        broadcast: s.broadcasts?.[0]?.media?.shortName ?? null, bouts: comps.map((c) => boutOf(c, rounds, belts)),
      };
    }).filter((s) => s.bouts.length);
  const v = fc.venue;
  return {
    event: {
      id: String(fc.event.id), name: String(fc.event.name ?? fc.event.shortName ?? 'UFC'),
      startsAt: Math.min(...segments.map((s) => s.startsAt), Date.parse(fc.event.date) || Infinity),
      venue: v?.fullName ?? null, place: [v?.address?.city, v?.address?.state ?? v?.address?.country].filter(Boolean).join(', ') || null,
    },
    segments,
  };
}

// ─── Reading, cached ──────────────────────────────────────────────────────────────────────────
// A card is kept 5 minutes; 20 seconds once the night is under way (from 5 minutes before its start, until
// every fight is over or off), between fights too, so a result or the next fight starting isn't 5 minutes late.
// A failed read isn't kept.
const cards = new Map<string, { at: number; live: boolean; value: Promise<UfcCard | null> }>();
let calendar: { at: number; value: Promise<any[]> } | null = null;
/** For tests: forget what was read. */
export const forgetUfcPreview = () => { cards.clear(); calendar = null; };

/** The night is under way: from just before its start until every fight is over or off. */
export const underway = (card: UfcCard, now: number) => now >= card.event.startsAt - CARD_TTL_MS && card.segments.some((s) => s.bouts.some((b) => b.state !== 'post' && !b.canceled));

/** One card, or null if ESPN hasn't it. */
export function ufcCard(eventId: string): Promise<UfcCard | null> {
  const now = ufcPreviewDeps.now(), hit = cards.get(eventId);
  if (hit && now - hit.at < (hit.live ? LIVE_TTL_MS : CARD_TTL_MS)) return hit.value;
  const entry = { at: now, live: false, value: Promise.resolve<UfcCard | null>(null) };
  entry.value = (async () => {
    // An id ESPN doesn't know: a 400 (not a number) or its 404 in a 200's body.
    const fc = await get(urls.ufcFightCenter(eventId), true).catch((e) => { if (/HTTP 40[04]/.test(String(e))) return null; throw e; });
    if (!fc?.event?.id) return null;
    const board = fc.event.date ? await get(urls.scoreboard('ufc', cardDay(fc.event.date)), true).catch(() => null) : null;
    const card = cardOf(fc, board);
    entry.live = !!card && underway(card, ufcPreviewDeps.now());
    return card;
  })();
  cards.set(eventId, entry);
  entry.value.catch(() => { if (cards.get(eventId) === entry) cards.delete(eventId); });
  return entry.value;
}

/** ESPN's calendar of UFC cards (the season scoreboard's): each card's event id, name and the night's start and end. */
async function readCalendar(): Promise<{ id: string; name: string; startsAt: number; endsAt: number }[]> {
  const now = ufcPreviewDeps.now();
  if (!calendar || now - calendar.at >= CALENDAR_TTL_MS) {
    const entry = { at: now, value: get(urls.scoreboard('ufc')).then((sb) => sb?.leagues?.[0]?.calendar ?? []) };
    calendar = entry;
    entry.value.catch(() => { if (calendar === entry) calendar = null; });
  }
  return (await calendar.value).map((c: any) => ({
    id: String(c.event?.$ref ?? '').match(/events\/(\d+)/)?.[1] ?? '', name: String(c.label ?? ''), startsAt: Date.parse(c.startDate) || 0, endsAt: Date.parse(c.endDate) || 0,
  })).filter((c) => c.id && !/contender series/i.test(c.name));
}

/** The next card (tonight's until the night is over) and the one after, soonest first. */
export async function ufcCards(): Promise<UfcCard[]> {
  const now = ufcPreviewDeps.now();
  const next = (await readCalendar()).filter((c) => c.endsAt > now).sort((a, b) => a.startsAt - b.startsAt).slice(0, CARDS);
  const read = await Promise.all(next.map((c, i) => (i === 0 ? ufcCard(c.id) : ufcCard(c.id).catch(() => null))));
  return read.filter((c): c is UfcCard => !!c);
}
