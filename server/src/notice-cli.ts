// Developer notices from the shell (notices.ts): a message from Hate Watch in every install's feed, never a push.
//   node /app/src/notice-cli.ts                                 the latest notices
//   node /app/src/notice-cli.ts send "Title" "Body"             sends one to every install (--urgent: marked important;
//                                                               --dry-run: how many it would reach, sending nothing)
//   node /app/src/notice-cli.ts send --b64 <base64 of {"title","body","urgent"}>   the same, for text with quotes in it
//                                                               (fly ssh console -C passes it whole)
//   node /app/src/notice-cli.ts withdraw <id>                   takes one back out of every feed
// The running server shows a new notice in open apps within seconds. It opens the server's database: HW_DB if set,
// else the volume's (/data) when there is one, and says which.
import { existsSync } from 'node:fs';

process.env.HW_DB ??= existsSync('/data/hatewatch.db') ? '/data/hatewatch.db' : 'data/hatewatch.db';
const { db } = await import('./db.ts');
const { listNotices, sendNotice, withdrawNotice } = await import('./notices.ts');
type Notice = import('./notices.ts').Notice;

const devices = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n;
console.log(`database ${process.env.HW_DB} (${devices} devices)`);
const USAGE = 'usage: node /app/src/notice-cli.ts [send "Title" "Body" [--urgent] [--dry-run] | send --b64 <base64 JSON> [--dry-run] | withdraw <id>]';
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const [command, ...rest] = args;

if (command === 'send') {
  const urgent = flag('--urgent'), dryRun = flag('--dry-run');
  let notice: Notice;
  const b64 = args.indexOf('--b64');
  if (b64 >= 0) {
    let parsed: Notice | undefined;
    try { parsed = JSON.parse(Buffer.from(args[b64 + 1] ?? '', 'base64').toString('utf8')); } catch { /* reported below */ }
    if (!parsed || typeof parsed !== 'object') fail(`--b64 needs base64 of {"title","body","urgent"}\n${USAGE}`);
    notice = { ...parsed!, urgent: urgent || !!parsed!.urgent };
  } else {
    const [, title, body] = args;
    notice = { title, body, urgent };
  }
  try {
    const sent = sendNotice(notice, { dryRun });
    console.log(dryRun ? `would reach ${sent.devices} devices (nothing sent)` : `sent ${sent.id} to ${sent.devices} devices, feed only`);
    console.log(`${notice.urgent ? 'urgent ' : ''}"${notice.title.trim()}": ${notice.body.trim()}`);
  } catch (e) { fail(`${(e as Error).message}\n${USAGE}`); }
} else if (command === 'withdraw') {
  const [id] = rest;
  if (!id) fail(USAGE);
  const out = withdrawNotice(id);
  console.log(out.found ? `withdrew ${id} from ${out.feeds} feeds` : `no notice ${id}`);
} else if (command) {
  fail(USAGE);
} else {
  const list = listNotices();
  if (!list.length) console.log('no notices sent yet');
  for (const n of list) {
    const urgent = n.meta && JSON.parse(n.meta).urgent ? ' URGENT' : '';
    console.log(`${n.id}  ${new Date(n.at).toISOString().slice(0, 16)}Z  ${n.devices} feeds${urgent}  "${n.title}": ${n.body}`);
  }
}
