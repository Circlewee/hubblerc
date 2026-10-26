import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classifierPrompt, parseLevel } from '../hooks/auto-effort'
import { cacheSummary } from '../hooks/effort-log'
import { standInForEngine, start } from './engine'

const BAND = { plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band' } as const
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}
const COMMAND = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }

/** Stands for the API: records the effort each request went out with, and reports its tokens. */
function answerRequests(on: On): unknown[] {
  const sent: unknown[] = []
  let step = 0
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    step += 1
    // The second request after a change of effort reads less from the cache, as a broken cache would.
    const cacheRead = step === 1 ? 0 : 50_000

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 100, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 2000 },
    }
  })

  return sent
}

async function ask($: Engine, turnId: string, text: string, steps = 1, agentId?: string): Promise<void> {
  await $.turn.start({ text, turnId, ...(agentId === undefined ? {} : { agentId }) })
  for (let index = 0; index < steps; index += 1) {
    const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
    for await (const chunk of stream) void chunk
  }
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId, durationMs: 1000, ...(agentId === undefined ? {} : { agentId }) })
}

test('a reply names a level by its first word; anything else names none', () => {
  expect(parseLevel('high')).toBe('high')
  expect(parseLevel(' XHigh.\n')).toBe('xhigh')
  expect(parseLevel('medium - a quick question')).toBe('medium')
  expect(parseLevel('max')).toBeUndefined()
  expect(parseLevel('I think high')).toBeUndefined()
})

test('the classifier reads the question, and the answer before it for a short follow-up', () => {
  expect(classifierPrompt('이어서 진행하자', '3단계를 커밋했습니다. 다음은 4단계입니다.')).toBe(
    '<previous_answer>\n3단계를 커밋했습니다. 다음은 4단계입니다.\n</previous_answer>\n\n<message>\n이어서 진행하자\n</message>',
  )
  expect(classifierPrompt('질문', '')).toBe('<message>\n질문\n</message>')
})

test('off by default: requests go out at the engine effort and nothing is classified', async ($, on) => {
  const standIn = standInForEngine(on)
  const sent = answerRequests(on)
  await start($)

  await ask($, 't1', '이 함수 뭐 하는 거야?')
  expect(sent).toEqual(['xhigh'])
  expect(standIn.completions).toHaveLength(0)
})

test("auto from the slider: each question's requests go out at the small model's pick, a subagent's untouched", async ($, on) => {
  const standIn = standInForEngine(on)
  const sent = answerRequests(on)
  standIn.messages = [{ role: 'assistant', text: '3단계를 커밋했습니다.', toolUses: [] }]
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-auto' })
  expect((await band.find({ key: 'effort' }))?.text).toBe('auto')

  standIn.completion = 'high'
  await ask($, 't1', '이어서 진행하자', 2)
  expect((await band.find({ key: 'effort' }))?.text).toBe('auto high')
  expect(standIn.completions[0]).toMatchObject({ model: 'haiku', prompt: expect.stringContaining('3단계를 커밋했습니다.') })

  standIn.completion = 'medium'
  await ask($, 't2', '이 함수 뭐 하는 거야?')
  await ask($, 's1', 'find the callers', 1, 'ag-1')
  expect(sent).toEqual(['high', 'high', 'medium', 'xhigh'])
  expect(standIn.completions).toHaveLength(2) // The subagent's turn is not classified.
  await band.unmount()
})

test('a level chosen on the slider wins over auto; the reset turns auto off', async ($, on) => {
  const standIn = standInForEngine(on)
  const sent = answerRequests(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-auto' })
  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-low' })
  await ask($, 't1', '질문')
  expect((await band.find({ key: 'effort' }))?.text).toBe('low')

  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-reset' })
  await ask($, 't2', '질문')
  expect(sent).toEqual(['low', 'xhigh'])
  expect(standIn.completions).toHaveLength(0)
  await band.unmount()
})

test('a question after an answer is picked with that answer, kept as it completed', async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on)
  standIn.messages = [{ role: 'assistant', text: 'from the transcript', toolUses: [] }]
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-auto' })
  await band.unmount()

  await $.turn.start({ text: '설계해 줘', turnId: 't1' })
  await $.turn.complete({ answer: '두 가지 안이 있습니다.', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  await $.turn.start({ text: '첫 번째로 가자', turnId: 't2' })
  expect(standIn.completions[0]?.prompt).toEqual(expect.stringContaining('from the transcript'))
  expect(standIn.completions[1]?.prompt).toEqual(expect.stringContaining('두 가지 안이 있습니다.'))
})

test('the autoEffort option turns auto on for a new session; a failed pick leaves the engine effort', { options: { autoEffort: true } }, async ($, on) => {
  const standIn = standInForEngine(on)
  const sent = answerRequests(on)
  await start($)

  standIn.completion = 'xhigh'
  await ask($, 't1', '설계 같이 고민해 줘')
  standIn.completion = null
  await ask($, 't2', '질문')
  standIn.completion = 'whatever'
  await ask($, 't3', '질문')
  expect(sent).toEqual(['xhigh', 'xhigh', 'xhigh'])
  expect(standIn.completions).toHaveLength(3)
})

test('/effort-log lists each request with whose effort it was, and the cache share after a change', async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-auto' })
  await band.unmount()
  standIn.completion = 'medium'
  await ask($, 't1', '질문', 2)

  const log = (await $.command.run({ command: 'effort-log', ...COMMAND })).text ?? ''
  expect(log.split('\n').slice(0, 4)).toEqual([
    '요청별 effort (전체 2개 중 최근 2개)',
    '답변   요청  effort            입력   캐시 읽기   캐시 쓰기      출력',
    '#1        0  auto medium         10           0       2,000       100',
    '#1        1  auto medium         10      50,000       2,000       100',
  ])
  expect(log).toContain('캐시 읽기 비율: effort가 바뀐 직후 0건 · 그대로인 요청 1건 평균 96%')
  expect(log).toContain('마지막 auto 판정: medium (0.0s)')
})

test('the cache share is averaged apart for requests right after a change of effort', () => {
  const sample = (effort: string, cacheRead: number) => ({ turnId: 't', index: 0, effort, source: 'auto' as const, input: 0, cacheRead, cacheWrite: 100 - cacheRead, output: 0 })

  expect(cacheSummary([sample('high', 0), sample('high', 90), sample('medium', 10), sample('medium', 80)])).toBe(
    '캐시 읽기 비율: effort가 바뀐 직후 1건 평균 10% · 그대로인 요청 2건 평균 85%',
  )
})
