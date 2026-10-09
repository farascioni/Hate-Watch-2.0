# Hate Watch: working notes for Claude

The app is in `app/` (Expo, see `app/CLAUDE.md` and `app/AGENTS.md`), the server in `server/` (Node, SQLite, Fly.io). `README.md` explains how everything works.

## Release flow
- After a change is built and tested, ask before you commit, push or deploy, every time. Don't do any of them unasked. The user wants a say before anything goes public or live, and Apple sign-in is theirs to do.
- Server: deploy from `server/` with `flyctl deploy --remote-only` (or `fly deploy --remote-only`). The app `hate-watch-api` runs on one machine with its SQLite database on a volume at `/data`. Before anything that changes production data, back it up with SQLite's `VACUUM INTO` into `/data`.
- Server switches (`server/src/flags.ts`) turn off what leans on someone else's rights or service without a build: ESPN's video clips, `clips` (all), `clips.highlights`, `clips.feed`, `clips.loss`; and its player photos and team logos, `images` (both), `images.headshots`, `images.logos` (every build then shows a badge in the team's colour with its code instead, `server/src/images.ts`). List or flip one, live within seconds: `fly ssh console -a hate-watch-api -C "node /app/src/flag-cli.ts clips.feed off"` (`on` to undo; it prints the database it opened, which should be `/data/hatewatch.db`). Apps drop a switched-off clip the next time they load the feed (opening the app, reconnecting, pull to refresh). To keep one off for good, `fly secrets set -a hate-watch-api HW_FLAGS_OFF=clips.feed` (restarts the app).
- App: changes reach people only in a new EAS build. Send one to TestFlight only when asked, from `app/`:
  `npx eas-cli@latest build --platform ios --profile production --auto-submit --non-interactive --no-wait`.
  `eas.json` has the App Store Connect app id and EAS stores the certificates, profile and API key, so it runs without an Apple login. The optional "TestFlight group setup" step needs one and is skipped, which is harmless. New entitlements would need an interactive build by the user.
- Before a build: a clean git tree, `npx tsc --noEmit` in `app/`, and the lockfile check below.
- EAS's free tier can queue a submission for about 2 hours, one at a time per account. If Apple returns a 500 on "Creating Build Upload", resubmit with `npx eas-cli@latest submit --platform ios --id <buildId>`; don't rebuild. Progress: `eas build:view <id> --json` (its log files carry `"phase"` steps; RUN_FASTLANE is the Xcode compile) and `eas status --json`.

## Don't run `npx expo lint` in app/
ESLint isn't set up, so `expo lint` installs it and rewrites `package-lock.json`. Local npm 11 accepts that, but EAS Build's `npm ci` (npm 10) rejects it, which failed iOS build 3. EAS uploads uncommitted changes too, so it gets into a build unnoticed. Typecheck with `npx tsc --noEmit` only. Before an EAS build, check the lockfile with `npx -y npm@10.9.8 ci --ignore-scripts --dry-run` on a copy of `package.json` and `package-lock.json`. On a fresh clone, install with `npm ci`, not `npm install`, so the lockfile isn't rewritten.

## Patch notes
Keep `PATCH_NOTES.md` up to date with every shipped change, server changes too (marked "(Server)"), under "Next build". When a TestFlight build is sent, rename that heading to the build number and date and start a new "Next build" above it; `eas build:list --json` gives each build's git commit. Each build's section is pasted as is into TestFlight's "What to Test", so it must be **under 4,000 characters** and **use no emoji**. Update it in the same change as the code, and check each section's length and that it has no emoji (a `\p{Extended_Pictographic}` regex) before committing.

## Fantasy Sweat
A sibling app, Fantasy Sweat (live fantasy-football matchup alerts for Sleeper leagues, freemium with a Pro subscription), is a separate git repo next to this one (`projects/fantasy-sweat`). It reuses this stack: an Expo SDK 57 app, a Node and SQLite server on Fly, anonymous device tokens, Expo push and expo-iap. When you change a shared pattern (push, auth, the store, the settings UI), say that the other app may need the same change. Its dev server uses port 8788; Hate Watch's uses 8787. Its placeholder contact emails (`support@example.com`) still need real values before release, and Pro status is reported by the app, so server-side receipt checking is still to do.

## Two machines (Windows and Mac)
Both machines work from this repo, and neither needs the other turned on. Production runs on Fly and builds run on EAS.
- On a new machine, or after a `git pull`: `bash claude-config/install.sh` sets Claude Code's user settings, this file's notes and the two scouts to the repo's copies. Anything it replaces is kept beside it as `<name>.before-<time>`. Then `npm ci` in `app/` and in `server/`.
- Logins, once per machine: Claude Code itself, `npx eas-cli@latest login`, `fly auth login`, and GitHub for `git push`. GitHub takes a personal access token (classic, `repo` scope, from github.com/settings/tokens), not the account password: run `git push` in a terminal, give the username `farascioni` and paste the token as the password, and the keychain or credential manager keeps it.
- Not in git, so each machine keeps its own: `.claude/settings.local.json`, `app/.expo/`, `server/data/` (the dev database, which the server rebuilds from ESPN on first start), and Claude's memory under `~/.claude/projects/`. This file is the shared copy of the notes that matter.
