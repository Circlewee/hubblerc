# Runtime: Orca workers

Orca runs each worker as its own agent (Claude or Codex) in a terminal and wakes you when it reports. Its version-matched guide is served by the binary: run `orca skills get orchestration` once per session and follow it for every command; this note only says how relay uses it. On Linux outside Orca, or when `ORCA_CLI_COMMAND` is set, resolve the executable as that guide says.

## Dispatch

- Full run: `orca orchestration worker-start --spec-file <the spec's absolute path> --worktree current --agent <claude|codex> --model <spec's model id> --effort <spec's effort> --task-title "<id>: <title>"`.
- Light delegation: the same with `--spec "<the text spec_text returned>"`.
- The model and effort come from the spec; never leave them to the agent's default (an unpinned worker inherits a costly default).
- Inside an active run, hubblerc refuses a `worker-start` without a spec file of that run, and one whose spec overlaps a running task. The refusal says why.
- Record the dispatch: hubblerc marks it from the receipt; if the receipt was not seen, call the tool's `dispatched` { run, task, runner: "orca dispatch:<id>" }.
- Then end your turn. Orca wakes you; never poll or run a watch script.

## Talking to a worker

- A follow-up in the same area, or a new revision of its spec: `orca orchestration send --to dispatch:<id> --subject "<id>-r<n>" --body "Read and follow: <spec path>"`. A finished worker is reopened and remembers its earlier work (seen 2026-11-08).
- A worker's question arrives as a `question`: answer with `orca orchestration reply --id <message id> --body "…"` when the answer follows from the task or the user's decisions; otherwise ask the user and log the row as `asked`.
- Never steer a worker through its terminal.

## Codex workers

- A Codex worker cannot see this skill or hubblerc; the spec carries its rules and the exact commit trailers.
- Its sandbox may block it from reaching Orca, so its `worker_done` waits at an approval prompt (seen twice, 2026-11-08). When an escalation says a Codex worker waits on a prompt, look for its report file first: the work may be done. Tell the user the worker is waiting for their approval.
- For verification, give it the package path and the verdict path from `package`, read only.

## When something goes wrong

Follow the guide's recovery reference (`orca skills get orchestration --reference references/recovery-and-cleanup.md`). Silence or an unverifiable liveness never proves a worker stopped; never stop or replace one on that alone.
