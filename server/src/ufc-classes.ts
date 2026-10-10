// The UFC's weight classes, and who heads each one, from ESPN's cards (scoreboards two years back and three
// months ahead) and its title fights (each fight's `types`, "UFC Lightweight Title"). Not ESPN's rankings: they
// are years out of date (October 2026: Figueiredo as flyweight champion). A fighter is in the class of their
// latest fight (a catch weight bout doesn't count); each class lists its champion, then an interim champion,
// then whoever has headlined and won the most lately. Search shows the top five of each (catalog.ts, api.ts).
// A belt that changes hands outside a fight (a champion retiring, vacating, stripped; another promoted) isn't
// in ESPN's fights, so a champion's claim ends at the next title fight without them, fought or scheduled.

/** The UFC's divisions, heaviest first, men's then women's: the order Search lists them in. */
export const WEIGHT_CLASSES = [
  'Heavyweight', 'Light Heavyweight', 'Middleweight', 'Welterweight', 'Lightweight', 'Featherweight', 'Bantamweight', 'Flyweight',
  "Women's Featherweight", "Women's Bantamweight", "Women's Flyweight", "Women's Strawweight",
];
/** Fighters listed under each class. */
export const TOP_PER_CLASS = 5;

/** ESPN's weight class as said: "W Flyweight" is "Women's Flyweight". */
export const weightName = (abbrev?: string | null) => (abbrev ? abbrev.replace(/^W /, "Women's ") : null);
/** A class someone fights in: not a catch weight or open weight bout. */
const divisionOf = (abbrev?: string | null) => { const w = weightName(abbrev); return w && !/catch|open/i.test(w) ? w : null; };
/** "UFC Interim Women's Flyweight Title": the class, and whether it's the interim belt. */
export function titleOf(text?: string | null): { weight: string; interim: boolean } | null {
  const m = text?.match(/^UFC (Interim )?(.+) Title$/);
  return m ? { weight: m[2], interim: !!m[1] } : null;
}

export interface CardFighter { name: string; short: string | null; weight: string | null; at: number }
export interface WeightClass { name: string; keys: string[] }
/** Who holds each class's belts (ESPN ids), for "lost the title" (ufc.ts). */
export type Belts = Record<string, { champion?: string; interim?: string }>;

const YEAR_MS = 365.25 * 86_400_000;
/** What a fight says about how much a fighter matters: a title fight most, then the main event, five rounds, the co-main, the main card, the prelims. */
const worth = (title: boolean, fromTop: number, fiveRounds: boolean) => (title ? 20 : fromTop === 0 ? 10 : fiveRounds ? 8 : fromTop === 1 ? 6 : fromTop <= 4 ? 3 : 1);

/**
 * Every fighter on these cards (not the Contender Series: they aren't signed) with the class of their latest
 * fight, and each class's fighters in order. `titles`: each fight's title, by ESPN fight id, where known
 * (a fight missing from it counts as no title fight). A fight scores by `worth`, half again for a win, halving
 * every year back; one scheduled scores in full; one called off scores nothing. A champion heads the class
 * of their belt while it's still the class they fight in (one who moved up isn't pulled back), until a title
 * fight in it without them; an interim champion comes next, until the next undisputed title fight. A no
 * contest or a draw in a title fight crowns nobody.
 */
export function rankFighters(boards: any[], titles: Record<string, string | null>, now: number, keyOf: (id: string) => string): { fighters: Map<string, CardFighter>; classes: WeightClass[]; belts: Belts } {
  const fighters = new Map<string, CardFighter & { score: number }>();
  const titleFights: { weight: string; interim: boolean; at: number; done: boolean; ids: string[]; winner?: string }[] = [];
  const events = new Map<string, any>();
  for (const ev of boards.flatMap((b: any) => b.events ?? [])) events.set(String(ev.id ?? events.size), ev); // months overlap at the edges
  for (const ev of events.values()) {
    if (/contender series/i.test(String(ev.name ?? ''))) continue;
    const fights: any[] = ev.competitions ?? [];
    fights.forEach((c, i) => {
      const at = Date.parse(c.date ?? ev.date ?? '') || 0;
      const off = /cancel|postpon/i.test(String(c.status?.type?.name ?? ''));
      const title = titleOf(titles[String(c.id)]);
      if (title && !off) {
        const done = !!c.status?.type?.completed, winner = done ? (c.competitors ?? []).find((x: any) => x.winner === true) : undefined;
        titleFights.push({ ...title, at, done, ids: (c.competitors ?? []).map((x: any) => String(x.id)), ...(winner ? { winner: String(winner.id) } : {}) });
      }
      const points = off ? 0 : worth(!!title, fights.length - 1 - i, Number(c.format?.regulation?.periods) === 5) * (at > now ? 1 : 0.5 ** ((now - at) / YEAR_MS));
      for (const x of c.competitors ?? []) {
        const id = String(x.id ?? x.athlete?.id ?? '');
        if (!id || !x.athlete?.displayName) continue;
        const f = fighters.get(id) ?? { name: x.athlete.displayName, short: x.athlete.shortName ?? null, weight: null, at: -1, score: 0 };
        f.score += points * (x.winner === true ? 1.5 : 1);
        const weight = off ? null : divisionOf(c.type?.abbreviation);
        if (weight && at > f.at) Object.assign(f, { weight, at, name: x.athlete.displayName, short: x.athlete.shortName ?? f.short });
        fighters.set(id, f);
      }
    });
  }
  const belts = new Map<string, string>(), interims = new Map<string, string>();
  for (const w of new Set(titleFights.map((t) => t.weight))) {
    const fights = titleFights.filter((t) => t.weight === w).sort((a, b) => b.at - a.at);
    const won = fights.find((t) => !t.interim && t.winner), interim = fights.find((t) => t.interim && t.winner);
    if (won && !fights.some((t) => !t.interim && t.at > won.at && !t.ids.includes(won.winner!))) belts.set(w, won.winner!);
    if (interim && !fights.some((t) => !t.interim && t.done && t.at > interim.at)) interims.set(w, interim.winner!);
  }
  const rank = (id: string, w: string) => (belts.get(w) === id ? 2 : interims.get(w) === id ? 1 : 0);
  const byClass = new Map<string, string[]>();
  for (const [id, f] of fighters) if (f.weight) byClass.set(f.weight, [...(byClass.get(f.weight) ?? []), id]);
  const order = (w: string) => { const i = WEIGHT_CLASSES.indexOf(w); return i < 0 ? WEIGHT_CLASSES.length : i; };
  const classes = [...byClass].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)).map(([name, ids]) => ({
    name,
    keys: ids.sort((a, b) => rank(b, name) - rank(a, name) || fighters.get(b)!.score - fighters.get(a)!.score || fighters.get(a)!.name.localeCompare(fighters.get(b)!.name))
      .slice(0, TOP_PER_CLASS).map(keyOf),
  }));
  const held: Belts = {};
  for (const [w, id] of belts) held[w] = { ...held[w], champion: id };
  for (const [w, id] of interims) held[w] = { ...held[w], interim: id };
  return { fighters: new Map([...fighters].map(([id, { score: _, ...f }]) => [id, f])), classes, belts: held };
}

/** The five-round fights on these cards (title fights always are), by event: the ones whose `types` say if it's a title fight. */
export function fiveRoundFights(boards: any[]): { eventId: string; fightId: string; done: boolean }[] {
  const out = new Map<string, { eventId: string; fightId: string; done: boolean }>();
  for (const ev of boards.flatMap((b: any) => b.events ?? [])) {
    if (/contender series/i.test(String(ev.name ?? ''))) continue;
    for (const c of ev.competitions ?? []) if (Number(c.format?.regulation?.periods) === 5) out.set(String(c.id), { eventId: String(ev.id), fightId: String(c.id), done: !!c.status?.type?.completed });
  }
  return [...out.values()];
}
