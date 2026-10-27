import { expect, test } from 'claude-code/testing'

import { CHANGELOG_URL, compareVersions, deviceLines, latestVersion, newest, parseDf, parseSysctl, parseVmStat, versionNote } from '../hooks/device'
import { CAT, CAT_PALETTE, catFrame, catMood, pixelRows } from '../hooks/pixel-art'
import { standInForEngine, start } from './engine'

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = {
  title: 'hubblerc',
  isFocused: false,
  bodyColumns: 56,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test("sysctl's chip and memory are read; what is missing is left out", () => {
  expect(parseSysctl('Apple M3 Pro\n19327352832\n')).toEqual({ chip: 'Apple M3 Pro', memoryGb: 18 })
  expect(parseSysctl('')).toEqual({})
})

test('the memory in use adds app memory, wired and compressed pages; the disk left is in GB as Finder counts', () => {
  // (392549 − 15550 + 198111 + 323642) pages of 16 KiB.
  expect(parseVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                     6279.\nPages wired down:                             198111.\nPages purgeable:                               15550.\nAnonymous pages:                              392549.\nPages stored in compressor:                   625561.\nPages occupied by compressor:                 323642.\n')).toBe(13.7)
  expect(parseVmStat('nothing')).toBeUndefined()
  expect(parseDf('Filesystem     1024-blocks     Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s1s1   482797652 13339736 250280580     6%  484019 2502817280    0%   /\n')).toBe(256)
  expect(parseDf('')).toBeUndefined()
})

test('the lines name only what is known', () => {
  expect(deviceLines(null)).toEqual([])
  expect(deviceLines({ os: 'macOS 27.0.1', version: '2.1.310' })).toEqual(['macOS 27.0.1'])
  expect(deviceLines({ memoryUsedGb: 13.7, memoryGb: 18 })).toEqual(['18GB', '메모리 13.7/18GB'])
  expect(deviceLines({ diskFreeGb: 256 })).toEqual(['디스크 256GB 남음'])
})

test('the cat is twelve cells by four, two pixels to a cell', () => {
  const rows = pixelRows(CAT, CAT_PALETTE)
  expect(rows).toHaveLength(4)
  for (const row of rows) expect(row.reduce((sum, run) => sum + [...run.text].length, 0)).toBe(12)
  // The ears: fur over fur a full block, fur below alone ▄; cells of one style run together.
  expect(rows[0]).toEqual([
    { text: ' ' },
    { text: '█▄', color: CAT_PALETTE.O },
    { text: '      ' },
    { text: '▄█', color: CAT_PALETTE.O },
    { text: ' ' },
  ])
  // An eye over fur: the top pixel dark on a fur background.
  expect(pixelRows(['D', 'O'], CAT_PALETTE)[0]).toEqual([{ text: '▀', color: CAT_PALETTE.D, backgroundColor: CAT_PALETTE.O }])
})

test('the sidebar opens with a box of the machine and the engine, beside the cat', async ($, on) => {
  standInForEngine(on)
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'title-device' }))?.text).toBe('╭── ▾ 장비 ')
  // A row of air above and below, in this box alone.
  expect((await ui.find({ key: 'device-body' }))?.props.paddingY).toBe(1)
  expect((await ui.find({ key: 'box-status' }))?.props.paddingY).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /M3/ }))?.text).toBe('Apple M3 Pro · 18GB')
  expect((await ui.find({ type: 'Text', text: /^macOS/ }))?.text).toBe('macOS 27.0.1')
  expect((await ui.find({ type: 'Text', text: /^메모리/ }))?.text).toBe('메모리 13.7/18GB · 디스크 256GB 남음')
  expect(await ui.find({ type: 'Text', text: /켜진 지/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Claude Code/ }))?.text).toBe('Claude Code 2.1.310')
  expect((await ui.findAll({ type: 'Text', text: /[▀▄█]/ })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('the cat\'s mood: a tool first, then what streams, then idle with or without a failure', () => {
  const idle = { isWorking: false, isToolRunning: false, phase: null, lastFailed: false } as const
  expect(catMood(idle)).toBe('sleeping')
  expect(catMood({ ...idle, lastFailed: true })).toBe('startled')
  expect(catMood({ ...idle, isWorking: true })).toBe('awake')
  expect(catMood({ ...idle, isWorking: true, phase: 'thinking' })).toBe('thinking')
  expect(catMood({ ...idle, isWorking: true, phase: 'text' })).toBe('writing')
  expect(catMood({ ...idle, isWorking: true, phase: 'thinking', isToolRunning: true })).toBe('busy')
  // A background subagent after the answer ended still keeps it busy.
  expect(catMood({ ...idle, isToolRunning: true, lastFailed: true })).toBe('busy')
})

test('only a cat at work moves: its picture changes with the second, a resting one stays', () => {
  expect(catFrame('sleeping', 1)).toEqual(catFrame('sleeping', 2))
  expect(catFrame('sleeping', 1).mark).toBe('z')
  expect(catFrame('thinking', 3).mark).toBe('?')
  expect(catFrame('startled', 3).mark).toBe('!')
  expect(catFrame('writing', 1).art).not.toEqual(catFrame('writing', 2).art)
  expect(catFrame('busy', 1).art).not.toEqual(catFrame('busy', 2).art)
  // Awake, it blinks one second in four.
  expect(catFrame('awake', 4).art).not.toEqual(catFrame('awake', 5).art)
  expect(catFrame('awake', 5).art).toEqual(catFrame('awake', 6).art)
  for (const mood of ['sleeping', 'awake', 'thinking', 'writing', 'busy', 'startled'] as const) {
    for (const row of catFrame(mood, 1).art) expect(row).toHaveLength(12)
  }
})

test('idle, the sidebar\'s cat sleeps; after an answer with a failed call it is startled', async ($, on) => {
  standInForEngine(on)
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'cat-mark' }))?.text ?? (await ui.find({ type: 'Text', text: 'z' }))?.text).toBe('z')
  await ui.unmount()

  await $.turn.start({ text: '지워 줘', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /nope', description: '지우기' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  const after = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await after.find({ type: 'Text', text: '!' })).toBeDefined()
  await after.unmount()
})

test('versions compare by their numbers; the newest installed and the latest released are read', () => {
  expect(compareVersions('2.1.310', '2.1.309')).toBeGreaterThan(0)
  expect(compareVersions('2.1.99', '2.1.100')).toBeLessThan(0)
  expect(newest(['2.1.307', '2.1.310', '2.1.99', '.DS_Store', ''])).toBe('2.1.310')
  expect(latestVersion('{"version":"2.1.312"}')).toBe('2.1.312')
  expect(latestVersion('not json')).toBeUndefined()
})

test('beside the running version: a restart when a later one is installed, a release when one is only out, nothing when current', () => {
  expect(versionNote({ version: '2.1.310', installed: '2.1.310', latest: '2.1.310' })).toBeNull()
  expect(versionNote({ version: '2.1.310', installed: '2.1.310', latest: '2.1.312' })).toEqual({ kind: 'released', version: '2.1.312' })
  // Installed and waiting on a restart says so first, a later release or not.
  expect(versionNote({ version: '2.1.310', installed: '2.1.311', latest: '2.1.312' })).toEqual({ kind: 'restart', version: '2.1.311' })
  expect(versionNote(null)).toBeNull()
})

test('a later version shows beside the running one, a link to the changelog', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.latestVersion = '2.1.312'
  await start($)

  const released = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const link = await released.find({ type: 'Link' })
  expect(link?.props.href).toBe(CHANGELOG_URL)
  expect(link?.children).toEqual(['2.1.312'])
  // In the sidebar, colours are the theme's keys: they follow a light theme as a dark one.
  expect((await released.find({ type: 'Text', text: /^ ↑/ }))?.props.color).toBe('suggestion')
  expect(await released.find({ type: 'Text', text: ' 재시작' })).toBeUndefined()
  await released.unmount()
})

test('a later version installed shows yellow with 재시작: a restart applies it', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.installedVersions = ['2.1.310', '2.1.311']
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ type: 'Text', text: /^ ↑/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Text', text: ' 재시작' })).toBeDefined()
  expect((await ui.find({ type: 'Link' }))?.children).toEqual(['2.1.311'])
  await ui.unmount()
})

test('a current version shows nothing beside it', async ($, on) => {
  standInForEngine(on)
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: /^ ↑/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Claude Code/ }))?.text).toBe('Claude Code 2.1.310')
  await ui.unmount()
})
