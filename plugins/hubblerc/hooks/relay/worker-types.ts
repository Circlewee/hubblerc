import type { EngineInterface } from 'claude-code'

import { isEffortLevel } from '../effort/levels'

/**
 * relay's worker agent types, one per effort level: `hubblerc:relay-worker-<level>`. A subagent
 * cannot be started with an effort of its own, but an agent type can carry one, and a subagent of
 * that type sends every request at it whatever the session's [확인: 2026-11-11 lead test, type
 * registered with effort low under a session at high: its requests went at low; the model the call
 * gave was kept]. The gate starts a brief's worker as the type of the brief's effort, so its effort
 * is fixed when it starts and nothing has to be remembered per request.
 *
 * The types carry no model (the Agent call's decides) and no tools (the parent's, all). They are
 * not hidden (`agent.offer`): the engine refuses to start a hidden type when the Agent call is
 * rewritten to it. Registered at session start; a failure (the session not yet bound, a schema
 * refusal) leaves the session to start as usual.
 */

export const WORKER_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

const WORKER_DESCRIPTION =
  'Worker for one task brief of a hubblerc relay run. hubblerc picks the type matching the brief’s effort when the lead starts a subagent on a brief; there is no need to choose it.'

const WORKER_PROMPT = [
  'You are a worker in a lead-and-workers workflow.',
  'You are given the path of a task brief. Read the whole brief first, then follow its Goal, Done when, Rules and Report format exactly as written.',
  'Do only what the brief asks; anything outside it, ask as its Rules say.',
  "Follow the repository's CLAUDE.md.",
  'When you are blocked, stop and report as the brief’s Rules and Report format say.',
].join('\n')

/** The short name of the worker type for an effort: `relay-worker-high`. */
const typeName = (level: string): string => `relay-worker-${level}`

/** The full agent type a brief's worker starts as: `hubblerc:relay-worker-<level>`; undefined for an effort that is no level. */
export function workerTypeOf(effort: string): string | undefined {
  const level = effort.trim()

  return isEffortLevel(level) ? `hubblerc:${typeName(level)}` : undefined
}

/** At session start: the five worker types; one that fails does not stop the others or the start. */
export async function registerWorkerTypes($: EngineInterface): Promise<void> {
  for (const level of WORKER_LEVELS) {
    await $.agent.register({ name: typeName(level), description: WORKER_DESCRIPTION, prompt: WORKER_PROMPT, effort: level }).catch(() => undefined)
  }
}
