import type { EffortLevel } from '../../types'
import { isEffortLevel } from '../effort/levels'
import { isBusy, taskKey } from './relay-format'
import type { RelayState } from './relay-format'

/**
 * The effort each subagent worker of a relay run should send its requests with: its brief's.
 * A subagent cannot be started with an effort of its own (it runs at the session's), so the gate
 * notes here "this agentId, this effort" when it records a subagent as a brief's worker (a start,
 * or a new revision sent to it), and the main `turn.step` hook sends that agent's requests with it.
 *
 * Each entry knows its task (run and key): when the run's state is saved (relay.ts's writeState,
 * which every save of the tool and the gate goes through), `settleWorkerEfforts` drops the run's
 * entries whose task no longer holds that worker (reported, cancelled, the run finished or
 * abandoned), so a later message to that subagent outside a brief goes as sent.
 *
 * Module memory only: a request looks up a map, never a file. No timers, no watching.
 *
 * Limits: a reload of the plugin (a refreshed development copy) empties the map, so until the next
 * start or session start that worker runs at the session's effort again. A SendMessage addressed by
 * a name rather than an agentId is noted, and its task's runner written, under the id the resume or
 * the answer gives (`resumedAgentId`); with neither, under the name, which a request (keyed by
 * agentId) and the refill at session start may not find.
 */

/** Subagents come and go: only the latest few are kept. */
const MAX_WORKERS = 50
/** The task an entry was noted for: its run and its key (`A-r2`). */
export type WorkerOwner = { run: string; task: string }
const efforts = new Map<string, { level: EffortLevel; owner: WorkerOwner }>()

/** Notes the effort a subagent's requests go out with, for a task; an effort that is no level is not noted (and forgets an older one). */
export function noteWorkerEffort(agentId: string, effort: string, owner: WorkerOwner): void {
  const id = agentId.trim()
  if (id === '') return
  efforts.delete(id)
  const level = effort.trim()
  if (!isEffortLevel(level)) return
  efforts.set(id, { level, owner })
  if (efforts.size > MAX_WORKERS) {
    const oldest = efforts.keys().next().value
    if (oldest !== undefined) efforts.delete(oldest)
  }
}

/** The brief's effort for a subagent's requests, if the gate noted one. */
export function workerEffort(agentId: string): EffortLevel | undefined {
  return efforts.get(agentId)?.level
}

/**
 * After a run's state is saved: its entries kept only while their task holds that worker (running,
 * launching, blocked after its launch) and its runner is that agent (or not yet written: a launch
 * under way); all of them once the run is finished or abandoned. Other runs' entries stay.
 */
export function settleWorkerEfforts(state: RelayState): void {
  for (const [id, { owner }] of [...efforts]) {
    if (owner.run !== state.run) continue
    const task = state.status === 'active' ? state.tasks.find(other => taskKey(other) === owner.task) : undefined
    const isHeld = task !== undefined && isBusy(task) && (task.runner === null || subagentOf(task.runner) === id)
    if (!isHeld) efforts.delete(id)
  }
}

/** The agentId in a runner the gate wrote (`subagent <agentId>`); undefined for any other runner. */
export function subagentOf(runner: string | null): string | undefined {
  // `subagent (agent id 미확인)` holds spaces: no match.
  return /^subagent (\S+)$/.exec(runner ?? '')?.[1]
}

/**
 * At session start: the map again from the active runs' states, each task that is a subagent's
 * (`subagent <id>`) and still holds its worker. Where one agent holds more than one, the latest
 * dispatched wins.
 */
export function refillWorkerEfforts(states: readonly RelayState[]): void {
  efforts.clear()
  const latest = new Map<string, { at: number; effort: string; owner: WorkerOwner }>()
  for (const state of states) {
    for (const task of state.tasks) {
      const id = subagentOf(task.runner)
      if (id === undefined || !isBusy(task)) continue
      const at = task.dispatchedAt ?? 0
      const known = latest.get(id)
      if (known === undefined || at >= known.at) latest.set(id, { at, effort: task.effort, owner: { run: state.run, task: taskKey(task) } })
    }
  }
  const byTime = [...latest].sort(([, a], [, b]) => a.at - b.at)
  for (const [id, { effort, owner }] of byTime) noteWorkerEffort(id, effort, owner)
}
