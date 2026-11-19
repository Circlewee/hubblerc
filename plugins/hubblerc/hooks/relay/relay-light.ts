import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnCompleteReason } from 'claude-code'

import type { RelayLightLine, RelayStatus } from '../../types'
import type { BriefInput } from './relay-format'

/**
 * relay's light delegations in the sidebar's relay box: a task `spec_text` made has no run, no
 * state.json and no gate record, so its line is kept here, in this session's state alone (no other
 * session takes a light delegation over). Moved by events the plugin already takes, no timer:
 *   spec_text → ready; an Agent call whose prompt holds that spec → running; that subagent's
 *   turn.complete → done (aborted: cancelled; an error or a refusal: blocked); a SendMessage that
 *   resumes it → running again.
 * A finished line stays through the main answer it finished in and goes at the end of the next
 * one; a new spec_text while every line has finished starts the list afresh.
 * Orca workers (`worker-start --spec "<text>"`) are not followed: their end reaches the plugin by
 * no event, and a line that never ends would stay.
 */

const relayStatus = atom({ plugin: 'hubblerc', key: 'relayStatus' } as const, null)

/** More lines than the light path takes (3 workers), so a few earlier ones fit beside them. */
const MAX_LIGHT = 6
const TITLE_CHARS = 40

const isFinished = (line: RelayLightLine): boolean => line.status !== 'ready' && line.status !== 'running'

function cut(value: string, max: number): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim())

  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

/** The list with a new spec's line put in: one of the same id replaced, every finished line gone first if all are. */
export function withSpec(lines: readonly RelayLightLine[], brief: Pick<BriefInput, 'id' | 'title' | 'model' | 'effort'>): RelayLightLine[] {
  const kept = lines.every(isFinished) ? [] : lines.filter(line => line.id !== brief.id)
  const line: RelayLightLine = { key: brief.id, id: brief.id, rev: 1, title: cut(brief.title, TITLE_CHARS), status: 'ready', model: brief.model, effort: brief.effort, runner: '', dispatchedAt: null }

  return [...kept, line].slice(-MAX_LIGHT)
}

/** The task ids an Agent prompt holds a light spec of: its head line `# Task <id>: …` (a run's spec is `<id>-r<n>` and has `.relay/runs/` in it). */
export function specIdsIn(prompt: string): string[] {
  return [...prompt.matchAll(/^# Task ([A-Za-z][A-Za-z0-9_.]{0,19}): /gm)].map(found => found[1] ?? '')
}

/** The line a spawn took: running, by the subagent, from now. */
export function withSpawn(lines: readonly RelayLightLine[], id: string, agentId: string, now: number): RelayLightLine[] {
  return lines.map(line => (line.id === id ? { ...withoutEnd(line), status: 'running', agentId, runner: 'subagent', dispatchedAt: now } : line))
}

/** A resumed subagent (a SendMessage to it): its line running again. */
export function withResume(lines: readonly RelayLightLine[], agentId: string): RelayLightLine[] {
  return lines.map(line => (line.agentId === agentId ? { ...withoutEnd(line), status: 'running' } : line))
}

const END_STATUS: Record<TurnCompleteReason, string> = { answer: 'done', aborted: 'cancelled', error: 'blocked', refusal: 'blocked' }

/** A subagent's turn ended: its line done, cancelled or blocked. */
export function withTurnEnd(lines: readonly RelayLightLine[], agentId: string, reason: TurnCompleteReason): RelayLightLine[] {
  return lines.map(line => (line.agentId === agentId && line.status === 'running' ? { ...line, status: END_STATUS[reason] } : line))
}

/** A main answer ended: the lines that had finished before an earlier one ended go, the ones finished since are marked. */
export function withAnswerEnd(lines: readonly RelayLightLine[]): RelayLightLine[] {
  return lines.filter(line => line.isAnswerEnded !== true).map(line => (isFinished(line) ? { ...line, isAnswerEnded: true as const } : line))
}

function withoutEnd(line: RelayLightLine): RelayLightLine {
  const { isAnswerEnded: _, ...rest } = line

  return rest
}

/** Writes the light list when it changed; none left, the field goes. */
async function change($: EngineInterface, next: (lines: readonly RelayLightLine[]) => RelayLightLine[]): Promise<void> {
  const current = await read($, relayStatus)
  const before = current?.light ?? []
  const after = next(before)
  if (JSON.stringify(after) === JSON.stringify(before)) return
  await update($, relayStatus, (status): RelayStatus => {
    const { light: _, ...rest } = status ?? { runs: [] }

    return after.length === 0 ? rest : { ...rest, light: after }
  })
}

const knows = (lines: readonly RelayLightLine[], test: (line: RelayLightLine) => boolean): boolean => lines.some(test)

/** spec_text handed a spec out. */
export async function noteLightSpec($: EngineInterface, brief: Pick<BriefInput, 'id' | 'title' | 'model' | 'effort'>): Promise<void> {
  await change($, lines => withSpec(lines, brief))
}

/**
 * The light spec an Agent prompt carries that the list holds as ready or finished (sent again):
 * its id; undefined for any other prompt. Read before the spawn, so its start can be noted after.
 */
export async function lightSpecOf($: EngineInterface, prompt: string): Promise<string | undefined> {
  if (!prompt.includes('# Task ')) return undefined
  const lines = (await read($, relayStatus))?.light ?? []
  if (lines.length === 0) return undefined

  return specIdsIn(prompt).find(id => knows(lines, line => line.id === id && line.status !== 'running'))
}

export async function noteLightSpawn($: EngineInterface, id: string, agentId: string): Promise<void> {
  const now = await $.clock.now()
  await change($, lines => withSpawn(lines, id, agentId, now))
}

export async function noteLightResume($: EngineInterface, agentId: string): Promise<void> {
  await change($, lines => (knows(lines, line => line.agentId === agentId) ? withResume(lines, agentId) : [...lines]))
}

export async function noteLightTurnEnd($: EngineInterface, agentId: string, reason: TurnCompleteReason): Promise<void> {
  await change($, lines => withTurnEnd(lines, agentId, reason))
}

export async function noteLightAnswerEnd($: EngineInterface): Promise<void> {
  await change($, withAnswerEnd)
}

/** The light lines as held now, for `/relay-status`. */
export async function lightLines($: EngineInterface): Promise<RelayLightLine[]> {
  return (await read($, relayStatus))?.light ?? []
}
