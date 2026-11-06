import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, MarkdownProps, On } from 'claude-code'

import type { TurnRecord } from '../../types'
import { THEME_COLORS } from '../status/band-format'
import { ANSWER_ID, SIDEBAR_COLUMNS } from '../shared/pane'
import { answersOf, answerText } from './restore'
import type { ApiLike, TranscriptAnswer } from './restore'
import { formatDuration, summarize } from './summary'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const tick = atom({ plugin: 'hubblerc', key: 'tick' } as const, 0)
const answerVersion = atom({ plugin: 'hubblerc', key: 'answerVersion' } as const, 0)

/** The answer's text the pane draws at most; the rest is counted ("외 N줄"). */
const MAX_BODY_LINES = 200
/** Where the summaries are kept, by session and answer number, the newest `MAX_SUMMARIES`. */
const SUMMARY_KEY = 'answerSummaries'
const MAX_SUMMARIES = 200
/** The small model, through the session's own login (as auto effort asks it): never likely's key. */
const SUMMARY_MODEL = 'haiku'
const SUMMARY_TIMEOUT_MS = 30_000
/** How much of the question and the answer the summary is asked about. */
const MAX_SUMMARY_INPUT_CHARS = 12_000
const SUMMARY_SYSTEM = 'You summarize one answer of a coding assistant for the person who asked it. Reply in Korean, in 3 to 5 short lines, plain text with no headings: what was asked, what was done or found, what is left.'

/**
 * The answer the pane shows: what a press on the contents could not scroll to. The module's, not
 * state (an answer's text runs long); `answerVersion` redraws the pane. A reload forgets it.
 */
type AnswerView = { number: number; session: string; question: string; line: string; body: string; hidden: number; isFound: boolean; fullBody: string }
let view: AnswerView | null = null
/** The summary of the answer shown: asked for, written, or why not. */
let summary: { key: string; state: 'running' | 'done' | 'failed'; text: string } | null = null

/**
 * The answer in the transcript a turn of the record is: the same question counted from the end (the
 * record keeps the last hundred), else the same place from the end.
 */
export function findAnswer(list: readonly TurnRecord[], turn: TurnRecord, answers: readonly TranscriptAnswer[]): TranscriptAnswer | undefined {
  const at = list.indexOf(turn)
  if (at < 0) return undefined
  const key = turn.promptKey
  if (key !== undefined && key !== '') {
    const later = list.slice(at + 1).filter(other => other.promptKey === key).length
    const same = answers.filter(answer => answer.prompt.key === key)

    return same[same.length - 1 - later]
  }

  return answers[answers.length - (list.length - at)]
}

/** The line under the question: how long it took, then the closing line's summary. */
export function answerLine(turn: TurnRecord): string {
  const time = turn.durationMs === null ? '진행 중' : turn.restored === true ? '' : formatDuration(turn.durationMs)

  return [time, summarize(turn) || '도구 없음'].filter(part => part !== '').join(' · ')
}

/**
 * A press on an answer of the contents whose row could not be scrolled to: the answer opens in a pane
 * of its own (a tab beside the sidebar under the fullscreen layout), with its question, its closing
 * line's summary and its text from the transcript. Esc or its ✕ closes it.
 */
export async function openAnswer($: EngineInterface, entry: { id: string; number: number }): Promise<void> {
  const list = await read($, turns)
  const turn = list.find(other => other.id === entry.id)
  const sent = (await $.session.messages({ as: 'api' }).catch(() => [])) as unknown as ApiLike[]
  const found = turn === undefined ? undefined : findAnswer(list, turn, answersOf(sent))
  const fullBody = found === undefined ? '' : answerText(found)
  const lines = fullBody.split('\n')
  view = {
    number: entry.number,
    session: await $.session.id().catch(() => ''),
    question: found?.prompt.text || turn?.prompt || '',
    line: turn === undefined ? '' : answerLine(turn),
    body: lines.slice(0, MAX_BODY_LINES).join('\n'),
    hidden: Math.max(0, lines.length - MAX_BODY_LINES),
    isFound: found !== undefined,
    fullBody,
  }
  const key = summaryKey(view)
  const cached = (await readSummaries($))[key]
  summary = cached === undefined ? null : { key, state: 'done', text: cached }
  await update($, answerVersion, n => n + 1)
  await $.ui.open({ id: ANSWER_ID, title: `#${entry.number} 답변`, columns: SIDEBAR_COLUMNS, closeOnEscape: true, focus: true })
}

function summaryKey(shown: AnswerView): string {
  return `${shown.session}:${shown.number}`
}

async function readSummaries($: EngineInterface): Promise<Record<string, string>> {
  const stored = await $.store.get(SUMMARY_KEY).catch(() => undefined)
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}

  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/**
 * [요약 보기]: three to five lines in Korean from the small model, through the session's login (the
 * path auto effort takes; nothing of likely's key, budget or log). Kept per answer in the store, the
 * last `MAX_SUMMARIES`: a press again reads it back.
 */
export async function summarizeAnswer($: EngineInterface): Promise<void> {
  const shown = view
  if (shown === null || !shown.isFound || summary?.state === 'running') return
  const key = summaryKey(shown)
  const cached = (await readSummaries($))[key]
  if (cached !== undefined) {
    summary = { key, state: 'done', text: cached }
    await update($, answerVersion, n => n + 1)

    return
  }
  summary = { key, state: 'running', text: '' }
  await update($, answerVersion, n => n + 1)
  const prompt = `<question>\n${shown.question.slice(0, 2000)}\n</question>\n\n<answer>\n${shown.fullBody.slice(0, MAX_SUMMARY_INPUT_CHARS)}\n</answer>`
  const reply = await $.model
    .complete({ model: SUMMARY_MODEL, system: SUMMARY_SYSTEM, prompt, maxTokens: 500, timeoutMs: SUMMARY_TIMEOUT_MS })
    .catch((error: unknown) => ({ isAnswered: false as const, reason: String(error) }))
  const text = reply.isAnswered ? reply.text.trim() : ''
  if (text === '') {
    summary = { key, state: 'failed', text: reply.isAnswered ? '빈 답이 왔습니다' : String(reply.reason) }
  } else {
    summary = { key, state: 'done', text }
    const kept = Object.entries({ ...(await readSummaries($)), [key]: text }).slice(-MAX_SUMMARIES)
    await $.store.set(SUMMARY_KEY, Object.fromEntries(kept)).catch(() => undefined)
  }
  await update($, answerVersion, n => n + 1)
}

/** The answer let go of, and the band asked to look again whether to stand aside: on any close. */
async function forgetAnswer($: EngineInterface): Promise<void> {
  view = null
  summary = null
  await update($, tick, n => n + 1)
}

/**
 * The pane's own " ✕ 닫기 ", top right: the engine's close mark sits on the frame and went unseen with
 * the sidebar beside it (2026-11-05). Closed as Esc closes it; the cleanup is done here too, whether
 * or not this plugin's own `ui.close` hook hears its own close.
 */
async function closeAnswer($: EngineInterface): Promise<void> {
  await $.ui.close({ id: ANSWER_ID }).catch(() => undefined)
  await forgetAnswer($)
}

/** The answer pane, and its close: the module lets go of the answer, the band looks again. */
export function showAnswer(on: On): void {
  on('ui.render', { component: 'Pane', requestId: ANSWER_ID }, async ($, e) => {
    await read($, answerVersion)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Markdown = (elements as { Markdown?: ElementConstructor<MarkdownProps> }).Markdown
    // The first row: what the pane holds, and " ✕ 닫기 " at its right (the terminal and the app alike).
    const head = (title: JSX.Element) => (
      <Box key="answer-head" justifyContent="space-between">
        <Box flexShrink={1}>{title}</Box>
        <Box flexShrink={0}>
          <Button
            key="answer-close"
            plain
            onPress={() => {
              void closeAnswer($)
            }}
          >
            <Text dimColor> ✕ 닫기 </Text>
          </Button>
        </Box>
      </Box>
    )
    const shown = view
    if (shown === null) return <Box paddingX={1}>{head(<Text dimColor>목차에서 답변을 다시 눌러 주세요.</Text>)}</Box>
    const current = summary !== null && summary.key === summaryKey(shown) ? summary : null

    return (
      <Box flexDirection="column" paddingX={1}>
        {head(<Text bold>{`#${shown.number} ${shown.question || '(이어진 답변)'}`}</Text>)}
        {shown.line === '' ? null : <Text dimColor>{shown.line}</Text>}
        {!shown.isFound ? null : current === null ? (
          <Button
            key="answer-summary"
            plain
            onPress={() => {
              void summarizeAnswer($)
            }}
          >
            <Text color={THEME_COLORS.effort}>[요약 보기]</Text>
          </Button>
        ) : current.state === 'running' ? (
          <Text key="answer-summary-running" dimColor>
            요약 중…
          </Text>
        ) : current.state === 'failed' ? (
          <Text key="answer-summary-failed" color={THEME_COLORS.alert}>{`요약하지 못했습니다: ${current.text}`}</Text>
        ) : (
          <Text key="answer-summary-text" color={THEME_COLORS.effort}>
            {current.text}
          </Text>
        )}
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(Math.max(1, e.props.bodyColumns - 2))}
        </Text>
        {!shown.isFound ? (
          <Text dimColor>대화 기록에서 이 답변을 찾지 못했습니다.</Text>
        ) : shown.body === '' ? (
          <Text dimColor>(글 없이 도구만 쓴 답변)</Text>
        ) : Markdown !== undefined ? (
          <Markdown key="answer-body" text={shown.body} />
        ) : (
          <Text>{shown.body}</Text>
        )}
        {shown.hidden > 0 ? <Text dimColor>{`외 ${shown.hidden}줄`}</Text> : null}
      </Box>
    )
  })

  // Esc, the engine's mark, or our own button: the sidebar back in front, the band looks again.
  on('ui.close', { id: ANSWER_ID }, async ($, e, next) => {
    const closed = await next(e)
    await forgetAnswer($)

    return closed
  }).catch(($, e, next) => next(e))
}
