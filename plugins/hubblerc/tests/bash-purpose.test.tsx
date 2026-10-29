import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

// Nothing draws beneath the plugin: this hook stands for the engine's own row, which names the
// command it was handed.
function engineDraws(on: On): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const command = e.component === 'ToolUse' ? (e.props.input as { command?: string }).command : undefined

    return <Text>engine row{command === undefined ? '' : `: ${command}`}</Text>
  })
}

const ROW = { plugin: 'hubblerc', component: 'ToolUse', requestId: 'toolu_1' } as const

function useProps(tool: string, input: Record<string, unknown>) {
  return { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: false, isInterrupted: false }
}

test('a Bash row shows what the command is for under it, on each surface', async ($, on) => {
  engineDraws(on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      ...ROW,
      surface,
      props: useProps('Bash', { command: 'grep -n effort types.d.ts', description: '타입 정의에서 effort 검색' }),
    })

    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row: grep -n effort types.d.ts')
    expect((await ui.find({ type: 'Text', text: /effort 검색/ }))?.text).toBe('타입 정의에서 effort 검색')
    await ui.unmount()
  }
})

test('in the full view the purpose rides on the command line as a shell comment', async ($, on) => {
  engineDraws(on)

  const ui = await $.ui.mount({
    ...ROW,
    surface: 'terminal',
    props: { ...useProps('Bash', { command: 'touch flag.txt', description: '플래그 파일 만들기' }), isExpanded: true },
  })

  expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row: touch flag.txt  # 플래그 파일 만들기')
  expect(await ui.find({ type: 'Text', text: /↳/ })).toBeUndefined()
  await ui.unmount()
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

test('the Bash tool asks for its description in Korean, once, and leaves other tools alone', async ($, on) => {
  on('tool.describe', (_, e) => ({ description: e.description }))
  const provider = { plugin: 'engine', tier: 'core' } as const

  const bash = await $.tool.describe({ tool: 'Bash', description: 'Executes a bash command.', provider })
  expect(bash.description.startsWith('Executes a bash command.')).toBe(true)
  expect(bash.description).toContain('Write it in Korean')
  expect(bash.description.split('Write it in Korean').length).toBe(2)

  const read = await $.tool.describe({ tool: 'Read', description: 'Reads a file.', provider })
  expect(read.description).toBe('Reads a file.')
})
