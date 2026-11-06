import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseLevel, parseReason } from '../hooks/effort/auto-effort'
import { effortWord } from '../hooks/effort/effort-record'
import { standInForEngine, start } from './engine'
import type { StandIn } from './engine'

const LOG = '/home/me/.claude/hubblerc/auto-effort/Test-Mac.jsonl'
const BAND = { plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band' } as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const COMMAND = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }

/** Stands for the API: each request answered, its effort recorded. */
function answerRequests(on: On): unknown[] {
  const sent: unknown[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })

  return sent
}

async function step($: Engine, turnId: string, index: number): Promise<void> {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
  for await (const chunk of stream) void chunk
}

async function ask($: Engine, turnId: string, text: string, during?: () => Promise<void>): Promise<void> {
  await $.turn.start({ text, turnId })
  await step($, turnId, 0)
  if (during !== undefined) await during()
  await $.turn.complete({ answer: '답했습니다.', isAborted: false, reason: 'answer', turnId, durationMs: 4200 })
}

const lines = (standIn: StandIn) =>
  (standIn.files[LOG] ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)

test('a reply reads as a level and the reason after it; a reason that is not there leaves the level', () => {
  expect(parseLevel('high - 여러 파일을 고치는 작업이다')).toBe('high')
  expect(parseReason('high - 여러 파일을 고치는 작업이다')).toBe('여러 파일을 고치는 작업이다')
  expect(parseReason('xhigh: 설계 결정\n두 번째 줄')).toBe('설계 결정')
  expect(parseReason('medium')).toBeNull()
  expect(['high', ' Max now', 'auto', '', '정도'].map(effortWord)).toEqual(['high', 'max', 'auto', null, null])
})

test('each pick is a line of the machine\'s auto-effort log: the question masked, the level and its reason, whether the first request took it; the answer\'s figures follow', { options: { autoEffort: true } }, async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  answerRequests(on)
  standIn.completion = 'high - 여러 파일을 고치는 작업'
  await start($)

  await ask($, 't1', 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijkl 로 테스트를 돌려 줘', async () => {
    await $.tool.call({ tool: 'Bash', command: 'false', description: '실패하는 명령' })
  })
  await standIn.clock.settle()
  const [decision, turn] = lines(standIn)
  expect(decision).toMatchObject({
    type: 'decision',
    session: 'session-1',
    turn: 1,
    promptVersion: 2,
    question: 'ANTHROPIC_API_KEY=*** 로 테스트를 돌려 줘',
    hadContext: false,
    effort: 'high',
    reason: '여러 파일을 고치는 작업',
    tokens: { input: 120, output: 1 },
    appliedFirst: true,
    firstEffort: 'high',
  })
  expect(typeof decision?.latencyMs).toBe('number')
  expect(turn).toEqual({ type: 'outcome', id: decision?.id, at: expect.any(String), kind: 'turn', failures: 1, durationMs: 4200, outputTokens: 300 })
  // The reply has room for the reason.
  expect(standIn.completions[0]).toMatchObject({ maxTokens: 60 })
})

test('a level set by hand after a pick, on the slider or with /effort, and the next question are its signals', { options: { autoEffort: true } }, async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  answerRequests(on)
  standIn.completion = 'medium - 짧은 질문'
  // The engine's own /effort, beneath the plugin.
  on('command.run', { command: 'effort' }, () => ({ text: '' }))
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })

  await ask($, 't1', '이 함수 뭐 해?')
  // Mid-answer or before the next question: the slider's level, then the engine's /effort.
  await band.press({ key: 'effort' })
  await band.press({ key: 'effort-xhigh' })
  await $.command.run({ ...COMMAND, command: 'effort', args: 'high' })
  await $.command.run({ ...COMMAND, command: 'effort', args: '' })
  await ask($, 't2', `다시 봐 줘 ${'가'.repeat(300)}`)
  await standIn.clock.settle()

  const [first] = lines(standIn)
  const about = lines(standIn).filter(line => line.id === first?.id && line.type === 'outcome')
  expect(about.map(line => [line.kind, line.via ?? null, line.to ?? null])).toEqual([
    ['turn', null, null],
    ['effort-change', 'slider', 'xhigh'],
    ['effort-change', 'engine', 'high'],
    ['effort-change', 'engine', null],
    ['next', null, null],
  ])
  expect(String(about.at(-1)?.question)).toHaveLength(200)
  // With a level set on the slider, the second question is not picked: no line of its own.
  expect(lines(standIn).filter(line => line.type === 'decision')).toHaveLength(1)
  await band.unmount()
})

test('a pick later than the first request\'s wait is logged as not taken by it; a failed pick is logged with why', { options: { autoEffort: true } }, async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  const sent = answerRequests(on)
  standIn.completion = 'xhigh - 설계 결정'
  standIn.completionDelayMs = 3000
  await start($)

  await $.turn.start({ text: '구조를 다시 짜자', turnId: 't1' })
  const first = step($, 't1', 0)
  await standIn.clock.advance(3000)
  await first
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 9000 })
  await standIn.clock.settle()
  expect(sent).toEqual(['xhigh'])
  expect(lines(standIn)[0]).toMatchObject({ effort: 'xhigh', reason: '설계 결정', appliedFirst: false, firstEffort: 'xhigh' })
  expect(Number(lines(standIn)[0]?.latencyMs)).toBeGreaterThanOrEqual(3000)

  standIn.completionDelayMs = 0
  standIn.completion = null
  await ask($, 't2', '다음')
  await standIn.clock.settle()
  const failed = lines(standIn).filter(line => line.type === 'decision')[1]
  expect(failed).toMatchObject({ effort: null, reason: null, error: 'api-error', appliedFirst: false })
})
