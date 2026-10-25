import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const LINE = {
  plugin: 'hubblerc',
  component: 'TurnDuration',
  requestId: 'turn-line',
  surface: 'terminal',
} as const

const EDIT_RESULT = {
  filePath: '/repo/src/app.ts',
  structuredPatch: [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-old', '+new', '+more'] },
  ],
}

const WRITE_RESULT = {
  type: 'create',
  filePath: '/repo/src/new.ts',
  content: 'one\ntwo\nthree\n',
  structuredPatch: [],
}

// Nothing sits beneath the plugin: these hooks stand for the engine.
function standInForEngine(on: On): void {
  mock.clock(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') return { result: EDIT_RESULT as never }
    if (e.tool === 'Write') return { result: WRITE_RESULT as never }
    if (e.tool === 'Bash' && e.command.startsWith('rm')) return { deny: 'refused' }
    if (e.tool === 'Agent') return { result: { status: 'async_launched', agentId: 'ag-1' } as never }

    return { result: {} as never }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>Baked for 5s</Text>
  })
}

const COMPLETE = { answer: '', isAborted: false, reason: 'answer' } as const

test("a turn's edits and tool calls follow its duration line", async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/app.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'old', new_string: 'new\nmore' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md', agentId: 'sub-1' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 5000 })

  const ui = await $.ui.mount({ ...LINE, props: { word: 'Baked', durationMs: 5000 } })

  expect((await ui.find({ type: 'Text', text: /Baked/ }))?.text).toBe('Baked for 5s')
  expect((await ui.find({ type: 'Text', text: /Read/ }))?.text).toBe(
    'app.ts +2 −1 · Bash 1 · Edit 1 · Read 1 · 에이전트 도구 1',
  )
  await ui.unmount()
})

test('several files are totalled and a refused call counts as failed', async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'add a file', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'old', new_string: 'new\nmore' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'one\ntwo\nthree\n' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', description: 'Remove the build' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 8000 })

  const ui = await $.ui.mount({ ...LINE, props: { word: 'Baked', durationMs: 8000 } })

  expect((await ui.find({ type: 'Text', text: /파일/ }))?.text).toBe(
    '2파일 +5 −1 · Bash 1 · Edit 1 · Write 1 · 실패 1',
  )
  await ui.unmount()
})

test('each line finds its own turn by duration', async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'first', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 4000 })
  await $.turn.start({ text: 'second', turnId: 't2' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })
  await $.turn.complete({ ...COMPLETE, turnId: 't2', durationMs: 60000 })

  const first = await $.ui.mount({ ...LINE, props: { word: 'Baked', durationMs: 4000 } })
  expect((await first.find({ type: 'Text', text: /Read|Bash|에이전트/ }))?.text).toBe('Read 1')
  await first.unmount()

  const second = await $.ui.mount({ ...LINE, requestId: 'turn-line-2', props: { word: 'Baked', durationMs: 60000 } })
  expect((await second.find({ type: 'Text', text: /Read|Bash|에이전트/ }))?.text).toBe('Bash 1')
  await second.unmount()
})

test('a line no turn matches, or a turn with no tool call, is drawn as the engine drew it', async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'just a question', turnId: 't1' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 3000 })

  for (const durationMs of [3000, 90000]) {
    const ui = await $.ui.mount({ ...LINE, props: { word: 'Baked', durationMs } })
    expect((await ui.find({ type: 'Text', text: /Baked/ }))?.text).toBe('Baked for 5s')
    expect(await ui.find({ type: 'Text', text: /Read|Bash|에이전트/ })).toBeUndefined()
    await ui.unmount()
  }
})

test("a subagent's own turns are not recorded as turns", async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'main', turnId: 't1' })
  await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'sub-1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'sub-1' })
  await $.turn.complete({ ...COMPLETE, turnId: 's1', agentId: 'sub-1', durationMs: 2000 })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 7000 })

  const sub = await $.ui.mount({ ...LINE, props: { word: 'Baked', durationMs: 2000 } })
  expect(await sub.find({ type: 'Text', text: /Read|Bash|에이전트/ })).toBeUndefined()
  await sub.unmount()

  const main = await $.ui.mount({ ...LINE, requestId: 'turn-line-2', props: { word: 'Baked', durationMs: 7000 } })
  expect((await main.find({ type: 'Text', text: /Read|Bash|에이전트/ }))?.text).toBe('에이전트 도구 1')
  await main.unmount()
})

test("a background subagent's calls count on the turn that started it, even after that turn ends", async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'look into it', turnId: 't1' })
  await $.tool.call({ tool: 'Agent', description: 'Read a file', prompt: 'Read a.ts', subagent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'ag-1' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 6000 })

  // The background agent works on while the person asks something else.
  await $.turn.start({ text: 'something else', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/b.ts', agentId: 'ag-1' })
  await $.tool.call({ tool: 'SubagentHandback', agentId: 'ag-1' } as never)
  await $.turn.complete({ ...COMPLETE, turnId: 't2', durationMs: 20000 })

  const spawner = await $.ui.mount({ ...LINE, props: { word: 'Baked', durationMs: 6000 } })
  expect((await spawner.find({ type: 'Text', text: /Agent/ }))?.text).toBe('Agent 1 · 에이전트 도구 2')
  await spawner.unmount()

  const later = await $.ui.mount({ ...LINE, requestId: 'turn-line-2', props: { word: 'Baked', durationMs: 20000 } })
  expect(await later.find({ type: 'Text', text: /Read|Agent|에이전트/ })).toBeUndefined()
  await later.unmount()
})

test('a line finds its turn by the id of the row it is drawn from, even when the times differ', async ($, on) => {
  standInForEngine(on)

  await $.turn.start({ text: 'after a background agent', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await $.turn.complete({ ...COMPLETE, turnId: 't1', durationMs: 19000 })
  await $.session.append({
    door: 'notice',
    origin: { kind: 'task-notification' } as never,
    uuid: 'row-1',
    message: { type: 'system', name: 'turn_duration', content: [{ type: 'text', text: 'Baked for 1m 27s' }] },
  })

  // The engine's line counts from an earlier prompt: 87.7s, far from the turn's own 19s.
  const ui = await $.ui.mount({ ...LINE, requestId: 'row-1', props: { word: 'Baked', durationMs: 87662 } })
  expect((await ui.find({ type: 'Text', text: /Read/ }))?.text).toBe('Read 1')
  await ui.unmount()
})
