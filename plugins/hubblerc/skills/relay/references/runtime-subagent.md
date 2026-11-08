# Runtime: Claude subagents

Claude Code's own subagents (the Agent tool). No Orca needed; Claude workers only. Use them where Orca is absent, or when a task needs no workspace or terminal of its own.

## Dispatch

- Call the Agent tool with `model` set to the spec's model (alias or id) and a prompt that starts with the spec's path and then its full text. Full run: the spec file from `task`. Light: the text from `spec_text`.
- Inside an active run, hubblerc checks an Agent call whose prompt names a spec of that run: it refuses one that overlaps a running task or whose model differs from the spec's. An Agent call naming no spec (a search, a quick question) passes untouched, so keep worker tasks on specs.
- Run independent workers in the background and end your turn; each completion wakes you. Several independent calls go in one message so they run together.
- A subagent's effort cannot be set per call; note in the report what it ran at if known, else "unverified".

## Follow-ups

- A finished subagent continues from its transcript when you message it by its name or id (SendMessage). Use that for a follow-up in the same area or a new revision of its spec, instead of a fresh subagent that must learn the files again.
- A subagent cannot ask the user. It can send you a message; answer it, or ask the user and log the row as `asked`.

## Reports

- Full run: the spec tells it to write the report file; its final answer only needs to say it is done. Run `report` and `check` as usual.
- Light: its final answer is the report (header lines and one line per criterion).

## Limits

- Claude only. For a different model's verification without Orca, use `references/runtime-codex-exec.md`.
- Subagents share your working tree. Overlapping edit scopes are refused by the tool; still give each one only its own files to commit.
