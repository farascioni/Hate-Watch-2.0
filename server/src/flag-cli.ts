// Server switches from the shell (flags.ts): `node /app/src/flag-cli.ts` lists them, `node /app/src/flag-cli.ts
// clips.feed off` turns one off (on to turn it back on); the "savings.*" ones are the opposite, off until turned
// on (`savings.injuries on`). The running server sees it within seconds. It opens
// the server's database: HW_DB if set, else the volume's (/data) when there is one, and says which.
import { existsSync } from 'node:fs';

process.env.HW_DB ??= existsSync('/data/hatewatch.db') ? '/data/hatewatch.db' : 'data/hatewatch.db';
const { db } = await import('./db.ts');
const { FLAGS, SAVINGS, flagList, savingList, setFlag, setSaving } = await import('./flags.ts');
type Flag = keyof typeof FLAGS;
type Saving = keyof typeof SAVINGS;

const devices = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n;
console.log(`database ${process.env.HW_DB} (${devices} devices)`);
const [flag, value] = process.argv.slice(2);
if (flag) {
  if (!(flag in FLAGS || flag in SAVINGS) || !['on', 'off'].includes(value ?? '')) {
    console.error(`usage: node /app/src/flag-cli.ts [${[...Object.keys(FLAGS), ...Object.keys(SAVINGS)].join(' | ')} on|off]`);
    process.exit(1);
  }
  if (flag in SAVINGS) setSaving(flag as Saving, value === 'on'); else setFlag(flag as Flag, value === 'on');
}
for (const f of flagList()) console.log(`${f.on ? 'on ' : 'OFF'}  ${f.flag.padEnd(26)} ${f.about}`);
console.log('\nSavings (read ESPN less; each off until turned on):');
for (const s of savingList()) console.log(`${s.on ? 'on ' : 'off'}  ${s.saving.padEnd(26)} ${s.about}`);
