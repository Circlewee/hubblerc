import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { readSharedUsage, USAGE_SHARED_KEY, withSharedUsage } from '../hooks/status/usage-share'
import { NOW, standInForEngine, start } from './engine'

const BAND = { plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band', surface: 'terminal' } as const
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const RESET = new Date(NOW + 90 * 60_000).toISOString()

/** The plugin's store, kept where the test can see it: what the sessions share. */
function memoryStore(on: On, entries: Record<string, unknown> = {}): { stored: Record<string, unknown>; sets: string[] } {
  const stored: Record<string, unknown> = { ...entries }
  const sets: string[] = []
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    sets.push(e.key)

    return { value: undefined }
  })

  return { stored, sets }
}

function answerRequests(on: On): void {
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
}

test('shared windows newer than the session\'s own take their place; older ones, or past their reset, do not', () => {
  const own = { contextPercent: 20, fiveHour: { percent: 25, resetsAt: RESET }, sevenDay: { percent: 12 }, limits: [{ kind: 'five_hour', percent: 25 }, { kind: 'seven_day', percent: 12 }] }
  const shared = { fiveHour: { percent: 40, resetsAt: RESET }, sevenDay: { percent: 13 }, at: NOW }

  const merged = withSharedUsage(own, NOW - 1000, shared, NOW)
  expect(merged.fiveHour?.percent).toBe(40)
  expect(merged.sevenDay?.percent).toBe(13)
  expect(merged.contextPercent).toBe(20)
  expect(merged.limits).toEqual([{ kind: 'five_hour', percent: 40 }, { kind: 'seven_day', percent: 13 }])

  expect(withSharedUsage(own, NOW + 1, shared, NOW)).toBe(own)
  expect(withSharedUsage(own, 0, null, NOW)).toBe(own)
  // The shared 5h window's reset is past: the session's own stands.
  expect(withSharedUsage(own, 0, { ...shared, fiveHour: { percent: 90, resetsAt: new Date(NOW - 1).toISOString() } }, NOW).fiveHour?.percent).toBe(25)
  expect(readSharedUsage({ fiveHour: { percent: 'x' }, at: 5 })).toEqual({ at: 5 })
  expect(readSharedUsage({ fiveHour: { percent: 3 } })).toBeNull()
})

test('an idle session draws the windows another session\'s response reported, at the next half minute and with no write', async ($, on) => {
  const standIn = standInForEngine(on)
  const { stored, sets } = memoryStore(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, props: BAND_PROPS })
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()

  // Another session's request came back: its reading is in the store.
  stored[USAGE_SHARED_KEY] = { fiveHour: { percent: 61, resetsAt: RESET }, sevenDay: { percent: 14 }, at: NOW + 10_000 }
  await standIn.clock.advance(35_000)
  expect(await ui.find({ type: 'Text', text: '61%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeUndefined()
  expect(sets.filter(key => key === USAGE_SHARED_KEY)).toEqual([])
  await ui.unmount()
})

test('a session whose response is the newest writes its windows: mid-answer at most each half minute, and as the answer ends', async ($, on) => {
  const standIn = standInForEngine(on)
  answerRequests(on)
  const { stored, sets } = memoryStore(on)
  await start($)
  const writes = () => sets.filter(key => key === USAGE_SHARED_KEY).length
  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
    for await (const chunk of stream) void chunk
    await standIn.clock.advance(1)
  }
  expect(writes()).toBe(0)

  await $.turn.start({ text: '질문', turnId: 't1' })
  standIn.fiveHourPercent = 30
  await step(0)
  expect(writes()).toBe(1)
  expect((stored[USAGE_SHARED_KEY] as { fiveHour: { percent: number } }).fiveHour.percent).toBe(30)

  // Within the half minute: not written again; the answer's end writes what moved since.
  standIn.fiveHourPercent = 31
  await step(1)
  expect(writes()).toBe(1)
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 3000 })
  expect(writes()).toBe(2)
  expect((stored[USAGE_SHARED_KEY] as { fiveHour: { percent: number } }).fiveHour.percent).toBe(31)

  // Idle after it, nothing moved: no write.
  await standIn.clock.advance(120_000)
  expect(writes()).toBe(2)
})
