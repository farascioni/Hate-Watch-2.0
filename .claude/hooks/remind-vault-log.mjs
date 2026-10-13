#!/usr/bin/env node
// "Log every change" (CLAUDE.md "Read the docs first"): a PostToolUse hook on Bash (.claude/settings.json), which
// Claude Code runs only after a command that succeeded (a command that exits non-zero never reaches it). It watches for
// four things: a `git commit`, a server deploy (`fly deploy`, `flyctl deploy`), an app build or update (`eas build`,
// `eas update`, `eas submit`, with or without `npx`) and `npm run update`.
//  - A deploy, build or update is recorded by itself: one JSON line (time, kind, git HEAD, folder, command) appended to
//    ~/Documents/obsidian/hate-watch/.tools/events.jsonl, which build_vault.py renders under "Deploys and builds that
//    day (generated)" in that day's log note; the vault is then rebuilt in the background (sync.sh --force).
//  - Every one of the four also adds a note to the session's context saying what is still hand-written: the story
//    (what was decided, deployed and left to check) as a bullet in the day's `note('80 Log/<date>', ...)` call in
//    ~/Documents/obsidian/hate-watch/.tools/build_vault.py. A commit's own entry is generated from git once it is pushed.
// Only a command that is one of these is matched, not text that mentions one: quoted strings and heredoc bodies are
// dropped first, and each command in a chain (`;`, `&&`, `||`, `|`) is checked from its start. It never blocks.
// It is installed twice: in .claude/settings.json (this checkout, and any clone) and in the user settings
// (claude-config/settings.json, which install.sh copies to ~/.claude/settings.json), because a session in a git
// worktree reads the worktree's own copy of the project settings, which may predate this hook. A command that fires
// both is handled once (a marker per tool_use_id in the temp folder), and a command outside this project's folders
// (a path with hate watch or hate-watch in it) is ignored. On a machine without the vault, or with
// HW_LOG_REMINDER=off in the environment, it does nothing.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.HW_LOG_REMINDER === 'off') process.exit(0);
let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (input.tool_name !== 'Bash' || input.tool_response?.interrupted) process.exit(0);
// Only in this project's folders (the hook is also installed in the user settings, for the worktrees' sessions).
if (!/\/hate[ -]watch/.test(input.cwd || '')) process.exit(0);

const ENV = String.raw`(?:\w+=\S*\s+)*`;
const kinds = [
  ['commit', new RegExp(`^${ENV}git(?:\\s+-C\\s+\\S+|\\s+-c\\s+\\S+)*\\s+commit(?=\\s|$)`)],
  ['server deploy', new RegExp(`^${ENV}(?:flyctl|fly)\\s+deploy(?=\\s|$)`)],
  ['app build or update', new RegExp(`^${ENV}(?:npx\\s+(?:-y\\s+)?)?eas(?:-cli)?(?:@\\S+)?\\s+(?:build|update|submit)(?::rollback)?(?=\\s|$)`)],
  ['app update', new RegExp(`^${ENV}npm\\s+run\\s+update(?=\\s|$)`)],
];
// Drop heredoc bodies and quoted strings, then split the chain into its commands.
const plain = String(input.tool_input?.command ?? '')
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, '')
  .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
const found = plain.split(/[;&|\n]+/).map((s) => s.trim())
  .filter((s) => !/(?:^|\s)(?:--help|-h|--dry-run)(?=\s|$)/.test(s))
  .map((s) => [kinds.find(([, re]) => re.test(s))?.[0], s]).find(([k]) => k);
if (!found) process.exit(0);
const [kind, segment] = found;
// Installed in the project settings and the user settings, so one command can fire it twice: the first run wins.
if (input.tool_use_id) { try { closeSync(openSync(join(tmpdir(), `hw-log-${input.tool_use_id}`), 'wx')); } catch { process.exit(0); } }

const vault = join(homedir(), 'Documents/obsidian/hate-watch/.tools');
const script = join(vault, 'build_vault.py');
if (!existsSync(script)) process.exit(0);
const now = new Date();
const today = now.toLocaleDateString('en-CA'); // YYYY-MM-DD in this machine's time zone (Eastern on the Mac)
const hhmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

if (kind !== 'commit') {
  let head = '';
  try { head = execFileSync('git', ['-C', input.cwd || process.cwd(), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a repo */ }
  try {
    appendFileSync(join(vault, 'events.jsonl'), JSON.stringify({ ts: now.toISOString(), date: today, time: hhmm, kind, head, cwd: input.cwd || '', command: segment.slice(0, 240) }) + '\n');
    const sync = join(vault, 'sync.sh');
    if (existsSync(sync)) spawn(sync, ['--force'], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* the reminder below still goes out */ }
}

const written = readFileSync(script, 'utf8').includes(`note('80 Log/${today}'`);
const how = `in ${script}, then rebuild with ${vault}/sync.sh --force`;
const lead = kind === 'commit'
  ? `That commit is listed in the vault's log for ${today} by itself once it is pushed.`
  : `That ${kind} was recorded in the vault's log for ${today} ("Deploys and builds that day (generated)") and the vault is rebuilding.`;
const ask = written
  ? `Add the story to the note('80 Log/${today}', ...) call ${how}: what was decided, deployed and left to check (skip it if you already did for this change).`
  : `${today} has no hand-written entry yet: add a note('80 Log/${today}', ...) call ${how}, copying the previous day's call, with a bullet for this change: what was decided, deployed and left to check.`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `${lead} ${ask}` } }));
