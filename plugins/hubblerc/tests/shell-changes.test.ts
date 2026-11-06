import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { TurnRecord } from '../types'
import { lineCount, parseNumstat, shellChanges } from '../hooks/activity/shell-changes'
import type { GitSnapshot } from '../hooks/activity/shell-changes'
import { summarize } from '../hooks/activity/summary'
import { standInForEngine, start } from './engine'

const snap = (tracked: GitSnapshot['tracked'], untracked: string[] = []): GitSnapshot => ({ root: '/repo', base: 'abc', tracked, untracked })
/** The git a shell-change snapshot runs (four as it is taken, three to compare); the status's own `git status` is not one. */
const snapshotRuns = (ran: string[][]) =>
  ran.filter(argv => argv[0] === 'git' && argv.includes('core.quotePath=false') && ['rev-parse', 'diff', 'ls-files'].some(command => argv.includes(command))).length
const done = (turnId: string) => ({ answer: '', isAborted: false, reason: 'answer' as const, turnId, durationMs: 3000 })
const activity = async ($: Engine) => (await $.command.run({ command: 'activity', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })).text ?? ''

test('an answer with no call that may change files unseen runs no git for its shell changes', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  await $.turn.start({ text: '읽어 줘', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  await $.turn.complete(done('t1'))
  await standIn.clock.settle()
  expect(snapshotRuns(standIn.ran)).toBe(0)
})

test("the snapshot is taken just before an answer's first Bash, once; a file the shell changed joins the answer", async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  await $.turn.start({ text: '스크립트로 고쳐 줘', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  expect(snapshotRuns(standIn.ran)).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'python3 fix.py', description: '스크립트로 고치기' })
  expect(snapshotRuns(standIn.ran)).toBe(4)
  // The script changed a file; the next Bash takes no snapshot of its own.
  standIn.gitNumstat = '5\t1\tsrc/a.ts\n'
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트 실행' })
  expect(snapshotRuns(standIn.ran)).toBe(4)

  await $.turn.complete(done('t1'))
  expect(snapshotRuns(standIn.ran)).toBe(7)
  expect(await activity($)).toContain('a.ts +5 −1')
})

test("a subagent's Bash takes the running main answer's snapshot; with no main answer running, none", async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'ls', description: '목록 보기', agentId: 'ag-1' })
  expect(snapshotRuns(standIn.ran)).toBe(0)

  await $.turn.start({ text: '조사해 줘', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: '목록 보기', agentId: 'ag-1' })
  expect(snapshotRuns(standIn.ran)).toBe(4)
  await $.turn.complete(done('t1'))
  expect(snapshotRuns(standIn.ran)).toBe(7)

  // The answer ended: a background subagent's Bash after it takes none.
  await $.tool.call({ tool: 'Bash', command: 'ls', description: '목록 보기', agentId: 'ag-1' })
  expect(snapshotRuns(standIn.ran)).toBe(7)
})

test("this plugin's to-do tool takes no snapshot; another server's tool does", async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  await $.turn.start({ text: '할 일 적어 줘', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__hubblerc__user_todos', action: 'add', text: '문서 갱신' })
  expect(snapshotRuns(standIn.ran)).toBe(0)
  await $.tool.call({ tool: 'mcp__files__write_file', path: '/repo/hubblerc/b.ts' } as never)
  expect(snapshotRuns(standIn.ran)).toBe(4)
  await $.turn.complete(done('t1'))
})

test("numstat reads as lines added and removed by path, a binary file's as 0", () => {
  expect(parseNumstat('3\t1\ta.ts\n-\t-\timg.png\n10\t0\tdocs/새 파일.md\n')).toEqual({
    'a.ts': { added: 3, removed: 1 },
    'img.png': { added: 0, removed: 0 },
    'docs/새 파일.md': { added: 10, removed: 0 },
  })
  expect(parseNumstat('')).toEqual({})
})

test('a file whose counts moved during the answer is changed by what moved; one that stood still is not', () => {
  const before = snap({ 'a.ts': { added: 3, removed: 1 }, 'b.ts': { added: 2, removed: 0 } })
  const after = snap({ 'a.ts': { added: 8, removed: 4 }, 'b.ts': { added: 2, removed: 0 }, 'c.ts': { added: 0, removed: 5 } })

  expect(shellChanges(before, after).changed).toEqual([
    { path: '/repo/a.ts', added: 5, removed: 3 },
    { path: '/repo/c.ts', added: 0, removed: 5 },
  ])
})

test('a new untracked file is created; one untracked before, or added to git since, is not new work', () => {
  const before = snap({}, ['old.md', 'staged.md'])
  const after = snap({ 'staged.md': { added: 4, removed: 0 } }, ['old.md', 'new.md'])

  expect(shellChanges(before, after)).toEqual({ changed: [], created: ['/repo/new.md'] })
})

test('lines are counted as a file has them', () => {
  expect(lineCount('a\nb\n')).toBe(2)
  expect(lineCount('a\nb')).toBe(2)
  expect(lineCount('')).toBe(0)
})

test("a file changed through the shell counts in the closing line's files, not among its tools", () => {
  const turn: TurnRecord = {
    id: 't1',
    prompt: 'x',
    startedAt: 0,
    durationMs: 1000,
    runs: [
      { id: '1', tool: 'Bash', ms: 5, isError: false, description: 'sed로 고치기' },
      { id: '', tool: 'Bash', ms: 0, isError: false, path: '/repo/a.ts', added: 5, removed: 3, isShellChange: true },
    ],
  }

  expect(summarize(turn)).toBe('a.ts +5 −3 · Bash 1')
})
