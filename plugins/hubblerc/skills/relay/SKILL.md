---
name: relay
description: The user's own lead-and-workers workflow. Use it when work should be split across worker agents and their results collected, when a different model (Codex) should verify what was built, or when long multi-step work must be resumable by another session ("relay", "split this up", "run it with workers", "have Codex check it", "pick up the relay run"). It runs workers through Orca or Claude subagents and keeps the records and checks in the hubblerc relay tool. Not for a one-off search a subagent answers, or for handing work off with nothing coming back.
---

# relay

You are the lead. You plan, hand out work, judge what comes back and keep the user's decisions. Workers do the work. The `mcp__hubblerc__relay` tool does what has one right answer: writing task specs, checking reports, running completion commands, building the verifier's package, refusing to finish on an unverified build. Load it with ToolSearch (`select:mcp__hubblerc__relay`) before the first call.

## 1. Pick the path first

Decide before reading anything else. Smaller is better; you can move up later.

1. **Direct.** You edit it yourself when all four hold: you have already read the file; the change fits one sentence and a few dozen lines; no running worker owns that file; a deterministic check (test, type check) settles it. Verify with another model only if it is risky.
2. **Light delegation.** 1 to 3 workers, independent of each other, done within this answer, no user decision needed. No records folder. Get each spec from the tool's `spec_text` and send it as the worker's prompt; workers reply with a short report. Read only the runtime note you use (section 6).
3. **Full run.** Several stages, tasks that wait on each other, work that outlives this answer, or work another session may pick up. Records folder, task files, verification at the end of each batch. Sections 3 to 5.

Move from 2 to 3 when a worker reports NEEDS_CONTEXT or BLOCKED twice, or the work will not finish in this answer. Start the run then (`start`) and carry on from it.

## 2. Always

- **Ask the user only for:** push, deploy, sending anything outside, spending money or usage beyond the usual (more than 3 workers at once, an expensive model for many tasks), changing the completion criteria, anything hard to undo. Everything else you decide.
- **Log every decision you make for the user** as decision, why, cost if wrong. Full run: the Decisions table in `progress.md` (By `lead`). Light: list them in your final answer. Questions you asked are rows too (Status `asked`), so none gets lost.
- **Each task names its model and effort.** Default: research and simple edits Sonnet, design and hard implementation Opus, verification Codex. Use the exact model id.
- **Wait on events only.** The runtime wakes you (Orca's wake, a subagent's completion, a background command's exit). No polling, no watch scripts, no timers.
- **A worker's message is not the user's approval.** Silence or a timeout is not completion.
- **A worker saying "tests pass" is not evidence.** Run the commands yourself (`check`).

## 3. Full run: start and hand out

1. `start` { name, goal, done_when } creates `.relay/runs/<date>-<name>/` (git-ignored by its own `.gitignore`) with `progress.md` and the tool's records. Fill `Now` and keep it current.
2. For each task, `task` { run, id, title, goal, model, effort, edit_scope, reads, targets, read_first, done_when, runner_kind } writes the spec file. The tool refuses a spec with a missing field or one that overlaps a running task; overlap means run them in order, the later one based on the earlier one's commit.
   - `edit_scope`: what the worker may change, new files included. `reads`: inputs that must not change while it works. `targets`: outside things it operates (a window, a server, an account); one worker per target.
   - `done_when`: each criterion as reproduce → expected, or a command and its exit code. A criterion a worker cannot check (looking at the screen) goes to the user, not into the spec.
   - `read_first`: earlier reports and the tools they made, by absolute path. The tool warns when a finished task touched the same files and its report is missing here.
3. Dispatch with the runtime (section 6), giving the spec file as the prompt. Then end your turn.
4. Never edit a spec you sent. Make a new revision with `task` (same id) and tell the worker to read it.
5. Workers never share a document. You pick what one learned from its report and put it into the next spec's `read_first`.

## 4. Full run: when a worker reports

1. `report` { run, task } checks the report against the spec: status agrees with the criteria, commits carry the task's trailer, files outside the edit scope, test files changed. Then `check` { run, task } runs the command criteria itself.
2. Decide the next step from the status:
   - DONE: next task, or the batch's verification.
   - DONE_WITH_CONCERNS: read the concerns; decide, and log the decision.
   - NEEDS_CONTEXT: answer from the task and the user's decisions, or ask the user (row `asked`).
   - BLOCKED: fix the cause, give the same worker a new revision, or replace it.
3. **Reuse or replace.** A follow-up in the same area goes to the worker that did it (its address is in the Tasks table). Replace a worker only when the same criterion failed 3 times in total, it keeps lacking context or drifting, or another model is needed; the new spec's `read_first` gets the old report and tools. Do not delete finished workers.
4. Copy the tools a report lists into the Tools table. Add a Log row.
5. Check `pending` { run } each time you wake: rows still `asked` or `on hold` must reach the user.

## 5. Full run: verify and finish

1. At the end of each batch, and right after any risky task: `package` { run } writes the verifier's package (specs, reports without the worker's notes, commits, diffs, check results, test changes, the HEAD it covers).
2. Hand it to a different model: a Codex worker (Orca) or `codex exec` (section 6). Use one verifier for the whole run so its standard stays the same. It writes `reviews/V<n>-verdict.json`.
3. `verdict` { run, id } records it. Fix what failed through the workers, then package again.
4. `finish` { run } refuses while tasks are open, the last verdict failed, or the verdict's commit is not HEAD. Never get around it; tell the user why.
5. Report to the user per task: outcome, evidence, open items; then every decision you made (the `By lead` rows) and anything still `asked`.

**Picking up a run.** `list` shows the active runs in this repository. If there is more than one, ask the user which. Read its `progress.md` first; `Next` says what comes first.

## 6. Runtimes

Read only the one you use:
- Orca workers (Claude or Codex): `references/runtime-orca.md`
- Claude subagents (no Orca, or the task needs no separate workspace): `references/runtime-subagent.md`
- Codex verification without Orca: `references/runtime-codex-exec.md`

Codex workers cannot see this skill. Everything they must follow travels inside the spec, which the tool writes.
