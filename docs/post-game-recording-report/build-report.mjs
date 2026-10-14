// Fills the post game recording report template for one game, and checks the data first.
// Usage: node build-report.mjs <data.json> <page title> <eyebrow> <out.html>
//   page title: 2 to 4 words ending in "recording report", e.g. "ORL at CLE recording report"
//   eyebrow:    "Hate Watch · post game recording report · ESPN event <id>"
// data.json: see data-skeleton.json beside this file (the field list is in docs/post-game-recording-report.md).
import { readFileSync, writeFileSync } from 'node:fs';

const [dataPath, title, eyebrow, out] = process.argv.slice(2);
if (!out) { console.error('usage: node build-report.mjs <data.json> <page title> <eyebrow> <out.html>'); process.exit(1); }
const tpl = readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };
need(/recording report$/i.test(title), 'page title should end in "recording report"');
need(/post game recording report/i.test(eyebrow), 'eyebrow should say "post game recording report"');
const g = data.game ?? {};
need(g.title && g.lede && Array.isArray(g.facts), 'game needs title, lede and facts');
const SEV = ['high', 'medium', 'low', 'note'];
const ids = new Set();
for (const f of data.findings ?? []) {
  need(/^F\d+$/.test(f.id ?? ''), `finding id "${f.id}" should look like F1`);
  need(!ids.has(f.id), `duplicate finding id ${f.id}`); ids.add(f.id);
  need(SEV.includes(f.severity), `${f.id}: severity must be one of ${SEV.join(', ')}`);
  need(Array.isArray(f.kind) && f.title && Array.isArray(f.wrong), `${f.id}: needs kind[], title and wrong[]`);
  need(Array.isArray(f.change), `${f.id}: needs change[]`);
  for (const s of f.sent ?? []) need(s.time && s.title, `${f.id}: every "sent" banner needs time and title`);
}
need(Array.isArray(data.right) && Array.isArray(data.method), 'needs right[] ("What looked right") and method[] ("How this was checked")');
if (problems.length) { console.error('Not built:\n- ' + problems.join('\n- ')); process.exit(1); }

const json = JSON.stringify(data).replace(/</g, '\\u003c'); // safe inside <script>
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
writeFileSync(out, tpl.replace('__TITLE__', esc(title)).replace('__EYEBROW__', esc(eyebrow)).replace('__DATA__', () => json));
console.log(`${out}: ${data.findings.length} findings, ${(readFileSync(out).length / 1024).toFixed(0)} KB`);
