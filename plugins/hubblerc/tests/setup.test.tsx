import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { keyStates, missingCount, setupState, withKeys } from '../hooks/setup'
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
  const done = setupState(JSON.stringify({ bindings: [{ context: 'Chat', bindings: OURS }] }), { tui: 'fullscreen', language: 'korean', statusLine: undefined })
  expect(missingCount(done)).toBe(0)
  expect(done.hasClaudeHud).toBe(false)

  const bare = setupState(undefined, { tui: undefined, language: undefined, statusLine: HUD })
  expect(missingCount(bare)).toBe(3)
  expect(bare.hasClaudeHud).toBe(true)
  expect(bare.hasLanguage).toBe(false)

  // Merged, the status line may be the terminal's own; the person's file still runs claude-hud.
  const wrapped = setupState(undefined, { tui: 'fullscreen', language: 'korean', statusLine: { type: 'command', command: 'orca-status' }, userStatusLine: HUD })
  expect(wrapped.hasClaudeHud).toBe(true)
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

  // The stand-in's settings have no tui: the keys and the fullscreen layout are missing.
  expect(logged).toEqual(['hubblerc 설정 3개가 덜 됐습니다. `/setup`으로 확인하세요'])
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
