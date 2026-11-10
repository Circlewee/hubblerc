import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { answerLine, findAnswer } from '../hooks/activity/answer'
import { answersOf, answerText } from '../hooks/activity/restore'
import type { TurnRecord } from '../types'
import { NOW, standInForEngine, start } from './engine'
import type { StandIn } from './engine'

type Block = { type: string; [field: string]: unknown }
type Sent = { role: 'user' | 'assistant'; content: Block[] }
const text = (value: string): Block => ({ type: 'text', text: value })
const user = (...content: Block[]): Sent => ({ role: 'user', content })
const assistant = (...content: Block[]): Sent => ({ role: 'assistant', content })

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const ANSWER = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc-answer' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const ANSWER_PROPS = { ...PANE_PROPS, title: '#1 답변' }

const turn = (id: string, key: string | undefined, extra: Partial<TurnRecord> = {}): TurnRecord => ({ id, prompt: key ?? '', startedAt: NOW, durationMs: 5000, runs: [], ...(key === undefined ? {} : { promptKey: key }), ...extra })

/** The plugin's store, kept where the test can see it. */
function memoryStore(on: On): Record<string, unknown> {
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })

  return stored
}

/** Two answers asked live, the transcript as the model was sent them; the first one's text long. */
async function twoAnswers($: Engine, standIn: StandIn): Promise<void> {
  const long = Array.from({ length: 250 }, (_, i) => `줄 ${i + 1}`).join('\n')
  standIn.sent = [user(text('긴 답을 줘')), assistant(text(long)), user(text('짧게')), assistant(text('**네**, 짧게 답합니다.'), { type: 'tool_use', id: 'u1', name: 'Read', input: {} }), user({ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }), assistant(text('끝.'))]
  await $.turn.start({ text: '긴 답을 줘', turnId: 't1' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })
  await $.turn.start({ text: '짧게', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't2', durationMs: 12_000 })
}

test('an answer of the transcript is found from the end by its question, else by its place; its text is its text blocks', () => {
  const sent = [user(text('같은 질문')), assistant(text('첫 답')), user(text('같은 질문')), assistant(text('둘째 답'), { type: 'tool_use', id: 'x', name: 'Bash', input: {} }), user(text('<system-reminder>r</system-reminder>')), assistant(text('No response requested.')), assistant(text('이어서'))]
  const answers = answersOf(sent)
  expect(answers.map(answer => [answer.prompt.text, answerText(answer)])).toEqual([
    ['같은 질문', '첫 답'],
    ['같은 질문', '둘째 답\n\n이어서'],
  ])
  // The record kept only the last of the two: still the second.
  const kept = [turn('b', '같은 질문')]
  expect(answerText(findAnswer(kept, kept[0] as TurnRecord, answers) ?? answers[0]!)).toBe('둘째 답\n\n이어서')
  const both = [turn('a', '같은 질문'), turn('b', '같은 질문')]
  expect(findAnswer(both, both[0] as TurnRecord, answers)?.index).toBe(0)
  // No key: the same place from the end.
  const keyless = [turn('c', undefined)]
  expect(findAnswer(keyless, keyless[0] as TurnRecord, answers)?.index).toBe(2)
  expect(findAnswer([turn('d', '없는 질문')], turn('d', '없는 질문'), answers)).toBeUndefined()

  expect(answerLine(turn('a', 'q', { runs: [{ id: 'r', tool: 'Read', ms: 1, isError: false }] }))).toBe('5s · Read 1')
  expect(answerLine(turn('a', 'q', { durationMs: null }))).toBe('진행 중 · 도구 없음')
})

test('the answer pane shows the question, its line, and its text: markdown, cut at 200 lines', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on)
  await start($)
  await twoAnswers($, standIn)
  const opens = standIn.opened.length

  const sidebar = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await sidebar.press({ key: 'turn-t1' })
  expect(standIn.opened.slice(opens)).toEqual([{ id: 'hubblerc-answer', title: '#1 답변', columns: 56, closeOnEscape: true, focus: true }])
  const pane = await $.ui.mount({ ...ANSWER, surface: 'terminal', props: ANSWER_PROPS })
  expect((await pane.find({ type: 'Text', text: /^#1 / }))?.text).toBe('#1 긴 답을 줘')
  expect((await pane.find({ type: 'Text', text: /^5s/ }))?.text).toBe('5s · 도구 없음')
  const body = await pane.find({ key: 'answer-body' })
  expect(body?.type).toBe('Markdown')
  expect(String(body?.props.text).split('\n')).toHaveLength(200)
  expect((await pane.find({ type: 'Text', text: /^외 \d+줄$/ }))?.text).toBe('외 50줄')
  await pane.unmount()

  await sidebar.press({ key: 'turn-t2' })
  const second = await $.ui.mount({ ...ANSWER, surface: 'desktop', props: { ...ANSWER_PROPS, title: '#2 답변' } })
  expect((await second.find({ key: 'answer-body' }))?.props.text).toBe('**네**, 짧게 답합니다.\n\n끝.')
  expect((await second.find({ type: 'Text', text: /^12s/ }))?.text).toBe('12s · Read 1')
  await second.unmount()
  await sidebar.unmount()
})

test('an answer the transcript does not hold says so, with no summary to ask for', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on)
  await start($)
  await twoAnswers($, standIn)
  standIn.sent = []

  const sidebar = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await sidebar.press({ key: 'turn-t2' })
  const pane = await $.ui.mount({ ...ANSWER, surface: 'terminal', props: ANSWER_PROPS })
  expect(await pane.find({ type: 'Text', text: '대화 기록에서 이 답변을 찾지 못했습니다.' })).toBeDefined()
  expect(await pane.find({ key: 'answer-summary' })).toBeUndefined()
  await pane.unmount()
  await sidebar.unmount()
})

test('[요약 보기] asks the small model through the session, once: kept per answer, nothing of likely touched', async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on)
  standIn.completion = '긴 답을 달라는 질문이었다.\n250줄을 답했다.\n남은 일은 없다.'
  await start($)
  await twoAnswers($, standIn)

  const sidebar = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await sidebar.press({ key: 'turn-t1' })
  const pane = await $.ui.mount({ ...ANSWER, surface: 'terminal', props: ANSWER_PROPS })
  // Nothing asked till the press.
  const before = standIn.completions.length
  await pane.press({ key: 'answer-summary' })
  expect(standIn.completions.slice(before)).toEqual([expect.objectContaining({ model: 'haiku', prompt: expect.stringContaining('<question>\n긴 답을 줘\n</question>') })])
  expect((await pane.find({ type: 'Text', text: /^긴 답을 달라는/ }))?.text).toBe('긴 답을 달라는 질문이었다.\n250줄을 답했다.\n남은 일은 없다.')
  expect(stored.answerSummaries).toEqual({ 'session-1:1': '긴 답을 달라는 질문이었다.\n250줄을 답했다.\n남은 일은 없다.' })
  // No API call of likely's, no spend, no log.
  expect(standIn.anthropicCalls).toEqual([])
  expect(stored.likelySpend).toBeUndefined()
  expect(standIn.files).toEqual({})
  await pane.unmount()

  // Opened again: the summary is read back, nothing asked.
  await sidebar.press({ key: 'turn-t1' })
  const again = await $.ui.mount({ ...ANSWER, surface: 'terminal', props: ANSWER_PROPS })
  expect(await again.find({ type: 'Text', text: /^긴 답을 달라는/ })).toBeDefined()
  expect(await again.find({ key: 'answer-summary' })).toBeUndefined()
  expect(standIn.completions.length).toBe(before + 1)
  await again.unmount()

  // A failure says why; nothing kept.
  standIn.completion = null
  await sidebar.press({ key: 'turn-t2' })
  const failing = await $.ui.mount({ ...ANSWER, surface: 'terminal', props: { ...ANSWER_PROPS, title: '#2 답변' } })
  await failing.press({ key: 'answer-summary' })
  expect((await failing.find({ type: 'Text', text: /^요약하지 못했습니다/ }))?.text).toBe('요약하지 못했습니다: api-error')
  expect(Object.keys(stored.answerSummaries as object)).toEqual(['session-1:1'])
  await failing.unmount()
  await sidebar.unmount()
})

test('the band stays aside while the answer pane stands in front of the sidebar, and when it closes', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on)
  on('ui.render', { component: 'AbovePrompt' }, (_$, e) => {
    const { Box } = _$.ui.resolve(e)

    return <Box />
  })
  await start($)
  standIn.panes = [
    { id: 'hubblerc', title: 'hubblerc', isShown: false, isFocused: false, isPlaced: true },
    { id: 'hubblerc-answer', title: '#1 답변', isShown: true, isFocused: true, isPlaced: true },
  ]
  const band = await $.ui.mount({ plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }, viewport: { isFullscreen: true, columns: 200, rows: 50 } as never })
  // Aside: no line of the band drawn.
  expect(await band.find({ type: 'Text', text: /^Opus/ })).toBeUndefined()
  // The answer closed (the kit has no close to raise): the sidebar in front again, still aside.
  standIn.panes = [{ id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true }]
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /^Opus/ })).toBeUndefined()
  // Neither shown (the sidebar behind another's tab): the band comes back.
  standIn.panes = [{ id: 'hubblerc', title: 'hubblerc', isShown: false, isFocused: false, isPlaced: true }]
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /^Opus/ })).toBeDefined()
  await band.unmount()
})

test('" ✕ 닫기 " at the top right closes the pane as Esc does, on the terminal and in the app', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on)
  await start($)
  await twoAnswers($, standIn)

  for (const surface of ['terminal', 'desktop'] as const) {
    const sidebar = await $.ui.mount({ ...PANE, surface, props: PANE_PROPS })
    await sidebar.press({ key: 'turn-t1' })
    expect(standIn.panes.map(pane => pane.id)).toContain('hubblerc-answer')
    const pane = await $.ui.mount({ ...ANSWER, surface, props: ANSWER_PROPS })
    // The first row: the question, the button at its right.
    const head = await pane.find({ key: 'answer-head' })
    expect(head?.text).toBe('#1 긴 답을 줘 ✕ 닫기 ')
    expect((await pane.find({ key: 'answer-close' }))?.text).toBe(' ✕ 닫기 ')
    await pane.press({ key: 'answer-close' })
    expect(standIn.panes.map(paneOpen => paneOpen.id)).not.toContain('hubblerc-answer')
    // The answer let go of, as on Esc: drawn again, the pane holds nothing of it.
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: '목차에서 답변을 다시 눌러 주세요.' })).toBeDefined()
    expect(await pane.find({ key: 'answer-close' })).toBeDefined()
    await pane.unmount()
    await sidebar.unmount()
  }
})
