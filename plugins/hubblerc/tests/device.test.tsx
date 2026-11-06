import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CHANGELOG_URL, compareVersions, deviceLines, latestVersion, manifestVersion, newest, parseDf, parseSysctl, parseVmStat, versionNote } from '../hooks/device'
import { catMark, catMood, pngSize } from '../hooks/cat-images'
import { catPictures, PNG_4X2, standInForEngine, start } from './engine'

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

test('the sidebar opens with a box of the machine and the engine, beside the cat', async ($, on) => {
  standInForEngine(on)
  catPictures(on)
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
  // Before the terminal has said whether it draws pictures, the cat is one, five rows tall beside
  // the lines: a terminal that cannot shows its blank alt there.
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/ })).toBeUndefined()
  const picture = await ui.find({ key: 'cat-picture' })
  expect(picture?.props.rows).toBe(5)
  expect(picture?.props.columns).toBe(20)
  expect(picture?.props.alt).toBe(' ')
  expect((picture?.props.source as { png: string }).png).toBe(PNG_4X2)
  await ui.unmount()
})

test('with no pictures in assets/cat the sidebar draws no cat: the lines alone', async ($, on) => {
  standInForEngine(on)
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'cat' })).toBeUndefined()
  expect(await ui.find({ key: 'cat-mark' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /M3/ }))?.text).toBe('Apple M3 Pro · 18GB')
  await ui.unmount()
})

test('where the terminal draws the picture\'s alt, the cat goes and the lines stand alone', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
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
  // No cat, no mark, no half blocks: the lines alone, as in the app.
  expect(await ui.find({ key: 'cat' })).toBeUndefined()
  expect(await ui.find({ key: 'cat-mark' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/ })).toBeUndefined()
  expect((await ui.find({ key: 'device-body' }))?.props.columnGap).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /M3/ }))?.text).toBe('Apple M3 Pro · 18GB')
  await ui.unmount()
})

const SHOWN = { id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true }
type PromptEdit = { origin: { kind: 'composer' }; text: string; cursor: number; start: number; end: number; inputText: string }
/**
 * A key typed in the prompt box. The kit raises `prompt.edit` though its `$` types leave it out; the
 * editor beneath (`typingBeneath`) applies the splice.
 */
const typeKey = ($: Engine) =>
  ($.prompt as unknown as { edit: (e: PromptEdit) => Promise<unknown> }).edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' })
function typingBeneath(on: On): void {
  on('prompt.edit', (_, e) => ({ text: `${e.text.slice(0, e.start)}${e.inputText}${e.text.slice(e.end)}`, cursor: e.start + e.inputText.length }))
}

test('a picture that stands still is not sent again while nothing happens: no timer wakes for it', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)
  standIn.panes.push(SHOWN)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // The probe's one, at a second; then a minute of nothing.
  await standIn.clock.advance(61_000)
  expect(blits).toBe(1)
  await ui.unmount()
})

test('a key in the prompt box sends the picture again, at most every ten seconds', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
  typingBeneath(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)
  standIn.panes.push(SHOWN)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // The probe sent it at a second; ten seconds on, a key sends it again.
  await standIn.clock.advance(11_000)
  expect(blits).toBe(1)
  await typeKey($)
  await standIn.clock.settle()
  expect(blits).toBe(2)
  // The keys after it, within ten seconds, send nothing.
  await standIn.clock.advance(5_000)
  await typeKey($)
  await typeKey($)
  await standIn.clock.settle()
  expect(blits).toBe(2)
  await standIn.clock.advance(5_000)
  await typeKey($)
  await standIn.clock.settle()
  expect(blits).toBe(3)
  await ui.unmount()
})

test('a question that starts sends the picture again', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)
  standIn.panes.push(SHOWN)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await standIn.clock.advance(11_000)
  expect(blits).toBe(1)
  await $.turn.start({ text: '질문', turnId: 't1' })
  await standIn.clock.settle()
  expect(blits).toBe(2)
  await ui.unmount()
})

test('a closed sidebar is sent nothing: the first key forgets the picture, the keys after it ask for no panes till it is drawn again', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
  typingBeneath(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)
  standIn.panes.push(SHOWN)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await standIn.clock.advance(11_000)
  expect(blits).toBe(1)

  standIn.panes = []
  await ui.unmount()
  const reads = standIn.paneReads
  await typeKey($)
  await standIn.clock.settle()
  expect(standIn.paneReads).toBe(reads + 1)
  await typeKey($)
  // A question sends nothing either.
  await $.turn.start({ text: '질문', turnId: 't1' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  await standIn.clock.settle()
  expect(blits).toBe(1)
  await typeKey($)
  await standIn.clock.settle()
  expect(standIn.paneReads).toBe(reads + 1)

  // Drawn again (a new frame, sent with the drawing): a key ten seconds on sends it again.
  standIn.panes.push(SHOWN)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await standIn.clock.advance(10_000)
  await typeKey($)
  await standIn.clock.settle()
  expect(blits).toBe(2)
  await again.unmount()
})

test('a sidebar first drawn after the probe stopped is still asked about', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await start($)
  // Nothing drawn for half a minute: the probe stops after ten seconds.
  await standIn.clock.advance(30_000)
  expect(blits).toBe(0)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // Its drawing starts the probe again; it asks a second on.
  await standIn.clock.advance(1_000)
  expect(blits).toBe(1)
  await standIn.clock.advance(11_000)
  expect(blits).toBe(1)
  await ui.unmount()
})

test('awake, the cat\'s pictures blink one second in four, not every other', async ($, on) => {
  const standIn = standInForEngine(on)
  const BLINK = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgYPj/H4KhDAA/0gf5tBJPzQAAAABJRU5ErkJggg=='
  on('fs.list', (_, e) => (e.path.endsWith('/assets/cat/awake') ? { value: ['01.png', '02.png'].map(name => ({ name, kind: 'file' as const, size: 70 })) } : { deny: 'no folder' }))
  on('fs.read', (_, e) => (e.path.includes('/assets/cat/awake/') ? { value: { base64: e.path.endsWith('02.png') ? BLINK : PNG_4X2 } as never } : { deny: 'no file' }))
  await start($)
  await $.turn.start({ text: '안녕', turnId: 't1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const shown: string[] = []
  for (let i = 0; i < 8; i += 1) {
    const second = Math.floor(standIn.clock.now() / 1000)
    const png = ((await ui.find({ key: 'cat-picture' }))?.props.source as { png: string }).png
    shown.push(`${second % 4}:${png === BLINK ? 'blink' : 'open'}`)
    await standIn.clock.advance(1000)
  }
  expect(shown.filter(entry => entry.endsWith('blink')).every(entry => entry.startsWith('0:'))).toBe(true)
  expect(shown.filter(entry => entry.endsWith('blink'))).toHaveLength(2)
  await ui.unmount()
})

test('a blit taken keeps the picture, and is not asked again', async ($, on) => {
  const standIn = standInForEngine(on)
  catPictures(on)
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

test('beside the head: z asleep, ? thinking, ! startled, nothing otherwise', () => {
  expect(catMark('sleeping')).toBe('z')
  expect(catMark('thinking')).toBe('?')
  expect(catMark('startled')).toBe('!')
  for (const mood of ['awake', 'writing', 'busy'] as const) expect(catMark(mood)).toBe('')
})

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
  catPictures(on)
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

test('while the sidebar shows, a version installed later appears within five minutes; the registry is asked once an hour', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  standIn.panes.push({ id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true })
  const listings = () => standIn.ran.filter(argv => argv[0] === 'sh').length
  expect(listings()).toBe(1)
  expect(standIn.fetches).toBe(1)

  standIn.installedVersions = ['2.1.310', '2.1.311']
  await standIn.clock.advance(4 * 60_000)
  expect(listings()).toBe(1)
  await standIn.clock.advance(60_000)
  expect(listings()).toBe(2)
  expect(standIn.fetches).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ type: 'Link' }))?.children).toEqual(['2.1.311'])
  await ui.unmount()

  await standIn.clock.advance(55 * 60_000)
  expect(standIn.fetches).toBe(2)
})
