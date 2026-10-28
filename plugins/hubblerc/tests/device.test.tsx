import { expect, test } from 'claude-code/testing'

import { CHANGELOG_URL, compareVersions, deviceLines, latestVersion, manifestVersion, newest, parseDf, parseSysctl, parseVmStat, versionNote } from '../hooks/device'
import { CAT, CAT_PALETTE, catFrame, catMood, pixelRows } from '../hooks/pixel-art'
import { pngSize } from '../hooks/cat-images'
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

test('the cat is thirty-two cells by sixteen in half blocks, two pixels to a cell', () => {
  const rows = pixelRows(CAT, CAT_PALETTE)
  expect(rows).toHaveLength(16)
  for (const row of rows) expect(row.reduce((sum, run) => sum + [...run.text].length, 0)).toBe(32)
  // The ear tips: outline over seal; outline under nothing a lower half; runs of one style together.
  const O = CAT_PALETTE.O
  expect(rows[0]).toEqual([
    { text: '      ' },
    { text: '▄', color: O },
    { text: '▀', color: O, backgroundColor: CAT_PALETTE.S },
    { text: '▄▄', color: O },
    { text: '            ' },
    { text: '▄▄', color: O },
    { text: '▀', color: O, backgroundColor: CAT_PALETTE.S },
    { text: '▄', color: O },
    { text: '      ' },
  ])
  // An eye over the mask: the top pixel blue on a mask background, in the row under the eyes.
  expect(pixelRows(['B', 'M'], CAT_PALETTE)[0]).toEqual([{ text: '▀', color: CAT_PALETTE.B, backgroundColor: CAT_PALETTE.M }])
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
  // Where the terminal draws pictures, the cat is one, five rows tall beside the lines; no half blocks.
  const picture = await ui.find({ key: 'cat-picture' })
  expect(picture?.props.rows).toBe(5)
  expect(picture?.props.columns).toBe(10)
  expect((picture?.props.source as { png: string }).png.startsWith('iVBORw0KGgo')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /[▀▄█]/ })).length).toBe(0)
  await ui.unmount()
})

test('where the terminal draws the picture\'s alt, the cat goes back to half blocks above the lines', async ($, on) => {
  const standIn = standInForEngine(on)
  const blits: unknown[] = []
  on('ui.blit', (_, e) => {
    blits.push(e)

    return { value: { deny: 'the Image draws its alt: no placeholder images' } }
  })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'cat-picture' })).toBeDefined()
  await standIn.clock.advance(1000)
  expect(blits).toHaveLength(1)
  expect(await ui.find({ key: 'cat-picture' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text', text: /[▀▄█]/ })).length).toBeGreaterThan(0)
  expect((await ui.find({ key: 'device-body' }))?.props.flexDirection).toBe('column')
  await ui.unmount()
})

test('a picture that stands still is sent again every ten seconds while the sidebar shows, and not when it is hidden', async ($, on) => {
  const standIn = standInForEngine(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)
  standIn.panes.push({ id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // The probe at one second; the idle cat seen at ten, sent again at twenty and thirty.
  await standIn.clock.advance(31_000)
  expect(blits).toBe(3)
  standIn.panes = []
  await standIn.clock.advance(20_000)
  expect(blits).toBe(3)
  await ui.unmount()
})

test('a blit taken keeps the picture, and is not asked again', async ($, on) => {
  const standIn = standInForEngine(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await standIn.clock.advance(1000)
  await standIn.clock.advance(5000)
  expect(blits).toBe(1)
  expect(await ui.find({ key: 'cat-picture' })).toBeDefined()
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
    for (const second of [1, 2]) {
      expect(catFrame(mood, second).art).toHaveLength(32)
      for (const row of catFrame(mood, second).art) expect(row).toHaveLength(32)
    }
  }
})

/** A 4×2 PNG, base64. */
const PNG_4X2 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC'

test('a PNG\'s size is read from its header; what is not a PNG has none', () => {
  expect(pngSize(PNG_4X2)).toEqual({ width: 4, height: 2 })
  expect(pngSize('aGVsbG8gd29ybGQsIHRoaXMgaXMgbm90IGEgcG5n')).toBeNull()
  expect(pngSize('')).toBeNull()
})

test('the user\'s own PNGs in assets/cat/<mood> are the picture, a frame a second; a mood without any shows the awake ones', async ($, on) => {
  standInForEngine(on)
  // No sleeping folder: the idle cat shows the awake pictures.
  const folders: Record<string, string[]> = { awake: ['02.png', '01.png', 'notes.txt'] }
  on('fs.list', (_, e) => {
    const mood = /assets\/cat\/([a-z]+)$/.exec(e.path)?.[1] ?? ''
    const names = folders[mood]

    return names === undefined ? { deny: 'no folder' } : { value: names.map(name => ({ name, kind: 'file' as const, size: 70 })) }
  })
  const reads: string[] = []
  on('fs.read', (_, e) => {
    if (!e.path.includes('/assets/cat/')) return { deny: 'no file' }
    reads.push(e.path.replace(/.*assets\/cat\//, ''))

    return { value: { base64: PNG_4X2 } as never }
  })
  await start($)
  // Each folder's PNGs in name order; other files left alone.
  expect(reads).toEqual(['awake/01.png', 'awake/02.png'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const picture = await ui.find({ key: 'cat-picture' })
  expect((picture?.props.source as { png: string }).png).toBe(PNG_4X2)
  // Square pixels in five rows: 4×2 pixels is twenty cells wide.
  expect(picture?.props.columns).toBe(20)
  expect(picture?.props.rows).toBe(5)
  await ui.unmount()
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

test("hubblerc's own version shows under Claude Code's, marked when it runs from its own folder", async ($, on) => {
  standInForEngine(on)
  on('fs.read', (_, e) => (e.path.endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ name: 'hubblerc', version: '0.4.0' }) as never } : { deny: 'no file' }))
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // The tests run the plugin from the repository, not from the plugin cache.
  expect((await ui.find({ type: 'Text', text: /^hubblerc \d/ }))?.text).toBe('hubblerc 0.4.0 dev')
  await ui.unmount()

  expect(manifestVersion('{"version":"0.4.0"}')).toBe('0.4.0')
  expect(manifestVersion('not json')).toBeUndefined()
  expect(manifestVersion(undefined)).toBeUndefined()
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
