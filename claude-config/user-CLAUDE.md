# Advisor and subagents

## Advisor checkpoints
The advisor (Opus) reads the whole conversation when you call the advisor tool. Call it:
- Before finalizing a plan that changes the structure of more than one file: new modules, moved
  responsibilities, new data flow, schema or API changes. Apply its guidance, or say why not.
- When the same test or compiler error fails a second time after a fix attempt. Stop and consult
  it before a third attempt.
- Before declaring a task complete or staging a git commit. Ask it to audit the diff against the
  task: every requirement met, nothing out of scope changed, tests cover the change, no debug
  leftovers. Fix what it finds, or say what you're leaving and why.
Skip it for one-file fixes, questions and other quick work.

## Subagents
Use `code-scout` and `docs-scout` (Haiku, read-only) for parallel file discovery and documentation
lookup, at most 3 at once. They report back and never edit. Keep plans, edits and decisions in the
main session.
