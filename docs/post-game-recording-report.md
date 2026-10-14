# Post game recording report: template and steps

## Index

**Summary:** the post game recording report is the one report every recorded game gets when it ends, in every sport: a private claude.ai Artifact with a card per finding, where the user picks Approve, Change or Skip and the choice is saved with the page. This doc is its template: the page (`template.html`), a builder that checks the data (`build-report.mjs`), a blank data file, the ALDS Game 5 data as a worked example, the steps to publish, and what each data field means. The files are in `docs/post-game-recording-report/`.

**Sections:**
- **When a report is owed**: every game recording, any sport, automatically when the game ends; what it is for.
- **The files**: the four files in `docs/post-game-recording-report/` and what each does.
- **Steps**: copy the data file, build the page, publish it, read the decisions, build only the approved ones.
- **The data file**: every field of `game`, `findings`, `right` and `method`, and what goes in it.
- **What the page shows**: header, tiles, filter chips, a card per finding, "What looked right", "How this was checked".
- **Rules**: private by default, no device ids or tokens, production reads, asking before commit, push or deploy.

The README's "The post game recording report" has the summary; this is the full detail. Read this index first, then only the part you need.

## When a report is owed

Every recorded game gets one, without being asked, when the recording ends (the user's rule of October 11, 2026), in every sport: MLB, NBA, NHL, NFL, college football, EPL, F1, UFC and any later league. Its findings are the bug list for that game, so it is how bugs are found and tracked across leagues. The session that owns the recording (`docs/working-in-this-repo.md`, "Naming a recording session") replays the recording through the real `GameTracker`, compares the replay with what production sent and with an independent count of the plays (`docs/tests.md`, "Recordings and replays"), and publishes the result. The first was the ALDS Game 5 report (13 findings, all approved and shipped as 214e7c0), https://claude.ai/artifact/YZDtjBsyVSgVEgVBcDwmmq. Call it the post game recording report everywhere (messages, briefs, artifact titles, notes); the old name was the "ALDS format".

## The files

All in `docs/post-game-recording-report/`; copy them, do not rebuild them.

| File | What it is |
|---|---|
| `template.html` | The whole page: styles, the cards, the Approve / Change / Skip buttons, saved decisions. Three placeholders: `__TITLE__`, `__EYEBROW__`, `__DATA__`. Nothing else to edit. |
| `build-report.mjs` | Fills the placeholders from a data file, and checks the data first: title and eyebrow wording, finding ids (`F1`, `F2`, each once) and severities, the required fields. |
| `data-skeleton.json` | A blank data file with every field and a note on what goes in it. Two findings show the two shapes: one with alerts sent and a before/after, one with nothing sent (a note). |
| `example-alds-game5.json` | The real data of the ALDS Game 5 report: 13 findings and a baseball line score. Copy a finding from it to see how a real one reads. |

The vault (`60 Testing/Post game recording report template/` on the Mac) keeps a private copy; the repo wins where they differ.

## Steps

1. **Copy** `data-skeleton.json` to your scratchpad and fill it in (the fields are below).
2. **Build** the page, from anywhere (the builder finds `template.html` beside itself):

```bash
node docs/post-game-recording-report/build-report.mjs <your data.json> "<Matchup> recording report" "Hate Watch · post game recording report · ESPN event <id>" <out.html>
```

   The page title is two to four words and ends in "recording report" (for example "ORL at CLE recording report"). The eyebrow starts "Hate Watch · post game recording report". The builder refuses a title or eyebrow that doesn't.
3. **Publish** it with the Artifact tool, as a new private artifact: `file_path` the built HTML, `icon` "chart" or similar, and `capabilities` `{"db":{},"user":{}}` (the page stores the decisions in its own database and asks who is viewing). Load the artifact-capabilities and artifact-design skills first, as the tool says. Give the user the link; it stays private until they share it.
4. **Read the decisions** before touching any code: ArtifactData with the artifact's `url`, action `list`, collection `decisions`. One document per finding id (`F1`, `F2`), shaped `{decision: "approve" | "change" | "skip" | null, note, at}`. Build only the approved ones, and follow a "change" note.
5. **After building**, ask before committing, pushing or deploying (`CLAUDE.md`, "Release flow").

## The data file

`game`:
- `title`: the matchup, as the page heading ("White Sox at Guardians, ALDS Game 5").
- `lede`: two or three sentences: what was checked (which feeds, how many test devices) and what production and the replay sent.
- `facts`: a list of `[label, value]` pairs: Final, who won or lost, "Production sent N alerts to N devices", "Replay N alerts, N pushes, N devices".
- the score table, one of these, or none (F1 and UFC have none):
  - `linescore`: `periods` (the column headings: innings, quarters, halves, periods), `totalLabel` ("T", or "R" for baseball), optional `extraLabels` (baseball: `["H", "E"]`), and `teams`: each `{abbr, points[], total, extras[], won}`.
  - `table`: `{head: [...], rows: [[...]], win: [row numbers to highlight]}`, for a results table (F1 order, UFC card).

`findings`: one object each, most important first. Ids run `F1`, `F2` and so on.
- `severity`: `high` (a wrong or missing alert people would notice), `medium` (wrong wording, extra pushes, delayed alerts), `low` (noise, small edge cases), `note` (no change proposed yet).
- `kind`: a few short tags ("Missing alert", "Wording", "Timing", "Merge", "Production").
- `title`: one sentence naming the bug.
- `sentLabel` and `sent[]`: the alert as it went out, drawn as a phone banner: `time` (Eastern), `title` and `body` exactly as sent, `who` got it, `pushed` (true, or false for feed only), and `lines` (silent lines added later). Use "(no alert)" as the title for something that should have been sent and wasn't. `sent` can be empty.
- `wrong[]` and `change[]`: paragraphs, in plain words.
- `ba[]`: before and after alert text for the proposed change (each `{before: {title, body}, after: {title, body}}`); leave it out when the change isn't about alert text.

`right[]`: what looked right, one line each (matches against the final feed, merges that worked, counts that matched an independent count). A report with only bugs hides what was tested.

`method[]`: how it was checked, one line each: the recording (feeds, cadence, window, file names), the replay (test devices and tracking choices), what it was compared with (production and dev server logs), and "Times are Eastern." Simple HTML such as `<code>` is allowed here.

## What the page shows

- **Header:** the eyebrow, the title, the lede, the game's score table, and the facts row.
- **Tiles:** counts of high, medium and low findings and how many are decided, then a "How to review" box with the save status, and filter chips.
- **A card per finding:** id, severity, kind tags and title; "As sent" (the alerts as phone banners: time in ET, who got it, pushed or feed only, later lines); "What's wrong"; "Proposed change"; Before / After alert text; Approve, Change and Skip buttons with a note, saved in the page's database.
- **Then** "What looked right" and "How this was checked".

It was tried on a baseball line score (ALDS Game 5), a basketball line score, a results table and no score table; each renders, and the builder refuses a wrong title or eyebrow.

## Rules

- A report is a private Artifact until the user shares it; publish it and give them the link, not a file.
- No device ids or push tokens in a report; alert counts and alert text are fine.
- A session that records a game may read production (`fly logs -a hate-watch-api`, read-only queries, `/health`, `fly status`, `fly releases`) to fill `facts` and `method`; anything that changes production still needs the user's OK for that action.
- Decisions come first: read the `decisions` collection before changing code, and build in a worktree with tests made from the game's plays.
