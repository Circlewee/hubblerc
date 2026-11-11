import type { EffortLevel } from '../../types'
import { isEffortLevel } from '../effort/levels'
import { isBusy, taskKey } from './relay-format'
import type { RelayState } from './relay-format'

/**
 * The effort each subagent worker of a relay run should send its requests with: its brief's.
 * A subagent cannot be started with an effort of its own (it runs at the session's), so the main
 * `turn.step` hook asks here, by the request's agentId, what to give it.
 *
 * One rule decides it. Per agent, its owner is the task started last among
 *  - the launches under way: a start or a resume the gate let through for a brief, not yet recorded
 *    in the run's state (noted by `noteWorkerEffort`); one holds the place until a save of its run
 *    shows it recorded (its task busy with that agent as runner, then it is a held task) or let go
 *    (its task no longer launching: the launch failed and was released), and
 *  - the tasks of the active runs that hold that agent as their worker (runner `subagent <id>`;
 *    running, launching, blocked after its launch), the one dispatched last (a tie: the later in the
 *    run's list).
 * A launch under way counts as started after every recorded task. The owner gives its brief's effort
 * when that is one of the five levels, else nothing ("leave it": the request goes as the engine sent
 * it); a "leave it" owner is an owner all the same, so an older task's effort does not come back
 * while it owns the agent. With no owner, there is no entry and the request goes as sent.
 *
 * The same rule serves every event: a launch noted (`noteWorkerEffort`), a run's state saved
 * (relay.ts's writeState → `settleWorkerEfforts`: that run's held tasks read again, its launches
 * under way kept or dropped), and session start (`refillWorkerEfforts`: every active run read again,
 * nothing under way).
 *
 * Module memory only: a request looks up a map, never a file. No timers, no watching.
 *
 * Limits: a reload of the plugin (a refreshed development copy) empties the memory, so until the
 * next start or session start that worker runs at the session's effort. Another session's change to
 * a run is seen here only at this session's next save of that run or at session start. A SendMessage
 * addressed by a name rather than an agentId is noted, and its task's runner written, under the id
 * the resume or the answer gives (`resumedAgentId`); with neither, under the name, which a request
 * (keyed by agentId) may not find.
 */

/** The task a note or an entry is for: its run and its key (`A-r2`). */
export type WorkerOwner = { run: string; task: string }
/** What an owner gives a request: a level, or null for "leave it". */
type Give = EffortLevel | null
type Owned = { owner: WorkerOwner; give: Give }

/** Launches under way come and go: only the latest few are kept. */
const MAX_LAUNCHES = 50

/** The launches under way, by agent: the latest noted for each. */
const launches = new Map<string, Owned>()
/** Per active run, the tasks holding an agent: the one dispatched last per agent. */
const heldByRun = new Map<string, Map<string, Owned & { at: number }>>()
/** Per agent, its owner and what it gives, worked out from the two above. */
const entries = new Map<string, Owned>()

const giveOf = (effort: string): Give => {
  const level = effort.trim()

  return isEffortLevel(level) ? level : null
}

/** The agentId in a runner the gate wrote (`subagent <agentId>`); undefined for any other runner. */
export function subagentOf(runner: string | null): string | undefined {
  // `subagent (agent id 미확인)` holds spaces: no match.
  return /^subagent (\S+)$/.exec(runner ?? '')?.[1]
}

/** A run's tasks that hold an agent, the one dispatched last per agent; none for a run not active. */
function heldIn(state: RelayState): Map<string, Owned & { at: number }> {
  const held = new Map<string, Owned & { at: number }>()
  if (state.status !== 'active') return held
  for (const task of state.tasks) {
    const id = subagentOf(task.runner)
    if (id === undefined || !isBusy(task)) continue
    const at = task.dispatchedAt ?? 0
    const known = held.get(id)
    if (known === undefined || at >= known.at) held.set(id, { at, owner: { run: state.run, task: taskKey(task) }, give: giveOf(task.effort) })
  }

  return held
}

/** The entries worked out again: a launch under way first, else the held task dispatched last across the runs. */
function resolve(): void {
  entries.clear()
  const latest = new Map<string, Owned & { at: number }>()
  for (const held of heldByRun.values()) {
    for (const [id, found] of held) {
      const known = latest.get(id)
      if (known === undefined || found.at >= known.at) latest.set(id, found)
    }
  }
  for (const [id, { owner, give }] of latest) entries.set(id, { owner, give })
  for (const [id, launch] of launches) entries.set(id, launch)
}

/** A start or a resume the gate let through for a task's brief: that agent's owner from now. */
export function noteWorkerEffort(agentId: string, effort: string, owner: WorkerOwner): void {
  const id = agentId.trim()
  if (id === '') return
  launches.delete(id)
  launches.set(id, { owner, give: giveOf(effort) })
  if (launches.size > MAX_LAUNCHES) {
    const oldest = launches.keys().next().value
    if (oldest !== undefined) launches.delete(oldest)
  }
  resolve()
}

/** The brief's effort for a subagent's requests: its owner's level; undefined with no owner or one that leaves it. */
export function workerEffort(agentId: string): EffortLevel | undefined {
  return entries.get(agentId)?.give ?? undefined
}

/**
 * After a run's state is saved: its held tasks read again, and each of its launches under way kept
 * while its task is still launching with no runner, dropped once recorded (it is then a held task)
 * or let go. Other runs stay as they were.
 */
export function settleWorkerEfforts(state: RelayState): void {
  const held = heldIn(state)
  if (held.size === 0) heldByRun.delete(state.run)
  else heldByRun.set(state.run, held)
  for (const [id, { owner }] of [...launches]) {
    if (owner.run !== state.run) continue
    const task = state.status === 'active' ? state.tasks.find(other => taskKey(other) === owner.task) : undefined
    if (task === undefined || !isBusy(task) || task.runner !== null) launches.delete(id)
  }
  resolve()
}

/** At session start: the active runs read again, with nothing under way. */
export function refillWorkerEfforts(states: readonly RelayState[]): void {
  launches.clear()
  heldByRun.clear()
  for (const state of states) {
    const held = heldIn(state)
    if (held.size > 0) heldByRun.set(state.run, held)
  }
  resolve()
}
