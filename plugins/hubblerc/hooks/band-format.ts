import type { AgentSeen, EffortLevel, GitInfo, RunningCall, TodoItem, TurnRecord, UsageSnapshot } from '../types'

import { formatDuration, summarize } from './summary'

export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * A run of text in one style. `role` marks what the band draws its own way: a bar's filled and
 * empty cells, and the effort value (a control that opens the effort slider).
 */
export type Segment = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  role?: 'barFilled' | 'barEmpty' | 'effort'
}

/** What each colour means: the same roles on the band and in the sidebar, each drawn from its own palette. */
export type Palette = {
  ok: string
  warn: string
  /** Between warn and alert: the sidebar's fourth step of a usage reading. */
  caution: string
  alert: string
  effort: string
  sessionEffort: string
  branch: string
  dirty: string
  running: string
  faint: string
}

/**
 * The band's colours, by the terminal's own names: the band has no background but the terminal's,
 * so the terminal theme (Kanagawa, …) picks the shade and the band sits in it; only what needs
 * attention is coloured.
 */
export const COLORS: Palette = {
  ok: 'green',
  warn: 'yellow',
  caution: 'yellow',
  alert: 'red',
  effort: 'cyan',
  sessionEffort: 'yellow',
  branch: 'magenta',
  dirty: 'yellow',
  running: 'blue',
  faint: 'gray',
}

/**
 * The sidebar's colours, by Claude Code's theme keys: the engine paints the pane's background
 * from the theme, so what is drawn on it follows the same theme, light or dark, `auto` or a custom
 * one, and stays readable on it.
 */
export const THEME_COLORS: Palette = {
  ok: 'success',
  warn: 'warning',
  // Claude's orange: between the theme's yellow and red.
  caution: 'claude',
  alert: 'error',
  effort: 'suggestion',
  sessionEffort: 'warning',
  branch: 'merged',
  dirty: 'warning',
  running: 'permission',
  faint: 'inactive',
}

/** A segment's style as `Text` props, only those it sets. */
export function textStyle(segment: Segment): { color?: string; dimColor?: true; bold?: true } {
  return {
    ...(segment.color === undefined ? {} : { color: segment.color }),
    ...(segment.dim === true ? { dimColor: true as const } : {}),
    ...(segment.bold === true ? { bold: true as const } : {}),
  }
}

const BAR_CELLS = 8

/** `claude-opus-5-5` → `Opus 5.5`; an id of another shape as given. */
export function modelLabel(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|\[|$)/.exec(id)
  const family = match?.[1]
  if (match === null || family === undefined) return id
  const name = family.charAt(0).toUpperCase() + family.slice(1)

  return match[3] === undefined ? `${name} ${match[2]}` : `${name} ${match[2]}.${match[3]}`
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return EFFORT_LEVELS.some(level => level === value)
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

/** Time until `iso`, short: `1h30m`, `45m`, `2d3h`, `<1m` (`isSpaced`, `1h 30m`, `2d 3h`); '' when unknown or past. */
export function countdown(iso: string | undefined, now: number, isSpaced = false): string {
  const gap = isSpaced ? ' ' : ''
  if (iso === undefined) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${gap}${String(minutes % 60).padStart(2, '0')}m`

  return `${Math.floor(hours / 24)}d${gap}${hours % 24}h`
}

/** How long something has run, short: `12s`, `2m15s`, `1h3m`. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/** Terminal cells a text takes: East Asian wide characters take two. */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    width += isWide ? 2 : 1
  }

  return width
}

export const SEPARATOR = ' │ '

export type StatusInput = {
  model: string
  effort: string | null
  isOverridden: boolean
  /** Auto effort is on: `effort` is its latest pick (null before the first). */
  isAuto?: boolean
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

/** How a usage part is drawn: how many cells its bar takes (0, none) and in what style. */
type BarStyle = { cells: number; isWide: boolean }

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
  // One width for every bar, from what the longest line leaves it.
  const tail = Math.max(segmentsWidth(fiveHourTail), segmentsWidth(sevenDayTail))
  const wide = Math.min(WIDE_BAR_MAX, Math.max(WIDE_BAR_MIN, (input.barColumns ?? 0) - WIDE_LABEL_CELLS - WIDE_PERCENT_CELLS - tail))
  const bar: BarStyle = { cells: !shape.bars ? 0 : isWide ? wide : BAR_CELLS, isWide }

  const context = input.usage?.contextPercent
  parts.push(context === undefined ? [{ text: 'ctx –', dim: true }] : usagePart('ctx', context, [], bar, input.palette))

  if (fiveHour !== undefined) parts.push(usagePart('5h', fiveHour.percent, fiveHourTail, bar, input.palette))

  if (shape.sevenDay && sevenDay !== undefined) {
    const step = weekStep(sevenDay.percent, sevenDay.resetsAt, input.now)
    parts.push(usagePart('7d', sevenDay.percent, sevenDayTail, isWide ? bar : { cells: 0, isWide }, input.palette, step))
  }

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
  const part: Segment[] = [{ text: bar.isWide ? `${name} `.padEnd(WIDE_LABEL_CELLS) : `${name} `, dim: true }]
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

function segmentsWidth(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + cellWidth(segment.text), 0)
}

const MAX_AGENTS_SHOWN = 2

/** Line 2: what runs now (main-loop tools, subagents) and the todo in progress. */
export function activityParts(
  running: readonly RunningCall[],
  agents: readonly AgentSeen[],
  todos: readonly TodoItem[],
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

  const todo = todoProgress(todos)
  if (todo !== '') parts.push(todo)

  if (parts.length === 0) parts.push(isWorking ? '◐ 응답 중' : '· 대기 중')

  return parts
}

/** `▸ 인증 버그 수정 2/5`: the todo in progress and how many are done; '' with no todos. */
export function todoProgress(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return ''
  const done = todos.filter(todo => todo.status === 'completed').length
  const current = todos.find(todo => todo.status === 'in_progress')
  if (current === undefined) return `▸ 할 일 ${done}/${todos.length}`

  return `▸ ${current.activeForm ?? current.subject} ${done}/${todos.length}`
}

/**
 * When the last request went out and how much of the last answer the cache served:
 * `마지막 요청 14:32 · 캐시 96%`. The share goes yellow under 80% and red under 50%, an answer that
 * paid for its prompt; the time stays dim. Nothing when neither is known.
 */
export function requestSegments(time: string | null, share: number | null, palette: Palette = COLORS): Segment[] {
  const segments: Segment[] = []
  if (time !== null) segments.push({ text: `마지막 요청 ${time}`, dim: true })
  if (share !== null) {
    if (segments.length > 0) segments.push({ text: ' · ', dim: true })
    const text = `캐시 ${share}%`
    segments.push(share < 50 ? { text, color: palette.alert } : share < 80 ? { text, color: palette.warn } : { text, dim: true })
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

/** TodoWrite's whole list, as the band keeps it. */
export function todosFromTodoWrite(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item: unknown, i): TodoItem[] => {
    if (typeof item !== 'object' || item === null) return []
    const { content, activeForm, status } = item as Record<string, unknown>
    if (typeof content !== 'string' || !isTodoStatus(status)) return []

    return [{ id: `todo-${i}`, subject: content, status, ...(typeof activeForm === 'string' ? { activeForm } : {}) }]
  })
}

/** The list after one TaskUpdate: its fields applied, or the task removed when deleted. */
export function applyTaskUpdate(list: readonly TodoItem[], update: Record<string, unknown>): TodoItem[] {
  const { taskId, status, subject, activeForm } = update
  if (typeof taskId !== 'string') return [...list]
  if (status === 'deleted') return list.filter(todo => todo.id !== taskId)

  return list.map(todo =>
    todo.id !== taskId
      ? todo
      : {
          ...todo,
          ...(isTodoStatus(status) ? { status } : {}),
          ...(typeof subject === 'string' ? { subject } : {}),
          ...(typeof activeForm === 'string' ? { activeForm } : {}),
        },
  )
}

function isTodoStatus(value: unknown): value is TodoItem['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}
