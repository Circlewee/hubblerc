import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { statusParts } from '../hooks/status/band-format'
import { parseModelLimits } from '../hooks/status/model-limits'
import { NOW, standInForEngine, start } from './engine'
import type { StandIn } from './engine'

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const MIN = 60_000
const HOUR = 60 * MIN
const WEEK_RESET = new Date(NOW + 12 * HOUR).toISOString()

/** The usage endpoint's answer, as far as the plugin reads it: the limits, one of them Fable's week. */
function usageBody(percent: number, resetsAt: string = WEEK_RESET): unknown {
  return {
    five_hour: { utilization: 7, resets_at: WEEK_RESET },
    limits: [
      { kind: 'session', group: 'session', percent: 7, resets_at: WEEK_RESET, scope: null, is_active: false },
      { kind: 'weekly_all', group: 'weekly', percent: 31, resets_at: WEEK_RESET, scope: null, is_active: true },
      { kind: 'weekly_scoped', group: 'weekly', percent, resets_at: resetsAt, scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
    ],
  }
}

function showSidebar(standIn: StandIn): void {
  standIn.panes.push({ id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true })
}

async function answer($: Engine, turnId: string): Promise<void> {
  await $.turn.start({ text: '질문', turnId })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId, durationMs: 1000 })
}

async function fableLine($: Engine): Promise<string | undefined> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const label = await pane.find({ type: 'Text', text: /^Fable/ })
  await pane.unmount()

  return label?.text
}

test("the usage endpoint's answer gives the weekly limits that name a model; none when it has none, null when it cannot be read", () => {
  expect(parseModelLimits(JSON.stringify(usageBody(2)))).toEqual([{ name: 'Fable', percent: 2, resetsAt: WEEK_RESET }])
  expect(parseModelLimits(JSON.stringify({ limits: [{ kind: 'weekly_all', percent: 31, scope: null }] }))).toEqual([])
  expect(parseModelLimits(JSON.stringify({ limits: [{ kind: 'weekly_scoped', percent: 5, scope: { model: null, surface: { display_name: 'Cowork' } } }] }))).toEqual([])
  expect(parseModelLimits(JSON.stringify({ five_hour: null }))).toEqual([])
  expect(parseModelLimits('<html>')).toBeNull()
  expect(parseModelLimits('[]')).toBeNull()
})

test("wide, a model's weekly limit is a line beneath 7d, every label padded to its name; the band names none", () => {
  const input = { model: 'claude-opus-5-5', effort: 'high', isOverridden: false, project: 'p', git: null, now: NOW }
  const usage = {
    contextPercent: 20,
    fiveHour: { percent: 7, resetsAt: new Date(NOW + 4 * HOUR).toISOString() },
    sevenDay: { percent: 31, resetsAt: WEEK_RESET },
    modelLimits: [{ name: 'Fable', percent: 2, resetsAt: new Date(NOW + 12 * HOUR + 1).toISOString() }],
  }
  const lines = (figures: typeof usage, barColumns?: number) =>
    statusParts({ ...input, usage: figures, ...(barColumns === undefined ? {} : { barColumns }) }, Number.POSITIVE_INFINITY).map(part => part.map(segment => segment.text).join(''))

  const wide = lines(usage, 50)
  const at = wide.findIndex(line => line.startsWith('7d'))
  // Resetting with 7d, its reset is not said again.
  expect(wide[at + 1]).toBe(`Fable ${'╌'.repeat(20)}   2%`)
  expect(wide[at]?.startsWith(`7d    ${'━'.repeat(6)}`)).toBe(true)
  expect(wide.find(line => line.startsWith('5h'))?.startsWith('5h    ━')).toBe(true)
  expect(lines(usage).some(line => line.includes('Fable'))).toBe(false)

  // A reset of its own is said; one already past is a figure of the week before, not drawn.
  const own = lines({ ...usage, modelLimits: [{ name: 'Fable', percent: 40, resetsAt: new Date(NOW + 3 * 24 * HOUR).toISOString() }] }, 50)
  expect(own.find(line => line.startsWith('Fable'))?.endsWith(' 40% ↻ 3d 0h')).toBe(true)
  expect(lines({ ...usage, modelLimits: [{ name: 'Fable', percent: 40, resetsAt: new Date(NOW - MIN).toISOString() }] }, 50).some(line => line.startsWith('Fable'))).toBe(false)
  // Without one, the lines are as they were.
  const { modelLimits: _none, ...plain } = usage
  expect(lines(plain as typeof usage, 50).find(line => line.startsWith('7d'))?.startsWith('7d  ━')).toBe(true)
})

test("as an answer ends, the sidebar showing, Fable's week is read with the session's sign-in, at most once in five minutes", async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)
  expect(standIn.usageCalls).toEqual([])

  await answer($, 't1')
  expect(standIn.usageCalls).toEqual([{ auth: 'handle-1' }])
  expect(await fableLine($)).toBe('Fable ')

  // Within five minutes, another answer asks nothing; after, it asks again and the line follows.
  standIn.usageAnswer = { status: 200, body: usageBody(9) }
  await standIn.clock.advance(4 * MIN)
  await answer($, 't2')
  expect(standIn.usageCalls.length).toBe(1)
  await standIn.clock.advance(MIN)
  await answer($, 't3')
  expect(standIn.usageCalls.length).toBe(2)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text', text: /^ +9%$/ }))?.text).toBe('  9%')
  await pane.unmount()

  // An answer that cannot be read, or refused, keeps what was known.
  standIn.usageAnswer = { status: 500, body: 'no' }
  await standIn.clock.advance(5 * MIN)
  await answer($, 't4')
  expect(standIn.usageCalls.length).toBe(3)
  expect(await fableLine($)).toBe('Fable ')
})

test('an idle session asks the usage endpoint once, when the sidebar first shows, and never again', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)

  await standIn.clock.advance(MIN)
  expect(standIn.usageCalls.length).toBe(1)
  expect(await fableLine($)).toBe('Fable ')
  await standIn.clock.advance(3 * HOUR)
  expect(standIn.usageCalls.length).toBe(1)
})

test('with the sidebar closed, or no subscription sign-in, the usage endpoint is not asked', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.signIn = 'bearer'
  await start($)
  await answer($, 't1')
  await standIn.clock.advance(10 * MIN)
  expect(standIn.usageCalls).toEqual([])

  standIn.signIn = 'api-key'
  showSidebar(standIn)
  await answer($, 't2')
  await standIn.clock.advance(10 * MIN)
  expect(standIn.usageCalls).toEqual([])
  expect(await fableLine($)).toBeUndefined()
})
