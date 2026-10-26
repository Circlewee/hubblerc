import type { EngineInterface } from 'claude-code'

/**
 * Files an answer changed with no Edit or Write: through Bash (`sed`, a script, `git`), which the
 * tool calls do not tell. Inside a git repository only: as an answer starts, the working tree's
 * lines added and removed against the commit it stands on, and the untracked files; as it
 * completes, the same against that same commit (a commit made meanwhile changes nothing). A file
 * whose counts moved, or a new untracked one, was changed during the answer.
 *
 * Whoever changed it: a change made in an editor during the answer counts too.
 */
export type GitSnapshot = {
  /** The repository's top folder, absolute. */
  root: string
  /** The commit the answer started on; null in a repository with none. */
  base: string | null
  /** Lines added and removed against `base`, by path relative to `root`. */
  tracked: Record<string, { added: number; removed: number }>
  /** The untracked files (`.gitignore` left out), relative to `root`. */
  untracked: string[]
}

export type ShellChange = { path: string; added: number; removed: number }

const MAX_NEW_FILES = 50

/** The repository's state now, `base` the commit to count against (HEAD when not given); null outside a repository. */
export async function snapshotGit($: EngineInterface, cwd: string, base?: string | null): Promise<GitSnapshot | null> {
  const git = async (args: string[], dir: string) => {
    const ran = await $.process.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false', ...args], { cwd: dir, timeoutMs: 5000 }).catch(() => undefined)

    return ran !== undefined && ran.exitCode === 0 ? ran.stdout : null
  }
  const top = await git(['rev-parse', '--show-toplevel'], cwd)
  if (top === null) return null
  const root = top.trim()

  const head = base === undefined ? ((await git(['rev-parse', '--verify', '-q', 'HEAD'], root))?.trim() ?? null) : base
  const [numstat, others] = await Promise.all([
    head === null || head === '' ? Promise.resolve('') : git(['diff', '--numstat', '--no-renames', head], root),
    git(['ls-files', '--others', '--exclude-standard'], root),
  ])

  return {
    root,
    base: head === '' ? null : head,
    tracked: parseNumstat(numstat ?? ''),
    untracked: (others ?? '').split('\n').filter(line => line !== ''),
  }
}

/** `git diff --numstat`'s lines: `added\tremoved\tpath`, `-` for a binary file (counted 0). */
export function parseNumstat(stdout: string): GitSnapshot['tracked'] {
  const files: GitSnapshot['tracked'] = {}
  for (const line of stdout.split('\n')) {
    const [added = '', removed = '', ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (path === '') continue
    files[path] = { added: Number(added) || 0, removed: Number(removed) || 0 }
  }

  return files
}

/**
 * What moved between two snapshots of one repository: tracked files whose counts changed, by how
 * much each way; untracked files new since, to have their lines counted.
 */
export function shellChanges(before: GitSnapshot, after: GitSnapshot): { changed: ShellChange[]; created: string[] } {
  const changed: ShellChange[] = []
  const paths = new Set([...Object.keys(before.tracked), ...Object.keys(after.tracked)])
  const wasUntracked = new Set(before.untracked)
  for (const path of paths) {
    const was = before.tracked[path] ?? { added: 0, removed: 0 }
    const now = after.tracked[path] ?? { added: 0, removed: 0 }
    if (was.added === now.added && was.removed === now.removed) continue
    // Untracked at the start and added to git since: the same content, not new work.
    if (before.tracked[path] === undefined && wasUntracked.has(path)) continue
    changed.push({ path: `${after.root}/${path}`, added: Math.max(0, now.added - was.added), removed: Math.max(0, now.removed - was.removed) })
  }
  const created = after.untracked.filter(path => !wasUntracked.has(path) && after.tracked[path] === undefined).slice(0, MAX_NEW_FILES)

  return { changed, created: created.map(path => `${after.root}/${path}`) }
}

/** Lines in a text: a final newline closes the last one. */
export function lineCount(text: string): number {
  if (text === '') return 0
  const count = text.split('\n').length

  return text.endsWith('\n') ? count - 1 : count
}

/** The shell's changes with each new file's lines counted (a file it cannot read counts 0). */
export async function countShellChanges($: EngineInterface, before: GitSnapshot, after: GitSnapshot): Promise<ShellChange[]> {
  const { changed, created } = shellChanges(before, after)
  const counted = await Promise.all(
    created.map(async path => ({
      path,
      added: await $.fs
        .read(path)
        .then(lineCount)
        .catch(() => 0),
      removed: 0,
    })),
  )

  return [...changed, ...counted]
}
