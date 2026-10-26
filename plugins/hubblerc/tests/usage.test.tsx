import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

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
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = {
  title: 'hubblerc',
  isFocused: false,
  bodyColumns: 56,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const MAIN_SCREEN = { columns: 200, rows: 50, isFullscreen: false }
const MIN = 60_000

/** Stands for the API: each request answers with this many output tokens. */
function answerRequests(on: On, output: number): void {
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
}

/** The engine's own rows beneath the plugin: the closing line, and nothing in the band. */
function drawBeneath(on: On): void {
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>Baked for 5s</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

async function requests($: Engine, turnId: string, steps: number): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
    for await (const chunk of stream) void chunk
  }
}

test("an answer's closing line ends with its output tokens and the points of the 5-hour window it took", async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on, 12_345)
  drawBeneath(on)
  await start($)

  await $.turn.start({ text: '질문', turnId: 't1' })
  await requests($, 't1', 2)
  standIn.fiveHourPercent = 28
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })

  const ui = await $.ui.mount({ plugin: 'hubblerc', component: 'TurnDuration', requestId: 'line-1', surface: 'terminal', props: { word: 'Baked', durationMs: 5000 } })
  expect((await ui.find({ type: 'Text', text: /출력/ }))?.text).toBe('출력 25k · 5h +3%')
  await ui.unmount()
})

test('a 5-hour window that did not move is not named on the closing line', async ($, on) => {
  answerRequests(on, 800)
  drawBeneath(on)
  standInForEngine(on)
  await start($)

  await $.turn.start({ text: '질문', turnId: 't1' })
  await requests($, 't1', 1)
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })

  const ui = await $.ui.mount({ plugin: 'hubblerc', component: 'TurnDuration', requestId: 'line-1', surface: 'terminal', props: { word: 'Baked', durationMs: 5000 } })
  expect((await ui.find({ type: 'Text', text: /출력/ }))?.text).toBe('출력 800')
  await ui.unmount()
})

test('idle, the band and the sidebar tell when the last request went out and the last answer\'s cache share; a pace that runs 5h out within the hour shows a chip', async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on, 100)
  drawBeneath(on)
  await start($)

  await $.turn.start({ text: '질문', turnId: 't1' })
  await requests($, 't1', 1)
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })
  // 25% to 45% in twelve minutes: the 55 points left go in 33 more.
  standIn.fiveHourPercent = 45
  await standIn.clock.advance(12 * MIN)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: MAIN_SCREEN })
  // The request went out at NOW, by the clock; its prompt came from no cache.
  const at = new Date(standIn.clock.now() - 12 * MIN)
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  expect((await band.find({ type: 'Text', text: /마지막 요청/ }))?.text).toBe(`마지막 요청 ${time}`)
  const share = await band.find({ type: 'Text', text: /^캐시/ })
  expect(share?.text).toBe('캐시 0%')
  expect(share?.props.color).toBe('red')
  expect((await band.find({ type: 'Text', text: /⚠/ }))?.text).toBe(' ⚠33m')
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text', text: /마지막 요청/ }))?.text).toBe(`마지막 요청 ${time}`)
  expect((await pane.find({ type: 'Text', text: /^캐시/ }))?.text).toBe('캐시 0%')
  expect((await pane.find({ type: 'Text', text: /⚠/ }))?.text).toBe(' ⚠ 33m 뒤 소진')
  await pane.unmount()
})

test('while an answer runs, the time since the last request is not shown', async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on, 100)
  drawBeneath(on)
  await start($)

  await $.turn.start({ text: '질문', turnId: 't1' })
  await requests($, 't1', 1)
  await standIn.clock.advance(2 * MIN)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND_PROPS, isWorking: true }, viewport: MAIN_SCREEN })
  expect(await band.find({ type: 'Text', text: /마지막 요청/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /⚠/ })).toBeUndefined()
  await band.unmount()
})
