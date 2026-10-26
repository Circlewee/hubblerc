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

/**
 * Colors by the terminal's own names, so the terminal theme (Kanagawa, …) picks the shade and the
 * band sits in it; only what needs attention is colored.
 */
export const COLORS = {
  ok: 'green',
  warn: 'yellow',
  alert: 'red',
  effort: 'cyan',
  sessionEffort: 'yellow',
  branch: 'magenta',
  dirty: 'yellow',
  running: 'blue',
  faint: 'gray',
} as const

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
export function levelColor(percent: number): string {
  if (percent >= 85) return COLORS.alert
  if (percent >= 60) return COLORS.warn

  return COLORS.ok
}

/** Time until `iso`, short: `1h30m`, `45m`, `2d3h`, `<1m`; '' when unknown or past. */
export function countdown(iso: string | undefined, now: number): string {
  if (iso === undefined) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`

  return `${Math.floor(hours / 24)}d${hours % 24}h`
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
}

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
  head.push({
    text: effort,
    role: 'effort',
    color: input.isOverridden ? COLORS.sessionEffort : COLORS.effort,
  })
  if (input.isOverridden) head.push({ text: ' (세션)', dim: true })
  parts.push(head)

  const context = input.usage?.contextPercent
  parts.push(
    context === undefined
      ? [{ text: 'ctx –', dim: true }]
      : usagePart('ctx', context, undefined, shape.bars, input.now),
  )

  const fiveHour = input.usage?.fiveHour
  if (fiveHour !== undefined) parts.push(usagePart('5h', fiveHour.percent, fiveHour.resetsAt, shape.bars, input.now))

  const sevenDay = input.usage?.sevenDay
  if (shape.sevenDay && sevenDay !== undefined) parts.push(usagePart('7d', sevenDay.percent, undefined, false, input.now))

  const where: Segment[] = []
  if (shape.projectName || input.git === null) where.push({ text: input.project })
  if (input.git !== null) {
    if (where.length > 0) where.push({ text: ' ' })
    where.push({ text: input.git.branch, color: COLORS.branch })
    if (input.git.isDirty) where.push({ text: '*', color: COLORS.dirty })
  }
  if (where.some(segment => segment.text.trim() !== '')) parts.push(where)

  return parts
}

function usagePart(name: string, percent: number, resetsAt: string | undefined, bars: boolean, now: number): Segment[] {
  const color = levelColor(percent)
  const isHigh = percent >= 60
  const part: Segment[] = [{ text: `${name} `, dim: true }]
  if (bars) {
    // A thin bar: its fill shows the level's color, the rest the terminal's faint gray.
    const filled = barFill(percent)
    if (filled > 0) part.push({ text: '━'.repeat(filled), role: 'barFilled', color })
    if (filled < BAR_CELLS) part.push({ text: '─'.repeat(BAR_CELLS - filled), role: 'barEmpty', color: COLORS.faint })
    part.push({ text: ' ' })
  }
  // The number takes a color only when it runs high.
  part.push({ text: `${Math.round(percent)}%`, ...(isHigh ? { color, bold: true } : {}) })
  const reset = countdown(resetsAt, now)
  if (reset !== '') part.push({ text: ` ↻${reset}`, dim: true })

  return part
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

  return { branch, isDirty: rest.some(line => line.trim() !== '') }
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
