// Runs the F1 alert logic on a real, finished race weekend (the same code path the live engine uses
// when a session completes) and checks the results against ESPN's own classification.
// Usage: node test/f1-replay.ts [eventId] (defaults to the current/most recent weekend)
import { loadCatalog, catalog } from '../src/catalog.ts';
import { getJson } from '../src/espn.ts';
import { urls } from '../src/leagues.ts';
import { fetchSessionRows, f1SessionResults, sessionKind } from '../src/f1.ts';

loadCatalog();
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
const sb = await getJson(urls.scoreboard('f1'));
const ev = process.argv[2] ? sb.events.find((e: any) => e.id === process.argv[2]) : sb.events[0];
console.log(`${ev.name} (${ev.shortName})`);

for (const comp of ev.competitions) {
  const kind = sessionKind(comp);
  if (!kind || !comp.status?.type?.completed) continue;
  const rows = await fetchSessionRows(String(ev.id), String(comp.id), kind !== 'qual');
  const events = f1SessionResults({ compId: String(comp.id), kind, label: `${ev.shortName} · ${comp.type.text ?? comp.type.abbreviation}`, at: Date.now() }, rows);
  console.log(`\n== ${comp.type.abbreviation}: ${rows.length} cars → ${events.length} alerts`);
  for (const e of events) console.log(`  [${e.type}${e.aliases ? ` +${e.aliases.join('+')}` : ''}] ${e.title}`);

  check(`${comp.type.abbreviation}: every car is mapped to a constructor`, rows.every((r) => r.teamKey));
  check(`${comp.type.abbreviation}: no duplicate alert ids`, new Set(events.map((e) => e.id)).size === events.length);
  check(`${comp.type.abbreviation}: at most one alert per driver`, (() => { const k = events.filter((e) => e.targetKey.startsWith('player:')).map((e) => e.targetKey); return new Set(k).size === k.length; })());
  if (kind === 'qual') {
    check('qualifying: exactly the cars outside the top 10 get a knockout alert', events.length === rows.filter((r) => r.order > 10).length);
  } else {
    const outs = rows.filter((r) => r.out);
    check(`race: one DNF alert per car that didn't finish (${outs.length})`, events.filter((e) => e.type === 'f1.driver.dnf').length === outs.length);
    check('race: grid positions are real (all 1..N, unique)', new Set(rows.map((r) => r.grid)).size === rows.length && rows.every((r) => r.grid >= 1 && r.grid <= rows.length));
    const winner = rows.find((r) => r.order === 1)!;
    console.log(`  winner ${catalog.playerByEspn('f1', winner.id)?.name} from grid P${winner.grid}`);
  }
}
