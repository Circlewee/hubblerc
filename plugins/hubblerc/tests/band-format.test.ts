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
  isListed,
  levelStep,
  requestSegments,
  THEME_COLORS,
  weekStep,
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
  expect(countdown(new Date(NOW + 51 * 3_600_000).toISOString(), NOW, true)).toBe('2d 3h')
  expect(countdown(new Date(NOW + 90 * 60_000).toISOString(), NOW, true)).toBe('1h 30m')
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
  expect(parseGitStatus('## main...origin/main [ahead 1]\n M a.ts\nR  old.ts -> 새 파일.ts\n')).toEqual({
    branch: 'main',
    isDirty: true,
    changed: ['a.ts', '새 파일.ts'],
    untracked: [],
    ignored: [],
  })
  expect(parseGitStatus('## main\n')).toMatchObject({ branch: 'main', isDirty: false, changed: [] })
  expect(parseGitStatus('## No commits yet on main\n?? a.ts\n')).toMatchObject({ branch: 'main', isDirty: true, changed: ['a.ts'], untracked: ['a.ts'] })
  expect(parseGitStatus('## HEAD (no branch)\n')).toMatchObject({ branch: 'HEAD', isDirty: false, changed: [] })
  expect(parseGitStatus('fatal: not a git repository')).toBeNull()
})

test('untracked and ignored come apart, a folder whole as dir/; ignored alone is not dirty', () => {
  expect(parseGitStatus('## main\n?? drafts/\n?? top.md\n!! dist/\n')).toEqual({
    branch: 'main',
    isDirty: true,
    changed: ['drafts/', 'top.md'],
    untracked: ['drafts/', 'top.md'],
    ignored: ['dist/'],
  })
  expect(parseGitStatus('## main\n!! dist/\n')?.isDirty).toBe(false)
  expect(isListed(['/r/drafts/', '/r/top.md'], '/r/drafts/notes/x.md')).toBe(true)
  expect(isListed(['/r/drafts/'], '/r/drafts.md')).toBe(false)
  expect(isListed(undefined, '/r/a.ts')).toBe(false)
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

test('in the sidebar every bar starts in one column, 7d has one too, and they stretch to the width, the empty cells dashed', () => {
  const resetsAt = new Date(NOW + 90 * 60_000).toISOString()
  const input = {
    model: 'claude-opus-5-5',
    effort: 'high',
    isOverridden: false,
    usage: { contextPercent: 45, fiveHour: { percent: 25, resetsAt }, sevenDay: { percent: 12, resetsAt: new Date(NOW + (3 * 24 + 4) * 3_600_000).toISOString() } },
    project: 'p',
    git: null,
    now: NOW,
  }
  const lines = (barColumns: number) =>
    statusParts({ ...input, barColumns }, Number.POSITIVE_INFINITY)
      .slice(1, 4)
      .map(part => part.map(segment => segment.text).join(''))

  // 52 cells: 4 for the label, 5 for the percent, 9 for the reset leave 34; twenty at most.
  expect(lines(52)).toEqual([
    `ctx ${'━'.repeat(9)}${'╌'.repeat(11)}  45%`,
    `5h  ${'━'.repeat(5)}${'╌'.repeat(15)}  25% ↻ 1h 30m`,
    `7d  ${'━'.repeat(2)}${'╌'.repeat(18)}  12% ↻ 3d 4h`,
  ])
  // Narrow, what is left after the longest line's tail; eight at least.
  expect(lines(30)[0]).toBe(`ctx ${'━'.repeat(5)}${'╌'.repeat(7)}  45%`)
  expect(lines(10)[2]).toBe(`7d  ━${'╌'.repeat(7)}  12% ↻ 3d 4h`)
  // The band keeps its short bars, and 7d none.
  const band = statusParts(input, 200).map(part => part.map(segment => segment.text).join(''))
  expect(band[1]).toBe('ctx ━━━━──── 45%')
  expect(band[3]).toBe('7d 12%')
})

test('in the sidebar a reading takes one of five steps, its number always coloured, bold from 70%, with a ! from 95%', () => {
  expect([0, 49, 50, 69, 70, 84, 85, 94, 95, 100].map(levelStep)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  const context = (percent: number) =>
    statusParts(
      { model: 'claude-opus-5-5', effort: 'high', isOverridden: false, usage: { contextPercent: percent }, project: 'p', git: null, now: NOW, palette: THEME_COLORS, barColumns: 40 },
      Number.POSITIVE_INFINITY,
    )[1] ?? []
  const number = (percent: number) => context(percent).find(segment => segment.text.endsWith('%'))
  expect(number(20)).toEqual({ text: ' 20%', color: 'success' })
  expect(number(55)).toEqual({ text: ' 55%', color: 'warning' })
  expect(number(75)).toEqual({ text: ' 75%', color: 'claude', bold: true })
  expect(number(90)).toEqual({ text: ' 90%', color: 'error', bold: true })
  expect(context(97).at(-1)).toEqual({ text: '!', color: 'error', bold: true })
  expect(context(90).at(-1)?.text).not.toBe('!')
})

test('the 7-day window steps up when its pace would run it out before the reset; not in its first day', () => {
  const resetIn = (days: number) => new Date(NOW + days * 24 * 3_600_000).toISOString()
  // Half the week gone: 30% is on pace for 60%, as its level says.
  expect(weekStep(30, resetIn(3.5), NOW)).toBe(0)
  // Two days gone: 30% heads for 105%, past the reset's limit.
  expect(weekStep(30, resetIn(5), NOW)).toBe(3)
  // 25% heads for 87.5% (주의); 40% for 140% (한계).
  expect(weekStep(25, resetIn(5), NOW)).toBe(2)
  expect(weekStep(40, resetIn(5), NOW)).toBe(4)
  // The first day, or no reset known: the level alone.
  expect(weekStep(20, resetIn(6.5), NOW)).toBe(0)
  expect(weekStep(55, undefined, NOW)).toBe(1)
})

test('in the sidebar the effort value is coloured by its level, never in the warning colours', () => {
  const effortOf = (effort: string | null, isOverridden = false) =>
    statusParts(
      { model: 'claude-opus-5-5', effort, isOverridden, usage: null, project: 'p', git: null, now: NOW, palette: THEME_COLORS, barColumns: 40 },
      Number.POSITIVE_INFINITY,
    )[0]?.find(segment => segment.role === 'effort')
  expect(effortOf('low')).toMatchObject({ dim: true })
  expect(effortOf('medium')).toEqual({ text: 'medium', role: 'effort' })
  expect(effortOf('high')).toMatchObject({ color: 'suggestion' })
  expect(effortOf('xhigh')).toMatchObject({ color: 'merged' })
  expect(effortOf('max')).toMatchObject({ color: 'merged', bold: true })
  // The session's own pick keeps its level's colour; "(세션)" says whose it is.
  expect(effortOf('high', true)).toMatchObject({ color: 'suggestion' })
})

test("the last request reads as its input with the cache's share, and its output; the share alone is coloured", () => {
  expect(requestSegments('14:32', { input: 2000, cacheRead: 115_000, cacheWrite: 3000, output: 2100 }).map(segment => segment.text).join('')).toBe(
    '마지막 요청 14:32 · 입력 120k(캐시 96%) · 출력 2.1k',
  )
  expect(requestSegments(null, { input: 900, cacheRead: 100, cacheWrite: 0, output: 5 })).toEqual([
    { text: '입력 1k(', dim: true },
    { text: '캐시 10%', color: 'red' },
    { text: ') · 출력 5', dim: true },
  ])
  expect(requestSegments('14:32', undefined)).toEqual([{ text: '마지막 요청 14:32', dim: true }])
  expect(requestSegments(null, null)).toEqual([])
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
