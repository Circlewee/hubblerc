import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { needsRelaunch, relaunchState, shellVersion, withRelaunchLine } from '../hooks/setup'
import { NOW, standInForEngine, start } from './engine'

const COMMAND = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
const RELAUNCH_FILE = '/tmp/hubblerc-relaunch.1'
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

/** The machine as the test sets it: its environment, files and store, and each `/exit` asked for. */
function machine(on: On, env: Record<string, string>, stored: Record<string, unknown> = {}, shipped?: string) {
  mock.env(on, env)
  const files: Record<string, string> = {}
  on('fs.read', (_, e) => {
    // The plugin's own script, wherever its root is.
    if (shipped !== undefined && e.path.endsWith('/shell/relaunch.zsh') && !e.path.startsWith('/home/me')) return { value: shipped as never }

    return files[e.path] === undefined ? { deny: `no file ${e.path}` } : { value: files[e.path] as never }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  const store: Record<string, unknown> = { ...stored }
  on('store.get', (_, e) => ({ value: store[e.key] as never }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) as never }))
  const exits: string[] = []
  on('command.run', { command: 'exit' }, (_, e) => {
    exits.push(e.command)

    return { text: '' }
  })

  return { files, store, exits }
}

const relaunch = async ($: Engine) => ((await $.command.run({ ...COMMAND, command: 'relaunch' })) as { text?: string }).text ?? ''

/** Lets what the plugin sent without waiting (the `/exit`) arrive. */
const { setTimeout: later } = globalThis as unknown as { setTimeout: (run: () => void, ms: number) => void }
const settle = () => new Promise<void>(resolve => later(resolve, 20))

test('without the shell function, /relaunch says why and leaves the session as it is', async ($, on) => {
  standInForEngine(on)
  const { files, exits } = machine(on, { HOME: '/home/me' })
  await start($)

  expect(await relaunch($)).toContain('셸 함수 없이 띄운 세션')
  await settle()
  expect(exits).toEqual([])
  expect(Object.keys(files)).toEqual([])
})

test('with nothing running, /relaunch writes the session id for the shell function and exits; the turns wait in the store', async ($, on) => {
  const standIn = standInForEngine(on)
  const { files, store, exits } = machine(on, { HOME: '/home/me', HUBBLERC_RELAUNCH_FILE: RELAUNCH_FILE })
  await start($)
  await $.turn.start({ text: '질문 하나', turnId: 't1' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })

  expect(await relaunch($)).toBe('재시작합니다.')
  // A moment later, not from inside the command.
  expect(exits).toEqual([])
  await standIn.clock.advance(200)
  await settle()
  expect(files[RELAUNCH_FILE]).toBe('session-1')
  expect(exits).toEqual(['exit'])
  expect(store.restartSnapshot).toMatchObject({ sessionId: 'session-1', turns: [{ id: 't1', durationMs: 5000 }] })
})

test('mid-answer, /relaunch waits for the answer to end; asked again before then, it is taken back', async ($, on) => {
  const standIn = standInForEngine(on)
  const { files, exits } = machine(on, { HOME: '/home/me', HUBBLERC_RELAUNCH_FILE: RELAUNCH_FILE })
  await start($)
  await $.turn.start({ text: '긴 작업', turnId: 't1' })

  expect(await relaunch($)).toContain('진행 중인 작업이 끝나면 재시작합니다')
  await standIn.clock.advance(4000)
  await settle()
  expect(exits).toEqual([])
  expect(files[RELAUNCH_FILE]).toBeUndefined()

  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 9000 })
  await standIn.clock.advance(2000)
  await settle()
  expect(files[RELAUNCH_FILE]).toBe('session-1')
  expect(exits).toEqual(['exit'])
})

test('/relaunch run again while it waits takes the restart back', async ($, on) => {
  const standIn = standInForEngine(on)
  const { exits } = machine(on, { HOME: '/home/me', HUBBLERC_RELAUNCH_FILE: RELAUNCH_FILE })
  await start($)
  await $.turn.start({ text: '긴 작업', turnId: 't1' })

  await relaunch($)
  expect(await relaunch($)).toBe('재시작 예약을 취소했습니다.')
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 9000 })
  await standIn.clock.advance(4000)
  await settle()
  expect(exits).toEqual([])
})

test('the session opened again by the restart gets its turns back with their times, and the effort it chose', async ($, on) => {
  standInForEngine(on)
  const turn = { id: 't1', prompt: '재시작 전 질문', startedAt: NOW - 60_000, durationMs: 5000, runs: [] }
  const { store } = machine(on, { HOME: '/home/me' }, { restartSnapshot: { sessionId: 'session-1', savedAt: NOW - 30_000, turns: [turn], effortOverride: 'medium', effortAuto: null } })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 1')
  expect(await ui.find({ type: 'Text', text: '5s' })).toBeDefined()
  expect((await ui.find({ key: 'effort' }))?.text).toBe('medium')
  await ui.unmount()
  // Taken once.
  expect(store.restartSnapshot).toBeUndefined()
})

test("another session's snapshot, or an old one, is dropped and not used", async ($, on) => {
  standInForEngine(on)
  const turn = { id: 't1', prompt: '다른 세션', startedAt: NOW - 60_000, durationMs: 5000, runs: [] }
  const { store } = machine(on, { HOME: '/home/me' }, { restartSnapshot: { sessionId: 'session-2', savedAt: NOW, turns: [turn], effortOverride: null, effortAuto: null } })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 0')
  await ui.unmount()
  expect(store.restartSnapshot).toBeUndefined()
})

test('the sidebar\'s "재시작" beside an installed version asks for the restart, and reads "재시작 대기" while it waits', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.installedVersions.push('2.1.311')
  const { exits } = machine(on, { HOME: '/home/me', HUBBLERC_RELAUNCH_FILE: RELAUNCH_FILE })
  await start($)
  await $.turn.start({ text: '긴 작업', turnId: 't1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'restart' }))?.text).toBe(' 재시작')
  await ui.press({ key: 'restart' })
  expect((await ui.find({ key: 'restart' }))?.text).toBe(' 재시작 대기')
  await ui.unmount()

  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 9000 })
  await standIn.clock.advance(2000)
  await settle()
  expect(exits).toEqual(['exit'])
})

test('the relaunch function: copied when missing or changed, sourced once from ~/.zshrc; an alias named claude stops it', () => {
  const facts = { isZsh: true, shipped: 'SCRIPT', installed: undefined, zshrc: "alias hcc='claude --plugin-dir x'\n", isActive: false }
  expect(needsRelaunch(relaunchState(facts))).toBe(true)
  expect(needsRelaunch(relaunchState({ ...facts, installed: 'OLD', zshrc: `${facts.zshrc}source ~/.claude/hubblerc/relaunch.zsh\n` }))).toBe(true)
  expect(needsRelaunch(relaunchState({ ...facts, installed: 'SCRIPT', zshrc: `${facts.zshrc}source ~/.claude/hubblerc/relaunch.zsh\n` }))).toBe(false)
  expect(needsRelaunch(relaunchState({ ...facts, zshrc: "alias claude='claude --foo'\n" }))).toBe(false)
  expect(needsRelaunch(relaunchState({ ...facts, isZsh: false }))).toBe(false)
  // Numbered copies: a newer one installed stays (an older hubblerc's /setup must not undo it); an older one is replaced.
  const sourced = `${facts.zshrc}source ~/.claude/hubblerc/relaunch.zsh\n`
  const v = (n: number, body: string) => `# hubblerc-shell-version: ${n}\n${body}`
  expect(shellVersion(v(2, 'x'))).toBe(2)
  expect(shellVersion('no number')).toBe(0)
  expect(needsRelaunch(relaunchState({ ...facts, shipped: 'OLD', installed: v(1, 'NEW'), zshrc: sourced }))).toBe(false)
  expect(needsRelaunch(relaunchState({ ...facts, shipped: v(1, 'A'), installed: v(2, 'B'), zshrc: sourced }))).toBe(false)
  expect(needsRelaunch(relaunchState({ ...facts, shipped: v(2, 'B'), installed: v(1, 'A'), zshrc: sourced }))).toBe(true)
  expect(needsRelaunch(relaunchState({ ...facts, shipped: v(1, 'B'), installed: v(1, 'A'), zshrc: sourced }))).toBe(true)

  const line = '[ -f "$HOME/.claude/hubblerc/relaunch.zsh" ] && source "$HOME/.claude/hubblerc/relaunch.zsh"'
  const next = withRelaunchLine(facts.zshrc, '/home/me/.claude/hubblerc/relaunch.zsh', '/home/me') ?? ''
  expect(next.startsWith(`${facts.zshrc}\n# hubblerc:`)).toBe(true)
  expect(next.endsWith(`${line}\n`)).toBe(true)
  expect(withRelaunchLine(next, '/home/me/.claude/hubblerc/relaunch.zsh', '/home/me')).toBeNull()
  // No file yet, one without a last newline, a folder outside home.
  expect(withRelaunchLine(undefined, '/home/me/.claude/hubblerc/relaunch.zsh', '/home/me')?.startsWith('# hubblerc:')).toBe(true)
  expect(withRelaunchLine('export A=1', '/home/me/.claude/hubblerc/relaunch.zsh', '/home/me')?.startsWith('export A=1\n\n# hubblerc:')).toBe(true)
  expect(withRelaunchLine('', '/etc/claude/hubblerc/relaunch.zsh', '/home/me')).toContain('[ -f "/etc/claude/hubblerc/relaunch.zsh" ]')
})

test('/setup in a session on an older hubblerc leaves a newer shell file in place', async ($, on) => {
  standInForEngine(on)
  const { files } = machine(on, { HOME: '/home/me', SHELL: '/bin/zsh' }, {}, 'OLD SCRIPT')
  const newer = '# hubblerc-shell-version: 1\nNEW SCRIPT'
  files['/home/me/.claude/hubblerc/relaunch.zsh'] = newer
  files['/home/me/.zshrc'] = '[ -f "$HOME/.claude/hubblerc/relaunch.zsh" ] && source "$HOME/.claude/hubblerc/relaunch.zsh"\n'
  await start($)

  const ran = ((await $.command.run({ ...COMMAND, command: 'setup' })) as { text?: string }).text ?? ''
  expect(files['/home/me/.claude/hubblerc/relaunch.zsh']).toBe(newer)
  expect(ran).toContain('셸 설정(재시작 함수: 사이드바 "재시작"·`/relaunch`, Orca 그림): 설치됨')
})

test('/setup copies the relaunch function and adds the line to ~/.zshrc, the old one kept; a second run changes nothing', async ($, on) => {
  standInForEngine(on)
  const before = "alias hcc='claude --plugin-dir x'\n"
  const { files } = machine(on, { HOME: '/home/me', SHELL: '/bin/zsh' }, {}, 'SCRIPT')
  files['/home/me/.zshrc'] = before
  await start($)

  const ran = ((await $.command.run({ ...COMMAND, command: 'setup' })) as { text?: string }).text ?? ''
  expect(files['/home/me/.claude/hubblerc/relaunch.zsh']).toBe('SCRIPT')
  expect(files['/home/me/.zshrc.bak']).toBe(before)
  expect(files['/home/me/.zshrc']).toContain('source "$HOME/.claude/hubblerc/relaunch.zsh"')
  expect(ran).toContain('셸 설정(재시작 함수: 사이드바 "재시작"·`/relaunch`, Orca 그림): 방금')

  files['/home/me/.zshrc.bak'] = 'untouched'
  const again = ((await $.command.run({ ...COMMAND, command: 'setup' })) as { text?: string }).text ?? ''
  expect(files['/home/me/.zshrc.bak']).toBe('untouched')
  expect(again).toContain('설치됨. 이 세션은 그 전에 열려서')
})
