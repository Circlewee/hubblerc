import { expect, test } from 'claude-code/testing'

import type { TurnRecord } from '../types'
import { lineCount, parseNumstat, shellChanges } from '../hooks/shell-changes'
import type { GitSnapshot } from '../hooks/shell-changes'
import { summarize } from '../hooks/summary'

const snap = (tracked: GitSnapshot['tracked'], untracked: string[] = []): GitSnapshot => ({ root: '/repo', base: 'abc', tracked, untracked })

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
