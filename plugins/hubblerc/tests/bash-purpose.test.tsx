import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

// Nothing draws beneath the plugin: this hook stands for the engine's own row.
function engineDraws(on: On): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
}

const ROW = { plugin: 'hubblerc', component: 'ToolUse', requestId: 'toolu_1' } as const

function useProps(tool: string, input: Record<string, unknown>) {
  return { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: false, isInterrupted: false }
}

function groupCall(tool: string, input: Record<string, unknown>, isErrored = false) {
  return { tool, input, isRunning: false, isErrored, isInterrupted: false }
}

test('a Bash row shows what the command is for under it, on each surface', async ($, on) => {
  engineDraws(on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      ...ROW,
      surface,
      props: useProps('Bash', { command: 'grep -n effort types.d.ts', description: '타입 정의에서 effort 검색' }),
    })

    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    expect((await ui.find({ type: 'Text', text: /effort 검색/ }))?.text).toBe('타입 정의에서 effort 검색')
    await ui.unmount()
  }
})

test('a Bash call with no description, and any other tool, is drawn as the engine drew it', async ($, on) => {
  engineDraws(on)

  const bare = await $.ui.mount({ ...ROW, surface: 'terminal', props: useProps('Bash', { command: 'ls' }) })
  expect(await bare.find({ type: 'Text', text: /↳/ })).toBeUndefined()
  await bare.unmount()

  const read = await $.ui.mount({
    ...ROW,
    surface: 'terminal',
    props: useProps('Read', { file_path: '/repo/a.ts', description: 'not a Bash call' }),
  })
  expect(await read.find({ type: 'Text', text: /↳/ })).toBeUndefined()
  await read.unmount()
})

test("a folded run lists its Bash calls' purposes, marks a failed one and stops at six", async ($, on) => {
  engineDraws(on)

  const calls = [
    groupCall('Read', { file_path: '/repo/a.ts' }),
    groupCall('Bash', { command: 'cat settings.json', description: '설정 확인' }),
    groupCall('Bash', { command: 'ls /nope', description: '없는 파일 조회' }, true),
    ...['3', '4', '5', '6', '7'].map(n => groupCall('Bash', { command: 'true', description: `명령 ${n}` })),
  ]
  const GROUP = { plugin: 'hubblerc', component: 'ToolGroup', surface: 'terminal' } as const

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...GROUP, surface, requestId: 'group-1', props: { calls, isActive: false, isExpanded: false } })

    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    expect((await ui.find({ type: 'Text', text: /설정 확인/ }))?.text).toBe('설정 확인')
    expect((await ui.find({ type: 'Text', text: / · 실패/ }))?.text).toBe(' · 실패')
    expect(await ui.find({ type: 'Text', text: /명령 6/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /명령 7/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /외/ }))?.text).toBe('↳ 외 1개')
    await ui.unmount()
  }

  // Unfolded, each call is its own ToolUse row, which shows its own purpose.
  const unfolded = await $.ui.mount({ ...GROUP, requestId: 'group-2', props: { calls, isActive: false, isExpanded: true } })
  expect(await unfolded.find({ type: 'Text', text: /↳/ })).toBeUndefined()
  await unfolded.unmount()
})
