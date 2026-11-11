import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { RelayRunStatus, RelayStatus, RelayTaskLine, RelayTaskName } from '../../types'
import type { Palette, Segment } from '../shared/style'
import { cellWidth, clipCells } from '../shared/text-width'
import { decisionRows, isBusy, isPending, latestRevs, sameCommit, taskKey } from './relay-format'
import type { RelayState, RelayTask } from './relay-format'

/**
 * relay's runs in small, for the sidebar's relay box and `/relay-status`: made where a run's state
 * is saved (relay.ts's writeState, which the tool's and the gate's saves both go through), at
 * session.start from the runs found there, and by `/relay-status`. Kept in state, so the box's
 * drawing reads no file. No timers: another session's change to the same run shows here at this
 * session's next save, its next start or `/relay-status`.
 */

const relayStatus = atom({ plugin: 'hubblerc', key: 'relayStatus' } as const, null)

/** A task's status as a person reads it. */
const STATUS_WORDS: Record<string, string> = {
  ready: '띄우기 전',
  launching: '띄우는 중',
  running: '도는 중',
  done: '끝',
  done_with_concerns: '걱정과 함께 끝',
  needs_context: '답 필요',
  blocked: '막힘',
  cancelled: '취소',
}
const LIVE_BLOCKED_WORD = '띄운 뒤 막힘'

/** A status as a person reads it; a word not in the table (a status of a newer tool) as it is. */
export const statusWord = (status: string): string => STATUS_WORDS[status] ?? status

const TITLE_CHARS_IN_STATE = 40

/** Cut to `max` characters with `…`, whitespace folded. */
function cut(value: string, max: number): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim())

  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

/**
 * What a task is called in a relay call's line: its title (cut to `max`), with ` (n번째 지시서)` when
 * it is a brief sent again (n > 1); the key when the title is not known. Never made up. (The box
 * and `/relay-status` say the brief's number short, `n판`: `taskSegments`.)
 */
export function taskName(task: { key: string; rev: number; title: string }, max: number): string {
  const title = cut(task.title, max)
  if (title === '') return task.key

  return task.rev > 1 ? `${title} (${task.rev}번째 지시서)` : title
}

/**
 * The task a call names (`B-r2`, or the id `B` for its latest revision) among the runs in small;
 * with `run`, only that run's. A key finds any revision, an earlier one too; an id its latest.
 * Undefined when the summary does not hold it (a finished run).
 */
export function findTaskLine(status: RelayStatus | null, run: string, name: string): RelayTaskName | undefined {
  const runs = (status?.runs ?? []).filter(other => run === '' || other.run === run)
  const names: RelayTaskName[] = runs.flatMap(other => [...other.tasks, ...(other.earlier ?? [])])
  const exact = names.find(line => line.key === name)
  if (exact !== undefined) return exact

  return names.filter(line => line.id === name).sort((a, b) => b.rev - a.rev)[0]
}

const taskNameOf = (task: RelayTask): RelayTaskName => ({ key: taskKey(task), id: task.id, rev: task.rev, title: cut(task.title, TITLE_CHARS_IN_STATE) })

function taskLine(task: RelayTask): RelayTaskLine {
  return {
    ...taskNameOf(task),
    status: task.status,
    ...(task.status === 'blocked' && task.workerLive === true ? { isLiveBlocked: true as const } : {}),
    model: task.model,
    effort: task.effort,
    ...(task.actualEffort === undefined ? {} : { actualEffort: task.actualEffort }),
    runner: (task.runner ?? '').trim().split(/\s+/)[0] ?? '',
    dispatchedAt: task.dispatchedAt,
  }
}

/**
 * A run in small: each task's latest revision, and an earlier one still holding a worker (an
 * earlier one cancelled or done is left out of the lines and kept by name alone, for the calls
 * that named it); the decisions waiting on the person, from progress.md (undefined: not read);
 * the last verdict, with HEAD as read now (undefined: not read).
 */
export function runStatus(state: RelayState, progress: string | undefined, head: string | undefined): RelayRunStatus {
  const latest = new Set(latestRevs(state.tasks))
  const last = state.verdicts.at(-1)
  const isShown = (task: RelayTask): boolean => latest.has(task) || isBusy(task)
  const earlier = state.tasks.filter(task => !isShown(task)).map(taskNameOf)

  return {
    run: state.run,
    tasks: state.tasks.filter(isShown).map(taskLine),
    ...(earlier.length === 0 ? {} : { earlier }),
    pending: progress === undefined ? null : decisionRows(progress).filter(isPending).length,
    verdict: last === undefined ? null : { id: last.id, result: last.result, commit: last.commit, ...(head === undefined ? {} : { head }) },
  }
}

const byName = (runs: readonly RelayRunStatus[]): RelayRunStatus[] => [...runs].sort((a, b) => a.run.localeCompare(b.run))

/** The list with one run put in, or taken out (`status` undefined: no longer active, finished or abandoned). */
export function withRun(current: RelayStatus | null, run: string, status: RelayRunStatus | undefined): RelayStatus {
  const others = (current?.runs ?? []).filter(other => other.run !== run)

  return { runs: byName(status === undefined ? others : [...others, status]) }
}

/** After a save: the run's summary in the box, or out of it once finished or abandoned. */
export async function noteRun($: EngineInterface, state: RelayState, progress: string | undefined, head: string | undefined): Promise<void> {
  const status = state.status === 'active' ? runStatus(state, progress, head) : undefined
  await update($, relayStatus, current => withRun(current, state.run, status))
}

/** The whole list, as read at session.start or by `/relay-status`. */
export async function setRuns($: EngineInterface, runs: readonly RelayRunStatus[]): Promise<void> {
  await update($, relayStatus, () => ({ runs: byName(runs) }))
}

// ── As shown ──────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

/** `HH:MM`, local. */
function clockTime(at: number): string {
  const d = new Date(at)

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusColor(task: RelayTaskLine, palette: Palette): string | undefined {
  switch (task.status) {
    case 'launching':
    case 'running':
      return palette.running
    case 'done':
      return palette.ok
    case 'done_with_concerns':
    case 'needs_context':
      return palette.warn
    case 'blocked':
      return palette.alert
    default:
      return undefined
  }
}

/** The status as the box's first column says it: the long one short, so the column stays narrow. */
const BOX_STATUS_WORDS: Record<string, string> = { done_with_concerns: '끝(걱정)' }

/** A title longer than this is not cut below this many cells: parts of the tail go first, the launch time before the model. */
const MIN_TITLE_CELLS = 20
/** Between the status column and the title, and between the title and the tail. */
const GAP = '  '

const statusOf = (task: RelayTaskLine, isShort: boolean): string =>
  task.isLiveBlocked === true ? LIVE_BLOCKED_WORD : ((isShort ? BOX_STATUS_WORDS[task.status] : undefined) ?? statusWord(task.status))

/** The widest status among the tasks, in cells: the column every task line pads its status to. */
const statusColumn = (tasks: readonly RelayTaskLine[], isShort: boolean): number => Math.max(0, ...tasks.map(task => cellWidth(statusOf(task, isShort))))

/** The model without its `claude-` head; in the box without its version too: `claude-opus-5-5` → `opus`. */
const modelName = (model: string, isShort: boolean): string => {
  const bare = model.replace(/^claude-/, '')

  return isShort ? bare.replace(/(-\d+)+$/, '') : bare
}

/** `opus/high`; `opus/high→xhigh` (the second part coloured) where the report told another effort than the brief's. */
function modelEffort(task: RelayTaskLine, isShort: boolean, palette: Palette): Segment[] {
  const said = [modelName(task.model, isShort), task.effort].filter(part => part !== '').join('/')
  const ran = task.actualEffort
  if (said === '') return []

  return ran === undefined || ran === task.effort.trim().toLowerCase() ? [{ text: said, dim: true }] : [{ text: said, dim: true }, { text: `→${ran}`, color: palette.warn }]
}

const SEPARATOR: Segment = { text: ' · ', dim: true }
const joined = (parts: readonly Segment[][]): Segment[] => parts.flatMap((part, i) => (i === 0 ? part : [SEPARATOR, ...part]))
const cells = (segments: readonly Segment[]): number => cellWidth(segments.map(segment => segment.text).join(''))

/**
 * A task's line: its status in a column `column` cells wide, its name (title; the key when
 * unknown), then which brief it is (`2판`, from the second), the model and effort, and when it was
 * launched. A cancelled one dim.
 *
 * With `width` (the box): the tail sits at the right edge and the title takes the cells between,
 * cut with `…`; too narrow for the title's MIN_TITLE_CELLS (or the whole of a shorter one), the
 * tail gives up the time, then the model, then the brief's number. The model is said short and the
 * runner left out.
 * Without (`/relay-status`'s text): nothing is cut, the model is whole and the runner is said.
 */
export function taskSegments(task: RelayTaskLine, palette: Palette, column: number, width?: number): Segment[] {
  const isBox = width !== undefined
  const word = statusOf(task, isBox)
  const color = statusColor(task, palette)
  const status: Segment = { text: word + ' '.repeat(Math.max(0, column - cellWidth(word))), ...(color === undefined ? { dim: true } : { color }) }
  const title = task.title === '' ? task.key : task.title
  const titleStyle = task.status === 'cancelled' ? { dim: true as const } : { bold: true as const }
  const parts: Segment[][] = [
    task.rev > 1 ? [{ text: `${task.rev}판`, dim: true }] : [],
    modelEffort(task, isBox, palette),
    !isBox && task.runner !== '' ? [{ text: task.runner, dim: true }] : [],
    task.dispatchedAt === null ? [] : [{ text: clockTime(task.dispatchedAt), dim: true }],
  ].filter(part => part.length > 0)

  if (!isBox) return [status, { text: GAP }, { text: title, ...titleStyle }, ...(parts.length === 0 ? [] : [SEPARATOR, ...joined(parts)])]

  // A cell is left free at the right edge, so a character the terminal draws wider than counted cuts nothing.
  const room = (tail: readonly Segment[][]): number => width - 1 - cellWidth(status.text) - GAP.length - (tail.length === 0 ? 0 : GAP.length + cells(joined(tail)))
  const tail = [...parts]
  // A short title asks for no more than its own cells: its tail stays whole.
  const wanted = Math.min(MIN_TITLE_CELLS, cellWidth(title))
  while (tail.length > 0 && room(tail) < wanted) tail.pop()
  const shown = clipCells(title, Math.max(1, room(tail)))
  const fill = ' '.repeat(Math.max(0, room(tail) - cellWidth(shown)))

  return [status, { text: GAP }, { text: shown, ...titleStyle }, ...(tail.length === 0 ? [] : [{ text: fill + GAP }, ...joined(tail)])]
}

function pendingSegments(pending: number | null, palette: Palette): Segment[] {
  if (pending === null) return [{ text: '기다리는 결정: progress.md를 읽지 못함', color: palette.warn }]
  if (pending === 0) return [{ text: '사용자 답을 기다리는 결정 없음', dim: true }]

  return [{ text: `사용자 답을 기다리는 결정 ${pending}개`, color: palette.warn }]
}

/** The last verdict: its result, the commit it saw, and whether that is HEAD as read with the summary. */
function verdictSegments(verdict: RelayRunStatus['verdict'], palette: Palette): Segment[] {
  if (verdict === null) return [{ text: '판정 없음', dim: true }]
  const commit = verdict.commit.slice(0, 7)
  const head =
    verdict.head === undefined
      ? { text: ` · ${commit} · HEAD 미확인`, dim: true }
      : sameCommit(verdict.commit, verdict.head)
        ? { text: ` · ${commit} = HEAD`, dim: true }
        : { text: ` · ${commit} ≠ HEAD ${verdict.head.slice(0, 7)}`, color: palette.warn }

  return [{ text: `판정 ${verdict.id} `, dim: true }, { text: verdict.result, color: verdict.result === 'pass' ? palette.ok : palette.alert }, head]
}

/**
 * What the box draws (`width`: the cells a line has) and `/relay-status` writes (no width), one
 * line each: per run its name, its tasks, the decisions waiting and the last verdict.
 */
export function relayLines(status: RelayStatus | null, palette: Palette, width?: number): Segment[][] {
  const runs = status?.runs ?? []
  // One column for every run in the box, so the statuses line up down the whole of it.
  const column = statusColumn(
    runs.flatMap(run => run.tasks),
    width !== undefined,
  )

  return runs.flatMap(run => [
    [{ text: run.run, bold: true }],
    ...(run.tasks.length === 0 ? [[{ text: '작업 없음', dim: true }]] : run.tasks.map(task => taskSegments(task, palette, column, width))),
    pendingSegments(run.pending, palette),
    verdictSegments(run.verdict, palette),
  ])
}

const lineText = (line: readonly Segment[]): string => line.map(segment => segment.text).join('')

/** `/relay-status`'s text: the runs as the box shows them; with none, the run finished last (by its last verdict) if any. */
export function statusText(status: RelayStatus, palette: Palette, finishedLast?: string): string {
  if (status.runs.length === 0) {
    return `진행 중인 relay 묶음이 없습니다. ${finishedLast === undefined ? '이 저장소에 끝난 묶음도 없습니다.' : `가장 최근에 끝난 묶음: ${finishedLast}`}`
  }
  const blocks = status.runs.map(run => relayLines({ runs: [run] }, palette).map(lineText).join('\n'))

  return [`진행 중인 relay 묶음 ${status.runs.length}개:`, ...blocks].join('\n\n')
}
