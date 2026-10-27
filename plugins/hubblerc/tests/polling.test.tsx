import { expect, test } from 'claude-code/testing'

import { standInForEngine, start } from './engine'

const SIDEBAR = { id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true }
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

test("the engine is asked to watch git's own files, and a change in them reads git", async ($, on) => {
  const standIn = standInForEngine(on)
  // The engine beneath: no settings hook of its own answers either event.
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  await start($)

  const started = await $.classic.SessionStart({ source: 'startup', cwd: '/repo/hubblerc', transcript_path: '/home/me/.claude/projects/x/session-1.jsonl' } as never)
  expect((started as { watchPaths?: string[] }).watchPaths).toEqual(['/repo/hubblerc/.git/HEAD', '/repo/hubblerc/.git/index', '/repo/hubblerc/.git/logs/HEAD'])

  await standIn.clock.advance(3000)
  const from = statusRuns(standIn.ran)
  await $.classic.FileChanged({ file_path: '/repo/hubblerc/.git/index', event: 'change' } as never)
  await standIn.clock.advance(100)
  expect(statusRuns(standIn.ran)).toBe(from + 1)
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
