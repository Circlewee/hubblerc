import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { ToolRun, TurnRecord } from '../types'
import { pointsUsed } from './forecast'

export const MAX_TURNS = 100
export const MAX_RUNS_PER_TURN = 400

/** Calls the engine makes for its own bookkeeping, not work the person would count. */
export const IGNORED_TOOLS = new Set(['SubagentHandback'])

/** The session's main-loop turns, oldest first, each with the tool calls made while it ran. */
const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const usage = atom({ plugin: 'hubblerc', key: 'usage' } as const, null)
/** A question's row ties to the turn that starts within this long of it. */
const PROMPT_ROW_WINDOW_MS = 10_000

/**
 * A question's row seen before its turn started, kept for that turn. Module state: a reload
 * between the two loses the tie, and the contents' entry then scrolls to the answer's end.
 */
let pendingPromptRow: { uuid: string; at: number } | undefined

export type CallInput = { tool: string; tool_use_id?: string; agentId?: string }

/** At turn.start: a main-loop turn opens a record. */
export async function startTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined) return

  const startedAt = await $.clock.now()
  const turn: TurnRecord = {
    id: e.turnId,
    prompt: promptLabel(e.text),
    startedAt,
    durationMs: null,
    runs: [],
  }
  const key = promptKey(e.text)
  if (key !== '') turn.promptKey = key
  const fiveHour = (await read($, usage))?.fiveHour
  if (fiveHour !== undefined) turn.fiveHourAtStart = fiveHour
  if (pendingPromptRow !== undefined && startedAt - pendingPromptRow.at <= PROMPT_ROW_WINDOW_MS) turn.promptRowId = pendingPromptRow.uuid
  pendingPromptRow = undefined
  await update($, turns, list => [...list, turn].slice(-MAX_TURNS))
}

/**
 * The row of a question the person typed: its id lets the sidebar's contents scroll to it. Tied to
 * the turn it begins, whichever of the two the engine raises first.
 */
export function trackPrompts(on: On): void {
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored

    try {
      const now = await $.clock.now()
      const list = await read($, turns)
      const last = list.at(-1)
      if (last !== undefined && last.durationMs === null && last.promptRowId === undefined && now - last.startedAt <= PROMPT_ROW_WINDOW_MS) {
        await update($, turns, all => all.map(turn => (turn.id === last.id ? { ...turn, promptRowId: e.uuid } : turn)))
      } else {
        pendingPromptRow = { uuid: e.uuid, at: now }
      }
    } catch {
      // Best effort: without the row the contents scroll to the answer's end.
    }

    return stored
  }).catch(($, e, next) => next(e))
}

/** After a tool call ran: it joins its turn (a subagent's joins the turn that started the subagent). */
export async function recordRun($: EngineInterface, e: CallInput, ran: ToolCallResult, ms: number): Promise<void> {
  const run = describeRun(e, ran, ms)
  const spawned = run.tool === 'Agent' && !run.isError ? spawnedAgent(ran.result) : undefined
  if (spawned !== undefined) run.spawned = spawned
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
 * After a turn completed and the usage was read again: the points of the 5-hour window it took.
 * Read from the account's figures, so another session's use in the meantime counts too.
 */
export async function noteFiveHourUsed($: EngineInterface, turnId: string): Promise<void> {
  const after = (await read($, usage))?.fiveHour
  await update($, turns, list =>
    list.map(turn => {
      if (turn.id !== turnId) return turn
      const used = pointsUsed(turn.fiveHourAtStart, after)

      return used === null ? turn : { ...turn, fiveHourUsed: used }
    }),
  )
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

const CROSS_SESSION_PREAMBLE = /^\s*Another Claude session sent a message:\s*/
const TASK_SUMMARY = /<task-notification>[\s\S]*?<summary>([\s\S]*?)<\/summary>/

/**
 * The prompt as a person would name it: the cross-session preamble and wrapper tags taken off; a
 * background task's notification by its summary, a subagent's hand-back by what it is.
 */
export function promptLabel(text: string): string {
  const summary = TASK_SUMMARY.exec(text)?.[1]
  if (summary !== undefined) return `알림: ${flatten(summary)}`.slice(0, 120)
  if (text.includes('<task-notification>')) return '(작업 알림)'

  const body = flatten(text.replace(CROSS_SESSION_PREAMBLE, ''))
  if (body.startsWith('[Subagent hand-back]')) return '(서브에이전트 보고)'

  return body.slice(0, 120)
}

/**
 * What the question's row shows, flattened: the key the contents find that row by (a UserMessage
 * draws a notification's summary, another party's message less its framing).
 */
export function promptKey(text: string): string {
  const summary = TASK_SUMMARY.exec(text)?.[1]

  return flatten(summary ?? text.replace(CROSS_SESSION_PREAMBLE, '')).slice(0, 80)
}

function flatten(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function describeRun(e: CallInput, ran: ToolCallResult, ms: number): ToolRun {
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

  const pattern = run.tool === 'WebSearch' ? text(args.query) : run.tool === 'Grep' || run.tool === 'Glob' ? text(args.pattern) : undefined
  if (pattern !== undefined) run.pattern = pattern.slice(0, 200)

  if (run.tool === 'Agent') {
    const description = text(args.description)
    const agentType = text(args.subagent_type)
    if (description !== undefined) run.description = description.slice(0, 200)
    if (agentType !== undefined) run.agentType = agentType
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
