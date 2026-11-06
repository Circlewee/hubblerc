import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { appendLogLine, defaultLogFolder } from '../shared/jsonl-log'
import { maskSecrets } from '../shared/log-safety'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

/**
 * Auto effort's record (2026-11-05): each pick a line of this machine's JSONL in
 * `hubblerc/auto-effort/` (iCloud Drive, else `~/.claude/hubblerc/auto-effort/`), and what came after
 * it appended as outcome lines, the pick's line never rewritten. What the picks can later be judged
 * by: the person changing the effort the same answer or before the next question (strong), the next
 * question (a correction or a retry, read later), and the answer's failures, time and output. Esc is
 * no signal: it is pressed when needed, not at a pick the person disliked.
 */

/** The classifier's prompt and its reply's form; raised whenever either changes. 2: a level and a reason. */
export const EFFORT_PROMPT_VERSION = 2
/** How much of the question the line keeps (secrets masked), and of the next question. */
const QUESTION_CHARS = 500
const NEXT_CHARS = 200
const MAX_RECORDS = 10

/** What a pick came to: the level (null when none came), the reason given, how long and how many tokens it took. */
export type PickResult = { effort: string | null; reason: string | null; latencyMs: number; tokens: { input: number; output: number } | null; error?: string }

type PickRecord = {
  id: string
  turnId: string
  at: number
  session: string
  /** The answer's number in the session. */
  turn: number
  question: string
  hadContext: boolean
  result?: PickResult
  /** The effort the turn's first request went out with, and whose. */
  first?: { effort: string; source: string }
  isTurnDone: boolean
  isWritten: boolean
  isTurnWritten: boolean
}

// Module state: a reload forgets picks in flight; their lines are not written.
/** Picks of this session, by turn id, the last few. */
const records = new Map<string, PickRecord>()
/** The pick a change of effort or the next question is a signal on: the last, till the next question. */
let latest: PickRecord | null = null
let folder: string | null = null

/** At session.start. */
export function resetEffortRecord(): void {
  records.clear()
  latest = null
  folder = null
}

async function append($: EngineInterface, line: Record<string, unknown>): Promise<void> {
  folder ??= await defaultLogFolder($, 'auto-effort')
  await appendLogLine($, folder, JSON.stringify(line))
}

/** At a main-loop question: the pick before it gets the question as its signal, and is the latest no more. */
export async function noteNextQuestion($: EngineInterface, text: string): Promise<void> {
  const before = latest
  latest = null
  if (before === null) return
  await append($, { type: 'outcome', id: before.id, at: new Date(await $.clock.now()).toISOString(), kind: 'next', question: maskSecrets(text).slice(0, NEXT_CHARS) })
}

/** As a pick starts: its record, the latest from now on. */
export async function notePickStart($: EngineInterface, turnId: string, question: string, hadContext: boolean): Promise<void> {
  const at = await $.clock.now()
  const record: PickRecord = {
    id: `e_${at.toString(36)}_${Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')}`,
    turnId,
    at,
    session: await $.session.id().catch(() => ''),
    turn: (await read($, turns)).length,
    question: maskSecrets(question).slice(0, QUESTION_CHARS),
    hadContext,
    isTurnDone: false,
    isWritten: false,
    isTurnWritten: false,
  }
  records.set(turnId, record)
  for (const id of [...records.keys()].slice(0, Math.max(0, records.size - MAX_RECORDS))) records.delete(id)
  latest = record
}

/** The pick came, or did not. */
export async function notePickDone($: EngineInterface, turnId: string, result: PickResult): Promise<void> {
  const record = records.get(turnId)
  if (record === undefined) return
  record.result = result
  await writeWhatIsKnown($, record)
}

/** The turn's first request went out: with the pick, or at the engine's effort (the pick late). */
export async function noteFirstRequest($: EngineInterface, turnId: string, effort: string, source: string): Promise<void> {
  const record = records.get(turnId)
  if (record === undefined || record.first !== undefined) return
  record.first = { effort, source }
  await writeWhatIsKnown($, record)
}

/** The turn completed: its failures, time and output follow the pick's line. */
export async function noteTurnDone($: EngineInterface, turnId: string): Promise<void> {
  const record = records.get(turnId)
  if (record === undefined) return
  record.isTurnDone = true
  await writeWhatIsKnown($, record)
}

/**
 * The person set the effort (the slider, or the engine's `/effort`) the same answer or before the
 * next question: the strongest signal on the latest pick. `to` the level set (`auto`, `engine` for
 * the engine's own), null where it is not known (the engine's slider).
 */
export async function noteEffortChange($: EngineInterface, to: string | null, via: 'slider' | 'engine'): Promise<void> {
  if (latest === null) return
  await append($, { type: 'outcome', id: latest.id, at: new Date(await $.clock.now()).toISOString(), kind: 'effort-change', via, to })
}

/** The level a `/effort` command's words name, if any. */
export function effortWord(args: string): string | null {
  const word = args.trim().toLowerCase().split(/\s+/)[0] ?? ''

  return ['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(word) ? word : null
}

/**
 * The pick's line once its result and its first request (or the turn's end) are known, then the
 * turn's line once the turn ended. Each written once: marked before the write.
 */
async function writeWhatIsKnown($: EngineInterface, record: PickRecord): Promise<void> {
  if (!record.isWritten && record.result !== undefined && (record.first !== undefined || record.isTurnDone)) {
    record.isWritten = true
    const { result, first } = record
    await append($, {
      type: 'decision',
      id: record.id,
      at: new Date(record.at).toISOString(),
      session: record.session,
      turn: record.turn,
      promptVersion: EFFORT_PROMPT_VERSION,
      question: record.question,
      hadContext: record.hadContext,
      effort: result.effort,
      reason: result.reason,
      latencyMs: result.latencyMs,
      tokens: result.tokens,
      ...(result.error === undefined ? {} : { error: result.error }),
      // Whether the first request went out at the pick: false when it waited past its limit, or the person had set a level.
      appliedFirst: first === undefined ? null : first.source === 'auto',
      ...(first === undefined ? {} : { firstEffort: first.effort }),
    })
  }
  if (record.isWritten && record.isTurnDone && !record.isTurnWritten) {
    record.isTurnWritten = true
    const turn = (await read($, turns)).find(other => other.id === record.turnId)
    await append($, {
      type: 'outcome',
      id: record.id,
      at: new Date(await $.clock.now()).toISOString(),
      kind: 'turn',
      failures: turn?.runs.filter(run => run.isError).length ?? null,
      durationMs: turn?.durationMs ?? null,
      outputTokens: turn?.tokens?.output ?? null,
    })
  }
}
