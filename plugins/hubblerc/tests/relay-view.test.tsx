import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { callLine, showRelayLines } from '../hooks/relay/relay-view'
import type { RelayStatus } from '../types'

// Nothing draws beneath the plugin: this hook stands for the engine's own row.
function engineDraws(on: On): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
}

const TOOL = 'mcp__hubblerc__relay'
const USE = { plugin: 'hubblerc', component: 'ToolUse', surface: 'terminal', requestId: 'toolu_1' } as const
const RESULT = { plugin: 'hubblerc', component: 'ToolResult', surface: 'terminal', requestId: 'toolu_1' } as const

const INPUT = {
  action: 'task',
  run: '2026-11-10-demo',
  id: 'A',
  title: 'Add the tool',
  goal: 'A long goal body\nover several lines\n'.repeat(20),
  model: 'claude-opus-5-5',
  effort: 'high',
  edit_scope: ['hooks/relay/**'],
  done_when: [{ text: 'a', command: 'x' }, { text: 'b' }],
}

function use(input: unknown, extra: { output?: unknown; isExpanded?: boolean; isErrored?: boolean; isRunning?: boolean } = {}) {
  return { tool_use_id: 'toolu_1', tool: TOOL, input, isRunning: extra.isRunning ?? false, isErrored: extra.isErrored ?? false, isInterrupted: false, isExpanded: extra.isExpanded, output: extra.output }
}

function result(output: unknown, extra: { isExpanded?: boolean; isErrored?: boolean } = {}) {
  return { tool_use_id: 'toolu_1', tool: TOOL, output, isErrored: extra.isErrored ?? false, isExpanded: extra.isExpanded }
}

test('a call is one line, however long its input', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const ui = await $.ui.mount({ ...USE, props: use(INPUT, { output: '지시서: /repo/.relay/runs/2026-11-10-demo/tasks/A-r3.md\n보고서 자리: x' }) })
  expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /relay 지시서/ }))?.text).toBe('relay 지시서 Add the tool (3번째 지시서) · opus-5-5/high · 기준 2')
  expect(await ui.find({ type: 'Text', text: /long goal body/ })).toBeUndefined()
  await ui.unmount()
})

test('the full view (ctrl+o) and another tool keep the engine’s rows', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const full = await $.ui.mount({ ...USE, props: use(INPUT, { isExpanded: true }) })
  expect((await full.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await full.unmount()

  const fullResult = await $.ui.mount({ ...RESULT, props: result('지시서: x', { isExpanded: true }) })
  expect((await fullResult.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await fullResult.unmount()

  const other = await $.ui.mount({ ...USE, requestId: 'toolu_2', props: { ...use(INPUT), tool: 'mcp__other__thing' } })
  expect((await other.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await other.unmount()

  // Nothing to read in the output: the engine draws.
  const empty = await $.ui.mount({ ...RESULT, requestId: 'toolu_3', props: result(undefined) })
  expect((await empty.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await empty.unmount()
})

test('a result is one line beneath the call', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const ui = await $.ui.mount({ ...RESULT, props: result('묶음을 시작했습니다: 2026-11-10-demo\n폴더: /repo/.relay/runs/2026-11-10-demo\nBase: abc') })
  expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /폴더 만듦/ }))?.text).toBe('폴더 만듦')
  expect(await ui.find({ type: 'Text', text: /Base/ })).toBeUndefined()
  await ui.unmount()
})

test('a refusal and a failure say so, in red', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const refused = await $.ui.mount({ ...RESULT, props: result('묶음을 끝내지 않았습니다:\n- 판정이 없습니다: package로 꾸러미를 만드세요', { isErrored: true }) })
  expect((await refused.find({ type: 'Text', text: /거절/ }))?.text).toBe('거절: 판정이 없습니다: package로 꾸러미를 만드세요')
  await refused.unmount()

  const failed = await $.ui.mount({ ...RESULT, requestId: 'toolu_2', props: result('relay 도구가 실패했습니다: Error: boom', { isErrored: true }) })
  expect((await failed.find({ type: 'Text', text: /relay 실패/ }))?.text).toBe('relay 실패: Error: boom')
  await failed.unmount()
})

test('a gate warning stays beneath the result line', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const ui = await $.ui.mount({ ...RESULT, props: result('A-r1: running · subagent x\n보낸 지시서 사본: /x\n⚠ relay: A-r1 기록에 경고가 있습니다 — 겹침') })
  expect((await ui.find({ type: 'Text', text: /도는 중/ }))?.text).toBe('도는 중')
  expect((await ui.find({ type: 'Text', text: /⚠ relay/ }))?.text).toBe('⚠ relay: A-r1 기록에 경고가 있습니다 — 겹침')
  await ui.unmount()
})

test('a text that no reading fits shows its first line', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const ui = await $.ui.mount({ ...RESULT, props: result('새로 바뀐 문구입니다\n둘째 줄') })
  expect((await ui.find({ type: 'Text', text: /새로 바뀐/ }))?.text).toBe('새로 바뀐 문구입니다')
  expect(await ui.find({ type: 'Text', text: /둘째/ })).toBeUndefined()
  await ui.unmount()
})

// ── Names, spacing and the arrow ──────────────────────────────────────────

const line = (key: string, id: string, rev: number, title: string) => ({ key, id, rev, title, status: 'running', model: 'claude-opus-5-5', effort: 'high', runner: 'orca', dispatchedAt: null })
const SUMMARY: RelayStatus = {
  runs: [{ run: '2026-11-10-demo', tasks: [line('A-r1', 'A', 1, 'Add the tool'), line('B-r2', 'B', 2, 'Wire the sidebar box')], pending: 0, verdict: null }],
}

test('a task is named by its title, "n번째 지시서" from the second brief; the key where the summary does not hold it', () => {
  expect(callLine({ action: 'cancel', run: '2026-11-10-demo', task: 'B-r2', reason: 'x' }, undefined, SUMMARY)).toBe('relay 취소 Wire the sidebar box (2번째 지시서) · x')
  // The id alone names its latest revision, the same way.
  expect(callLine({ action: 'report', run: '2026-11-10-demo', task: 'B' }, undefined, SUMMARY)).toBe('relay 보고 확인 Wire the sidebar box (2번째 지시서)')
  expect(callLine({ action: 'check', task: 'A' }, undefined, SUMMARY)).toBe('relay 완료 검사 Add the tool')
  expect(callLine({ action: 'dispatched', task: 'A-r1', runner: 'orca dispatch:x' }, undefined, SUMMARY)).toBe('relay 띄움 기록 Add the tool → orca dispatch:x')
  expect(callLine({ action: 'spec_text', id: 'B' }, undefined, SUMMARY)).toBe('relay 지시서 미리보기 Wire the sidebar box (2번째 지시서)')
  // Not held (another run, a finished run, no summary): the key as it was said.
  expect(callLine({ action: 'report', run: '2026-11-01-old', task: 'B-r2' }, undefined, SUMMARY)).toBe('relay 보고 확인 B-r2')
  expect(callLine({ action: 'report', task: 'Z-r1' }, undefined, SUMMARY)).toBe('relay 보고 확인 Z-r1')
  expect(callLine({ action: 'report', task: 'A-r1' }, undefined, null)).toBe('relay 보고 확인 A-r1')
  // A call that named a task by its id keeps the revision its answer names, after a later brief of that id:
  // the first brief's report and check are not renamed to the second's.
  const later: RelayStatus = {
    runs: [{ run: '2026-11-10-demo', tasks: [line('T-r2', 'T', 2, 'Write the second line')], earlier: [{ key: 'T-r1', id: 'T', rev: 1, title: 'Write one line' }], pending: 0, verdict: null }],
  }
  expect(callLine({ action: 'report', run: '2026-11-10-demo', task: 'T' }, 'T-r1: 보고 DONE → 상태 done\n보고서: /x', later)).toBe('relay 보고 확인 Write one line')
  expect(callLine({ action: 'check', run: '2026-11-10-demo', task: 'T' }, 'T-r1 검사 결과(HEAD abc1234): /x', later)).toBe('relay 완료 검사 Write one line')
  expect(callLine({ action: 'report', run: '2026-11-10-demo', task: 'T-r1' }, undefined, later)).toBe('relay 보고 확인 Write one line')
  // Still running (no answer), or refused (no key in the answer): the id's latest, as before.
  expect(callLine({ action: 'report', run: '2026-11-10-demo', task: 'T' }, undefined, later)).toBe('relay 보고 확인 Write the second line (2번째 지시서)')
  expect(callLine({ action: 'report', run: '2026-11-10-demo', task: 'T' }, '보고서가 없습니다: /x', later)).toBe('relay 보고 확인 Write the second line (2번째 지시서)')
  // An answer about another task than the one named changes nothing.
  expect(callLine({ action: 'report', run: '2026-11-10-demo', task: 'T' }, 'B-r2: 보고 DONE → 상태 done', later)).toBe('relay 보고 확인 Write the second line (2번째 지시서)')
  // A package names each of its tasks the same way: the title where known, the key where not, the rest counted.
  expect(callLine({ action: 'package', run: '2026-11-10-demo', tasks: ['A-r1', 'B-r2', 'Z-r1'] }, undefined, SUMMARY)).toBe('relay 검증 꾸러미 · Add the tool, Wire the sidebar box (2번째 지시서), Z-r1')
  expect(callLine({ action: 'package', run: '2026-11-10-demo', tasks: ['A', 'B', 'A-r1', 'B-r2', 'Z'] }, undefined, SUMMARY)).toBe('relay 검증 꾸러미 · Add the tool, Wire the sidebar box (2번째 지시서), Add the tool 외 2')
  expect(callLine({ action: 'package', tasks: ['B-r2'] }, undefined, null)).toBe('relay 검증 꾸러미 · B-r2')
  expect(callLine({ action: 'package', run: '2026-11-10-demo' }, undefined, SUMMARY)).toBe('relay 검증 꾸러미 · 전체')
  // A brief written is named by the title it carries; the revision is told from the answer.
  expect(callLine({ action: 'task', id: 'A', title: 'Add the tool', model: 'claude-opus-5-5', effort: 'high', done_when: [] }, '지시서: /r/tasks/A-r1.md')).toBe('relay 지시서 Add the tool · opus-5-5/high · 기준 0')
})

test('a result row begins with an arrow, not the engine’s hook, and states are in Korean', async ($, on) => {
  engineDraws(on)
  showRelayLines(on)
  const ui = await $.ui.mount({ ...RESULT, props: result('A-r1: running → cancelled · gave up\n보낸 지시서 사본: /x') })
  expect((await ui.find({ type: 'Text', text: /도는 중/ }))?.text).toBe('도는 중 → 취소')
  expect((await ui.find({ type: 'Text', text: /↳/ }))?.text).toBe('  ↳ ')
  expect(await ui.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /running|cancelled/ })).toBeUndefined()
  await ui.unmount()
})
