import { expect, mock, test } from 'claude-code/testing'

import { relayBandLine } from '../hooks/relay/relay-status'
import { startedText } from '../hooks/status/peer'
import { COLORS } from '../hooks/shared/style'
import { NOW, standInForEngine, start } from './engine'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band' } as const
const BAND_PROPS = {
  hasSurvey: false, isCollapsed: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

test('the band shows the model, effort, usage and branch, then idle, then no answer yet', async ($, on) => {
  standInForEngine(on)
  await start($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: BAND_PROPS })

    expect((await ui.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
    // A press that opens the slider in the terminal; text in the desktop app (its button padded the value apart).
    if (surface === 'terminal') expect((await ui.find({ key: 'effort' }))?.text).toBe('xhigh')
    else expect(await ui.find({ key: 'effort' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'xhigh' }))?.text).toBe('xhigh')
    expect(await ui.find({ type: 'Text', text: '45%' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /↻/ }))?.text).toBe(' ↻ 1h 30m')
    expect(await ui.find({ type: 'Text', text: '7d ' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /main/ }))?.text).toBe('main')
    expect(await ui.find({ type: 'Text', text: '*' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /대기 중/ }))?.text).toBe('· 대기 중')
    expect((await ui.find({ type: 'Text', text: /직전/ }))?.text).toBe('직전 답변 없음')
    await ui.unmount()
  }
})

test("an effort picked in the engine's picker shows on the bar from the next request, which goes out as set", async ($, on) => {
  standInForEngine(on)
  const sent: unknown[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await start($)
  const step = async (index: number, effort: 'low' | 'high', agentId?: string) => {
    const stream = $.turn.step({
      turnId: 't1',
      index,
      model: 'claude-opus-5-5',
      effort,
      messageCount: 1,
      ...(agentId === undefined ? {} : { agentId }),
    })
    for await (const chunk of stream) void chunk
  }
  const head = async () => (await ui.find({ key: 'effort' }))?.text

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  expect(await head()).toBe('xhigh') // From the model's settings, before any request.

  await step(0, 'high') // The person picked high with Option+P: the next request carries it.
  expect(await head()).toBe('high')

  await step(1, 'low', 'sub-1') // A subagent's request leaves the bar as it was.
  expect(await head()).toBe('high')

  expect(sent).toEqual(['high', 'low'])
  expect(await ui.find({ type: 'Text', text: ' (세션)' })).toBeUndefined()
  await ui.unmount()
})

test("the effort control opens a slider; a level sends this session's requests at it, the reset at the engine's", async ($, on) => {
  standInForEngine(on)
  const sent: unknown[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await start($)
  const step = async (index: number, agentId?: string) => {
    const stream = $.turn.step({
      turnId: 't1',
      index,
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      messageCount: 1,
      ...(agentId === undefined ? {} : { agentId }),
    })
    for await (const chunk of stream) void chunk
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  expect(await ui.find({ key: 'effort-high' })).toBeUndefined() // Closed: no level buttons, no digit hotkeys.
  expect((await ui.find({ type: 'Text', text: /직전/ }))?.text).toBe('직전 답변 없음')

  await ui.press({ key: 'effort' })
  expect(await ui.find({ key: 'effort-high' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /직전/ })).toBeUndefined() // The slider stands in line 3.

  await ui.press({ key: 'effort-high' })
  expect((await ui.find({ key: 'effort' }))?.text).toBe('high')
  expect(await ui.find({ type: 'Text', text: ' (세션)' })).toBeDefined()
  expect(await ui.find({ key: 'effort-high' })).toBeUndefined() // Chosen: the slider closes.

  await step(0)
  await step(1, 'sub-1') // A subagent's request keeps the engine's effort.

  await ui.press({ key: 'effort' })
  await ui.press({ key: 'effort-reset' })
  await step(2)

  expect(sent).toEqual(['high', 'xhigh', 'xhigh'])
  expect((await ui.find({ key: 'effort' }))?.text).toBe('xhigh')
  expect(await ui.find({ type: 'Text', text: ' (세션)' })).toBeUndefined()
  await ui.unmount()
})

test('the slider closes by itself after a while, and when the next turn starts', async ($, on) => {
  const { clock } = standInForEngine(on)
  await start($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  await ui.press({ key: 'effort' })
  expect(await ui.find({ key: 'effort-low' })).toBeDefined()
  await clock.advance(10_000)
  expect(await ui.find({ key: 'effort-low' })).toBeUndefined()

  await ui.press({ key: 'effort' })
  await $.turn.start({ text: 'next question', turnId: 't9' })
  expect(await ui.find({ key: 'effort-low' })).toBeUndefined()
  await ui.unmount()
})

test('line 2 shows a running subagent, and none of Claude\'s own to-do progress; line 3 the last answer', async ($, on) => {
  standInForEngine(on, { agents: [{ id: 'ag-1', type: 'general-purpose', description: '코드 찾기', status: 'running' }] })
  await start($)

  await $.turn.start({ text: 'fix the auth bug', turnId: 't1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '원인 찾기', activeForm: '원인 찾는 중', status: 'completed' },
      { content: '인증 버그 수정', activeForm: '인증 버그 수정 중', status: 'in_progress' },
      { content: '테스트', activeForm: '테스트 중', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'Agent', description: '코드 찾기', prompt: 'find it', subagent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND_PROPS, isWorking: true } })
  expect((await ui.find({ type: 'Text', text: /◐/ }))?.text).toBe('◐ general-purpose: 코드 찾기 0s')
  expect(await ui.find({ type: 'Text', text: /▸/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /직전/ }))?.text).toBe('직전 5s · Agent 1 · Read 1 · TodoWrite 1')
  await ui.unmount()
})

test('a survey keeps the band to itself', async ($, on) => {
  standInForEngine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>survey</Text>
  })
  await start($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND_PROPS, hasSurvey: true } })
  expect((await ui.find({ type: 'Text', text: /survey/ }))?.text).toBe('survey')
  expect(await ui.find({ type: 'Text', text: /^Opus/ })).toBeUndefined()
  await ui.unmount()
})

test('collapsed, the band draws nothing and reads no state; uncollapsed, it draws whole again', async ($, on) => {
  standInForEngine(on)
  let reads = 0
  on('state.get', ($, e, next) => {
    reads += 1

    return next(e)
  })
  await start($)

  const from = reads
  const collapsed = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND_PROPS, isCollapsed: true } })
  expect(await collapsed.find({ type: 'Text' })).toBeUndefined()
  expect(reads - from).toBe(0)
  await collapsed.unmount()

  const shown = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS })
  expect((await shown.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
  await shown.unmount()
})

test("the band ends line 1 with the session's name as the sidebar does, a press copying it; relay's light delegations get a line of their own", async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  standIn.sessionId = '444027a3-234d-4c3c-8232-a7e561773f2d'
  const entry = JSON.stringify({ pid: 222, sessionId: standIn.sessionId, startedAt: NOW - 3_600_000, name: 'hubblerc-1b' })
  on('fs.list', (_, e) => (e.path === '/home/me/.claude/sessions' ? { value: [{ name: '222.json', kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false }] } : { deny: 'no folder' }))
  on('fs.read', (_, e) => (e.path === '/home/me/.claude/sessions/222.json' ? { value: entry as never } : { deny: 'no file' }))
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } as never }
  })
  await start($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND_PROPS, bodyColumns: 200 } })
  expect((await ui.find({ key: 'band-session' }))?.text).toBe('hubblerc-1b')
  await ui.press({ key: 'band-session' })
  expect(copied).toEqual([`hubblerc-1b (${startedText(NOW - 3_600_000)} 시작)`])
  expect(await ui.find({ type: 'Text', text: /^relay {2}/ })).toBeUndefined()

  const spec = (await $.tool.call({ tool: 'mcp__hubblerc__relay', action: 'spec_text', id: 'T21', title: 'Fix the band', goal: 'Fix it.', model: 'claude-sonnet-5-5', effort: 'high', edit_scope: ['hooks/**'], done_when: [{ text: 'tests pass', command: 'make test' }], runner_kind: 'claude' } as never)) as { deny?: string }
  expect(spec.deny).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^relay {2}/ }))?.text).toBe('relay  light ready 1')
  await ui.unmount()
})

test("the band's relay line counts each group's tasks by status, a run's waiting decisions too", () => {
  const task = (status: string) => ({ key: 'A', id: 'A', rev: 1, title: 'A', status, model: 'm', effort: 'e', runner: '', dispatchedAt: null })
  const text = (line: { text: string }[]) => line.map(segment => segment.text).join('')
  expect(relayBandLine(null, COLORS)).toEqual([])
  expect(relayBandLine({ runs: [] }, COLORS)).toEqual([])
  const line = relayBandLine({ light: [task('done'), task('running'), task('done')], runs: [{ run: '2026-11-19-demo', tasks: [task('ready'), task('done_with_concerns')], pending: 2, verdict: null }] }, COLORS)
  expect(text(line)).toBe('relay  light running 1 done 2 │ 2026-11-19-demo concerns 1 ready 1 · 결정 2')
})
