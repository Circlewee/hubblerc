import type { GitInfo } from '../../types'

/** The branch and whether the tree has changes, from `git status --porcelain=v1 --branch`. */
export function parseGitStatus(stdout: string): GitInfo | null {
  const [header = '', ...rest] = stdout.split('\n')
  if (!header.startsWith('## ')) return null

  let branch = header.slice(3)
  const unborn = /^No commits yet on (.+)$/.exec(branch)
  if (unborn?.[1] !== undefined) branch = unborn[1]
  branch = (branch.split('...')[0] ?? branch).split(' ')[0] ?? branch

  const lines = rest.filter(line => line.trim() !== '')
  // `!!` ignored, `??` untracked (with --ignored and --untracked-files=normal, a folder whole as `dir/`).
  const kept = lines.filter(line => !line.startsWith('!! '))

  return {
    branch,
    isDirty: kept.length > 0,
    changed: kept.map(changedPath),
    untracked: kept.filter(line => line.startsWith('?? ')).map(changedPath),
    ignored: lines.filter(line => line.startsWith('!! ')).map(changedPath),
  }
}

/** Whether `path` is one of `entries`, or under one that is a folder (`dir/`). */
export function isListed(entries: readonly string[] | undefined, path: string): boolean {
  return (entries ?? []).some(entry => (entry.endsWith('/') ? path.startsWith(entry) : path === entry))
}

/** A porcelain line's path, relative to the repository's top: the new one of a rename. */
function changedPath(line: string): string {
  const path = line.slice(3)
  const renamed = path.split(' -> ')

  return (renamed[renamed.length - 1] ?? path).replace(/^"(.*)"$/, '$1')
}
