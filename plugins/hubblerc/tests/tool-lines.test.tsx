import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { groupLine, readNames } from '../hooks/tool-lines'

// Nothing draws beneath the plugin: this hook stands for the engine's own row.
function engineDraws(on: On): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
}

function call(tool: string, input: Record<string, unknown>, extra: { output?: unknown; isErrored?: boolean; isRunning?: boolean } = {}) {
  return { tool, input, isRunning: extra.isRunning ?? false, isErrored: extra.isErrored ?? false, isInterrupted: false, output: extra.output }
}

const GROUP = { plugin: 'hubblerc', component: 'ToolGroup', surface: 'terminal', requestId: 'group-1' } as const
const RESULT = { plugin: 'hubblerc', component: 'ToolResult', surface: 'terminal', requestId: 'toolu_1' } as const

const PATCH = { filePath: '/repo/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-old', '+new', '+more'] }] }

test('a run of calls is said in Korean, Bash counted as commands', () => {
  expect(
    groupLine([
      call('Read', { file_path: '/repo/a.ts' }),
      call('Read', { file_path: '/repo/b.ts' }),
      call('Grep', { pattern: 'effort' }),
      call('Bash', { command: 'ls' }),
      call('Edit', { file_path: '/repo/a.ts' }, { output: PATCH }),
      call('mcp__docs__read', {}),
      call('ToolSearch', {}),
    ]),
  ).toBe('파일 2개 읽음 · 파일 1개 수정 (+2 −1) · 검색 1번 · 명령 1개 실행 · MCP 도구 1번 · ToolSearch 1번')
})

test('the files read are named once each, three at most', () => {
  const reads = ['a.ts', 'b.ts', 'a.ts', 'c.ts', 'd.ts', 'e.ts'].map(name => call('Read', { file_path: `/repo/${name}` }))
  expect(readNames(reads)).toBe('a.ts, b.ts, c.ts 외 2')
  expect(readNames([call('Bash', { command: 'ls' })])).toBe('')
})

test('a finished run of calls alone is drawn in Korean, with the files it read and what each command was for', async ($, on) => {
  engineDraws(on)
  const calls = [
    call('Read', { file_path: '/repo/register.tsx' }),
    call('Read', { file_path: '/repo/band.tsx' }),
    call('Bash', { command: 'bun test', description: '테스트 실행' }),
  ]

  const ui = await $.ui.mount({ ...GROUP, props: { calls, isActive: false, isExpanded: false, isCallsOnly: true } })
  expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /읽음 ·/ }))?.text).toBe('파일 2개 읽음 · 명령 1개 실행')
  expect((await ui.find({ type: 'Text', text: /band\.tsx/ }))?.text).toBe('register.tsx, band.tsx')
  expect((await ui.find({ type: 'Text', text: /테스트 실행/ }))?.text).toBe('테스트 실행')
  await ui.unmount()
})

test('a live run, or one holding more than calls, keeps the engine’s line and gets the names under it', async ($, on) => {
  engineDraws(on)
  const calls = [call('Read', { file_path: '/repo/a.ts' }), call('Read', { file_path: '/repo/b.ts' }, { isRunning: true })]

  const live = await $.ui.mount({ ...GROUP, props: { calls, isActive: true, isExpanded: false, isCallsOnly: true } })
  expect((await live.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  expect((await live.find({ type: 'Text', text: /a\.ts/ }))?.text).toBe('a.ts, b.ts')
  await live.unmount()

  const mixed = await $.ui.mount({ ...GROUP, requestId: 'group-2', props: { calls, isActive: false, isExpanded: false, isCallsOnly: false } })
  expect((await mixed.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  expect(await mixed.find({ type: 'Text', text: /읽음 ·/ })).toBeUndefined()
  await mixed.unmount()

  const unfolded = await $.ui.mount({ ...GROUP, requestId: 'group-3', props: { calls, isActive: false, isExpanded: true, isCallsOnly: true } })
  expect(await unfolded.find({ type: 'Text', text: /a\.ts/ })).toBeUndefined()
  await unfolded.unmount()
})

test("a folded run lists its Bash calls' purposes, marks a failed one and stops at six", async ($, on) => {
  engineDraws(on)
  const calls = [
    call('Read', { file_path: '/repo/a.ts' }),
    call('Bash', { command: 'cat settings.json', description: '설정 확인' }),
    call('Bash', { command: 'ls /nope', description: '없는 파일 조회' }, { isErrored: true }),
    ...['3', '4', '5', '6', '7'].map(n => call('Bash', { command: 'true', description: `명령 ${n}` })),
  ]

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...GROUP, surface, props: { calls, isActive: false, isExpanded: false } })

    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    expect((await ui.find({ type: 'Text', text: /설정 확인/ }))?.text).toBe('설정 확인')
    expect((await ui.find({ type: 'Text', text: / · 실패/ }))?.text).toBe(' · 실패')
    expect(await ui.find({ type: 'Text', text: /명령 6/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /명령 7/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /외 1개/ }))?.text).toBe('↳ 외 1개')
    await ui.unmount()
  }
})

test("an edit's diff folds to one line of lines added and removed; the full view and a failure keep it", async ($, on) => {
  engineDraws(on)

  const folded = await $.ui.mount({ ...RESULT, props: { tool_use_id: 'toolu_1', tool: 'Edit', output: PATCH, isErrored: false, isExpanded: false } })
  expect(await folded.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
  expect((await folded.find({ type: 'Text', text: /^\+/ }))?.text).toBe('+2')
  expect((await folded.find({ type: 'Text', text: /^−/ }))?.text).toBe('−1')
  expect(await folded.find({ type: 'Text', text: /ctrl\+o/ })).toBeDefined()
  await folded.unmount()

  const full = await $.ui.mount({ ...RESULT, requestId: 'toolu_2', props: { tool_use_id: 'toolu_2', tool: 'Edit', output: PATCH, isErrored: false, isExpanded: true } })
  expect((await full.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await full.unmount()

  const failed = await $.ui.mount({ ...RESULT, requestId: 'toolu_3', props: { tool_use_id: 'toolu_3', tool: 'Edit', output: 'String not found', isErrored: true } })
  expect((await failed.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await failed.unmount()
})

test('a new file written folds to its line count', async ($, on) => {
  engineDraws(on)
  const output = { type: 'create', filePath: '/repo/new.ts', content: 'one\ntwo\nthree\n', structuredPatch: [] }

  const ui = await $.ui.mount({ ...RESULT, props: { tool_use_id: 'toolu_1', tool: 'Write', output, isErrored: false, isExpanded: false } })
  expect((await ui.find({ type: 'Text', text: /새 파일/ }))?.text).toBe('새 파일 3줄')
  await ui.unmount()
})
