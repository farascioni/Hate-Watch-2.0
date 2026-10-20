// Share card styles. A shared alert's link preview can be drawn in more than one style: the classic card
// every alert has, and ticket-shaped ones for the alerts they fit (a ticket stub for a loss, VOID for an
// elimination, a boarding pass for an F1 drop, a parking ticket for an ejection, a scratch-off for an
// upset, a ticket torn in half for a blown lead). Which styles apply is decided here, from the alert's
// type, meta, title and body alone (nothing is stored), so an alert from before this file and a Recent
// misery row work the same. A style applies only when every number it prints can be read from the alert:
// its builder returns null otherwise. The server tells the app which apply (`shareStyles` on a feed item,
// fanout.ts); share.ts draws them. This file must not import share.ts or fanout.ts (they import it).
// The "season in misery" card (season.ts) is drawn here too (seasonSheet): not an alert, one look, not in STYLES.
import { targetDto } from './catalog.ts';
import { LEAGUES, type League } from './leagues.ts';

export interface EventRow { id: string; type: string; league: string; target_key: string; title: string; body: string; meta?: string | null }

// ─── Drawing kit (satori lays everything out with flexbox and wants it declared on every div) ──────
export type El = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
export const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El =>
  ({ type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const initials = (name: string) => name.split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
/** Black or white text, whichever reads on this colour. */
export function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0B0B0D' : '#FFFFFF';
}

// ─── What the styles read from an alert ───────────────────────────────────────────────────────────
const metaOf = (e: EventRow): Record<string, any> => { try { return (e.meta ? JSON.parse(e.meta) : null) ?? {}; } catch { return {}; } };
/** "Final Score: 3 to 0" is always the winner first (detectors.ts). */
const finalScore = (e: EventRow) => { const m = /Final Score: (\d+) to (\d+)/.exec(e.body); return m ? { win: +m[1], lose: +m[2] } : null; };
const teamOf = (key: string) => { const t = targetDto(key); return t?.kind === 'team' ? t : null; };
const plain = (title: string) => title.replace(/^Successful Hate Watch!\s*/, '');
const color = (hex: string | null | undefined) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#3F3F46');
const shade = (hex: string, f: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('')}`;
const leagueName = (e: EventRow) => LEAGUES[e.league as League]?.name ?? e.league.toUpperCase();
const serial = (id: string) => String([...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 10000, 7)).padStart(4, '0'); // a stable number for a parking ticket

const GLOW = 'radial-gradient(circle at 50% -10%, rgba(229, 35, 43, 0.30), rgba(11, 11, 13, 0) 62%)';
const small = (text: string, style: Record<string, unknown> = {}) => h('div', { fontSize: 19, fontWeight: 800, letterSpacing: 3, opacity: 0.8, ...style }, text);
const big = (text: string, size: number, style: Record<string, unknown> = {}) => h('div', { fontSize: size, fontWeight: 900, lineHeight: 1, ...style }, text);
const fit = (s: string, sizes: [number, number, number]) => (s.length > 14 ? sizes[0] : s.length > 9 ? sizes[1] : sizes[2]);

/** The canvas every ticket sits on: the dark card, the brand in the corner, the ticket in the middle. */
const frame = (...children: unknown[]) =>
  h('div', { width: 1200, height: 630, position: 'relative', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter', color: '#FAFAFA', backgroundColor: '#0B0B0D', backgroundImage: GLOW },
    h('div', { position: 'absolute', left: 60, top: 44, alignItems: 'center', gap: 12 },
      h('div', { width: 16, height: 16, borderRadius: 8, backgroundColor: '#E5232B' }),
      h('div', { fontSize: 24, fontWeight: 900, letterSpacing: 3, color: '#FF3B44' }, 'HATE WATCH')),
    ...children);

/** A ticket with a main part and a tear-off stub (the general stub and VOID). */
const stubbed = (o: { width: number; height: number; rotate: number; bg: string; fg: string; stubBg: string; stubFg: string; rule: string; main: El[]; stub: El[]; over?: El[] }) =>
  h('div', { position: 'relative', width: o.width, height: o.height, marginTop: 28, transform: `rotate(${o.rotate}deg)`, borderRadius: 22, overflow: 'hidden', backgroundImage: o.bg, color: o.fg },
    h('div', { flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: '38px 52px' }, ...o.main),
    h('div', { width: 264, flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '38px 20px', backgroundColor: o.stubBg, color: o.stubFg, borderLeft: `6px dashed ${o.rule}` }, ...o.stub),
    ...(o.over ?? []));

// ─── The styles ───────────────────────────────────────────────────────────────────────────────────
const TICKET_TYPES = new Set(['team.lost', 'team.lost_as_favorite', 'team.lost_to_worse', 'team.shut_out', 'team.last_second_loss', 'team.blew_lead']);

/** A team's final loss as an admit-one stub: the score on the tear-off (the loser's first). */
function ticket(e: EventRow): El | null {
  if (!TICKET_TYPES.has(e.type)) return null;
  const t = teamOf(e.target_key), sc = finalScore(e);
  if (!t || !sc) return null; // the live "blew a lead" alert has no final score
  const m = metaOf(e), opp = teamOf(`team:${e.league}:${m.winnerId}`)?.shortName;
  let head = `${t.shortName} lost.`, sub = plain(e.title), seat = '';
  if (e.type === 'team.lost') { if (opp) sub = `To the ${opp}`; if (m.margin != null) seat = `SEAT: ${m.margin}`; }
  else if (e.type === 'team.lost_as_favorite' && opp && Number.isFinite(m.chance)) { sub = `As ${m.chance}% favorites, to the ${opp}`; seat = `SEAT: ${m.chance}`; }
  else if (e.type === 'team.lost_to_worse' && opp && m.winnerRecord) { sub = `To the ${m.winnerRecord} ${opp}`; seat = `SEAT: ${m.winnerRecord}`; }
  else if (e.type === 'team.shut_out') { head = 'Shut out.'; sub = `${t.shortName}${opp ? `, by the ${opp}` : ''}`; seat = 'SEAT: 0'; }
  const c = color(t.color), fg = readableOn(c);
  return frame(stubbed({
    width: 1056, height: 432, rotate: -2.5, bg: `linear-gradient(135deg, ${c}, ${shade(c, 0.6)})`, fg, stubBg: '#E9EAEC', stubFg: '#17171A', rule: '#6B6B73',
    main: [small('ADMIT ONE · FINAL'), h('div', { flexDirection: 'column', gap: 12 }, big(head, fit(head, [72, 88, 104])), h('div', { fontSize: 34, fontWeight: 800, opacity: 0.92 }, clip(sub, 56))),
      small(`SEC: DISAPPOINTMENT · ROW: HATE${seat ? ` · ${seat}` : ''}`)],
    stub: [small(t.abbrev, { opacity: 1 }), big(`${sc.lose}–${sc.win}`, 84), small('NO REFUNDS')],
  }));
}

/** An elimination as a season ticket stamped VOID. */
function voided(e: EventRow): El | null {
  if (e.type !== 'team.eliminated') return null;
  const t = teamOf(e.target_key);
  if (!t) return null;
  const year = /^elim:[^:]+:[^:]+:(\d{4})$/.exec(e.id)?.[1];
  return frame(stubbed({
    width: 1056, height: 456, rotate: 1.5, bg: 'linear-gradient(135deg, #D9D6CC, #C9C5B8)', fg: '#2A2824', stubBg: 'transparent', stubFg: '#2A2824', rule: '#8A867A',
    main: [small(`SEASON TICKET${year ? ` · ${year}` : ''}`), h('div', { flexDirection: 'column', gap: 12 }, big(t.shortName, fit(t.shortName, [72, 92, 112])), h('div', { fontSize: 34, fontWeight: 800 }, clip(e.body, 56))), small('GOOD FOR: NOTHING')],
    stub: [small('SEAT', { opacity: 1 }), big(t.abbrev, 72), small('SEE YOU NEXT YEAR')],
    over: [h('div', { position: 'absolute', left: 430, top: 56, border: '10px solid #C21F27', color: '#C21F27', fontSize: 100, fontWeight: 900, letterSpacing: 6, padding: '0 36px', borderRadius: 12, opacity: 0.88, transform: 'rotate(-14deg)', lineHeight: 1.1 }, 'VOID')],
  }));
}

/** An F1 driver who lost places, as a boarding pass from the grid slot to the finish. Both title forms carry "P<place> from P<grid>". */
function boarding(e: EventRow): El | null {
  if (e.type !== 'f1.driver.lost_places') return null;
  const m = /P(\d+) from P(\d+)/.exec(e.title), t = targetDto(e.target_key);
  if (!m || !t || t.kind !== 'player') return null;
  const [place, grid] = [m[1], m[2]];
  const field = (label: string, value: El) => h('div', { flexDirection: 'column', gap: 6 }, small(label, { color: '#5B616C' }), value);
  const bars = [...(e.id + e.id)].slice(0, 14).map((c, i) => h('div', { width: 3 + ((c.charCodeAt(0) + i) % 4) * 3, height: 130, flexShrink: 0, marginRight: 4 + (i % 3) * 2, backgroundColor: '#14161A' }));
  return frame(h('div', { width: 1080, height: 456, marginTop: 28, transform: 'rotate(-1.5deg)', flexDirection: 'column', backgroundColor: '#F4F5F7', color: '#14161A', borderRadius: 22, overflow: 'hidden' },
    h('div', { backgroundColor: '#E8002D', color: '#FFFFFF', justifyContent: 'space-between', alignItems: 'center', padding: '18px 48px', fontSize: 26, fontWeight: 800, letterSpacing: 3 }, h('div', {}, 'BOARDING PASS'), h('div', {}, leagueName(e).toUpperCase())),
    h('div', { flex: 1 },
      h('div', { flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: '30px 48px' },
        h('div', { gap: 56 }, field('FROM', big(`P${grid}`, 112)), field('TO', big(`P${place}`, 112))),
        field('PASSENGER', h('div', { fontSize: 44, fontWeight: 900 }, clip(t.name.toUpperCase(), 22))),
        field('REASON FOR DELAY', h('div', { fontSize: 32, fontWeight: 800 }, clip(e.body.replace(/^[:\s]+/, '') || plain(e.title), 64)))),
      h('div', { width: 270, borderLeft: '5px dashed #9AA0AA', alignItems: 'center', justifyContent: 'center' }, ...bars))));
}

/** An ejection or a penalty as a parking ticket. The violation is what the alert's title says, never ESPN's long play text. */
function citation(e: EventRow): El | null {
  const t = targetDto(e.target_key);
  if (!t) return null;
  let violation: string | undefined, fine = 'NO APPEALS';
  if (e.type === 'player.ejected') { violation = /\(([^)]+)\)/.exec(e.title)?.[1] ?? 'Ejection'; fine = 'REST OF THE NIGHT'; }
  else if (e.type === 'nba.technical') { const out = /ejected/i.test(e.title); violation = out ? 'Ejection' : 'Technical foul'; fine = out ? 'REST OF THE NIGHT' : 'ONE FREE THROW'; }
  else if (e.type === 'nfl.penalty' || e.type === 'cfb.team.penalty') violation = /was flagged: (.+)$/.exec(e.title)?.[1];
  if (!violation) return null;
  const score = /([A-Z]{2,4} \d+, [A-Z]{2,4} \d+)\s*$/.exec(e.body)?.[1];
  const teamName = t.kind === 'team' ? t.abbrev : t.teamName ?? leagueName(e);
  const cell = (label: string, value: string) => h('div', { width: 430, flexDirection: 'column', borderBottom: '3px solid rgba(42, 36, 0, 0.5)', paddingBottom: 6 }, small(label), h('div', { fontSize: 36, fontWeight: 900 }, clip(value, 24)));
  return frame(h('div', { width: 1008, height: 480, marginTop: 28, transform: 'rotate(2deg)', flexDirection: 'column', justifyContent: 'space-between', padding: '30px 44px', backgroundColor: '#F2D95C', color: '#2A2400', borderRadius: 10 },
    h('div', { justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '6px solid #2A2400', paddingBottom: 10, fontSize: 42, fontWeight: 900, letterSpacing: 4 }, h('div', {}, 'CITATION'), h('div', { fontSize: 26 }, `No. ${serial(e.id)}`)),
    h('div', { flexWrap: 'wrap', columnGap: 36, rowGap: 22 }, cell('VIOLATOR', t.name), cell('TEAM', teamName), cell('VIOLATION', violation), cell(score ? 'SCORE AT TIME' : 'LEAGUE', score ?? leagueName(e))),
    small(`PAY AT THE BOX · FINE: ${fine}`, { opacity: 0.9 })));
}

/** A loss as the favourite as a scratch-off: the win chance and both scores, none of them a match. */
function scratch(e: EventRow): El | null {
  if (e.type !== 'team.lost_as_favorite') return null;
  const m = metaOf(e), sc = finalScore(e), loser = teamOf(e.target_key), winner = teamOf(`team:${e.league}:${m.winnerId}`);
  if (!sc || !loser || !winner || !Number.isFinite(m.chance)) return null;
  const cell = (value: string, label: string) => h('div', { flex: 1, height: 190, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundImage: 'linear-gradient(135deg, #D9DCE0, #A9AEB5)', color: '#17171A', borderRadius: 14 }, big(value, 76), small(label, { fontSize: 18, marginTop: 8 }));
  return frame(h('div', { width: 1032, height: 504, marginTop: 28, transform: 'rotate(-2deg)', flexDirection: 'column', justifyContent: 'space-between', padding: '32px 44px', backgroundImage: 'linear-gradient(135deg, #1F7A4D, #145636)', color: '#FFFFFF', borderRadius: 24, border: '6px solid #F0C75E' },
    h('div', { justifyContent: 'space-between', alignItems: 'baseline' }, h('div', { fontSize: 44, fontWeight: 900, letterSpacing: 4 }, 'SCRATCH TO WIN'), small('MATCH 3 · UPSET', { color: '#F0C75E', opacity: 1 })),
    h('div', { gap: 20 }, cell(`${m.chance}%`, `${loser.abbrev} WIN CHANCE`), cell(String(sc.lose), `${loser.abbrev} SCORE`), cell(String(sc.win), `${winner.abbrev} SCORE`)),
    h('div', { justifyContent: 'center', fontSize: 40, fontWeight: 900, color: '#F0C75E' }, 'NO MATCH. BETTER LUCK NEXT TIME.')));
}

/** A blown lead as a ticket torn where the lead went. The score is printed only on the final alert. */
function torn(e: EventRow): El | null {
  if (e.type !== 'team.blew_lead') return null;
  const m = metaOf(e), t = teamOf(e.target_key);
  if (!t || !Number.isFinite(m.led)) return null;
  const sc = finalScore(e);
  // Pixels, not percentages: satori resolves a polygon's percentages against the wrong side.
  const zig = (edge: number, bite: number) => Array.from({ length: 13 }, (_, i) => `${i % 2 ? edge - bite : edge}px ${i * 36}px`);
  const left = [...zig(600, 24), '0px 432px', '0px 0px'].join(', '), right = ['0px 0px', '360px 0px', '360px 432px', ...zig(0, -24).reverse()].join(', ');
  return frame(h('div', { alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 28 },
    h('div', { transform: 'rotate(-3deg)' },
      h('div', { width: 600, height: 432, flexDirection: 'column', justifyContent: 'space-between', padding: '38px 70px 38px 40px', backgroundColor: '#E9EAEC', color: '#17171A', borderRadius: '20px 0 0 20px', clipPath: `polygon(${left})` },
        small(`${leagueName(e).toUpperCase()} TICKET`), h('div', { flexDirection: 'column', gap: 12 }, big(`Led by ${m.led}`, 84), h('div', { fontSize: 30, fontWeight: 700 }, clip(plain(e.title), 56))), small('ADMIT ONE'))),
    h('div', { transform: 'rotate(3deg) translateY(24px)' },
      h('div', { width: 360, height: 432, flexDirection: 'column', justifyContent: 'space-between', padding: '38px 36px 38px 52px', backgroundColor: '#C21F27', color: '#FFFFFF', borderRadius: '0 20px 20px 0', clipPath: `polygon(${right})` },
        small('THEN', { opacity: 1 }), big('BLEW IT', 84), small(sc ? `FINAL ${sc.lose}–${sc.win}` : 'LEAD GONE', { opacity: 1 })))));
}

// ─── The season card (season.ts): a device's whole run, not an alert, so not one of STYLES ──────────
export const SEASON_TYPE = 'app.season_card';

/** A team's (or fighter's) name, badge and colour: team colours and initials, as on the classic card. F1's short names are junk (Ferrari is "JK"), so a constructor is its full name. */
export function who(key: string) {
  const t = targetDto(key);
  const name = t?.kind === 'team' ? (key.split(':')[1] === 'f1' ? t.name : t.shortName) : t?.name ?? key;
  const c = color(t?.kind === 'team' ? t.color : t?.kind === 'player' ? t.teamColor : null);
  return { name, c, badge: t?.kind === 'team' ? t.abbrev : initials(name) };
}

/** A device's season as a stat sheet. It prints only the numbers season.ts stored in the meta (never a loss rating); null if they aren't all there. */
function seasonSheet(e: EventRow): El | null {
  const m = metaOf(e);
  if (!Number.isFinite(m.watches) || !Number.isFinite(m.alerts) || typeof m.range !== 'string') return null;
  const stat = (n: number, label: string, c: string) => h('div', { flexDirection: 'column', gap: 10 }, big(String(n), 136, { color: c }), small(label));
  const chip = (t: { key: string; n: number }) => {
    const w = who(t.key);
    return h('div', { alignItems: 'center', gap: 12, padding: '10px 22px 10px 10px', borderRadius: 40, backgroundColor: '#16161A', border: '2px solid #2A2A31' },
      h('div', { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: w.c, color: readableOn(w.c), fontSize: 17, fontWeight: 900 }, w.badge),
      h('div', { fontSize: 30, fontWeight: 800 }, clip(w.name, 16)),
      h('div', { fontSize: 30, fontWeight: 900, color: '#FF3B44' }, String(t.n)));
  };
  const teams: { key: string; n: number }[] = Array.isArray(m.teams) ? m.teams.slice(0, 3) : [];
  const most = typeof m.most?.key === 'string' ? who(m.most.key) : null;
  return frame(h('div', { width: 1080, flexDirection: 'column', gap: 26, marginTop: 40 },
    small(`MY SEASON IN MISERY · ${m.range.toUpperCase()}`, { color: '#FF3B44', opacity: 1 }),
    h('div', { gap: 96 }, stat(m.watches, m.watches === 1 ? 'SUCCESSFUL HATE WATCH' : 'SUCCESSFUL HATE WATCHES', '#FF3B44'), stat(m.alerts, m.alerts === 1 ? 'ALERT' : 'ALERTS', '#FAFAFA')),
    ...(teams.length ? [h('div', { gap: 16 }, ...teams.map(chip))] : []),
    ...(m.low ? [h('div', { flexDirection: 'column', gap: 6 }, small('LOW POINT'), h('div', { fontSize: 30, fontWeight: 800 }, clip(String(m.low), 80)))] : []),
    ...(most ? [small(`MOST ALERTS FROM ${most.name.toUpperCase()}`)] : [])));
}

// ─── Which styles apply, and their trees ──────────────────────────────────────────────────────────
const STYLES = {
  ticket: { label: 'Ticket stub', make: ticket },
  void: { label: 'Void', make: voided },
  boarding: { label: 'Boarding pass', make: boarding },
  citation: { label: 'Parking ticket', make: citation },
  scratch: { label: 'Scratch-off', make: scratch },
  torn: { label: 'Torn in half', make: torn },
} as const;
export type StyleId = 'classic' | keyof typeof STYLES;

/** The styles an alert can be shared in, the classic card first. Applying means the tree builds: what the rule accepts is what gets drawn. */
export function shareStyles(e: EventRow): { id: StyleId; label: string }[] {
  const out: { id: StyleId; label: string }[] = [{ id: 'classic', label: 'Classic' }];
  for (const [id, s] of Object.entries(STYLES)) if (s.make(e)) out.push({ id: id as StyleId, label: s.label });
  return out;
}

/** An alert's tree in a style, or null for classic and for a style that doesn't apply (the caller draws the classic card). A season card has the one look. */
export const styleTree = (id: string, e: EventRow): El | null =>
  (e.type === SEASON_TYPE ? seasonSheet(e) : id in STYLES ? STYLES[id as keyof typeof STYLES].make(e) : null);
