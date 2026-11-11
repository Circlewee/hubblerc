import type { EngineInterface, TurnCompleteInput } from 'claude-code'

import { hasApiKey, judgesTodos, likely, recordOutcome } from '../likely/likely'
import { changeTodos, currentTodos, currentTurn, redrawTodos } from './todo'
import { setItemStatus } from './todo-format'
import type { TurnRef, UserTodo } from './todo-format'
import { awaits, cameTrue, candidatesFor, chosenId, DONE_QUIET_ANSWERS, doneInput, doneQuestion, PREVIOUS_CHARS, SAMPLES, SUGGEST_AT, suggestionToast, takeInput, takeQuestion, TASK_DONE, TASK_TAKE, valueOf } from './todo-judge-format'
import type { SuggestionKind, TodoSuggestion } from './todo-judge-format'

/*
 * The to-dos judged by likely (2026-11-12): an item's status moved by itself only when its ↗ text
 * was sent word for word, and never to done. Now, with an API key, each main-loop question is asked
 * "which waiting to-do, if any, does this start?" and each answer "which to-do in progress, if any,
 * did this finish?": a choice among the items and `none`, the kind of judgment likely is for (the
 * answer is in the text shown; a rule cannot read a to-do said in other words).
 *
 * For now a judgment changes nothing by itself. A sure enough one puts a line under the to-dos
 * ("시작? …  82%  맞음 아님") and a toast; the status moves on 맞음. What the person pressed is logged
 * as the decision's outcome, which is what a threshold for moving it unasked is to be read from.
 */

// Module state: a reload forgets it all, and judgments in flight are dropped by the counter.
let suggestion: TodoSuggestion | null = null
/** The judgments since the last question began, and the items each was shown: what a status moved by hand answers. */
let open: { decisionId: string; kind: SuggestionKind; candidates: number[] }[] = []
/** `kind:id` the person pressed 아님 on, with the count of answers then. */
const rejected = new Map<string, number>()
/** Main-loop answers begun in this session. */
let answers = 0
let question = ''
let previousAnswer = ''

/** At session.start. */
export function startTodoJudge(): void {
  suggestion = null
  open = []
  rejected.clear()
  answers = 0
  question = ''
  previousAnswer = ''
}

/** Whether judgments are made at all: the option on and a key to make them with. */
function canJudge(): boolean {
  return judgesTodos() && hasApiKey()
}

/** Whether the person said no to this item's suggestion lately enough that it is not put again. */
function isRejected(kind: SuggestionKind, id: number): boolean {
  const at = rejected.get(`${kind}:${id}`)

  return at !== undefined && (kind === 'take' || answers - at < DONE_QUIET_ANSWERS)
}

/** One judgment: the choice and how sure, or null when none was made (no key, a limit). */
async function ask($: EngineInterface, kind: SuggestionKind, candidates: readonly UserTodo[], input: string): Promise<{ decisionId: string; id: number | null; probability: number } | null> {
  const meta: Record<string, string> = {}
  const session = await $.session.id().catch(() => '')
  if (session !== '') meta.sessionId = session
  const result = await likely($, { task: kind === 'take' ? TASK_TAKE : TASK_DONE, input, questions: [kind === 'take' ? takeQuestion(candidates) : doneQuestion(candidates)], samples: SAMPLES, meta })
  if ('skipped' in result || result.logPath === undefined) return null
  const answer = result.answers[0]
  if (answer?.type !== 'choice') return null
  open.push({ decisionId: result.id, kind, candidates: candidates.map(item => item.id) })

  return { decisionId: result.id, id: chosenId(answer.choice), probability: answer.confidence }
}

async function note($: EngineInterface, decisionId: string, outcome: string | null, why: string): Promise<void> {
  await recordOutcome($, decisionId, outcome, why).catch(() => undefined)
}

/**
 * What the judgments since the last question came to, read off the list as it stands: an item moved
 * by hand (or by the model's tool) to what a judgment said answers it; a suggestion whose item moved
 * on or went is taken down. A suggestion still waiting on its item stays, for the person to press.
 */
async function settle($: EngineInterface): Promise<void> {
  if (open.length === 0 && suggestion === null) return
  const items = await currentTodos($)
  const statusOf = (id: number) => items.find(item => item.id === id)?.status
  for (const entry of open) {
    if (suggestion?.decisionId === entry.decisionId) continue
    const came = entry.candidates.find(id => {
      const status = statusOf(id)

      return status !== undefined && cameTrue(entry.kind, status)
    })
    if (came !== undefined) await note($, entry.decisionId, valueOf(came), 'by hand')
  }
  open = []
  const shown = suggestion
  if (shown === null) return
  const status = statusOf(shown.id)
  if (status !== undefined && awaits(shown.kind, status)) return
  suggestion = null
  if (status !== undefined && cameTrue(shown.kind, status)) await note($, shown.decisionId, valueOf(shown.id), 'by hand')
  else await note($, shown.decisionId, null, 'lapsed')
  await redrawTodos($)
}

/** A judgment's choice put to the person when it names an item, is sure enough, and was not refused. */
async function suggest($: EngineInterface, kind: SuggestionKind, made: { decisionId: string; id: number | null; probability: number }, at: TurnRef): Promise<void> {
  if (made.id === null || made.probability < SUGGEST_AT || isRejected(kind, made.id)) return
  const item = (await currentTodos($)).find(other => other.id === made.id)
  if (item === undefined || !awaits(kind, item.status)) return
  const before = suggestion
  const isSame = before !== null && before.kind === kind && before.id === item.id
  if (before !== null) await note($, before.decisionId, null, 'replaced')
  suggestion = { kind, id: item.id, text: item.text, probability: made.probability, decisionId: made.decisionId, at }
  await redrawTodos($)
  // Said once: the same item suggested again by a later judgment keeps its line and stays quiet.
  if (!isSame) $.ui.toast(suggestionToast(suggestion), { timeoutMs: 8000 })
}

/**
 * At a main-loop turn's start, not awaited: the last answer's judgments are settled, then the
 * question is judged against the waiting to-dos. `isOffered`: an item was taken up by its ↗ text
 * sent as offered, so nothing is left to judge. A judgment that comes back after a later question
 * began is dropped: it would be put under another question.
 */
export async function judgeTodoStart($: EngineInterface, text: string, isOffered: boolean): Promise<void> {
  answers += 1
  const mine = answers
  question = text
  await settle($)
  if (isOffered || !canJudge() || text.trim() === '') return
  const candidates = candidatesFor('take', await currentTodos($))
  if (candidates.length === 0) return
  const at = await currentTurn($)
  const made = await ask($, 'take', candidates, takeInput(text, previousAnswer))
  if (made === null || mine !== answers) return
  await suggest($, 'take', made, at)
}

/**
 * At a main-loop turn's end, not awaited: the answer is judged against the to-dos in progress (and
 * the item a "시작?" still waits on: one answer may start and finish it). Only an answer the model
 * gave whole is judged; its end is kept as the next question's context either way.
 */
export async function judgeTodoEnd($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  if (e.agentId !== undefined) return
  const answer = e.answer.trim()
  const asked = question
  if (answer !== '') previousAnswer = answer.slice(-PREVIOUS_CHARS)
  if (e.reason !== 'answer' || e.isAborted || answer === '' || !canJudge()) return
  const candidates = candidatesFor('done', await currentTodos($), suggestion?.kind === 'take' ? suggestion.id : undefined)
  if (candidates.length === 0) return
  const at = await currentTurn($)
  const made = await ask($, 'done', candidates, doneInput(asked, answer))
  if (made === null) return
  await suggest($, 'done', made, at)
}

/** While drawing: the suggestion to show, or null: none, or its item moved on or went (taken down at the next question). */
export function todoSuggestion(items: readonly UserTodo[]): TodoSuggestion | null {
  const shown = suggestion
  const item = shown === null ? undefined : items.find(other => other.id === shown.id)

  return shown !== null && item !== undefined && awaits(shown.kind, item.status) ? shown : null
}

/** 맞음: the item moves to what the judgment said, with the answer it was judged in; logged as the decision's outcome. */
export async function acceptTodoSuggestion($: EngineInterface): Promise<void> {
  const shown = suggestion
  if (shown === null) return
  suggestion = null
  const changed = await changeTodos($, record => {
    const item = record.items.find(other => other.id === shown.id)

    return item === undefined || !awaits(shown.kind, item.status) ? null : setItemStatus(record, shown.id, shown.kind === 'take' ? 'in_progress' : 'done', shown.at)
  }).catch(() => null)
  await note($, shown.decisionId, changed === null ? null : valueOf(shown.id), changed === null ? 'gone' : 'accepted')
  await redrawTodos($)
}

/** 아님: nothing moves, the item is not suggested so again for a while, and the refusal is logged. */
export async function rejectTodoSuggestion($: EngineInterface): Promise<void> {
  const shown = suggestion
  if (shown === null) return
  suggestion = null
  rejected.set(`${shown.kind}:${shown.id}`, answers)
  await note($, shown.decisionId, `not:${valueOf(shown.id)}`, 'rejected')
  await redrawTodos($)
}
