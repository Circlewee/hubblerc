import { expect, test } from 'claude-code/testing'

import {
  activityParts,
  applyTaskUpdate,
  cellWidth,
  countdown,
  elapsed,
  lastAnswer,
  modelLabel,
  parseGitStatus,
  partsWidth,
  statusParts,
  todoProgress,
  todosFromTodoWrite,
} from '../hooks/band-format'
import { modelEffort } from '../hooks/effort'

const NOW = Date.parse('2026-10-25T09:00:00Z')

test('model ids read as names', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(modelLabel('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
  expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
  expect(modelLabel('gpt-x')).toBe('gpt-x')
})

test('times read short', () => {
  expect(countdown(new Date(NOW + 90 * 60_000).toISOString(), NOW)).toBe('1h30m')
  expect(countdown(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toBe('5m')
  expect(countdown(new Date(NOW + 30_000).toISOString(), NOW)).toBe('<1m')
  expect(countdown(new Date(NOW + 51 * 3_600_000).toISOString(), NOW)).toBe('2d3h')
  expect(countdown(new Date(NOW - 1000).toISOString(), NOW)).toBe('')
  expect(countdown(undefined, NOW)).toBe('')
  expect(elapsed(12_400)).toBe('12s')
  expect(elapsed(135_000)).toBe('2m15s')
  expect(elapsed(3_780_000)).toBe('1h3m')
})

test('Korean takes two cells a character', () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('대기 중')).toBe(7)
})

test('line 1 drops 7d, then the project name, then the bars, to fit a narrow band', () => {
  const input = {
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    isOverridden: false,
    usage: { contextPercent: 45, fiveHour: { percent: 25, resetsAt: new Date(NOW + 90 * 60_000).toISOString() }, sevenDay: { percent: 12 } },
    project: 'hubblerc',
    git: { branch: 'main', isDirty: true },
    now: NOW,
  }
  const text = (columns: number) => statusParts(input, columns).map(part => part.map(s => s.text).join('')).join(' │ ')

  expect(text(200)).toBe('Opus 5.5 · xhigh │ ctx ━━━━──── 45% │ 5h ━━────── 25% ↻1h30m │ 7d 12% │ hubblerc main*')
  expect(text(80)).toBe('Opus 5.5 · xhigh │ ctx ━━━━──── 45% │ 5h ━━────── 25% ↻1h30m │ hubblerc main*')
  expect(text(70)).toBe('Opus 5.5 · xhigh │ ctx ━━━━──── 45% │ 5h ━━────── 25% ↻1h30m │ main*')
  expect(text(50)).toBe('Opus 5.5 · xhigh │ ctx 45% │ 5h 25% ↻1h30m │ main*')
  expect(partsWidth(statusParts(input, 50))).toBeLessThanOrEqual(50)
})

test('line 1 marks a usage percent that runs high, and an effort chosen for the session', () => {
  const parts = statusParts(
    { model: 'claude-opus-5-5', effort: 'high', isOverridden: true, usage: { contextPercent: 90 }, project: 'p', git: null, now: NOW },
    200,
  )

  expect(parts[0]).toEqual([
    { text: 'Opus 5.5', bold: true },
    { text: ' · ', dim: true },
    { text: 'high', role: 'effort', color: 'yellow' },
    { text: ' (세션)', dim: true },
  ])
  expect(parts[1]?.find(segment => segment.text === '90%')?.color).toBe('red')
  expect(parts[2]).toEqual([{ text: 'p' }])
})

test('line 2 names what runs, the subagents and the todo, or says it waits', () => {
  const running = [
    { id: 'c1', tool: 'Bash', label: '테스트 실행', startedAt: NOW - 12_000 },
    { id: 'c2', tool: 'Read', label: 'a.ts', startedAt: NOW - 1_000 },
    { id: 'c3', tool: 'Read', label: 'b.ts', startedAt: NOW - 1_000, agentId: 'ag-1' },
  ]
  const agents = [
    { id: 'ag-1', type: 'Explore', description: '인증 코드 찾기', status: 'running', startedAt: NOW - 135_000 },
    { id: 'ag-2', type: 'Explore', description: '끝난 일', status: 'completed' },
  ]
  const todos = [
    { id: '1', subject: '원인 찾기', status: 'completed' as const },
    { id: '2', subject: '수정', activeForm: '수정 중', status: 'in_progress' as const },
  ]

  expect(activityParts(running, agents, todos, true, NOW)).toEqual([
    '◐ Bash 테스트 실행 12s +1',
    '◐ Explore: 인증 코드 찾기 2m15s',
    '▸ 수정 중 1/2',
  ])
  expect(activityParts([], [], [], true, NOW)).toEqual(['◐ 응답 중'])
  expect(activityParts([], [], [], false, NOW)).toEqual(['· 대기 중'])
  expect(todoProgress([{ id: '1', subject: 'a', status: 'pending' }])).toBe('▸ 할 일 0/1')
})

test('git status reads as a branch and whether the tree has changes', () => {
  expect(parseGitStatus('## main...origin/main [ahead 1]\n M a.ts\nR  old.ts -> 새 파일.ts\n')).toEqual({ branch: 'main', isDirty: true, changed: ['a.ts', '새 파일.ts'] })
  expect(parseGitStatus('## main\n')).toEqual({ branch: 'main', isDirty: false, changed: [] })
  expect(parseGitStatus('## No commits yet on main\n?? a.ts\n')).toEqual({ branch: 'main', isDirty: true, changed: ['a.ts'] })
  expect(parseGitStatus('## HEAD (no branch)\n')).toEqual({ branch: 'HEAD', isDirty: false, changed: [] })
  expect(parseGitStatus('fatal: not a git repository')).toBeNull()
})

test('todos follow TodoWrite whole and TaskUpdate one by one', () => {
  expect(
    todosFromTodoWrite([
      { content: 'a', activeForm: 'doing a', status: 'in_progress' },
      { content: 'b', status: 'bogus' },
    ]),
  ).toEqual([{ id: 'todo-0', subject: 'a', status: 'in_progress', activeForm: 'doing a' }])

  const list = [
    { id: '1', subject: 'a', status: 'pending' as const },
    { id: '2', subject: 'b', status: 'pending' as const },
  ]
  expect(applyTaskUpdate(list, { taskId: '1', status: 'in_progress', activeForm: 'doing a' })[0]).toEqual({
    id: '1',
    subject: 'a',
    status: 'in_progress',
    activeForm: 'doing a',
  })
  expect(applyTaskUpdate(list, { taskId: '2', status: 'deleted' })).toEqual([list[0]])
})

test("line 3 is the last completed answer, and the engine's effort comes from the model's settings", () => {
  expect(lastAnswer([])).toBe('직전 답변 없음')
  expect(
    lastAnswer([
      { id: 't1', prompt: '', startedAt: 0, durationMs: 5000, runs: [{ id: 'r', tool: 'Read', ms: 1, isError: false }] },
      { id: 't2', prompt: '', startedAt: 0, durationMs: null, runs: [] },
    ]),
  ).toBe('직전 5s · Read 1')

  expect(modelEffort({ 'claude-opus-5-5': { effortLevel: 'xhigh' } }, 'claude-opus-5-5[1m]')).toBe('xhigh')
  expect(modelEffort({}, 'claude-opus-5-5')).toBeNull()
})

test('a usage bar is a thin line colored by its level, and its number is colored only when high', () => {
  const [, context] = statusParts(
    { model: 'claude-opus-5-5', effort: 'high', isOverridden: false, usage: { contextPercent: 90 }, project: 'p', git: null, now: NOW },
    200,
  )

  expect(context).toEqual([
    { text: 'ctx ', dim: true },
    { text: '━━━━━━━', role: 'barFilled', color: 'red' },
    { text: '─', role: 'barEmpty', color: 'gray' },
    { text: ' ' },
    { text: '90%', color: 'red', bold: true },
  ])
})
