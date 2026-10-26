import type { TurnRecord } from '../types'
import { cellWidth, elapsed } from './band-format'
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
}

/** The session's last `shown` answers, newest first. */
export function tocEntries(list: readonly TurnRecord[], now: number, shown = 50): TocEntry[] {
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
export function sessionFiles(list: readonly TurnRecord[]): SessionFile[] {
  const byPath = new Map<string, SessionFile>()

  list.forEach((turn, i) => {
    for (const total of fileTotals(turn.runs)) {
      const file = byPath.get(total.path) ?? { path: total.path, name: '', added: 0, removed: 0, turns: [] }
      file.added += total.added
      file.removed += total.removed
      file.turns.push(i + 1)
      // Re-inserted, so the map runs from the file changed longest ago to the one changed last.
      byPath.delete(total.path)
      byPath.set(total.path, file)
    }
  })

  const files = [...byPath.values()].reverse()
  const names = new Map<string, number>()
  for (const file of files) names.set(basename(file.path), (names.get(basename(file.path)) ?? 0) + 1)
  for (const file of files) {
    const name = basename(file.path)
    file.name = (names.get(name) ?? 0) > 1 ? file.path.split('/').slice(-2).join('/') : name
  }

  return files
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
