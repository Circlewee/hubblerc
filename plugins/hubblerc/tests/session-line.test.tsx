import { expect, test } from 'claude-code/testing'

import { statusParts } from '../hooks/band-format'
import { limitsLine } from '../hooks/effort-log'
import { NOW, standInForEngine, start } from './engine'

const COMMAND = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

test('a 5-hour window the engine left out, while it hands others, reads as a dim dash; with no window at all, nothing', () => {
  const input = { model: 'claude-opus-5-5', effort: 'high', isOverridden: false, project: 'p', git: null, now: NOW }
  const lines = (usage: Parameters<typeof statusParts>[0]['usage'], barColumns?: number) =>
    statusParts({ ...input, usage, ...(barColumns === undefined ? {} : { barColumns }) }, Number.POSITIVE_INFINITY).map(part => part.map(segment => segment.text).join(''))

  const noFiveHour = { contextPercent: 20, sevenDay: { percent: 52 }, limits: [{ kind: 'seven_day', percent: 52 }] }
  expect(lines(noFiveHour)).toContain('5h –')
  expect(lines(noFiveHour, 40)).toContain('5h  –')
  expect(lines({ contextPercent: 20, limits: [] }).some(line => line.startsWith('5h'))).toBe(false)
})

test('/effort-log ends with the windows the engine handed over, naming the usual one it left out', () => {
  expect(limitsLine({ limits: [{ kind: 'seven_day', percent: 52 }] })).toBe('엔진이 준 한도: seven_day 52% (five_hour 없음)')
  expect(limitsLine({ limits: [{ kind: 'five_hour', percent: 11 }, { kind: 'seven_day', percent: 52 }] })).toBe('엔진이 준 한도: five_hour 11%, seven_day 52%')
  expect(limitsLine({ limits: [] })).toBe('엔진이 준 한도: 없음')
  expect(limitsLine(null)).toBe('엔진이 준 한도: 아직 읽지 못함')
})

test('/effort-log shows the line in a session', async ($, on) => {
  standInForEngine(on)
  await start($)

  const ran = ((await $.command.run({ ...COMMAND, command: 'effort-log' })) as { text?: string }).text ?? ''
  // The stand-in hands both windows.
  expect(ran.endsWith('엔진이 준 한도: five_hour 25%, seven_day 12%')).toBe(true)
})
