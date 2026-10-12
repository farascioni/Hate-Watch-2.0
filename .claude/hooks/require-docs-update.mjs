#!/usr/bin/env node
// "Keep the docs current" (CLAUDE.md "Read the docs first"): a PreToolUse hook on Bash (.claude/settings.json) that
// checks a `git commit` before it runs. Two rules:
//  1. A commit that changes code (app/ or server/ sources and scripts, the Claude hooks and settings, claude-config/)
//     also changes the docs that describe it (README.md, CLAUDE.md, docs/**/*.md, a NOTES.md), or its message says
//     why not in a "Docs-unchanged: <reason>" line. PATCH_NOTES.md alone isn't the docs: it's the release log.
//  2. The docs it commits keep the format: README.md, CLAUDE.md and every docs/*.md open with an index ("## Index" as
//     the first "##" heading, every "##" heading named in it), and every README "##"/"###" section opens with a
//     paragraph that starts "**In short:**".
// It blocks (exit 2, the reason fed back to the agent) and changes nothing. Merge commits pass (MERGE_HEAD), and so
// does anything that isn't a commit. Off for an emergency: HW_DOCS_GATE=off.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

if (process.env.HW_DOCS_GATE === 'off') process.exit(0);
let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (input.tool_name !== 'Bash') process.exit(0);
const cmd = String(input.tool_input?.command ?? '');
// `git commit` or `git -C <dir> commit` (options before the subcommand allowed).
const m = cmd.match(/\bgit((?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+)|\s+-c\s+\S+)*)\s+commit\b/);
if (!m) process.exit(0);

const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2');
const cwd = input.cwd || process.cwd();
const dirArg = m[1].match(/-C\s+("[^"]*"|'[^']*'|\S+)/);
const dir = dirArg ? (isAbsolute(unquote(dirArg[1])) ? unquote(dirArg[1]) : resolve(cwd, unquote(dirArg[1]))) : cwd;
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let top;
try { top = git('rev-parse', '--show-toplevel').trim(); } catch { process.exit(0); } // not a repo: not ours to check
let gitDir;
try { gitDir = git('rev-parse', '--absolute-git-dir').trim(); } catch { gitDir = join(top, '.git'); }
if (existsSync(join(gitDir, 'MERGE_HEAD'))) process.exit(0); // a merge: both sides were checked when they were committed

const rest = cmd.slice(m.index + m[0].length);
const all = /(?:^|\s)(?:--all|-[a-zA-Z]*a[a-zA-Z]*)(?=\s|$)/.test(rest.split(/<<|[|;&]/)[0]);
const list = (args) => git(...args).split('\n').filter(Boolean);
const files = [...new Set([...list(['diff', '--cached', '--name-only', '--diff-filter=ACMR']), ...(all ? list(['diff', '--name-only', '--diff-filter=ACMR']) : [])])];
const removed = [...new Set([...list(['diff', '--cached', '--name-only', '--diff-filter=D']), ...(all ? list(['diff', '--name-only', '--diff-filter=D']) : [])])];
if (!files.length && !removed.length) process.exit(0);

const CODE = /^(?:(?:app|server)\/(?:src|scripts)\/|\.claude\/hooks\/|\.claude\/settings\.json$|claude-config\/)/;
const DOCS = /^(?:README\.md|CLAUDE\.md|docs\/.+\.md|(?:.+\/)?NOTES\.md)$/;
const code = [...files, ...removed].filter((f) => CODE.test(f) && !/\/node_modules\//.test(f));
const docs = files.filter((f) => DOCS.test(f));

// The commit message: -m/--message texts, a -F/--file file, or a heredoc in the command (-F -).
let message = [...rest.matchAll(/(?:-m|--message)(?:\s+|=)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g)].map((x) => unquote(x[1])).join('\n');
const fileArg = rest.match(/(?:-F|--file)(?:\s+|=)("[^"]*"|'[^']*'|\S+)/);
if (fileArg && unquote(fileArg[1]) !== '-') { try { message += '\n' + readFileSync(resolve(dir, unquote(fileArg[1])), 'utf8'); } catch {} }
if (/<</.test(rest)) message += '\n' + rest; // a heredoc's text is in the command itself
const excused = /^\s*Docs-unchanged:\s*\S/m.test(message);

const problems = [];
if (code.length && !docs.length && !excused) {
  problems.push(`It changes code (${code.slice(0, 4).join(', ')}${code.length > 4 ? `, and ${code.length - 4} more` : ''}) but no docs.`
    + ' Update the docs that describe it in this commit (the README section, docs/*.md, CLAUDE.md, a NOTES.md; and the module\'s header comment),'
    + ' or, if nothing documented changed, add a line "Docs-unchanged: <why>" to the commit message.');
}

// The format of each doc being committed, as it's staged (or on disk, with -a). Headings inside code blocks don't count.
const staged = (f) => { try { return all ? readFileSync(join(top, f), 'utf8') : git('show', `:${f}`); } catch { return null; } };
const outsideFences = (text) => text.replace(/^```[\s\S]*?^```/gm, '');
const names = (hs) => hs.slice(0, 5).map((h) => `"${h}"`).join(', ') + (hs.length > 5 ? ` and ${hs.length - 5} more` : '');
for (const f of docs.filter((d) => /^(?:README\.md|CLAUDE\.md|docs\/.+\.md)$/.test(d))) {
  const text = staged(f);
  if (text == null) continue;
  const body = outsideFences(text);
  const h2 = [...body.matchAll(/^## (.+?)\s*$/gm)].map((x) => x[1]);
  if (h2[0] !== 'Index') { problems.push(`${f}: its first "##" heading must be "## Index" (a summary, then every section with one line), before the content.`); continue; }
  const after = body.slice(body.search(/^## Index\s*$/m) + '## Index'.length);
  const end = after.search(/^## /m);
  const idx = (end < 0 ? after : after.slice(0, end)).replace(/[`*]/g, '');
  const missing = h2.slice(1).filter((h) => !idx.includes(h.replace(/[`*]/g, '')));
  if (missing.length) problems.push(`${f}: its "## Index" doesn't name ${names(missing)}. Every "##" section is listed there with one line.`);
  if (f === 'README.md') {
    const secs = [...body.matchAll(/^(#{2,3}) (.+?)\s*$/gm)];
    const bare = secs.filter((s, i) => s[2] !== 'Index'
      && !body.slice(s.index + s[0].length, i + 1 < secs.length ? secs[i + 1].index : body.length).trim().startsWith('**In short:**')).map((s) => s[2]);
    if (bare.length) problems.push(`README.md: these sections don't open with a "**In short:**" paragraph: ${names(bare)}.`);
  }
}

if (!problems.length) process.exit(0);
process.stderr.write([
  'Keep the docs current (CLAUDE.md "Read the docs first"): this commit was stopped.',
  ...problems.map((p) => `- ${p}`),
  'Every document opens with an index and has the full detail below it; every change updates the docs that describe it, in the same commit.',
  'Fix it, stage it, and commit again.',
].join('\n') + '\n');
process.exit(2);
