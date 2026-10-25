import { atom, update } from 'claude-code'
import type { EngineInterface, On, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { ToolRun, TurnRecord } from '../types'

const MAX_TURNS = 100
const MAX_RUNS_PER_TURN = 400

/** Calls the engine makes for its own bookkeeping, not work the person would count. */
export const IGNORED_TOOLS = new Set(['SubagentHandback'])

/** The session's main-loop turns, oldest first, each with the tool calls made while it ran. */
const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

export type CallInput = { tool: string; tool_use_id?: string; agentId?: string }

/** At turn.start: a main-loop turn opens a record. */
export async function startTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined) return

  const turn: TurnRecord = {
    id: e.turnId,
    prompt: promptLabel(e.text),
    startedAt: await $.clock.now(),
    durationMs: null,
    runs: [],
  }
  await update($, turns, list => [...list, turn].slice(-MAX_TURNS))
}

/** After a tool call ran: it joins its turn (a subagent's joins the turn that started the subagent). */
export async function recordRun($: EngineInterface, e: CallInput, ran: ToolCallResult, ms: number): Promise<void> {
  const run = describeRun(e, ran, ms)
  const spawned = run.tool === 'Agent' && !run.isError ? spawnedAgent(ran.result) : undefined
  await update($, turns, list => addRun(list, run, spawned))
}

/**
 * At turn.complete, before the engine appends the row that closes the turn: the turn gets its
 * duration, so the row can be tied to it as it lands.
 */
export async function completeTurn($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  if (e.agentId !== undefined) return

  await update($, turns, list => list.map(turn => (turn.id === e.turnId ? { ...turn, durationMs: e.durationMs } : turn)))
}

/**
 * The row that closes a turn is appended as the turn completes: its id ties the drawn line to the
 * turn exactly. The time the line shows can differ from the turn's own (after a background agent
 * the engine may count from an earlier prompt), so matching by time alone can miss.
 */
export function trackLines(on: On): void {
  on('session.append', { door: 'notice' }, async ($, e, next) => {
    const stored = await next(e)

    if (e.agentId === undefined && e.door === 'notice' && e.message.name === 'turn_duration') {
      try {
        await update($, turns, list => linkLine(list, e.uuid))
      } catch {
        // Linking is best effort: the line falls back to matching by time.
      }
    }

    return stored
  }).catch(($, e, next) => next(e))
}

/** Gives the closing row's id to the latest completed turn that has none yet. */
function linkLine(list: readonly TurnRecord[], lineId: string): TurnRecord[] {
  const target = lastIndex(list, turn => turn.durationMs !== null && turn.lineId === undefined)

  return list.map((turn, i) => (i === target ? { ...turn, lineId } : turn))
}

/** The prompt as a person would name it: the cross-session preamble and wrapper tags taken off. */
export function promptLabel(text: string): string {
  return text
    .replace(/^Another Claude session sent a message:\s*/, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function describeRun(e: CallInput, ran: ToolCallResult, ms: number): ToolRun {
  const args = e as unknown as Record<string, unknown>
  const run: ToolRun = {
    id: e.tool_use_id ?? '',
    tool: String(e.tool),
    ms: Math.max(0, Math.round(ms)),
    isError: ran.deny !== undefined || ran.isError === true,
  }

  if (e.agentId !== undefined) run.agentId = e.agentId

  const path = text(args.file_path) ?? text(args.notebook_path)
  if (path !== undefined) run.path = path

  if (run.tool === 'Bash') {
    const command = text(args.command)
    const description = text(args.description)
    if (command !== undefined) run.command = command.slice(0, 400)
    if (description !== undefined) run.description = description.slice(0, 200)
  }

  if (!run.isError && (run.tool === 'Edit' || run.tool === 'Write')) {
    const lines = changedLines(ran.result)
    if (lines !== undefined) {
      run.added = lines.added
      run.removed = lines.removed
    }
  }

  return run
}

/**
 * Adds the run to its turn: a subagent's call to the turn that started that subagent, any other
 * call to the turn still running. An Agent call's new subagent is recorded on the same turn.
 */
function addRun(list: readonly TurnRecord[], run: ToolRun, spawned?: string): TurnRecord[] {
  const owner = run.agentId === undefined ? -1 : lastIndex(list, turn => turn.agents?.includes(run.agentId ?? '') === true)
  const target = owner !== -1 ? owner : lastIndex(list, turn => turn.durationMs === null)
  if (target === -1) return [...list]

  return list.map((turn, i) => {
    if (i !== target) return turn
    const runs = turn.runs.length < MAX_RUNS_PER_TURN ? [...turn.runs, run] : turn.runs
    const agents = spawned === undefined ? turn.agents : [...(turn.agents ?? []), spawned]

    return agents === undefined ? { ...turn, runs } : { ...turn, runs, agents }
  })
}

function lastIndex(list: readonly TurnRecord[], test: (turn: TurnRecord) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const turn = list[i]
    if (turn !== undefined && test(turn)) return i
  }

  return -1
}

/** The id of the subagent an Agent call started, from its result (finished or still running). */
function spawnedAgent(result: unknown): string | undefined {
  return isRecord(result) ? text(result.agentId) : undefined
}

/** Counts the + and - lines of an Edit or Write result's patch; a new file counts its lines. */
export function changedLines(result: unknown): { added: number; removed: number } | undefined {
  if (!isRecord(result)) return undefined

  const patch = Array.isArray(result.structuredPatch) ? result.structuredPatch : []
  if (patch.length === 0 && result.type === 'create' && typeof result.content === 'string') {
    return { added: countLines(result.content), removed: 0 }
  }

  let added = 0
  let removed = 0
  for (const hunk of patch) {
    const lines: unknown[] = isRecord(hunk) && Array.isArray(hunk.lines) ? hunk.lines : []
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }

  return { added, removed }
}

function countLines(content: string): number {
  if (content === '') return 0
  const count = content.split('\n').length

  return content.endsWith('\n') ? count - 1 : count
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
