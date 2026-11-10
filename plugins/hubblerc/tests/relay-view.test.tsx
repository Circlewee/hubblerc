import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { showRelayLines } from '../hooks/relay/relay-view'

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
  expect((await ui.find({ type: 'Text', text: /relay 지시서/ }))?.text).toBe('relay 지시서 A-r3 · Add the tool · opus-5-5/high · 기준 2')
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
  expect((await ui.find({ type: 'Text', text: /running/ }))?.text).toBe('running')
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
