# Runtime: Orca workers

Orca runs each worker as its own agent (Claude or Codex) in a terminal and wakes you when it reports. Its version-matched guide is served by the binary: run `orca skills get orchestration` once per session and follow it for every command; this note only says how relay uses it. On Linux outside Orca, or when `ORCA_CLI_COMMAND` is set, resolve the executable as that guide says.

## Dispatch

- Full run: `orca orchestration worker-start --spec-file <the spec's absolute path> --worktree current --agent <claude|codex> --model <spec's model id> --effort <spec's effort> --task-title "<id>: <title>"`.
- Light delegation: the same with `--spec "<the text spec_text returned>"`. While a run of this repository is active, hubblerc refuses a `worker-start` that has no spec file of that run: add `--comment no-relay`.
- The model and effort come from the spec; never leave them to the agent's default (an unpinned worker inherits a costly default).
- Give the spec's absolute path. A relative `--spec-file` (or a relative spec path in a `send` body) is refused when the command also has `cd`, `pushd`, a subshell or `$( )`: hubblerc cannot tell where it points.
- Start one worker per command. Inside an active run, hubblerc refuses a command with more than one `worker-start`, a `worker-start` without a spec file of that run (add `--comment no-relay` for a worker that has nothing to do with the run), one whose spec is not ready, was edited after it was written, or overlaps a task that is running or being launched, and one whose `--model` or `--effort` differs from the spec's or is missing. The refusal says why.
- Record the dispatch: hubblerc claims the task before the launch and marks it running with `orca dispatch:<id>` from the receipt (`orca (dispatch id 미확인)` if the receipt names none: find the dispatch id with the guide's listing commands and write it in `progress.md`). A failed launch leaves the task ready. If the spec changed while the worker was being started, the task is left `blocked` and the tool result ends with a `⚠ relay:` line: stop that worker and make a new revision. `dispatched` { run, task, runner: "orca dispatch:<id>" } only takes a task that is still ready, for a launch hubblerc did not see (it failed open).
- Then end your turn. Orca wakes you; never poll or run a watch script.

## Talking to a worker

- A follow-up in the same area, or a new revision of its spec: make the revision with the tool's `task`, then `orca orchestration send --to dispatch:<id> --subject "<id>-r<n>" --body "Read and follow: <spec path>"`. A finished worker is reopened and remembers its earlier work (seen 2026-11-08). A `send` whose arguments name a spec of the active run gets the same check as a launch (the spec ready, unchanged, clear of running tasks) and hubblerc marks that task running with the dispatch it went to; if it did not, call `dispatched`. A `send` that names no spec of the run goes out untouched.
- A worker's question arrives as a `question`: answer with `orca orchestration reply --id <message id> --body "…"` when the answer follows from the task or the user's decisions; otherwise ask the user and log the row as `asked`.
- Never steer a worker through its terminal.

## Codex workers

- A Codex worker cannot see this skill or hubblerc; the spec carries its rules and the exact commit trailers.
- Its sandbox blocks it from reaching Orca (`EPERM`), so every `orca orchestration send` or `check` it runs waits at an approval prompt for the user (seen 2026-11-08 and 2026-11-11: three prompts for one verification). When an escalation says a Codex worker waits on a prompt, look for its report file first: the work may be done. Tell the user the worker is waiting for their approval.
- For a different model's verification, use `codex exec` first (`references/runtime-codex-exec.md`), even inside Orca: `codex exec --sandbox read-only` only writes its verdict to a file, so no approval prompt comes up. Start a Codex worker in Orca only when the job needs Orca itself (its own terminal or workspace, or talking with you while it runs).
- If a Codex worker does verify, give it the package path and the verdict path from `package`, read only. It must be able to read the repository: the package lists the files to review and the `git show` commands that open them (no diffs), and its verdict names in `reviewed_files` the files it opened. Start it in this repository's worktree.

## When something goes wrong

Follow the guide's recovery reference (`orca skills get orchestration --reference references/recovery-and-cleanup.md`). Silence or an unverifiable liveness never proves a worker stopped; never stop or replace one on that alone.
