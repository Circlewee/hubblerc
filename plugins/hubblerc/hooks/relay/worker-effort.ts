import type { EffortLevel } from '../../types'
import { isEffortLevel } from '../effort/levels'
import { isBusy, taskKey } from './relay-format'
import type { RelayState } from './relay-format'

/**
 * The effort each subagent worker of a relay run should send its requests with: its brief's.
 * A subagent cannot be started with an effort of its own (it runs at the session's), so the main
 * `turn.step` hook asks here, by the request's agentId, what to give it.
 *
 * One subagent works one task at a time: the gate refuses a brief sent to an agent that already
 * holds a task, or that another send is on its way to (the user's decision, 2026-11-11, after four
 * verifications found their faults where one agent held several tasks). So an agent has at most one
 * owner, and the table holds one entry per agent: its owner task (run and key) and what it gives,
 * the brief's effort when that is one of the five levels, else nothing ("leave it": the request goes
 * as the engine sent it).
 *  - Noted when the gate lets a start or a resume through for a brief (`noteWorkerEffort`), before
 *    the state records it: the agent may send a request first.
 *  - At each save of a run (relay.ts's writeState → `settleWorkerEfforts`), that run's entries whose
 *    task no longer holds that agent go: reported, cancelled, let go after a failed launch, the run
 *    finished or abandoned. A task still launching with no runner yet keeps its entry.
 *  - At session start (`refillWorkerEfforts`), filled again from the active runs' tasks that hold a
 *    subagent (runner `subagent <id>`; running, launching, blocked after its launch).
 * With no entry, the request goes as sent. At most 50 entries; the oldest noted goes first.
 *
 * Module memory only: a request looks up a map, never a file. No timers, no watching.
 *
 * Limits: a reload of the plugin (a refreshed development copy) empties the map, so until the next
 * start or session start that worker runs at the session's effort. Another session's change to a run
 * is seen here only at this session's next save of that run or at session start. A SendMessage
 * addressed by a name rather than an agentId is noted, and its task's runner written, under the id
 * the resume or the answer gives (`resumedAgentId`); with neither, under the name, which a request
 * (keyed by agentId) may not find, and which the gate cannot tell is busy when addressed by its id.
 */

/** The task an entry is for: its run and its key (`A-r2`). */
export type WorkerOwner = { run: string; task: string }

/** Subagents come and go: only the latest few are kept. */
const MAX_WORKERS = 50
/** Per agent, its owner task and what it gives (null: leave the request as it is). */
const entries = new Map<string, { owner: WorkerOwner; give: EffortLevel | null }>()

/** The agentId in a runner the gate wrote (`subagent <agentId>`); undefined for any other runner. */
export function subagentOf(runner: string | null): string | undefined {
  // `subagent (agent id 미확인)` holds spaces: no match.
  return /^subagent (\S+)$/.exec(runner ?? '')?.[1]
}

function put(agentId: string, effort: string, owner: WorkerOwner): void {
  const id = agentId.trim()
  if (id === '') return
  const level = effort.trim()
  entries.delete(id)
  entries.set(id, { owner, give: isEffortLevel(level) ? level : null })
  if (entries.size > MAX_WORKERS) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) entries.delete(oldest)
  }
}

/** A start or a resume the gate let through for a task's brief: that agent's entry from now. */
export function noteWorkerEffort(agentId: string, effort: string, owner: WorkerOwner): void {
  put(agentId, effort, owner)
}

/** The brief's effort for a subagent's requests: its owner's level; undefined with no owner or one that leaves it. */
export function workerEffort(agentId: string): EffortLevel | undefined {
  return entries.get(agentId)?.give ?? undefined
}

/** After a run's state is saved: its entries whose task no longer holds that agent go. Other runs' entries stay. */
export function settleWorkerEfforts(state: RelayState): void {
  for (const [id, { owner }] of [...entries]) {
    if (owner.run !== state.run) continue
    const task = state.status === 'active' ? state.tasks.find(other => taskKey(other) === owner.task) : undefined
    const isHeld = task !== undefined && isBusy(task) && (task.runner === null || subagentOf(task.runner) === id)
    if (!isHeld) entries.delete(id)
  }
}

/** At session start: the entries again from the active runs' tasks that hold a subagent, in the order dispatched. */
export function refillWorkerEfforts(states: readonly RelayState[]): void {
  entries.clear()
  const held = states
    .filter(state => state.status === 'active')
    .flatMap(state => state.tasks.filter(task => isBusy(task) && subagentOf(task.runner) !== undefined).map(task => ({ state, task })))
    .sort((a, b) => (a.task.dispatchedAt ?? 0) - (b.task.dispatchedAt ?? 0))
  for (const { state, task } of held) put(subagentOf(task.runner) ?? '', task.effort, { run: state.run, task: taskKey(task) })
}
