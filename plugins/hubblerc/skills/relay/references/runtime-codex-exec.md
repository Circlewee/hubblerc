# Runtime: Codex verification with `codex exec`

The first choice for a different model's verification, with or without Orca. Verification only: Codex reads, judges and writes a verdict; it changes nothing. Flags change between versions: read `codex exec --help` once before the first run, and prefer what it says over this note.

Why first, even inside Orca: an Orca Codex worker's sandbox blocks its connection to Orca (`EPERM`), so each `orca orchestration send` or `check` it runs waits for the user's approval (seen 2026-11-11: three approval prompts for one verification). `codex exec --sandbox read-only` writes its verdict to a file only and raises no prompt. Use an Orca Codex worker only when the job needs Orca itself.

## Run it

1. `package` { run } gives the package path, the verdict path and the schema path.
2. Run in the background (Bash `run_in_background`), with the repository root as Codex's working root (`-C`): the package lists files and the `git show` commands to open them, and the verifier runs them there.
   ```bash
   codex exec -C <repository root> --sandbox read-only --ephemeral \
     --output-schema <schema path> -o <verdict path> \
     "You are verifying another agent's work. Read the package at <package path> and follow its verifier instructions: open every file it lists with its git show command, from this repository's root, and name in reviewed_files only the files you opened. Read only. Your final message is the verdict JSON." < /dev/null
   ```
   - `-C <repository root>` (`--cd`): where its commands run; the package holds no diffs, so without the repository it cannot review.
   - `--sandbox read-only`: it cannot change files. Never pass `--dangerously-bypass-approvals-and-sandbox`, `--approve-for-me` or a writable sandbox for verification.
   - `-o` writes its last message, the verdict, to the file; `--output-schema` holds it to the schema.
   - `< /dev/null` keeps it from waiting on input.
3. End your turn; the command's exit wakes you. Then `verdict` { run, id }.

## Following up

- `--ephemeral` keeps no session to resume. When the same verifier should look again (one verifier for the whole run keeps its standard), leave out `--ephemeral` on the first run and note the session id printed at the head of its log. Later, with the next `package`'s paths (seen working 2026-11-11):
  ```bash
  codex exec resume <session id> -c 'sandbox_mode="read-only"' \
    --output-schema <schema path> -o <verdict path> \
    "<what changed; the new package path>" < /dev/null
  ```
  `resume` has no `--sandbox` or `-C` (codex-cli 0.167.0): give the sandbox as a config value (`-c 'sandbox_mode="read-only"'`), keep it read-only, and run the command from the repository root. Never use `--last`: another Codex session may be newer.
- It cannot ask you anything while it runs. A question in its verdict (`unverified` with a reason) is answered by the next package or by the user.

## If it fails

A non-zero exit or a missing verdict file is not a pass: report it to the user, with the command's last lines. Do not fall back to a Claude model and call it cross-model verification; if the user agrees to a same-family check, say so in the report.
