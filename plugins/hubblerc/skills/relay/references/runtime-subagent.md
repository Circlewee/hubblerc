# Runtime: Claude subagents

Claude Code's own subagents (the Agent tool). No Orca needed; Claude workers only. Use them where Orca is absent, or when a task needs no workspace or terminal of its own.

## Dispatch

- Call the Agent tool with `model` set to the spec's model (alias or id) and a prompt that starts with the spec's path and then its full text. Full run: the spec file from `task`. Light: the text from `spec_text`.
- Name one spec per Agent call. Inside an active run, hubblerc checks an Agent call whose prompt names a spec of that run: it refuses one whose spec is not ready, was edited after it was written, or overlaps a task that is running or being launched, one with no `model` or one that differs from the spec's (an alias such as `sonnet` and an id that holds it are the same), and a prompt that names two ready specs. It claims the task before the start and marks it running as `subagent <agentId>`; a start that was refused or failed leaves it ready and the Agent result ends with a `⚠ relay:` line saying so (do not call `dispatched` for it). If the spec changed while the subagent was being started, the task is left `blocked` and the Agent result ends with a `⚠ relay:` line: stop that subagent and make a new revision; a SendMessage result carries the same line. An Agent call naming no spec (a search, a quick question) passes untouched, so keep worker tasks on specs.
- Run independent workers in the background and end your turn; each completion wakes you. Several independent calls go in one message so they run together.
- A subagent's effort cannot be set per call; note in the report what it ran at if known, else "unverified".

## Follow-ups

- A finished subagent continues from its transcript when you message it by its name or id (SendMessage): the engine resumes it inside that call. Use that for a follow-up in the same area or a new revision of its spec, instead of a fresh subagent that must learn the files again. Make the revision with the tool's `task` first, then send its path.
- A SendMessage whose message names a spec of the active run is checked once, as a start is (ready, unchanged, clear of the tasks running), and the resume it causes is let through unchecked. The model is not checked: the subagent keeps the one it started on, so send a revision only to a worker already on the revision's model.
- When the call answers that the message went, hubblerc marks the task running as `subagent <to>`. When it did not (an error, a refusal, or a `success: false` answer such as a declined resume or no agent by that name), the task is ready again and the result ends with a `⚠ relay:` line: do not call `dispatched`; fix the cause and send again, or start a fresh subagent on the spec. Only when the message went and the task is still ready with no such line, call `dispatched`. A message that names no spec of the run goes out untouched.
- A subagent cannot ask the user. It can send you a message; answer it, or ask the user and log the row as `asked`.

## Reports

- Full run: the spec tells it to write the report file; its final answer only needs to say it is done. Run `report` and `check` as usual.
- Light: its final answer is the report (header lines and one line per criterion).

## Limits

- Claude only. For a different model's verification without Orca, use `references/runtime-codex-exec.md`.
- Subagents share your working tree. Overlapping edit scopes are refused by the tool; still give each one only its own files to commit.
- When your session loads the plugin under work with `--plugin-dir` straight from the repository the workers edit, auto mode refuses edits under that path ("no verdict") for your session and its subagents. Load a copy kept outside the repository instead; never work around the refusal.
