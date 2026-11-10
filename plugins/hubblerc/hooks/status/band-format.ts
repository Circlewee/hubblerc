import type { AgentSeen, GitInfo, RunningCall, TokenTotals, TurnRecord, UsageSnapshot } from '../../types'

import { cacheShare, tokenCount } from './forecast'

import { formatDuration, summarize } from '../activity/summary'
import { COLORS } from '../shared/style'
import type { Palette, Segment } from '../shared/style'
import { cellWidth } from '../shared/text-width'
import { countdown, elapsed } from '../shared/time-text'

const BAR_CELLS = 8

/** `claude-opus-5-5` → `Opus 5.5`; an id of another shape as given. */
export function modelLabel(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|\[|$)/.exec(id)
  const family = match?.[1]
  if (match === null || family === undefined) return id
  const name = family.charAt(0).toUpperCase() + family.slice(1)

  return match[3] === undefined ? `${name} ${match[2]}` : `${name} ${match[2]}.${match[3]}`
}

/** How many of a bar's `cells` are filled for `percent` of 100. */
export function barFill(percent: number, cells = BAR_CELLS): number {
  return Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
}

/** A usage reading's color: fine, getting high (60%), nearly out (85%). */
export function levelColor(percent: number, palette: Palette = COLORS): string {
  if (percent >= 85) return palette.alert
  if (percent >= 60) return palette.warn

  return palette.ok
}

/**
 * The sidebar's step of a usage reading, 0 to 4: 여유 (under 50%), 보통 (50), 주의 (70), 위험 (85),
 * 한계 (95), drawn green, yellow, orange, red, red with a `!`.
 */
export function levelStep(percent: number): number {
  if (percent >= 95) return 4
  if (percent >= 85) return 3
  if (percent >= 70) return 2
  if (percent >= 50) return 1

  return 0
}

const WEEK_MS = 7 * 24 * 3_600_000
const DAY_MS = 24 * 3_600_000

/**
 * The 7-day window's step by its pace as well as its level: what it will reach at the reset, at
 * the rate so far, raises the step to 주의 from 85%, 위험 from 100% (it runs out first), 한계 from
 * 130%. Not in its first day, when a little use already looks fast; by level alone with no reset.
 */
export function weekStep(percent: number, resetsAt: string | undefined, now: number): number {
  const level = levelStep(percent)
  const left = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt) - now
  const gone = WEEK_MS - left
  if (!Number.isFinite(gone) || gone < DAY_MS || gone > WEEK_MS) return level

  const projected = (percent * WEEK_MS) / gone
  const pace = projected >= 130 ? 4 : projected >= 100 ? 3 : projected >= 85 ? 2 : 0

  return Math.max(level, pace)
}

/** A step's colour: green, yellow, orange, red, red. */
export function stepColor(step: number, palette: Palette): string {
  return [palette.ok, palette.warn, palette.caution, palette.alert][Math.min(step, 3)] ?? palette.alert
}

/**
 * The effort value's style in the sidebar, by its level: low faint, medium plain, high blue,
 * xhigh purple, max purple and bold. None of the usage readings' yellow to red, which warn.
 */
export function effortStyle(level: string | null, palette: Palette): Pick<Segment, 'color' | 'dim' | 'bold'> {
  if (level === 'low') return { dim: true }
  if (level === 'high') return { color: palette.effort }
  if (level === 'xhigh') return { color: palette.branch }
  if (level === 'max') return { color: palette.branch, bold: true }

  return {}
}

export const SEPARATOR = ' │ '

export type StatusInput = {
  model: string
  effort: string | null
  isOverridden: boolean
  /** Auto effort is on: `effort` is its latest pick (null before the first). */
  isAuto?: boolean
  /** Ultracode is on for the session: named after the effort. */
  isUltracode?: boolean
  usage: UsageSnapshot | null
  project: string
  git: GitInfo | null
  now: number
  /** Minutes until the 5-hour window runs out at the current pace, when that is soon (`burnoutMinutes`). */
  burnout?: number | null
  /** Room to spare (the sidebar): the burn-out chip says what it means. */
  isRoomy?: boolean
  /** The colours to draw with: the terminal's (the band, the default) or the theme's (the sidebar). */
  palette?: Palette
  /**
   * The cells a usage line may take, one to a line (the sidebar): then the labels pad to one width
   * so every bar starts in one column, 7d gets a bar too, the bars stretch to what the longest line
   * leaves (8 to 20 cells) and their empty cells are dashed. Absent (the band), short bars on one line.
   */
  barColumns?: number
}

/** The sidebar's bars: at least the band's eight cells, at most twenty. */
const WIDE_BAR_MIN = 8
const WIDE_BAR_MAX = 20
/** A label padded (`5h  `) and a percent padded (` 45%`): what a wide usage line takes besides its bar and tail. */
const WIDE_LABEL_CELLS = 4
const WIDE_PERCENT_CELLS = 5

/** How a usage part is drawn: how many cells its bar takes (0, none), in what style, and (wide) the cells its label pads to. */
type BarStyle = { cells: number; isWide: boolean; labelCells?: number }

type StatusShape = { bars: boolean; sevenDay: boolean; projectName: boolean }

/** Line 1, as parts to join with SEPARATOR, made to fit `columns` by dropping the least needed first. */
export function statusParts(input: StatusInput, columns: number): Segment[][] {
  const shapes: StatusShape[] = [
    { bars: true, sevenDay: true, projectName: true },
    { bars: true, sevenDay: false, projectName: true },
    { bars: true, sevenDay: false, projectName: false },
    { bars: false, sevenDay: false, projectName: false },
  ]
  let parts: Segment[][] = []
  for (const shape of shapes) {
    parts = buildStatus(input, shape)
    if (partsWidth(parts) <= columns) break
  }

  return parts
}

export function partsWidth(parts: readonly Segment[][]): number {
  const text = parts.map(part => part.map(segment => segment.text).join('')).join(SEPARATOR)

  return cellWidth(text)
}

function buildStatus(input: StatusInput, shape: StatusShape): Segment[][] {
  const parts: Segment[][] = []

  const model = input.model === '' ? '모델 ?' : modelLabel(input.model)
  const head: Segment[] = [{ text: model, bold: true }, { text: ' · ', dim: true }]
  const effort = input.isAuto === true && !input.isOverridden ? `auto${input.effort === null ? '' : ` ${input.effort}`}` : (input.effort ?? 'effort')
  // Wide (the sidebar), coloured by its level; "(세션)" still says it is the session's.
  head.push(
    input.barColumns !== undefined
      ? { text: effort, role: 'effort', ...effortStyle(input.effort, input.palette ?? COLORS) }
      : { text: effort, role: 'effort', color: input.isOverridden ? (input.palette ?? COLORS).sessionEffort : (input.palette ?? COLORS).effort },
  )
  if (input.isOverridden) head.push({ text: ' (세션)', dim: true })
  if (input.isUltracode === true) head.push({ text: ' · ', dim: true }, { text: 'ultracode', color: (input.palette ?? COLORS).ultracode, bold: true })
  parts.push(head)

  const fiveHour = input.usage?.fiveHour
  // Kept in every shape: the one thing worth the room when the window is about to run out.
  const burnout: Segment[] =
    fiveHour === undefined || input.burnout === undefined || input.burnout === null
      ? []
      : [{ text: input.isRoomy === true ? ` ⚠ ${input.burnout}m 뒤 소진` : ` ⚠${input.burnout}m`, color: (input.palette ?? COLORS).alert, bold: true }]
  const isWide = input.barColumns !== undefined
  const fiveHourTail = [...resetSegments(fiveHour?.resetsAt, input.now, isWide), ...burnout]
  const sevenDay = input.usage?.sevenDay
  // Wide, 7d says when it resets too (`↻ 3d4h`).
  const sevenDayTail = isWide ? resetSegments(sevenDay?.resetsAt, input.now, true) : []
  // Wide, a line for each weekly limit of a single model (Fable's) beneath 7d: one still running,
  // its reset said only when it is not 7d's.
  const modelLines = (isWide ? (input.usage?.modelLimits ?? []) : [])
    .filter(limit => limit.resetsAt === undefined || !(Date.parse(limit.resetsAt) <= input.now))
    .map(limit => ({ limit, tail: resetsWith(limit.resetsAt, sevenDay?.resetsAt) ? [] : resetSegments(limit.resetsAt, input.now, true) }))
  // One width for every label and every bar: the longest name, and what the longest line leaves.
  const labelCells = Math.max(WIDE_LABEL_CELLS, ...modelLines.map(line => cellWidth(line.limit.name) + 1))
  const tail = Math.max(segmentsWidth(fiveHourTail), segmentsWidth(sevenDayTail), ...modelLines.map(line => segmentsWidth(line.tail)))
  const wide = Math.min(WIDE_BAR_MAX, Math.max(WIDE_BAR_MIN, (input.barColumns ?? 0) - labelCells - WIDE_PERCENT_CELLS - tail))
  const bar: BarStyle = { cells: !shape.bars ? 0 : isWide ? wide : BAR_CELLS, isWide, labelCells }

  const context = input.usage?.contextPercent
  parts.push(context === undefined ? [{ text: 'ctx –', dim: true }] : usagePart('ctx', context, [], bar, input.palette))

  // Left out by the engine while it hands other windows (a subscription with no 5-hour figure now):
  // a dim dash, not a line gone, as ctx does. With no window at all (an API key) there is no line.
  if (fiveHour !== undefined) parts.push(usagePart('5h', fiveHour.percent, fiveHourTail, bar, input.palette))
  else if ((input.usage?.limits?.length ?? 0) > 0) parts.push([{ text: isWide ? `${'5h '.padEnd(labelCells)}–` : '5h –', dim: true }])

  if (shape.sevenDay && sevenDay !== undefined) {
    const step = weekStep(sevenDay.percent, sevenDay.resetsAt, input.now)
    parts.push(usagePart('7d', sevenDay.percent, sevenDayTail, isWide ? bar : { cells: 0, isWide }, input.palette, step))
  }
  for (const line of modelLines) parts.push(usagePart(line.limit.name, line.limit.percent, line.tail, bar, input.palette))

  const where: Segment[] = []
  if (shape.projectName || input.git === null) where.push({ text: input.project })
  if (input.git !== null) {
    if (where.length > 0) where.push({ text: ' ' })
    where.push({ text: input.git.branch, color: (input.palette ?? COLORS).branch })
    if (input.git.isDirty) where.push({ text: '*', color: (input.palette ?? COLORS).dirty })
  }
  if (where.some(segment => segment.text.trim() !== '')) parts.push(where)

  return parts
}

function usagePart(name: string, percent: number, tail: readonly Segment[], bar: BarStyle, palette: Palette = COLORS, step = levelStep(percent)): Segment[] {
  // Wide, five steps and the number always coloured, bold from 주의; else three, the number coloured from 60%.
  const color = bar.isWide ? stepColor(step, palette) : levelColor(percent, palette)
  const isHigh = bar.isWide || percent >= 60
  const isBold = bar.isWide ? step >= 2 : percent >= 60
  // Wide, the labels pad to one width so the bars start in one column.
  const part: Segment[] = [{ text: bar.isWide ? `${name} `.padEnd(bar.labelCells ?? WIDE_LABEL_CELLS) : `${name} `, dim: true }]
  if (bar.cells > 0) {
    // A thick fill in the level's color over a faint thin line; wide, the empty cells dashed.
    const filled = barFill(percent, bar.cells)
    if (filled > 0) part.push({ text: '━'.repeat(filled), role: 'barFilled', color })
    if (filled < bar.cells) part.push({ text: (bar.isWide ? '╌' : '─').repeat(bar.cells - filled), role: 'barEmpty', color: palette.faint })
    part.push({ text: ' ' })
  }
  // The number takes a color only when it runs high; wide, right-aligned so what follows lines up.
  const number = `${Math.round(percent)}%`
  part.push({ text: bar.isWide ? number.padStart(WIDE_PERCENT_CELLS - 1) : number, ...(isHigh ? { color } : {}), ...(isBold ? { bold: true } : {}) })
  if (bar.isWide && step >= 4) part.push({ text: '!', color, bold: true })
  part.push(...tail)

  return part
}

/** ` ↻1h30m` (wide, ` ↻ 1h 30m`), dim; none when the reset is unknown or past. */
function resetSegments(resetsAt: string | undefined, now: number, isWide = false): Segment[] {
  const reset = countdown(resetsAt, now, isWide)

  return reset === '' ? [] : [{ text: isWide ? ` ↻ ${reset}` : ` ↻${reset}`, dim: true }]
}

/** Two resets under a minute apart: one window's, said once (a model's weekly limit resets with 7d). */
function resetsWith(resetsAt: string | undefined, other: string | undefined): boolean {
  return resetsAt !== undefined && other !== undefined && Math.abs(Date.parse(resetsAt) - Date.parse(other)) < 60_000
}

function segmentsWidth(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + cellWidth(segment.text), 0)
}

const MAX_AGENTS_SHOWN = 2

/**
 * Line 2: what runs now (main-loop tools, subagents). Claude's own to-do progress (`▸ … 2/5`) went
 * 2026-11-06.
 */
export function activityParts(
  running: readonly RunningCall[],
  agents: readonly AgentSeen[],
  isWorking: boolean,
  now: number,
): string[] {
  const parts: string[] = []

  const mainCalls = running.filter(call => call.agentId === undefined)
  const [first] = mainCalls
  if (first !== undefined) {
    const name = first.label === '' ? first.tool : `${first.tool} ${first.label}`
    const more = mainCalls.length > 1 ? ` +${mainCalls.length - 1}` : ''
    parts.push(`◐ ${name} ${elapsed(now - first.startedAt)}${more}`)
  }

  const live = agents.filter(agent => agent.status === 'running' || agent.status === 'pending')
  for (const agent of live.slice(0, MAX_AGENTS_SHOWN)) {
    const time = agent.startedAt === undefined ? '' : ` ${elapsed(now - agent.startedAt)}`
    parts.push(`◐ ${agent.type}: ${agent.description}${time}`)
  }
  if (live.length > MAX_AGENTS_SHOWN) parts.push(`에이전트 +${live.length - MAX_AGENTS_SHOWN}`)

  if (parts.length === 0) parts.push(isWorking ? '◐ 응답 중' : '· 대기 중')

  return parts
}

/**
 * When the last main-loop request went out and what it carried: its input, the cache's share of it,
 * and its output, `마지막 요청 14:32 · 입력 120k(캐시 96%) · 출력 2.1k`. The share goes yellow under
 * 80% and red under 50%, a request that paid for its prompt; the rest stays dim. Nothing when
 * neither is known. Only the input can come from the cache: the output is never cached.
 */
export function requestSegments(time: string | null, request: TokenTotals | null | undefined, palette: Palette = COLORS): Segment[] {
  const segments: Segment[] = []
  if (time !== null) segments.push({ text: `마지막 요청 ${time}`, dim: true })
  const share = request === null || request === undefined ? null : cacheShare(request)
  if (request !== null && request !== undefined && share !== null) {
    if (segments.length > 0) segments.push({ text: ' · ', dim: true })
    const text = `캐시 ${share}%`
    segments.push({ text: `입력 ${tokenCount(request.input + request.cacheRead + request.cacheWrite)}(`, dim: true })
    segments.push(share < 50 ? { text, color: palette.alert } : share < 80 ? { text, color: palette.warn } : { text, dim: true })
    segments.push({ text: `) · 출력 ${tokenCount(request.output)}`, dim: true })
  }

  return segments
}

/** Line 3's text: the last completed answer's time and summary. */
export function lastAnswer(turns: readonly TurnRecord[]): string {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]
    if (turn === undefined || turn.durationMs === null) continue

    const time = turn.restored === true ? '' : ` ${formatDuration(turn.durationMs)}`

    return `직전${time} · ${summarize(turn) || '도구 없음'}`
  }

  return '직전 답변 없음'
}
