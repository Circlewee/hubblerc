import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionMessage, ToolCallResult, ToolUseSummary } from 'claude-code'

import type { ToolRun, TurnRecord } from '../types'
import { describeRun, isIgnoredTool, MAX_RUNS_PER_TURN, MAX_TURNS, promptKey, promptLabel } from './activity'
import { restoreSnapshot } from './relaunch'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const sessionId = atom({ plugin: 'hubblerc', key: 'sessionId' } as const, '')

/** Subagents whose own transcripts a rebuild reads for their tool calls, newest answers first. */
const MAX_RESTORED_AGENTS = 30
/** A resumed session may not hand its transcript over at once: one more try after this long. */
const RESTORE_RETRY_MS = 2000
/** The opening of the summary a compaction leaves as a user message. */
const COMPACT_PREFIX = 'This session is being continued from a previous conversation'
/** The opening of a skill's body, sent after the command that invoked it. */
const SKILL_PREFIX = 'Base directory for this skill'
/** What the engine records as the answer to a local command (/reload-plugins …): no answer. */
const NO_RESPONSE = 'No response requested.'
/** The tags a slash command's rows are made of (`<command-name>/reload-plugins</command-name>` …). */
const COMMAND_TAGS = /<(command-name|command-message|command-args|local-command-[a-z]+)>[\s\S]*?<\/\1>/g
const REMINDERS = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** A message as `$.session.messages({ as: "api" })` hands it: the blocks the model was sent. */
type Block = { type: string; [field: string]: unknown }
export type ApiLike = { role: 'user' | 'assistant'; content: readonly Block[] }

/** What a question asks: its label, its key, and its text as written (reminders taken off). */
type Prompt = { title: string; key?: string; text: string }

/** An answer of the transcript: the message that asked it (its place and prompt), and the assistant's messages after it. */
export type TranscriptAnswer = { index: number; prompt: Prompt; replies: ApiLike[] }

/**
 * At session.start: a session opened again (--resume, /resume) starts with no record, so its
 * answers are rebuilt from the transcript. The same session (a reload of the plugin) keeps the
 * record it has, which knows the times the transcript does not.
 */
export async function restoreTurns($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  const known = await read($, sessionId)
  const list = await read($, turns)
  await update($, sessionId, () => id)
  // The same session reloaded, or the first load of a copy that kept no id: what was recorded live stays.
  if (list.length > 0 && (known === id || known === '')) return
  // Opened again by hubblerc's restart: what it saved, times and all.
  if (await restoreSnapshot($, id).catch(() => false)) return

  const rebuilt = await rebuildTurns($)
  await update($, turns, () => rebuilt)
  if (rebuilt.length > 0) return

  $.clock.after(RESTORE_RETRY_MS, () => {
    void (async () => {
      if ((await $.session.id()) !== id || (await read($, turns)).length > 0) return
      const late = await rebuildTurns($)
      if (late.length > 0) await update($, turns, now => (now.length > 0 ? now : late))
    })().catch(() => undefined)
  })
}

/**
 * The answers in the transcript, each with its tool calls and those of the subagents it started.
 * The form the model was sent tells the answers apart (another session's message, a notification:
 * rows the plain form leaves out); the plain form holds each call's stored result.
 */
async function rebuildTurns($: EngineInterface): Promise<TurnRecord[]> {
  const [sent, rows] = await Promise.all([$.session.messages({ as: 'api' }), $.session.messages()])
  const list = turnsFromTranscript(sent, rows).slice(-MAX_TURNS)

  let agentsRead = 0
  for (const turn of [...list].reverse()) {
    for (const agentId of turn.agents ?? []) {
      if (agentsRead >= MAX_RESTORED_AGENTS) return list
      agentsRead += 1
      const found = await $.session.messages({ agentId }).catch(() => undefined)
      if (!Array.isArray(found)) continue
      const uses = found.flatMap(message => message.toolUses).filter(use => !isIgnoredTool(use.tool))
      for (const use of uses) if (turn.runs.length < MAX_RUNS_PER_TURN) turn.runs.push(runFromUse(use, agentId))
    }
  }

  return list
}

/**
 * The answers of a transcript: a user message with something to answer opens one (tool results,
 * reminders and a local command's rows do not), and what the assistant did until the next is its
 * runs. A message nobody answered is no answer.
 *
 * @param sent the messages as the model was sent them
 * @param rows the transcript's messages, whose tool uses hold the stored results
 */
export function turnsFromTranscript(sent: readonly ApiLike[], rows: readonly SessionMessage[]): TurnRecord[] {
  const stored = new Map(rows.flatMap(message => message.toolUses).map(use => [use.tool_use_id, use] as const))
  const failed = new Set(
    sent.flatMap(message => message.content).flatMap(block => (block.type === 'tool_result' && block.is_error === true ? [String(block.tool_use_id)] : [])),
  )

  return answersOf(sent).map(answer => {
    const turn: TurnRecord = { id: `restored-${answer.index}`, prompt: answer.prompt.title, startedAt: 0, durationMs: 0, runs: [], restored: true }
    if (answer.prompt.key !== undefined && answer.prompt.key !== '') turn.promptKey = answer.prompt.key
    for (const block of answer.replies.flatMap(message => message.content)) {
      if (block.type !== 'tool_use') continue
      const id = String(block.id ?? '')
      const tool = String(block.name ?? '')
      if (isIgnoredTool(tool)) continue
      const input = typeof block.input === 'object' && block.input !== null ? (block.input as Record<string, unknown>) : {}
      const use: ToolUseSummary = stored.get(id) ?? { tool_use_id: id, tool, input, ...(failed.has(id) ? { isError: true as const } : {}) }
      if (turn.runs.length < MAX_RUNS_PER_TURN) turn.runs.push(runFromUse(use))
      if (tool === 'Agent' && use.agentId !== undefined) turn.agents = [...(turn.agents ?? []), use.agentId]
    }

    return turn
  })
}

/**
 * Where the answers of a transcript part: a user message with something to answer opens one (tool
 * results, reminders and a local command's rows do not), and what the assistant did until the next
 * is its replies. A message nobody answered (no text, no tool call) is no answer. The record rebuilt
 * on a resume and the answer pane (`answer.tsx`) both read the transcript so.
 *
 * @param sent the messages as the model was sent them
 */
export function answersOf(sent: readonly ApiLike[]): TranscriptAnswer[] {
  const result: TranscriptAnswer[] = []
  let current: TranscriptAnswer | undefined
  let isAnswered = false
  const close = () => {
    if (current !== undefined && isAnswered) result.push(current)
    current = undefined
    isAnswered = false
  }

  sent.forEach((message, index) => {
    if (message.role === 'user') {
      if (message.content.some(block => block.type === 'tool_result')) return
      const prompt = promptOf(message.content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])))
      if (prompt !== undefined) {
        close()
        current = { index, prompt, replies: [] }
      }

      return
    }

    if (current === undefined) current = { index, prompt: { title: '', text: '' }, replies: [] }
    current.replies.push(message)
    for (const block of message.content) {
      if (block.type === 'tool_use') isAnswered = true
      if (block.type === 'text' && typeof block.text === 'string') {
        const answer = block.text.trim()
        if (answer !== '' && answer !== NO_RESPONSE) isAnswered = true
      }
    }
  })
  close()

  return result
}

/** An answer's own words: its text blocks, the assistant's "No response requested." left out. */
export function answerText(answer: TranscriptAnswer): string {
  return answer.replies
    .flatMap(message => message.content)
    .flatMap(block => (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== NO_RESPONSE ? [block.text.trim()] : []))
    .filter(text => text !== '')
    .join('\n\n')
}

/**
 * What a user message asks, from its text blocks: the last one with something to answer (a typed
 * question, another session's message, a notification), else the slash command that invoked a
 * skill; undefined when it holds only reminders and a local command's rows.
 */
function promptOf(texts: readonly string[]): Prompt | undefined {
  let prompt: Prompt | undefined
  let command: string | undefined

  for (const raw of texts) {
    const text = raw.replace(REMINDERS, '').trim()
    if (text === '' || text.startsWith(SKILL_PREFIX)) continue
    if (/<(command-name|local-command-[a-z]+)>/.test(text) && text.replace(COMMAND_TAGS, '').trim() === '') {
      command = commandTitle(text) ?? command
      continue
    }
    prompt = text.startsWith(COMPACT_PREFIX) ? { title: '(압축 후 이어짐)', text } : { title: promptLabel(text), key: promptKey(text), text }
  }

  if (prompt !== undefined) return prompt

  return command === undefined ? undefined : { title: command, key: promptKey(command), text: command }
}

/** The command a row names, as typed: `/plugin-authoring make a pane`. */
function commandTitle(text: string): string | undefined {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  if (name === undefined || name === '') return undefined
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
  const typed = name.startsWith('/') ? name : `/${name}`

  return promptLabel(args === '' ? typed : `${typed} ${args}`)
}

/** A transcript's tool use as a run; `agentId` when a subagent made it. */
function runFromUse(use: ToolUseSummary, agentId?: string): ToolRun {
  const call = { ...use.input, tool: use.tool, tool_use_id: use.tool_use_id, ...(agentId === undefined ? {} : { agentId }) }
  const ran = { result: use.result, ...(use.isError === true ? { isError: true } : {}) } as unknown as ToolCallResult
  const run = describeRun(call, ran, use.durationMs ?? 0)
  if (use.agentId !== undefined) run.spawned = use.agentId

  return run
}
