import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { RelayRunStatus, RelayStatus, RelayTaskLine } from '../../types'
import type { Palette, Segment } from '../shared/style'
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

function taskLine(task: RelayTask): RelayTaskLine {
  return {
    key: taskKey(task),
    status: task.status,
    ...(task.status === 'blocked' && task.workerLive === true ? { isLiveBlocked: true as const } : {}),
    model: task.model,
    effort: task.effort,
    runner: (task.runner ?? '').trim().split(/\s+/)[0] ?? '',
    dispatchedAt: task.dispatchedAt,
  }
}

/**
 * A run in small: each task's latest revision, and an earlier one still holding a worker (an
 * earlier one cancelled or done is left out); the decisions waiting on the person, from progress.md
 * (undefined: not read); the last verdict, with HEAD as read now (undefined: not read).
 */
export function runStatus(state: RelayState, progress: string | undefined, head: string | undefined): RelayRunStatus {
  const latest = new Set(latestRevs(state.tasks))
  const last = state.verdicts.at(-1)

  return {
    run: state.run,
    tasks: state.tasks.filter(task => latest.has(task) || isBusy(task)).map(taskLine),
    pending: progress === undefined ? null : decisionRows(progress).filter(isPending).length,
    verdict: last === undefined ? null : { id: last.id, result: last.result, commit: last.commit, ...(head === undefined ? {} : { head }) },
  }
}

const byName = (runs: readonly RelayRunStatus[]): RelayRunStatus[] => [...runs].sort((a, b) => a.run.localeCompare(b.run))

/** The list with one run put in, or taken out (`status` undefined: finished). */
export function withRun(current: RelayStatus | null, run: string, status: RelayRunStatus | undefined): RelayStatus {
  const others = (current?.runs ?? []).filter(other => other.run !== run)

  return { runs: byName(status === undefined ? others : [...others, status]) }
}

/** After a save: the run's summary in the box, or out of it once finished. */
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

/** The model's name without its `claude-` head, and the effort: `opus-5-5/high`. */
const modelEffort = (task: RelayTaskLine): string => [task.model.replace(/^claude-/, ''), task.effort].filter(part => part !== '').join('/')

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

/** A task's line: its key, its status, model/effort, where it runs and when it was launched. A cancelled one dim. */
export function taskSegments(task: RelayTaskLine, palette: Palette): Segment[] {
  const word = task.isLiveBlocked === true ? LIVE_BLOCKED_WORD : (STATUS_WORDS[task.status] ?? task.status)
  const color = statusColor(task, palette)
  const tail = [modelEffort(task), task.runner, task.dispatchedAt === null ? '' : clockTime(task.dispatchedAt)].filter(part => part !== '')

  return [
    { text: task.key, ...(task.status === 'cancelled' ? { dim: true } : { bold: true }) },
    { text: ` ${word}`, ...(color === undefined ? { dim: true } : { color }) },
    ...(tail.length === 0 ? [] : [{ text: ` · ${tail.join(' · ')}`, dim: true }]),
  ]
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

/** What the box draws and `/relay-status` writes, one line each: per run its name, its tasks, the decisions waiting and the last verdict. */
export function relayLines(status: RelayStatus | null, palette: Palette): Segment[][] {
  return (status?.runs ?? []).flatMap(run => [
    [{ text: run.run, bold: true }],
    ...(run.tasks.length === 0 ? [[{ text: '작업 없음', dim: true }]] : run.tasks.map(task => taskSegments(task, palette))),
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
