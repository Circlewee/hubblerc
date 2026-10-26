import { expect, test } from 'claude-code/testing'

import type { FiveHourPoint } from '../types'
import { addFiveHourPoint, burnoutMinutes, cacheShare, pointsUsed, requestTime, tokenCount } from '../hooks/forecast'

const MIN = 60_000
const NOW = Date.parse('2026-10-26T09:00:00Z')
const RESET = new Date(NOW + 3 * 60 * MIN).toISOString()

test('a 5-hour reading joins the log only when it moved, and old readings fall away', () => {
  const first = addFiveHourPoint([], { percent: 40, resetsAt: RESET }, NOW)
  expect(first).toEqual([{ at: NOW, percent: 40, resetsAt: RESET }])
  expect(addFiveHourPoint(first ?? [], { percent: 40, resetsAt: RESET }, NOW + MIN)).toBeNull()
  expect(addFiveHourPoint(first ?? [], undefined, NOW + MIN)).toBeNull()

  // Three hours on, the first reading is past the two hours kept.
  const later = addFiveHourPoint(first ?? [], { percent: 41, resetsAt: RESET }, NOW + 180 * MIN)
  expect(later).toEqual([{ at: NOW + 180 * MIN, percent: 41, resetsAt: RESET }])
})

test('at the last hour’s pace, a window running out within the hour shows the minutes left', () => {
  // 60% to 80% over the last 40 minutes: a point every two minutes, 20 left → 40 minutes.
  const log: FiveHourPoint[] = [
    { at: NOW - 40 * MIN, percent: 60, resetsAt: RESET },
    { at: NOW - 20 * MIN, percent: 70, resetsAt: RESET },
    { at: NOW - 2 * MIN, percent: 80, resetsAt: RESET },
  ]

  expect(burnoutMinutes(log, { percent: 80, resetsAt: RESET }, NOW)).toBe(40)
})

test('the reading that stood an hour ago is counted from then, not from when it was taken', () => {
  // 50% since three hours ago, then 80% now: 30 points over the last hour, 20 left → 40 minutes.
  const log: FiveHourPoint[] = [
    { at: NOW - 100 * MIN, percent: 50, resetsAt: RESET },
    { at: NOW - MIN, percent: 80, resetsAt: RESET },
  ]

  expect(burnoutMinutes(log, { percent: 80, resetsAt: RESET }, NOW)).toBe(40)
})

test('no chip on a slow pace, a short or flat span, a reset that comes first, or a new window', () => {
  const window = { percent: 80, resetsAt: RESET }
  const slow: FiveHourPoint[] = [{ at: NOW - 60 * MIN, percent: 75, resetsAt: RESET }]
  expect(burnoutMinutes(slow, window, NOW)).toBeNull()

  const short: FiveHourPoint[] = [{ at: NOW - 5 * MIN, percent: 70, resetsAt: RESET }]
  expect(burnoutMinutes(short, window, NOW)).toBeNull()

  const flat: FiveHourPoint[] = [{ at: NOW - 30 * MIN, percent: 79, resetsAt: RESET }]
  expect(burnoutMinutes(flat, window, NOW)).toBeNull()

  const soonReset = new Date(NOW + 10 * MIN).toISOString()
  const fast: FiveHourPoint[] = [{ at: NOW - 20 * MIN, percent: 60, resetsAt: soonReset }]
  expect(burnoutMinutes(fast, { percent: 80, resetsAt: soonReset }, NOW)).toBeNull()

  const otherWindow: FiveHourPoint[] = [{ at: NOW - 20 * MIN, percent: 10, resetsAt: new Date(NOW - 2 * 60 * MIN).toISOString() }]
  expect(burnoutMinutes(otherWindow, window, NOW)).toBeNull()
  expect(burnoutMinutes([], undefined, NOW)).toBeNull()
})

test('the last request reads as a clock time, and the cache\'s share of an answer\'s prompts in percent', () => {
  const at = new Date(NOW)
  expect(requestTime(NOW)).toBe(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`)
  expect(requestTime(null)).toBeNull()
  expect(cacheShare({ input: 10, cacheRead: 960, cacheWrite: 30, output: 100 })).toBe(96)
  expect(cacheShare({ input: 0, cacheRead: 0, cacheWrite: 0, output: 5 })).toBeNull()
  expect(cacheShare(undefined)).toBeNull()
})

test('token counts are short', () => {
  expect(tokenCount(850)).toBe('850')
  expect(tokenCount(1000)).toBe('1k')
  expect(tokenCount(1234)).toBe('1.2k')
  expect(tokenCount(12_345)).toBe('12k')
  expect(tokenCount(1_250_000)).toBe('1.3M')
})

test('the points a turn took come from the same window, never below zero', () => {
  expect(pointsUsed({ percent: 40, resetsAt: RESET }, { percent: 43, resetsAt: RESET })).toBe(3)
  expect(pointsUsed({ percent: 40, resetsAt: RESET }, { percent: 39, resetsAt: RESET })).toBe(0)
  expect(pointsUsed({ percent: 90, resetsAt: RESET }, { percent: 2, resetsAt: new Date(NOW + 5 * 60 * MIN).toISOString() })).toBeNull()
  expect(pointsUsed(undefined, { percent: 2, resetsAt: RESET })).toBeNull()
})
