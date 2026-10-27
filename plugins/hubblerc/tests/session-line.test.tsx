import { expect, mock, test } from 'claude-code/testing'

import { statusParts } from '../hooks/band-format'
import { limitsLine } from '../hooks/effort-log'
import { titleIn } from '../hooks/status'
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

test("a session's name is its transcript's custom-title row; another row, or none, is no name read", () => {
  expect(titleIn('{"type":"custom-title","customTitle":"v0.4.0","sessionId":"s"}\n')).toBe('v0.4.0')
  expect(titleIn('{"type":"custom-title","customTitle":"  ","sessionId":"s"}')).toBeNull()
  expect(titleIn('{"type":"user"}')).toBeUndefined()
  expect(titleIn('')).toBeUndefined()
})

test("the status box ends with the session's name and short id; with no name, the id alone; a press copies the whole id", async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  standIn.sessionId = '444027a3-234d-4c3c-8232-a7e561773f2d'
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } as never }
  })
  await start($)

  const bare = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await bare.find({ key: 'session-id' }))?.text).toBe('444027a3')
  expect((await bare.find({ key: 'session' }))?.text).toBe('444027a3')
  await bare.press({ key: 'session-id' })
  expect(copied).toEqual(['444027a3-234d-4c3c-8232-a7e561773f2d'])
  await bare.unmount()

  standIn.sessionName = 'v0.4.0'
  await standIn.clock.advance(30_000)
  const named = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await named.find({ key: 'session' }))?.text).toBe('v0.4.0 · 444027a3')
  await named.unmount()
})

test('a read of the machine that failed at the start is made again, and the chip, memory and OS come back', async ($, on) => {
  const standIn = standInForEngine(on)
  // The read at the start and the one right after it both fail.
  standIn.failMachineReads = 2
  await start($)

  const before = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await before.find({ type: 'Text', text: /M3/ })).toBeUndefined()
  await before.unmount()

  await standIn.clock.advance(30_000)
  const after = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await after.find({ type: 'Text', text: /M3/ }))?.text).toBe('Apple M3 Pro · 18GB')
  expect((await after.find({ type: 'Text', text: /^macOS/ }))?.text).toBe('macOS 27.0.1')
  await after.unmount()
})
