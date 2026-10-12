# Models, advisor and subagents

## Models and cost
Every call re-reads the whole conversation, so cost grows with the model, the session's length and its context.
- Main sessions run on Sonnet (`"model": "sonnet"` in settings; the app's model picker overrides it, so pick Sonnet
  there too). Opus is for the advisor only.
- Side sessions you start (`start_session`): pass `model` Sonnet, or Haiku for read-only or mechanical work. Never Opus.
- One task per session. When the context passes about 40%, compact or hand the rest to a fresh session.
- Read a long doc's index first, then only the sections you need (the Read tool's offset and limit).

## Advisor checkpoints
The advisor (Opus) reads the whole conversation when you call the advisor tool, so each call costs as much as the
session's context. Call it:
- Before finalizing a plan that changes the structure of more than one file: new modules, moved
  responsibilities, new data flow, schema or API changes. Apply its guidance, or say why not.
- When the same test or compiler error fails a second time after a fix attempt. Stop and consult
  it before a third attempt.
- Before declaring a code change complete or committing it. Ask it to audit the diff against the
  task: every requirement met, nothing out of scope changed, tests cover the change, no debug
  leftovers. Fix what it finds, or say what you're leaving and why.
Skip it for docs-only or config-only changes, one-file fixes, questions and other quick work.

## Subagents
Use `code-scout` and `docs-scout` (Haiku, read-only) for parallel file discovery and documentation
lookup, at most 3 at once. They report back and never edit. Keep plans, edits and decisions in the
main session.
