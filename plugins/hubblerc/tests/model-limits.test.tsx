import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { statusParts } from '../hooks/status/band-format'
import { countsToward, MODEL_LIMITS_KEY, parseModelLimits, readSharedModelLimits, refusalWaitMs } from '../hooks/status/model-limits'
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

/** An answer from start to end, and a millisecond after: the ask its end sets off is not awaited there. */
async function answer($: Engine, turnId: string, standIn: StandIn): Promise<void> {
  await $.turn.start({ text: '질문', turnId })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId, durationMs: 1000 })
  await standIn.clock.advance(1)
}

/** The plugin's store, kept where the test can see it: what the sessions share. */
function memoryStore(on: On, entries: Record<string, unknown> = {}): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...entries }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })

  return stored
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

test("as a question goes out, the sidebar showing, Fable's week is read with the session's sign-in, at most once in five minutes", async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)
  expect(standIn.usageCalls).toEqual([])

  await answer($, 't1', standIn)
  expect(standIn.usageCalls).toEqual([{ auth: 'handle-1' }])
  expect(await fableLine($)).toBe('Fable ')

  // Within five minutes, another answer asks nothing; after, it asks again and the line follows.
  standIn.usageAnswer = { status: 200, body: usageBody(9) }
  await standIn.clock.advance(4 * MIN)
  await answer($, 't2', standIn)
  expect(standIn.usageCalls.length).toBe(1)
  await standIn.clock.advance(MIN)
  await answer($, 't3', standIn)
  expect(standIn.usageCalls.length).toBe(2)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text', text: /^ +9%$/ }))?.text).toBe('  9%')
  await pane.unmount()

  // An answer that cannot be read, or refused, keeps what was known.
  standIn.usageAnswer = { status: 500, body: 'no' }
  await standIn.clock.advance(5 * MIN)
  await answer($, 't4', standIn)
  expect(standIn.usageCalls.length).toBe(3)
  expect(await fableLine($)).toBe('Fable ')
})

test('an idle session asks the usage endpoint once, when the sidebar first shows, and never again', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on)
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
  await answer($, 't1', standIn)
  await standIn.clock.advance(10 * MIN)
  expect(standIn.usageCalls).toEqual([])

  standIn.signIn = 'api-key'
  showSidebar(standIn)
  await answer($, 't2', standIn)
  await standIn.clock.advance(10 * MIN)
  expect(standIn.usageCalls).toEqual([])
  expect(await fableLine($)).toBeUndefined()
})

test('a refusing endpoint (429, 403) is left alone for what it names, else the gap doubled each time, an hour at most; what was known stays', async ($, on) => {
  expect(refusalWaitMs({ 'retry-after': '1800' }, 1)).toBe(30 * MIN)
  expect(refusalWaitMs({ 'retry-after': '10' }, 1)).toBe(5 * MIN)
  expect(refusalWaitMs({ 'retry-after': '86400' }, 1)).toBe(HOUR)
  expect([1, 2, 3, 4, 5].map(refusals => refusalWaitMs({}, refusals) / MIN)).toEqual([5, 10, 20, 40, 60])

  const standIn = standInForEngine(on)
  memoryStore(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)
  await answer($, 't1', standIn)
  expect(standIn.usageCalls.length).toBe(1)

  // Refused with a wait named: nothing asked till it is up, however many answers end.
  standIn.usageAnswer = { status: 429, body: 'no', headers: { 'retry-after': '1800' } }
  await standIn.clock.advance(5 * MIN)
  await answer($, 't2', standIn)
  expect(standIn.usageCalls.length).toBe(2)
  await standIn.clock.advance(29 * MIN)
  await answer($, 't3', standIn)
  expect(standIn.usageCalls.length).toBe(2)
  expect(await fableLine($)).toBe('Fable ')

  // Refused again with none named (a 403), the second in a row: ten minutes.
  standIn.usageAnswer = { status: 403, body: 'no' }
  await standIn.clock.advance(MIN)
  await answer($, 't4', standIn)
  expect(standIn.usageCalls.length).toBe(3)
  await standIn.clock.advance(9 * MIN)
  await answer($, 't5', standIn)
  expect(standIn.usageCalls.length).toBe(3)
  standIn.usageAnswer = { status: 200, body: usageBody(9) }
  await standIn.clock.advance(MIN)
  await answer($, 't6', standIn)
  expect(standIn.usageCalls.length).toBe(4)
})

test('the sessions ask as one: what another asked within the gap is drawn with no request, at a restart at once', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(9) }
  // Another session asked two minutes ago: its record is in the store.
  const stored = memoryStore(on, { [MODEL_LIMITS_KEY]: { limits: [{ name: 'Fable', percent: 4, resetsAt: WEEK_RESET }], nextAt: NOW + 3 * MIN, refusals: 0 } })
  await start($)
  showSidebar(standIn)

  // Drawn from the record as the session starts, before any answer.
  expect(await fableLine($)).toBe('Fable ')
  await standIn.clock.advance(MIN)
  await answer($, 't1', standIn)
  expect(standIn.usageCalls).toEqual([])

  // Meanwhile the other session asked again and was refused for an hour: this one waits with it.
  stored[MODEL_LIMITS_KEY] = { limits: [{ name: 'Fable', percent: 5, resetsAt: WEEK_RESET }], nextAt: NOW + 63 * MIN, refusals: 3 }
  await standIn.clock.advance(5 * MIN)
  await answer($, 't2', standIn)
  await standIn.clock.advance(30 * MIN)
  await answer($, 't3', standIn)
  expect(standIn.usageCalls).toEqual([])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text', text: /^ +5%$/ }))?.text).toBe('  5%')
  await pane.unmount()

  // Its wait up, this session's answer asks, and leaves the record for the others.
  await standIn.clock.advance(30 * MIN)
  await answer($, 't4', standIn)
  expect(standIn.usageCalls.length).toBe(1)
  const left = readSharedModelLimits(stored[MODEL_LIMITS_KEY])
  expect(left?.limits).toEqual([{ name: 'Fable', percent: 9, resetsAt: WEEK_RESET }])
  expect(left?.refusals).toBe(0)
  // The next ask five minutes after this one (the answer's end, a millisecond back).
  expect(left?.nextAt).toBe(standIn.clock.now() - 1 + 5 * MIN)
})

test('a store that can be neither read nor written leaves the session asking for itself, at its own gap', async ($, on) => {
  const standIn = standInForEngine(on)
  on('store.get', () => ({ deny: 'store unreadable' }))
  on('store.set', () => ({ deny: 'store over 4 MiB' }))
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)

  await answer($, 't1', standIn)
  expect(standIn.usageCalls.length).toBe(1)
  expect(await fableLine($)).toBe('Fable ')
  await standIn.clock.advance(4 * MIN)
  await answer($, 't2', standIn)
  expect(standIn.usageCalls.length).toBe(1)
})

test("a model's weekly limit is coloured by its pace, as 7d is: running out before the reset, it is marked", () => {
  const input = { model: 'claude-opus-5-5', effort: 'high', isOverridden: false, project: 'p', git: null, now: NOW, barColumns: 50 }
  const line = (resetsAt: string | undefined, weekReset: string) =>
    statusParts({ ...input, usage: { contextPercent: 20, sevenDay: { percent: 10, resetsAt: weekReset }, modelLimits: [{ name: 'Fable', percent: 40, ...(resetsAt === undefined ? {} : { resetsAt }) }] } }, Number.POSITIVE_INFINITY)
      .map(part => part.map(segment => segment.text).join(''))
      .find(text => text.startsWith('Fable'))

  // Two days in at 40%: 140% by the reset.
  const early = new Date(NOW + 5 * 24 * HOUR).toISOString()
  expect(line(early, early)?.endsWith(' 40%!')).toBe(true)
  // With no reset of its own, the week's.
  expect(line(undefined, early)?.endsWith(' 40%!')).toBe(true)
  // Six days in at 40%: under half by the reset.
  const late = new Date(NOW + 24 * HOUR).toISOString()
  expect(line(late, late)?.endsWith(' 40%')).toBe(true)
})

/** The engine beneath answers every request; one made through `step` comes back a millisecond on. */
function answerRequests(on: On): void {
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
}

async function step($: Engine, standIn: StandIn, index: number, model: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't1', index, model, effort: 'high', messageCount: 1 })
  for await (const chunk of stream) void chunk
  await standIn.clock.advance(1)
}

test("a request counts toward a limit whose name is in its model's id; with no limit known, toward Fable's", () => {
  const fable = [{ name: 'Fable', percent: 4 }]
  expect(countsToward('claude-fable-5-2', fable)).toBe(true)
  expect(countsToward('claude-opus-5-5', fable)).toBe(false)
  expect(countsToward('claude-fable-5-2[1m]', [])).toBe(true)
  expect(countsToward('claude-haiku-5-5', [])).toBe(false)
})

test("mid-answer, Fable's week is asked for when the 5-hour window stands a point on after a Fable request, at most once a minute; as the answer ends, once more", async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on)
  memoryStore(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)

  // The question going out asks (nothing was known): the gap runs from here.
  await $.turn.start({ text: '질문', turnId: 't1' })
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(1)

  // Fable requests with the window where it was: nothing says the limit moved.
  await step($, standIn, 0, 'claude-fable-5-2')
  await step($, standIn, 1, 'claude-fable-5-2')
  expect(standIn.usageCalls.length).toBe(1)

  // The window a point on, within the minute: not yet. A minute after the ask, the next point asks.
  standIn.fiveHourPercent = 26
  await step($, standIn, 2, 'claude-fable-5-2')
  expect(standIn.usageCalls.length).toBe(1)
  await standIn.clock.advance(MIN)
  standIn.fiveHourPercent = 27
  await step($, standIn, 3, 'claude-fable-5-2')
  expect(standIn.usageCalls.length).toBe(2)

  // The answer's end: a Fable request went since that ask, so once the minute is up it asks; within it, not.
  await step($, standIn, 4, 'claude-fable-5-2')
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(2)
})

test("an answer that asked no model the limits count asks nothing as it ends, the window moved or not", async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on)
  memoryStore(on)
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(2) }
  await start($)
  showSidebar(standIn)
  await $.turn.start({ text: '질문', turnId: 't1' })
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(1)

  await standIn.clock.advance(2 * MIN)
  await step($, standIn, 0, 'claude-opus-5-5')
  standIn.fiveHourPercent = 40
  await step($, standIn, 1, 'claude-opus-5-5')
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(1)

  // A Fable request, and the answer's end more than a minute after the ask: asked.
  await $.turn.start({ text: '질문', turnId: 't1' })
  await step($, standIn, 0, 'claude-fable-5-2')
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(2)
})

test('an idle session asks nothing and draws what another session asked within the half minute; a key in the prompt box asks once the gap is up', async ($, on) => {
  const standIn = standInForEngine(on)
  on('prompt.edit', (_, e) => ({ text: e.text, cursor: e.cursor }))
  standIn.signIn = 'bearer'
  standIn.usageAnswer = { status: 200, body: usageBody(9) }
  const stored = memoryStore(on, { [MODEL_LIMITS_KEY]: { limits: [{ name: 'Fable', percent: 4, resetsAt: WEEK_RESET }], nextAt: NOW + 5 * MIN, refusals: 0, askedAt: NOW } })
  await start($)
  showSidebar(standIn)
  await standIn.clock.advance(MIN)

  // Another session asked meanwhile: its record shows here with no request.
  stored[MODEL_LIMITS_KEY] = { limits: [{ name: 'Fable', percent: 6, resetsAt: WEEK_RESET }], nextAt: NOW + 7 * MIN, refusals: 0, askedAt: NOW + 2 * MIN }
  await standIn.clock.advance(MIN)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text', text: /^ +6%$/ }))?.text).toBe('  6%')
  await pane.unmount()
  await standIn.clock.advance(HOUR)
  expect(standIn.usageCalls).toEqual([])

  // The person is back: a key asks, the gap long up; the keys after it ask nothing.
  const typeKey = () => ($.prompt as unknown as { edit: (e: unknown) => Promise<unknown> }).edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' })
  await typeKey()
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(1)
  await standIn.clock.advance(20_000)
  await typeKey()
  await standIn.clock.advance(1)
  expect(standIn.usageCalls.length).toBe(1)
})
