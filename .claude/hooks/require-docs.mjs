#!/usr/bin/env node
// "Read the docs first" (CLAUDE.md): before an agent's first edit to the app's or the server's code in a session,
// it must have read the documentation for it: README.md, docs/, app/AGENTS.md (Expo's versioned docs), a folder's
// NOTES.md, or the Hate Watch Obsidian vault. A PreToolUse hook (.claude/settings.json) on
// file edits and on shell commands that write to code (a python or sed rewrite, a redirect, cp or mv onto it; read-
// only commands like grep, sed -n or cat always pass): it looks through the session's transcript for such a read
// and blocks the edit (exit 2, the reason
// fed back to the agent) until there is one, naming the docs for the file being edited. Once a session has read
// them it's remembered (a marker in the temp folder), so later edits aren't checked again.
// Off for an emergency: HW_DOCS_GATE=off.
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.HW_DOCS_GATE === 'off') process.exit(0);

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); } // not a hook payload: nothing to check
// The code: app/ and server/ sources, tests and scripts (in the checkout or a worktree), not data or packages.
const CODE_PATH = /(?:app|server)\/(?:src|test|scripts)\/[^\s'"`;|&)]+/;
// A shell command that writes to a code file: it names one (a full path, or a relative src/ or test/ file after a
// cd) and writes (a python or node write, an in-place sed or perl, a redirect, tee, cp or mv, a patch).
const SHELL_CODE = /(?:app|server)\/(?:src|test|scripts)\/[^\s'"`;|&)]+|(?:^|[\s'"=(])(?:src|test)\/[\w./[\]()-]+\.(?:tsx?|mjs|js)\b/;
const SHELL_WRITES = /open\([^)]*['"][wa]\+?['"]|\.write\(|write_text\(|writeFileSync|\bsed\s+(?:-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-z]*i|\btee\b|(?:^|\s)\d?>{1,2}\s*[^&\s|]|\b(?:cp|mv)\s|\bgit\s+apply\b|\bpatch\s/;
let file;
if (input.tool_name === 'Bash') {
  const cmd = String(input.tool_input?.command ?? '').replace(/\d?>{1,2}\s*\/dev\/null|\d?>&\d/g, ''); // not writes
  if (!SHELL_WRITES.test(cmd)) process.exit(0);
  const m = cmd.match(SHELL_CODE);
  if (!m || /node_modules/.test(m[0])) process.exit(0);
  file = m[0].trim().replace(/^['"=(]/, '');
} else {
  file = String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '').replace(/\\/g, '/');
  if (!CODE_PATH.test(file) || /\/node_modules\//.test(file)) process.exit(0);
}

const marker = join(tmpdir(), `hw-docs-read-${String(input.session_id ?? 'none').replace(/[^\w-]/g, '')}`);
if (existsSync(marker)) process.exit(0);

// A read of the docs: a tool call whose input names one (the Read tool, grep or sed or cat in a shell, the
// Obsidian CLI), or any call to an Obsidian MCP tool.
const DOCS = /"type":"tool_use","id":"[^"]*","name":"(Read|Bash|Grep|Glob)","input":\{[^\n]*?(README\.md|\/docs\/[^"\s]+\.md|AGENTS\.md|\/[\w-]+\/NOTES\.md|obsidian\/hate-watch|vault=hate-watch)/;
const OBSIDIAN_MCP = /"type":"tool_use","id":"[^"]*","name":"mcp__[^"]*obsidian[^"]*"/;
async function readDocs(path) {
  if (!path || !existsSync(path)) return false;
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"tool_use"')) continue;
    if (DOCS.test(line) || OBSIDIAN_MCP.test(line)) { lines.close(); return true; }
  }
  return false;
}
const transcripts = [input.transcript_path, input.agent_transcript_path].filter(Boolean);
for (const t of transcripts) {
  if (await readDocs(t)) { try { writeFileSync(marker, ''); } catch {} process.exit(0); }
}
if (!transcripts.some((t) => existsSync(t))) process.exit(0); // no transcript to check: don't block blind

// Which docs, for this file: its README sections and vault notes (CLAUDE.md "Read the docs first" has the full map).
const AREAS = [
  [/f1|RaceOrder|F1Preview/i, 'README "Notifications" → "F1 drivers" / "F1 how", and "Scores tab"; vault "Formula 1"'],
  [/ufc|UfcCard/i, 'vault "UFC" (the README has no UFC section); PATCH_NOTES.md "UFC"'],
  [/revisions/i, 'README "Real-time" → "Football plays ESPN changes"; vault "Football play revisions"'],
  [/cfb/i, 'vault "College football"; README "Real-time" → "Football plays ESPN changes"'],
  [/detectors|live\.ts|boxscore|highlights|clips/i, 'README "Notifications" (the league\'s rows) and "Real-time"; vault: the league\'s note and "Live engine and game tracker"'],
  [/fanout|event-types|push\.ts|settings\.tsx|alerts\/\[key\]|SettingRow/i, 'README "Notifications" → "Defaults for new installs" and the Settings list ("How a push is decided"); vault "Publish and delivery", "Settings and alert defaults"'],
  [/notice/i, 'README "Developer notices"; vault "Developer notices"'],
  [/scores|GameCard|UpNextRow|upnext|game\/\[key\]/i, 'README "Scores tab"; vault "Scores tab", "Game screen"'],
  [/share|a\/\[code\]/i, 'README "Sharing an alert"'],
  [/leaderboard/i, 'README "Leaderboard"'],
  [/stats|StatsView/i, 'README "Stats pages"'],
  [/hate-watches|recap|HateWatchCounter/i, 'README "Successful Hate Watch counter"'],
  [/catalog|images|divisions|ingest/i, 'README "Data: rosters, duplicates, and images"; vault "Catalog, rosters and images"'],
  [/leagues\.ts|leagueUi|FilterBar|LeagueSheet|search\.tsx/i, 'README "The league filter" and "Adding a soccer league"; CLAUDE.md on how the app shows each league'],
  [/guide/i, 'README "Startup guide"'],
  [/alert\/\[id\]|FeedCard|alerts\.ts/i, 'README "An alert on its own screen"'],
  [/flags|flag-cli/i, 'CLAUDE.md "Server switches"; vault "Feature switches"'],
  [/news\.ts/i, 'README "Notifications" → "Off-field trouble / Fined or suspended"'],
  [/tips|Donate|TipJar/i, 'README "Donations (in-app tips)"'],
];
const hits = AREAS.filter(([re]) => re.test(file)).map(([, d]) => `  - ${d}`);
const app = /\/app\//.test(file) ? ['  - app/AGENTS.md: Expo changes every SDK, so read the versioned docs for any Expo or React Native API you touch'] : [];
process.stderr.write([
  `Read the docs first (CLAUDE.md): no documentation has been read in this session, and this ${input.tool_name === 'Bash' ? 'command writes to' : 'edits'} ${file.replace(/^.*?\/(app|server)\//, '$1/')}.`,
  'Before changing code, read what the docs say about it:',
  ...(hits.length ? hits : ['  - README.md: the section for this area (its headings are the map)']),
  ...app,
  '  - The Hate Watch Obsidian vault (~/Documents/obsidian/hate-watch on the Mac): Home.md is the map',
  'Then retry the edit.',
].join('\n') + '\n');
process.exit(2);
