import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { footerRows, parseTodoRecord, todoStoreKey } from '../hooks/todo/todo-format'
import type { UserTodo } from '../hooks/todo/todo-format'
import { candidatesFor, chosenId, doneInput, doneQuestion, MAX_CANDIDATES, takeInput, takeQuestion, TASK_DONE, TASK_TAKE } from '../hooks/todo/todo-judge-format'
import { messageReply, NOW, standInForEngine, start } from './engine'
import type { StandIn } from './engine'

const API_KEY = 'sk-ant-api03-test-key-0000'
const WITH_KEY = { options: { anthropicApiKey: API_KEY } }
const HOME = '/home/me'
const LOG = `${HOME}/.claude/hubblerc/likely/Test-Mac.jsonl`
const KEY = todoStoreKey('/repo/hubblerc')
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

const item = (id: number, status: UserTodo['status'], text = `일 ${id}`, extra: Partial<UserTodo> = {}): UserTodo => ({ id, text, status, createdAt: NOW, ...extra })

/** The machine: home, and the plugin's store with the to-do tab shown and these items. */
function machine(on: On, standIn: StandIn, todos: UserTodo[]): Record<string, unknown> {
  mock.env(on, { HOME })
  const store: Record<string, unknown> = { sidebarTab: 'todo', [KEY]: { items: todos, nextId: 100 } }
  on('store.get', (_, e) => ({ value: store[e.key] as never }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('fs.list', (_, e) => ({
    value: Object.keys(standIn.files)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: standIn.files[path]?.length ?? 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.log', () => ({ value: undefined }))

  return store
}

/** A model that gives each option the chance it is told, reading the options in the order a call shows them. */
function choosing(chances: Record<string, number>) {
  return (body: Record<string, unknown>) => {
    const prompt = (body.messages as { content: string }[])[0]?.content ?? ''
    const shown = [...prompt.matchAll(/^\S+\. (\S+)/gm)].map(match => match[1] ?? '')

    return messageReply(JSON.stringify({ answers: [{ probabilities: shown.map(name => chances[name] ?? 0) }] }))
  }
}

const items = (store: Record<string, unknown>) => parseTodoRecord(store[KEY]).items
const logged = (standIn: StandIn) =>
  (standIn.files[LOG] ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
const toastTexts = (standIn: StandIn) => standIn.toasts.map(toast => String((toast as { text?: unknown }).text ?? ''))
const promptOf = (standIn: StandIn, call: number) => (standIn.anthropicCalls[call]?.body.messages as { content: string }[])[0]?.content ?? ''

async function ask($: Engine, standIn: StandIn, text: string, turnId: string): Promise<void> {
  await $.turn.start({ text, turnId })
  await standIn.clock.settle()
}

async function answered($: Engine, standIn: StandIn, answer: string, turnId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await $.turn.complete({ answer, isAborted: false, reason: 'answer', turnId, durationMs: 1000, ...extra } as never)
  await standIn.clock.settle()
}

test('a judgment is shown the newest twelve items of its kind and `none`; a choice names an item by its id', () => {
  const many = Array.from({ length: 15 }, (_, i) => item(i + 1, 'pending'))
  const list = [...many, item(20, 'in_progress'), item(21, 'done'), item(22, 'on_hold')]
  expect(candidatesFor('take', list).map(one => one.id)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
  expect(candidatesFor('take', list)).toHaveLength(MAX_CANDIDATES)
  expect(candidatesFor('done', list).map(one => one.id)).toEqual([20])
  // The item a "시작?" still waits on can be finished by the same answer.
  expect(candidatesFor('done', list, 3).map(one => one.id)).toEqual([20, 3])

  const question = takeQuestion([item(7, 'pending', '로그 줄이기\n  둘째 줄'), item(3, 'pending', `token=${'a1B2'.repeat(10)} ${'가'.repeat(300)}`)])
  if (question.type !== 'choice') throw new Error('a choice')
  expect(question.choices.map(choice => choice.value)).toEqual(['todo-7', 'todo-3', 'none'])
  expect(question.choices[0]?.description).toBe('로그 줄이기 둘째 줄')
  // A secret is masked and a long text cut before it goes out.
  expect(question.choices[1]?.description).not.toContain('a1B2a1B2')
  expect(question.choices[1]?.description?.length).toBe(200)
  expect(doneQuestion([item(7, 'in_progress')]).type).toBe('choice')

  expect(chosenId('todo-12')).toBe(12)
  expect(chosenId('none')).toBeNull()
  expect(chosenId('todo-x')).toBeNull()
  expect(takeInput('질문', '')).toBe('<message>\n질문\n</message>')
  expect(takeInput('네', '문서를 만들까요?')).toBe('<previous_answer>\n문서를 만들까요?\n</previous_answer>\n\n<message>\n네\n</message>')
  expect(doneInput('질문', `${'x'.repeat(3000)}끝`).endsWith('끝\n</answer_end>')).toBe(true)
  expect(doneInput('질문', 'x'.repeat(3000)).length).toBeLessThan(2100)
  // The suggestion's line is a row of the footer.
  expect(footerRows(1, 0, true, true)).toBe(3)
  expect(footerRows(0, 0, false)).toBe(0)
})

test('a question that starts a waiting to-do in other words is put to the person; 맞음 moves it to in progress with that answer', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn, [item(1, 'pending', '인증 버그 고치기'), item(2, 'pending', '문서 정리'), item(3, 'in_progress', '로그 줄이기')])
  standIn.anthropic = choosing({ 'todo-1': 0.8, none: 0.2 })
  await start($)
  await ask($, standIn, '로그인이 가끔 풀리는 문제 좀 잡아 줘', 't1')

  // Three calls, the waiting items and `none` as options; the item in progress is not one of them.
  expect(standIn.anthropicCalls).toHaveLength(3)
  expect(promptOf(standIn, 0)).toContain('<message>\n로그인이 가끔 풀리는 문제 좀 잡아 줘\n</message>')
  expect(promptOf(standIn, 0)).toMatch(/todo-1 - 인증 버그 고치기/)
  expect(promptOf(standIn, 0)).toMatch(/todo-2 - 문서 정리/)
  expect(promptOf(standIn, 0)).toMatch(/none - none of them: the message asks for other work/)
  expect(promptOf(standIn, 0)).not.toContain('todo-3')
  expect(logged(standIn)[0]).toMatchObject({ type: 'decision', task: TASK_TAKE, samples: 3, meta: { sessionId: 'session-1' } })
  // Nothing moved by itself.
  expect(items(store).find(one => one.id === 1)?.status).toBe('pending')
  expect(toastTexts(standIn).filter(text => text.includes('할 일을 시작한 것 같습니다'))).toHaveLength(1)
  expect(toastTexts(standIn).join('\n')).toContain('인증 버그 고치기')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'todo-suggestion' }))?.text).toMatch(/^시작\? 인증 버그 고치기 \d+% 맞음  아님 $/)
  await ui.press({ key: 'todo-suggestion-yes' })
  expect(items(store).find(one => one.id === 1)).toMatchObject({ status: 'in_progress', turn: 1, turnSession: 'session-1' })
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()
  expect(logged(standIn)[1]).toMatchObject({ type: 'outcome', id: logged(standIn)[0]?.id, outcome: 'todo-1', note: 'accepted' })
  await ui.unmount()
})

test('`none`, or a choice not sure enough, puts nothing; 아님 logs the refusal and that item is not suggested so again this session', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn, [item(1, 'pending', '인증 버그 고치기'), item(2, 'pending', '문서 정리')])
  await start($)
  standIn.anthropic = choosing({ none: 0.9, 'todo-1': 0.1 })
  await ask($, standIn, '날씨 어때', 't1')
  standIn.anthropic = choosing({ 'todo-1': 0.4, 'todo-2': 0.3, none: 0.3 })
  await ask($, standIn, '뭔가 고쳐 줘', 't2')
  expect(standIn.anthropicCalls).toHaveLength(6)
  expect(standIn.toasts).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()

  standIn.anthropic = choosing({ 'todo-2': 0.9, none: 0.1 })
  await ask($, standIn, '문서 좀 손봐 줘', 't3')
  expect((await ui.find({ key: 'todo-suggestion' }))?.text).toContain('시작? 문서 정리')
  await ui.press({ key: 'todo-suggestion-no' })
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()
  expect(items(store).every(one => one.status === 'pending')).toBe(true)
  const lines = logged(standIn)
  expect(lines[lines.length - 1]).toMatchObject({ type: 'outcome', outcome: 'not:todo-2', note: 'rejected' })

  // Judged again, chosen again, not put again.
  await ask($, standIn, '문서 정리 얘기 말인데', 't4')
  expect(standIn.anthropicCalls).toHaveLength(12)
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()
  expect(standIn.toasts).toHaveLength(1)
  await ui.unmount()
})

test('an answer that finishes a to-do in progress is put as "완료?"; 맞음 marks it done with that answer', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn, [item(1, 'pending', '문서 정리'), item(5, 'in_progress', '인증 버그 고치기')])
  await start($)
  standIn.anthropic = choosing({ none: 1 })
  await ask($, standIn, '이어서 마무리해 줘', 't1')
  standIn.anthropic = choosing({ 'todo-5': 0.85, none: 0.15 })
  await answered($, standIn, '세션 만료 검사를 고치고 테스트를 통과시켜 커밋했습니다.', 't1')

  expect(standIn.anthropicCalls).toHaveLength(6)
  // The answer is judged against what is in progress alone, with the question it answered.
  expect(promptOf(standIn, 3)).toContain('<message>\n이어서 마무리해 줘\n</message>')
  expect(promptOf(standIn, 3)).toContain('<answer_end>\n세션 만료 검사를 고치고 테스트를 통과시켜 커밋했습니다.\n</answer_end>')
  expect(promptOf(standIn, 3)).toMatch(/todo-5 - 인증 버그 고치기/)
  expect(promptOf(standIn, 3)).not.toContain('todo-1')
  expect(logged(standIn).filter(line => line.type === 'decision').map(line => line.task)).toEqual([TASK_TAKE, TASK_DONE])
  expect(toastTexts(standIn).filter(text => text.includes('할 일이 끝난 것 같습니다'))).toHaveLength(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'todo-suggestion' }))?.text).toMatch(/^완료\? 인증 버그 고치기 \d+% 맞음  아님 $/)
  await ui.press({ key: 'todo-suggestion-yes' })
  expect(items(store).find(one => one.id === 5)).toMatchObject({ status: 'done', turn: 1 })
  const lines = logged(standIn)
  expect(lines[lines.length - 1]).toMatchObject({ type: 'outcome', outcome: 'todo-5', note: 'accepted' })

  // The next question is shown the end of that answer: what a short go-ahead refers to.
  standIn.anthropic = choosing({ none: 1 })
  await ask($, standIn, '좋아 그럼 그것도', 't2')
  expect(promptOf(standIn, 6)).toContain('<previous_answer>\n세션 만료 검사를 고치고 테스트를 통과시켜 커밋했습니다.\n</previous_answer>')
  await ui.unmount()
})

test('no judgment without a key, with the option off, with no item to judge, for an aborted or a subagent\'s turn, or when ↗ took the item up', async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn, [item(1, 'pending', '문서 정리'), item(5, 'in_progress', '인증 버그 고치기')])
  standIn.anthropic = choosing({ 'todo-1': 0.9, none: 0.1 })
  await start($)
  await ask($, standIn, '문서 좀 손봐 줘', 't1')
  await answered($, standIn, '다 했습니다.', 't1')
  expect(standIn.anthropicCalls).toHaveLength(0)
  expect(standIn.toasts).toHaveLength(0)
})

test('the option off: nothing is judged though a key is set', { options: { anthropicApiKey: API_KEY, likelyTodos: false } }, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn, [item(1, 'pending', '문서 정리'), item(5, 'in_progress', '인증 버그 고치기')])
  standIn.anthropic = choosing({ 'todo-1': 0.9, none: 0.1 })
  await start($)
  await ask($, standIn, '문서 좀 손봐 줘', 't1')
  await answered($, standIn, '다 했습니다.', 't1')
  expect(standIn.anthropicCalls).toHaveLength(0)
})

test('with a key: no item of the kind, an aborted turn and a subagent\'s turn are not judged; an item ↗ took up needs no judging', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn, [item(1, 'pending', '문서 정리'), item(9, 'done', '끝난 일')])
  standIn.anthropic = choosing({ 'todo-1': 0.9, none: 0.1 })
  await start($)

  // A subagent's question and answer are not the person's.
  await $.turn.start({ text: '문서 좀 손봐 줘', turnId: 'a1', agentId: 'ag-1' })
  await $.turn.complete({ answer: '다 했습니다.', isAborted: false, reason: 'answer', turnId: 'a1', durationMs: 1000, agentId: 'ag-1' })
  await standIn.clock.settle()
  expect(standIn.anthropicCalls).toHaveLength(0)

  // The item sent by its ↗ as offered is taken up by the old rule: nothing is left to judge at the start.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'todo-send-1' })
  await ask($, standIn, '문서 정리', 't1')
  expect(items(store).find(one => one.id === 1)?.status).toBe('in_progress')
  expect(standIn.anthropicCalls).toHaveLength(0)

  // An answer cut short is not read for what it finished; a whole one is.
  await $.turn.complete({ answer: '하다가', isAborted: true, reason: 'aborted', turnId: 't1', durationMs: 1000 })
  await standIn.clock.settle()
  expect(standIn.anthropicCalls).toHaveLength(0)
  standIn.anthropic = choosing({ none: 1 })
  await ask($, standIn, '계속', 't2')
  // Nothing waits any more: the question is not judged; the answer is, against the item in progress.
  expect(standIn.anthropicCalls).toHaveLength(0)
  await answered($, standIn, '아직 하는 중입니다.', 't2')
  expect(standIn.anthropicCalls).toHaveLength(3)
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()
  await ui.unmount()
})

test('a status moved by hand answers the judgment: logged at the next question, and the line goes', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn, [item(1, 'pending', '인증 버그 고치기'), item(2, 'pending', '문서 정리')])
  standIn.anthropic = choosing({ 'todo-1': 0.8, none: 0.2 })
  await start($)
  await ask($, standIn, '로그인 문제 잡아 줘', 't1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'todo-suggestion' })).toBeDefined()

  // The sign pressed instead of 맞음: the line is not drawn for an item no longer waiting.
  await ui.press({ key: 'todo-status-1' })
  expect(items(store).find(one => one.id === 1)?.status).toBe('in_progress')
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()

  standIn.anthropic = choosing({ none: 1 })
  await ask($, standIn, '다른 얘기', 't2')
  const outcomes = logged(standIn).filter(line => line.type === 'outcome')
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({ outcome: 'todo-1', note: 'by hand' })
  await ui.unmount()
})

test('a judgment that comes back after the next question began is not put under it', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn, [item(1, 'pending', '인증 버그 고치기')])
  standIn.anthropic = choosing({ 'todo-1': 0.9, none: 0.1 })
  standIn.anthropicDelayMs = 5000
  await start($)
  await $.turn.start({ text: '로그인 문제 잡아 줘', turnId: 't1' })
  standIn.anthropic = choosing({ none: 1 })
  await $.turn.start({ text: '아니 다른 얘기', turnId: 't2' })
  await standIn.clock.advance(6000)
  await standIn.clock.settle()

  expect(standIn.anthropicCalls).toHaveLength(6)
  expect(standIn.toasts).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'todo-suggestion' })).toBeUndefined()
  await ui.unmount()
})
