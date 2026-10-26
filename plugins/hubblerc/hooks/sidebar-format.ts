import type { GitInfo, TurnRecord } from '../types'
import { cellWidth, elapsed, isListed } from './band-format'
import { basename, fileTotals } from './summary'

/** One answer of the session as the sidebar's table of contents lists it. */
export type TocEntry = {
  id: string
  /** Its number in the session, as `/activity` counts. */
  number: number
  title: string
  /** `2m13s`, or how long it has run while it runs; '' on an answer rebuilt from the transcript. */
  time: string
  isRunning: boolean
  /** Calls that failed, the subagents' included. */
  failed: number
  /**
   * The transcript row a press scrolls to: the question (`start`), else the line that closes the
   * answer (`end`, the answer above it); none for an answer rebuilt from the transcript.
   */
  target?: { requestId: string; block: 'start' | 'end' }
  /**
   * What the question's row shows, flattened, and how many earlier answers share it: how a press
   * finds the row when no id was kept (an answer rebuilt from the transcript, another party's message).
   */
  key?: string
  occurrence: number
}

/** A file this session changed: its lines added and removed in all, and by which answers. */
export type SessionFile = {
  path: string
  /** The name to show: the file's own, or with its folder when another file shares it. */
  name: string
  added: number
  removed: number
  /** The answers that changed it, by number, oldest first. */
  turns: number[]
  /** In the repository with no change left uncommitted. */
  isCommitted: boolean
  /** Outside the repository (memory, a temporary folder): git never commits it. False when no repository is known. */
  isOutside: boolean
  /** In the repository, and git does not track it yet (new, never added). */
  isUntracked: boolean
  /** In the repository, and `.gitignore` keeps it out: git never commits it. */
  isIgnored: boolean
}

/** The files outside the repository that sit in one folder: those shown, and how many more there are. */
export type OutsideGroup = { folder: string; files: SessionFile[]; hidden: number }

/**
 * How the files box lays out: the repository's files and how many more; then each folder outside
 * it, the folder changed last first; then how many folders more.
 */
export type FileLayout = { inside: SessionFile[]; insideHidden: number; outside: OutsideGroup[]; foldersHidden: number }

/** How much of each part the files box shows. */
export type FileLimits = {
  /** Files in all, inside and outside the repository. */
  total: number
  /** The repository's files shown even when folders outside take the rest. */
  minInside: number
  folders: number
  perFolder: number
}

/** The session's last `shown` answers (all by default), newest first. */
export function tocEntries(list: readonly TurnRecord[], now: number, shown = list.length): TocEntry[] {
  const start = Math.max(0, list.length - shown)
  const seen = new Map<string, number>()
  const occurrences = list.map(turn => {
    if (turn.promptKey === undefined) return 0
    const count = seen.get(turn.promptKey) ?? 0
    seen.set(turn.promptKey, count + 1)

    return count
  })

  return list
    .slice(start)
    .map((turn, i) => toEntry(turn, start + i + 1, now, occurrences[start + i] ?? 0))
    .reverse()
}

function toEntry(turn: TurnRecord, number: number, now: number, occurrence: number): TocEntry {
  const entry: TocEntry = {
    id: turn.id,
    number,
    title: turn.prompt === '' ? '(이어진 답변)' : turn.prompt,
    time: turn.durationMs === null ? `진행 중 ${elapsed(now - turn.startedAt)}` : turn.restored === true ? '' : elapsed(turn.durationMs),
    isRunning: turn.durationMs === null,
    failed: turn.runs.filter(run => run.isError).length,
    occurrence,
  }
  if (turn.promptKey !== undefined) entry.key = turn.promptKey
  if (turn.promptRowId !== undefined) entry.target = { requestId: turn.promptRowId, block: 'start' }
  else if (turn.lineId !== undefined) entry.target = { requestId: turn.lineId, block: 'end' }

  return entry
}

/** Every file the session's answers changed (subagents' too), the one changed last first. */
export function sessionFiles(list: readonly TurnRecord[], git: GitInfo | null = null): SessionFile[] {
  const byPath = new Map<string, SessionFile>()

  list.forEach((turn, i) => {
    for (const total of fileTotals(turn.runs)) {
      const file = byPath.get(total.path) ?? { path: total.path, name: '', added: 0, removed: 0, turns: [], isCommitted: false, isOutside: false, isUntracked: false, isIgnored: false }
      file.added += total.added
      file.removed += total.removed
      file.turns.push(i + 1)
      // Re-inserted, so the map runs from the file changed longest ago to the one changed last.
      byPath.delete(total.path)
      byPath.set(total.path, file)
    }
  })

  const files = [...byPath.values()].reverse()
  const root = git?.root
  for (const file of files) {
    file.isOutside = root !== undefined && !file.path.startsWith(`${root}/`)
    const isInside = root !== undefined && !file.isOutside
    file.isIgnored = isInside && isListed(git?.ignored, file.path)
    file.isUntracked = isInside && !file.isIgnored && isListed(git?.untracked, file.path)
    file.isCommitted = isInside && !file.isIgnored && !isListed(git?.changed, file.path)
  }
  const names = new Map<string, number>()
  for (const file of files) names.set(basename(file.path), (names.get(basename(file.path)) ?? 0) + 1)
  for (const file of files) {
    const name = basename(file.path)
    file.name = (names.get(name) ?? 0) > 1 ? file.path.split('/').slice(-2).join('/') : name
  }

  return files
}

/**
 * The files laid out within `limits`: the repository's, then those outside it by folder, each
 * folder in the order its latest change came, each part saying how many it left out.
 *
 * The folders outside take their room first, a few files each, so many changes in the repository
 * never push them out of sight; the repository keeps `minInside` however many folders there are.
 */
export function fileLayout(files: readonly SessionFile[], limits: FileLimits): FileLayout {
  const byFolder: { folder: string; files: SessionFile[] }[] = []
  for (const file of files) {
    if (!file.isOutside) continue
    const folder = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/'))) || '/'
    const group = byFolder.find(other => other.folder === folder)
    if (group === undefined) byFolder.push({ folder, files: [file] })
    else group.files.push(file)
  }

  const outside = byFolder.slice(0, limits.folders).map(group => ({
    folder: group.folder,
    files: group.files.slice(0, limits.perFolder),
    hidden: Math.max(0, group.files.length - limits.perFolder),
  }))
  const outsideShown = outside.reduce((sum, group) => sum + group.files.length, 0)
  const inside = files.filter(file => !file.isOutside)
  const insideRoom = Math.max(limits.minInside, limits.total - outsideShown)

  return {
    inside: inside.slice(0, insideRoom),
    insideHidden: Math.max(0, inside.length - insideRoom),
    outside,
    foldersHidden: Math.max(0, byFolder.length - limits.folders),
  }
}

/**
 * A folder's path in at most `max` cells: the home folder as `~`, macOS's `/private/tmp` as `/tmp`,
 * and when too long its middle as `…`, keeping the first folder and as many of the last as fit.
 *
 * @example shortPath('/Users/me/.claude/projects/x/memory', 20) === '~/.claude/…/memory'
 */
export function shortPath(folder: string, max: number): string {
  const path = folder.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~').replace(/^\/private(?=\/(tmp|var)\/)/, '')
  if (cellWidth(path) <= max) return path

  const rooted = path.startsWith('/')
  const parts = path.split('/').filter(part => part !== '')
  // `~` alone says little: the first folder in it stays with it.
  const headCount = parts[0] === '~' ? 2 : 1
  const head = `${rooted ? '/' : ''}${parts.slice(0, headCount).join('/')}`
  const rest = parts.slice(headCount)
  for (let kept = rest.length - 1; kept >= 1; kept -= 1) {
    const short = `${head}/…/${rest.slice(-kept).join('/')}`
    if (cellWidth(short) <= max) return short
  }

  return clipCells(`…/${parts.at(-1) ?? ''}`, max)
}

/**
 * A `file:` URL for an absolute path, with no host (the engine opens no other): each part
 * percent-encoded, so a space, a Korean name, `#` or `?` stays part of the path.
 */
export function fileUrl(path: string): string {
  return `file://${path
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')}`
}

/** `text` cut to `max` cells, an ellipsis taking the last. */
export function clipCells(text: string, max: number): string {
  if (cellWidth(text) <= max) return text
  if (max <= 0) return ''

  let clipped = ''
  for (const char of text) {
    if (cellWidth(clipped + char) > max - 1) break
    clipped += char
  }

  return `${clipped}…`
}

/** One page of the contents: its entries, which page it is (0 the newest) and how many there are. */
export type TocPage = { entries: TocEntry[]; page: number; pages: number }

/** The page `page` of entries listed newest first, `size` to a page; a page past the end shows the last. */
export function tocPage(entries: readonly TocEntry[], page: number, size: number): TocPage {
  const pages = Math.max(1, Math.ceil(entries.length / size))
  const shown = Math.min(Math.max(0, page), pages - 1)

  return { entries: entries.slice(shown * size, (shown + 1) * size), page: shown, pages }
}
