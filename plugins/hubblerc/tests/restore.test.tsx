import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { lastAnswer } from '../hooks/band-format'
import { turnsFromTranscript } from '../hooks/restore'
import { summarize } from '../hooks/summary'
import { standInForEngine, start } from './engine'

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = {
  title: 'hubblerc',
  isFocused: false,
  bodyColumns: 56,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

type Block = { type: string; [field: string]: unknown }
type Sent = { role: 'user' | 'assistant'; content: Block[] }

const text = (value: string): Block => ({ type: 'text', text: value })
const use = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input })
const result = (id: string, isError = false): Block => ({ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError })
const user = (...content: Block[]): Sent => ({ role: 'user', content })
const assistant = (...content: Block[]): Sent => ({ role: 'assistant', content })

const CAVEAT = text('<local-command-caveat>Caveat: run directly in Claude Code.</local-command-caveat>')
const RELOAD = text('<command-name>/reload-plugins</command-name>\n<command-message>reload-plugins</command-message>')
const RELOADED = text('<local-command-stdout>Reloaded: 3 plugins</local-command-stdout>')

/** A resumed session as the model was sent it: the shapes the test session's transcript has. */
const SENT: Sent[] = [
  user(text('인증 버그 고쳐줘')),
  assistant(use('u1', 'Read', { file_path: '/repo/src/auth.ts' }), use('u2', 'Bash', { command: 'bun test', description: '테스트 실행' })),
  user(result('u1'), result('u2', true)),
  user(text('<system-reminder>파일이 바뀌었습니다</system-reminder>')),
  assistant(use('u3', 'Edit', { file_path: '/repo/src/auth.ts' })),
  user(result('u3')),
  assistant(text('고쳤습니다.')),
  // A local command, then another session's message: one answer, titled by the message.
  user(CAVEAT, RELOAD, RELOADED, text('Another Claude session sent a message:\n<cross-session-message from="x">시나리오 7 · 두 도구</cross-session-message>')),
  assistant(use('u4', 'Agent', { description: '호출부 찾기', subagent_type: 'Explore' })),
  user(result('u4')),
  assistant(text('찾았습니다.')),
  user(text('Another Claude session sent a message:\n<agent-message from="ag-9">\n[Subagent hand-back] The text below is the final report.</agent-message>')),
  assistant(text('보고 받았습니다.')),
  user(
    text(
      '<task-notification>\n<task-id>ag-9</task-id>\n<status>completed</status>\n<summary>Agent "호출부 찾기" finished</summary>\n</task-notification>',
    ),
  ),
  assistant(text('확인했습니다.')),
  // A local command nobody answered.
  user(CAVEAT, RELOAD, RELOADED),
  assistant(text('No response requested.')),
  // A skill: its command titles the answer, its body does not.
  user(
    text('<command-message>plugin-authoring</command-message>\n<command-name>/plugin-authoring</command-name>\n<command-args>make a pane</command-args>'),
    text('Base directory for this skill: /skills/plugin-authoring\n\n# Plugin authoring …'),
  ),
  assistant(use('u5', 'Bash', { command: 'ls', description: '목록' })),
  user(result('u5')),
]

/** The plain transcript: what it adds is each call's stored result (an Edit's patch, an Agent's id). */
const ROWS: SessionMessage[] = [
  {
    role: 'assistant',
    text: '',
    toolUses: [
      {
        tool_use_id: 'u3',
        tool: 'Edit',
        input: { file_path: '/repo/src/auth.ts' },
        result: { structuredPatch: [{ lines: ['-old', '+new', '+more'] }] },
        text: 'ok',
      },
      { tool_use_id: 'u4', tool: 'Agent', input: { description: '호출부 찾기', subagent_type: 'Explore' }, agentId: 'ag-9', text: 'done' },
    ],
  },
]

test('a transcript reads back as its answers, titled by what each answered', () => {
  const list = turnsFromTranscript(SENT, ROWS)

  expect(list.map(turn => [turn.prompt, summarize(turn)])).toEqual([
    ['인증 버그 고쳐줘', 'auth.ts +2 −1 · Bash 1 · Edit 1 · Read 1 · 실패 1'],
    ['시나리오 7 · 두 도구', 'Agent 1'],
    ['(서브에이전트 보고)', ''],
    ['알림: Agent "호출부 찾기" finished', ''],
    ['/plugin-authoring make a pane', 'Bash 1'],
  ])
  expect(list.every(turn => turn.restored === true)).toBe(true)
  expect(list[1]?.agents).toEqual(['ag-9'])
  expect(list[1]?.runs[0]).toMatchObject({ tool: 'Agent', description: '호출부 찾기', agentType: 'Explore', spawned: 'ag-9' })
  // The key a question's row is found by: what a UserMessage row shows for it.
  expect(list.map(turn => turn.promptKey)).toEqual([
    '인증 버그 고쳐줘',
    '시나리오 7 · 두 도구',
    '[Subagent hand-back] The text below is the final report.',
    'Agent "호출부 찾기" finished',
    '/plugin-authoring make a pane',
  ])
  expect(lastAnswer(list)).toBe('직전 · Bash 1')
})

test('a summary left by a compaction reads as a continuation', () => {
  const list = turnsFromTranscript(
    [
      user(text('This session is being continued from a previous conversation that ran out of context. …')),
      assistant(use('u1', 'Read', { file_path: '/a.ts' })),
    ],
    [],
  )

  expect(list.map(turn => turn.prompt)).toEqual(['(압축 후 이어짐)'])
})

test('a resumed session shows its earlier answers, with no times, and what its subagents did', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.sent = SENT
  standIn.messages = ROWS
  standIn.agentMessages['ag-9'] = [
    { role: 'user', text: 'find the callers', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 's1', tool: 'Read', input: { file_path: '/repo/src/a.ts' }, text: 'ok' },
        { tool_use_id: 's2', tool: 'Read', input: { file_path: '/repo/src/b.ts' }, text: 'ok' },
      ],
    },
  ]
  await start($)

  const table = (await $.command.run({ command: 'activity', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })).text
  expect(table?.split('\n').slice(0, 3)).toEqual([
    '답변별 활동 (전체 5개 중 최근 5개)',
    '#1        이전  "인증 버그 고쳐줘"  auth.ts +2 −1 · Bash 1 · Edit 1 · Read 1 · 실패 1',
    '#2        이전  "시나리오 7 · 두 도구"  Agent 1 · 에이전트 도구 2',
  ])

  // Rebuilt answers have no time; a press finds the question's row by what it shows.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'turn-restored-0' }))?.text).toBe('#1 인증 버그 고쳐줘 실패 1')
  expect((await ui.find({ key: 'turn-restored-0' }))?.type).toBe('Button')
  expect((await ui.find({ key: 'fold-files' }))?.text).toBe(' ▾ 파일 ')
  expect((await ui.find({ key: 'file-/repo/src/auth.ts' }))?.text).toMatch(/auth\.ts \+2 −1/)
  await ui.unmount()
})

test("a press finds the question's row among the rows drawn, and says so when it was not drawn", async ($, on) => {
  const standIn = standInForEngine(on)
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })
  standIn.sent = SENT
  standIn.messages = ROWS
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'turn-restored-0' })
  expect(standIn.toasts).toEqual([{ text: '#1의 질문이 아직 화면에 그려지지 않아 이동할 수 없습니다.' }])

  // The row draws: a press now scrolls to it. The kit draws no conversation to scroll, so the
  // scroll is refused there; the refusal shows the row was found.
  const row = await $.ui.mount({
    plugin: 'hubblerc',
    component: 'UserMessage',
    requestId: 'row-q1',
    surface: 'terminal',
    props: { text: '인증 버그 고쳐줘', origin: { kind: 'composer' }, isExpanded: false },
  })
  await ui.press({ key: 'turn-restored-0' })
  expect(standIn.toasts.at(-1)).toEqual({ text: expect.stringContaining('#1(으)로 이동하지 못했습니다') })
  await row.unmount()
  await ui.unmount()
})

test('a reload of the same session keeps the record made live, times and all', async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.sent = SENT
  standIn.messages = ROWS
  await start($)

  await $.turn.start({ text: '새 질문', turnId: 't-live' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't-live', durationMs: 7000 })
  await start($) // A reload raises session.start again, in the same session.

  const table = (await $.command.run({ command: 'activity', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })).text
  expect(table?.split('\n').at(-1)).toBe('#6        7s  "새 질문"  도구 없음')

  // Another session (a /resume to it, or /clear) is rebuilt from its own transcript.
  standIn.sessionId = 'session-2'
  standIn.sent = []
  standIn.messages = []
  await start($)
  const cleared = (await $.command.run({ command: 'activity', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })).text
  expect(cleared).toBe('아직 기록된 답변이 없습니다. 플러그인을 불러온 뒤의 답변부터 기록됩니다.')
})
