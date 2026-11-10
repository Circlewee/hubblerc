import { expect, test } from 'claude-code/testing'

import { standInForEngine, start } from './engine'

const SIDEBAR = { id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const statusRuns = (ran: string[][]) => ran.filter(argv => argv[0] === 'git' && argv.includes('status')).length
const count = (ran: string[][], program: string) => ran.filter(argv => argv[0] === program).length

test('idle, the timer reads the subagents every fifth second; while an answer runs, every second', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  const idleFrom = standIn.agentListCalls
  await standIn.clock.advance(10_000)
  expect(standIn.agentListCalls - idleFrom).toBe(2)

  await $.turn.start({ text: '질문', turnId: 't1' })
  const busyFrom = standIn.agentListCalls
  await standIn.clock.advance(10_000)
  expect(standIn.agentListCalls - busyFrom).toBe(10)
})

test('idle, a question that starts puts the timer to each second at once, not at the next fifth second', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  await standIn.clock.advance(2000)

  const from = standIn.agentListCalls
  await $.turn.start({ text: '질문', turnId: 't1' })
  await standIn.clock.advance(1000)
  expect(standIn.agentListCalls - from).toBe(1)
})

test('once the answer ends, the timer goes back to every fifth second', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  await $.turn.start({ text: '질문', turnId: 't1' })
  await standIn.clock.advance(3000)
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 3000 })

  // The tick a second on finds nothing running and goes back to five: it and the one five on.
  const from = standIn.agentListCalls
  await standIn.clock.advance(10_000)
  expect(standIn.agentListCalls - from).toBe(2)
})

test('idle, a call that starts puts the timer to each second at once; ended, back to every fifth second', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  await standIn.clock.advance(2000)

  // The stand-in's call ends at once: the tick a second on finds nothing running.
  const from = standIn.agentListCalls
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  await standIn.clock.advance(1000)
  expect(standIn.agentListCalls - from).toBe(1)
  await standIn.clock.advance(10_000)
  expect(standIn.agentListCalls - from).toBe(3)
})

test('idle, the timer reads the running calls every fifth second and the answers not at all', async ($, on) => {
  const standIn = standInForEngine(on)
  const reads: Record<string, number> = {}
  on('state.get', ($, e, next) => {
    reads[e.key] = (reads[e.key] ?? 0) + 1

    return next(e)
  })
  await start($)
  // Past the restore's one retry at two seconds, which reads the answers once.
  await standIn.clock.advance(5000)
  const before = { ...reads }
  await standIn.clock.advance(60_000)
  expect((reads.running ?? 0) - (before.running ?? 0)).toBe(12)
  expect((reads.turns ?? 0) - (before.turns ?? 0)).toBe(0)
})

test('idle, git is not polled: only the 30-second refresh reads it', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  const from = statusRuns(standIn.ran)
  await standIn.clock.advance(25_000)
  expect(statusRuns(standIn.ran)).toBe(from)
  await standIn.clock.advance(6000)
  expect(statusRuns(standIn.ran)).toBe(from + 1)
})

test('a call that may change files reads git after it, a script run through Bash too; calls close together fold into one more read', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  await standIn.clock.advance(3000)

  const from = statusRuns(standIn.ran)
  await $.tool.call({ tool: 'Bash', command: 'python3 fix.py', description: '스크립트로 고치기' })
  expect(statusRuns(standIn.ran)).toBe(from + 1)

  // Two more within two seconds: one read when the gap is up.
  await $.tool.call({ tool: 'Write', file_path: '/repo/hubblerc/a.ts', content: 'a\n' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/hubblerc/b.ts', content: 'b\n' })
  expect(statusRuns(standIn.ran)).toBe(from + 1)
  await standIn.clock.advance(2000)
  expect(statusRuns(standIn.ran)).toBe(from + 2)

  // A read only: nothing to read git for.
  await standIn.clock.advance(3000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  expect(statusRuns(standIn.ran)).toBe(from + 2)
})

test('the engine is asked to watch no files; a commit made elsewhere shows as the next question starts', async ($, on) => {
  const standIn = standInForEngine(on)
  // The engine beneath: no settings hook of its own answers.
  on('classic.SessionStart', () => ({}))
  await start($)

  const started = await $.classic.SessionStart({ source: 'startup', cwd: '/repo/hubblerc', transcript_path: '/home/me/.claude/projects/x/session-1.jsonl' } as never)
  expect((started as { watchPaths?: string[] }).watchPaths).toBeUndefined()

  await standIn.clock.advance(3000)
  const from = statusRuns(standIn.ran)
  await $.turn.start({ text: '질문', turnId: 't1' })
  await standIn.clock.settle()
  expect(statusRuns(standIn.ran)).toBe(from + 1)
})

test('after the model changed, the band names the new one at once, not at the next half minute', async ($, on) => {
  const standIn = standInForEngine(on)
  on('classic.PostModelSwitch', () => ({}))
  await start($)

  const band = await $.ui.mount({ plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: BAND_PROPS })
  expect((await band.find({ type: 'Text', text: /Opus/ }))?.text).toContain('Opus')
  standIn.modelId = 'claude-sonnet-5-5'
  await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'picker' } as never)
  await standIn.clock.settle()
  expect(await band.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  expect((await band.find({ type: 'Text', text: /Sonnet/ }))?.text).toContain('Sonnet')
  await band.unmount()
})

test("memory, disk and the session's name are read again only while the sidebar shows", async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  const hidden = { vm: count(standIn.ran, '/usr/bin/vm_stat'), sh: count(standIn.ran, '/bin/sh') }
  await standIn.clock.advance(60_000)
  expect(count(standIn.ran, '/usr/bin/vm_stat')).toBe(hidden.vm)
  expect(count(standIn.ran, '/bin/sh')).toBe(hidden.sh)

  standIn.panes.push(SIDEBAR)
  await standIn.clock.advance(60_000)
  expect(count(standIn.ran, '/usr/bin/vm_stat')).toBe(hidden.vm + 2)
})

test('while the sidebar shows, memory is read every half minute and the disk every five minutes', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  standIn.panes.push(SIDEBAR)

  // Both read once as the session started; the disk's next reading is due five minutes on.
  const from = { vm: count(standIn.ran, '/usr/bin/vm_stat'), df: count(standIn.ran, '/bin/df') }
  expect(from.df).toBe(1)
  await standIn.clock.advance(270_000)
  expect(count(standIn.ran, '/usr/bin/vm_stat')).toBe(from.vm + 9)
  expect(count(standIn.ran, '/bin/df')).toBe(from.df)
  await standIn.clock.advance(30_000)
  expect(count(standIn.ran, '/usr/bin/vm_stat')).toBe(from.vm + 10)
  expect(count(standIn.ran, '/bin/df')).toBe(from.df + 1)
})
