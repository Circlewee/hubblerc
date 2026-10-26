import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isAutoUpdating, keyStates, missingCount, setupState, withAutoUpdate, withKeys } from '../hooks/setup'
import { standInForEngine, start } from './engine'

const OURS = { 'ctrl+x ctrl+e': 'app:cycleDiffBase', 'ctrl+x ctrl+p': 'command:panel' }
const COMMAND = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
const KEY_FILE = '/home/me/.claude/keybindings.json'
const HUD = { type: 'command', command: 'node ~/.claude/plugins/cache/claude-hud/dist/index.js' }

test("our keys are found in the Chat context: bound, missing, or bound to something else", () => {
  expect(keyStates(JSON.stringify({ bindings: [{ context: 'Chat', bindings: OURS }] })).map(key => key.state)).toEqual(['ok', 'ok'])
  expect(keyStates(undefined).map(key => key.state)).toEqual(['missing', 'missing'])
  const other = keyStates(JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+x ctrl+e': 'chat:externalEditor' } }] }))
  expect(other[0]).toMatchObject({ state: 'conflict', current: 'chat:externalEditor' })
  expect(other[1]?.state).toBe('missing')
})

test('the missing keys are added to the Chat context, everything else kept; a key bound elsewhere is left', () => {
  const file = {
    $schema: 'x',
    bindings: [
      { context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } },
      { context: 'Chat', bindings: { 'ctrl+x ctrl+e': 'chat:externalEditor', 'ctrl+g': 'chat:externalEditor' } },
    ],
  }
  const next = JSON.parse(withKeys(JSON.stringify(file)) ?? '{}')
  expect(next.$schema).toBe('x')
  expect(next.bindings[0]).toEqual(file.bindings[0])
  expect(next.bindings[1].bindings).toEqual({ 'ctrl+x ctrl+e': 'chat:externalEditor', 'ctrl+g': 'chat:externalEditor', 'ctrl+x ctrl+p': 'command:panel' })

  // A new file is made whole; one with every key, or one that is not JSON, is not written.
  expect(JSON.parse(withKeys(undefined) ?? '{}').bindings).toEqual([{ context: 'Chat', bindings: OURS }])
  expect(withKeys(JSON.stringify({ bindings: [{ context: 'Chat', bindings: OURS }] }))).toBeNull()
  expect(withKeys('{ not json')).toBeNull()
})

test('needed: our keys and the fullscreen layout; claude-hud and the language are advice', () => {
  const done = setupState(
    JSON.stringify({ bindings: [{ context: 'Chat', bindings: OURS }] }),
    { tui: 'fullscreen', language: 'korean', statusLine: undefined },
    JSON.stringify({ extraKnownMarketplaces: { hubblerc: { source: { source: 'github', repo: 'Circlewee/hubblerc' }, autoUpdate: true } } }),
  )
  expect(missingCount(done)).toBe(0)
  expect(done.hasClaudeHud).toBe(false)

  const bare = setupState(undefined, { tui: undefined, language: undefined, statusLine: HUD })
  expect(missingCount(bare)).toBe(4)
  expect(bare.hasClaudeHud).toBe(true)
  expect(bare.hasLanguage).toBe(false)

  // A project's own status line in place of claude-hud: none here.
  expect(setupState(undefined, { tui: 'fullscreen', language: 'korean', statusLine: { type: 'command', command: 'true' } }).hasClaudeHud).toBe(false)
})

/** The machine's home and its keybindings file, as the test sets them. */
function machine(on: On, files: Record<string, string>): Record<string, string> {
  mock.env(on, { HOME: '/home/me' })
  on('fs.read', (_, e) => (files[e.path] === undefined ? { deny: `no file ${e.path}` } : { value: files[e.path] as never }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })

  return files
}

test('a first run on a new machine says what is missing, once, in the conversation', async ($, on) => {
  standInForEngine(on)
  machine(on, {})
  const logged: string[] = []
  on('ui.log', (_, e) => {
    logged.push(e.text)

    return { value: undefined }
  })
  await start($)

  // The stand-in's settings have no tui, and no settings file turns auto-update on: the two keys,
  // the fullscreen layout and auto-update are missing.
  expect(logged).toEqual(['hubblerc 설정 4개가 덜 됐습니다. `/setup`으로 확인하세요'])
})

test('/setup adds the missing keys, keeps the old file as .bak, and tells the rest', async ($, on) => {
  standInForEngine(on)
  const before = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+g': 'chat:externalEditor' } }] })
  const files = machine(on, { [KEY_FILE]: before })
  await start($)

  const ran = await $.command.run({ ...COMMAND, command: 'setup' })
  expect(files[`${KEY_FILE}.bak`]).toBe(before)
  expect(JSON.parse(files[KEY_FILE] ?? '{}').bindings[0].bindings).toEqual({ 'ctrl+g': 'chat:externalEditor', ...OURS })
  const text = (ran as { text?: string }).text ?? ''
  expect(text).toContain('✓ 키 ctrl+x ctrl+e: effort 슬라이더 (방금 추가함)')
  expect(text).toContain('✗ 전체 화면이 아닙니다')
  expect(text).toContain(`원래 파일은 \`${KEY_FILE}.bak\``)

  // A second run has nothing to add and writes nothing.
  files[`${KEY_FILE}.bak`] = 'untouched'
  const again = await $.command.run({ ...COMMAND, command: 'setup' })
  expect(files[`${KEY_FILE}.bak`]).toBe('untouched')
  expect((again as { text?: string }).text).toContain('✓ 키 ctrl+x ctrl+p: 사이드바 열기/닫기')
})

test("auto-update is turned on in the marketplace's entry of the user's settings, nothing else changed", () => {
  const settings = { model: 'opus', extraKnownMarketplaces: { 'claude-hud': { source: { source: 'github', repo: 'x/claude-hud' } }, hubblerc: { source: { source: 'github', repo: 'Circlewee/hubblerc' } } }, theme: 'dark' }
  const next = JSON.parse(withAutoUpdate(JSON.stringify(settings)) ?? '{}')
  expect(next.extraKnownMarketplaces.hubblerc).toEqual({ source: { source: 'github', repo: 'Circlewee/hubblerc' }, autoUpdate: true })
  expect(next.extraKnownMarketplaces['claude-hud']).toEqual(settings.extraKnownMarketplaces['claude-hud'])
  expect(Object.keys(next)).toEqual(['model', 'extraKnownMarketplaces', 'theme'])
  expect(isAutoUpdating(JSON.stringify(next))).toBe(true)

  // No entry yet: made with the GitHub source. On already, or not JSON: nothing to write.
  expect(JSON.parse(withAutoUpdate('{}') ?? '{}').extraKnownMarketplaces.hubblerc).toEqual({ source: { source: 'github', repo: 'Circlewee/hubblerc' }, autoUpdate: true })
  expect(withAutoUpdate(JSON.stringify(next))).toBeNull()
  expect(withAutoUpdate('{ not json')).toBeNull()
})

test('/setup turns auto-update on, the old settings kept as .bak', async ($, on) => {
  standInForEngine(on)
  const before = JSON.stringify({ theme: 'dark', extraKnownMarketplaces: { hubblerc: { source: { source: 'github', repo: 'Circlewee/hubblerc' } } } })
  const files = machine(on, { [KEY_FILE]: JSON.stringify({ bindings: [{ context: 'Chat', bindings: OURS }] }), '/home/me/.claude/settings.json': before })
  await start($)

  const ran = await $.command.run({ ...COMMAND, command: 'setup' })
  expect(files['/home/me/.claude/settings.json.bak']).toBe(before)
  expect(JSON.parse(files['/home/me/.claude/settings.json'] ?? '{}').extraKnownMarketplaces.hubblerc.autoUpdate).toBe(true)
  expect((ran as { text?: string }).text).toContain('✓ 자동 업데이트: 방금 켬')
  // The keys were there: their file is not touched.
  expect(files[`${KEY_FILE}.bak`]).toBeUndefined()
})
