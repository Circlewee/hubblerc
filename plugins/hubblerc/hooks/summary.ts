import type { ToolRun, TurnRecord } from '../types'
import { tokenCount } from './forecast'

/** How far a duration line's time may sit from a turn's recorded duration and still be that turn. */
const MATCH_TOLERANCE_MS = 1500
const MAX_TOOLS_SHOWN = 4

/**
 * The turn a closing line belongs to: the one that recorded the line's row id, else the completed
 * turn whose duration is closest to the line's.
 */
export function findTurnForLine(list: readonly TurnRecord[], requestId: string, durationMs: number): TurnRecord | undefined {
  return list.find(turn => turn.lineId !== undefined && turn.lineId === requestId) ?? matchTurn(list, durationMs)
}

/** The completed turn whose duration is closest to the line's, the latest one on a tie. */
export function matchTurn(list: readonly TurnRecord[], durationMs: number): TurnRecord | undefined {
  let best: TurnRecord | undefined
  let bestGap = Number.POSITIVE_INFINITY

  for (const turn of list) {
    if (turn.durationMs === null || turn.restored === true) continue
    const gap = Math.abs(turn.durationMs - durationMs)
    if (gap <= bestGap) {
      best = turn
      bestGap = gap
    }
  }

  return bestGap <= MATCH_TOLERANCE_MS ? best : undefined
}

/**
 * One line for the end of a turn: what changed, then the main loop's tool calls by name, then what
 * subagents ran and what failed, then what it cost: the main loop's output tokens and the points of
 * the 5-hour window it took (one point or more). '' when the turn ran no tool and cost nothing known.
 *
 * @example 'app.ts +2 −1 · Read 3 · Bash 1 · 에이전트 도구 4 · 실패 1 · 출력 12k · 5h +3%'
 */
export function summarize(turn: TurnRecord): string {
  const parts: string[] = []

  const files = fileTotals(turn.runs)
  const [only] = files
  if (files.length === 1 && only !== undefined) {
    parts.push(`${basename(only.path)} ${signed(only.added, only.removed)}`)
  } else if (files.length > 1) {
    const added = files.reduce((sum, file) => sum + file.added, 0)
    const removed = files.reduce((sum, file) => sum + file.removed, 0)
    parts.push(`${files.length}파일 ${signed(added, removed)}`)
  }

  const counts = countByTool(turn.runs.filter(run => run.agentId === undefined))
  for (const [tool, count] of counts.slice(0, MAX_TOOLS_SHOWN)) parts.push(`${tool} ${count}`)
  if (counts.length > MAX_TOOLS_SHOWN) parts.push(`외 ${counts.length - MAX_TOOLS_SHOWN}종`)

  const agentRuns = turn.runs.filter(run => run.agentId !== undefined).length
  if (agentRuns > 0) parts.push(`에이전트 도구 ${agentRuns}`)

  const failed = turn.runs.filter(run => run.isError).length
  if (failed > 0) parts.push(`실패 ${failed}`)

  if (turn.tokens !== undefined && turn.tokens.output > 0) parts.push(`출력 ${tokenCount(turn.tokens.output)}`)
  if (turn.fiveHourUsed !== undefined && turn.fiveHourUsed > 0) parts.push(`5h +${turn.fiveHourUsed}%`)

  return parts.join(' · ')
}

/**
 * The `/activity` table: one row per recorded answer, newest last, so each summary line on screen
 * can be found again by its number, its time and the start of its prompt.
 *
 * @example '#3      8s  "시나리오 3: 실패하는 Bash 한…"  Bash 1 · 실패 1'
 */
export function activityTable(list: readonly TurnRecord[], shown = 30): string {
  // No plugin name here: the engine heads a command's output with it.
  if (list.length === 0) return '아직 기록된 답변이 없습니다. 플러그인을 불러온 뒤의 답변부터 기록됩니다.'

  const start = Math.max(0, list.length - shown)
  const rows = list.slice(start).map((turn, i) => {
    const number = `#${start + i + 1}`.padEnd(4)
    const time = (turn.durationMs === null ? '진행 중' : turn.restored === true ? '이전' : formatDuration(turn.durationMs)).padStart(7)
    const prompt = turn.prompt.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const label = prompt === '' ? '(이어진 답변)' : `"${clip(prompt, 32)}"`

    return `${number} ${time}  ${label}  ${summarize(turn) || '도구 없음'}`
  })

  return [`답변별 활동 (전체 ${list.length}개 중 최근 ${rows.length}개)`, ...rows].join('\n')
}

/** A duration as the engine's turn line writes it: `8s`, `1m 27s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`

  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

export type FileTotal = { path: string; added: number; removed: number }

export function fileTotals(runs: readonly ToolRun[]): FileTotal[] {
  const byPath = new Map<string, FileTotal>()

  for (const run of runs) {
    if (run.path === undefined || (run.added === undefined && run.removed === undefined)) continue
    const total = byPath.get(run.path) ?? { path: run.path, added: 0, removed: 0 }
    total.added += run.added ?? 0
    total.removed += run.removed ?? 0
    byPath.set(run.path, total)
  }

  return [...byPath.values()]
}

/** Tool names with their call counts, most called first, then by name. */
function countByTool(runs: readonly ToolRun[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const run of runs) counts.set(run.tool, (counts.get(run.tool) ?? 0) + 1)

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function signed(added: number, removed: number): string {
  if (removed === 0) return `+${added}`
  if (added === 0) return `−${removed}`

  return `+${added} −${removed}`
}

export function basename(path: string): string {
  return path.split('/').pop() || path
}
