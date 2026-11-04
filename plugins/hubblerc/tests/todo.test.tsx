import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  addItem,
  cleanTodoText,
  clearDone,
  MAX_TODOS,
  nextStatus,
  parseTodoRecord,
  removeItem,
  setItemStatus,
  sortTodos,
  todoListText,
  todoRows,
  todosShown,
  todoStoreKey,
  todoToolList,
} from '../hooks/todo-format'
import type { TodoRecord, UserTodo } from '../hooks/todo-format'
import { NOW, standInForEngine, start } from './engine'

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = {
  title: 'hubblerc',
  isFocused: false,
  bodyColumns: 56,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}
const KEY = todoStoreKey('/repo/hubblerc')
const TOOL = 'mcp__hubblerc__user_todos'

const item = (id: number, status: UserTodo['status'], extra: Partial<UserTodo> = {}): UserTodo => ({ id, text: `일 ${id}`, status, createdAt: NOW, ...extra })

/** The plugin's store, kept where the test can see it. */
function memoryStore(on: On, entries: Record<string, unknown> = {}): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...entries }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })

  return stored
}

const items = (stored: Record<string, unknown>) => parseTodoRecord(stored[KEY]).items

/** The keys of the to-do rows drawn, top to bottom. */
async function rowKeys(ui: { findAll: (query: { type: string }) => Promise<{ key: string | undefined }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(found => found.key ?? '').filter(key => /^todo-\d+$/.test(key))
}

async function todo($: Engine, args: string): Promise<string | undefined> {
  return (await $.command.run({ command: 'todo', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })).text
}

async function answer($: Engine, text: string, turnId: string): Promise<void> {
  await $.turn.start({ text, turnId })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId, durationMs: 1000 })
}

test('to-dos sort in progress, waiting, on hold, done, each in the order written; a press cycles the status', () => {
  const list = [item(1, 'done'), item(2, 'pending'), item(3, 'on_hold'), item(4, 'in_progress'), item(5, 'pending')]
  expect(sortTodos(list).map(one => one.id)).toEqual([4, 2, 5, 3, 1])
  expect(['pending', 'in_progress', 'done', 'on_hold'].map(status => nextStatus(status as UserTodo['status']))).toEqual(['in_progress', 'done', 'on_hold', 'pending'])
})

test('a stored list is read back whole or not at all, item by item', () => {
  const record = parseTodoRecord({
    nextId: 2,
    items: [
      item(1, 'pending'),
      { id: 'x', text: 'no id', status: 'pending' },
      { id: 3, text: 'bad status', status: 'later' },
      { id: 4, text: '   ', status: 'pending' },
      item(1, 'done'),
      { ...item(7, 'done'), text: 'a'.repeat(600), turn: 9, createdTurn: 0 },
    ],
  })
  expect(record.items.map(one => one.id)).toEqual([1, 7])
  expect(record.items[1]?.text.length).toBe(500)
  expect(record.items[1]?.turn).toBe(9)
  expect(record.items[1]?.createdTurn).toBeUndefined()
  // Past every id kept, whatever the stored next id says.
  expect(record.nextId).toBe(8)
  expect(parseTodoRecord(undefined)).toEqual({ items: [], nextId: 1 })
  expect(parseTodoRecord({ items: Array.from({ length: 250 }, (_, i) => item(i + 1, 'pending')) }).items).toHaveLength(MAX_TODOS)
})

test("a project's key holds a hash and the path's end, short whatever the path", () => {
  const long = `/Users/me/${'deep/'.repeat(80)}project`
  expect(todoStoreKey(long).length).toBeLessThan(120)
  expect(todoStoreKey(long).endsWith('deep/project')).toBe(true)
  expect(todoStoreKey('/a/one')).not.toBe(todoStoreKey('/b/one'))
  expect(todoStoreKey('/repo/hubblerc')).toBe(todoStoreKey('/repo/hubblerc'))
})

test('a text is kept trimmed, cut at 500 characters', () => {
  expect(cleanTodoText('  할 일  ')).toEqual({ text: '할 일', isClipped: false })
  const long = cleanTodoText('가'.repeat(501))
  expect(long.isClipped).toBe(true)
  expect([...long.text]).toHaveLength(500)
})

test('adding stops at 200; taking up or finishing an item sets the answer, a press does not', () => {
  const full: TodoRecord = { items: Array.from({ length: MAX_TODOS }, (_, i) => item(i + 1, 'pending')), nextId: MAX_TODOS + 1 }
  expect(addItem(full, '하나 더', NOW, { turn: 1, session: 's' })).toBeNull()

  const added = addItem({ items: [], nextId: 5 }, '새 일', NOW, { turn: 3, session: 's1' })
  expect(added?.item).toEqual({ id: 5, text: '새 일', status: 'pending', createdAt: NOW, createdTurn: 3, createdSession: 's1' })
  expect(added?.record.nextId).toBe(6)
  // Before a session's first answer, no number.
  expect(addItem({ items: [], nextId: 1 }, '처음', NOW, { turn: 0, session: '' })?.item).toEqual({ id: 1, text: '처음', status: 'pending', createdAt: NOW })

  const record: TodoRecord = { items: [item(1, 'pending'), item(2, 'done')], nextId: 3 }
  expect(setItemStatus(record, 1, 'in_progress', { turn: 7, session: 's1' })?.items[0]).toMatchObject({ status: 'in_progress', turn: 7, turnSession: 's1' })
  expect(setItemStatus(record, 1, 'on_hold', { turn: 7, session: 's1' })?.items[0]?.turn).toBeUndefined()
  expect(setItemStatus(record, 1, 'done')?.items[0]?.turn).toBeUndefined()
  expect(setItemStatus(record, 9, 'done')).toBeNull()
  expect(removeItem(record, 2)?.items.map(one => one.id)).toEqual([1])
  expect(removeItem(record, 9)).toBeNull()
  expect(clearDone(record).items.map(one => one.id)).toEqual([1])
})

test('the tab shows twelve at most, fewer in fewer rows with a row for "외 N개"', () => {
  // Items, "완료 N개 지우기", the field.
  expect(todoRows(3, 1, true)).toBe(5)
  expect(todoRows(0, 0, true)).toBe(2)
  expect(todoRows(20, 0, false)).toBe(13)
  expect(todosShown(3, 10, 1, true)).toBe(3)
  expect(todosShown(20, 40, 0, true)).toBe(12)
  // Six rows less the field and "지우기": four, one of them "외 N개".
  expect(todosShown(20, 6, 2, true)).toBe(3)
  expect(todosShown(20, 1, 2, true)).toBe(1)
})

test('the lists say each item, the model\'s with ids and the answers it was written and taken up in', () => {
  const list = [
    item(1, 'done', { turn: 9, turnSession: 'old' }),
    item(2, 'pending', { createdTurn: 3, createdSession: 'old' }),
    item(3, 'in_progress', { createdTurn: 12, createdSession: 'now', turn: 14, turnSession: 'now' }),
    item(4, 'on_hold'),
  ]
  expect(todoListText(list)).toBe(['할 일: 진행 1 · 대기 1 · 보류 1 · 완료 1', '◐ 일 3  #14', '○ 일 2', '— 일 4', '✓ 일 1  #9'].join('\n'))
  expect(todoListText([])).toMatch(/없습니다/)

  const text = todoToolList(list, { turn: 15, session: 'now' })
  expect(text).toMatch(/This is answer #15 of the current session/)
  expect(text).toMatch(/- id 3 \[in_progress\] 일 3 \(written during answer #12; taken up in answer #14\)/)
  expect(text).toMatch(/- id 2 \[pending\] 일 2 \(written during answer #3 of an earlier session\)/)
  expect(text).toMatch(/- id 1 \[done\] 일 1 \(written before any answer; done in answer #9 of an earlier session\)/)
  expect(text).toMatch(/- id 4 \[on_hold\] 일 4 \(written before any answer\)/)
})

test('/todo writes to the project with the answer it was written during; alone it lists', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on)
  await start($)
  await answer($, '첫 질문', 't1')
  await $.turn.start({ text: '두 번째 질문', turnId: 't2' })

  expect(await todo($, '  로그 정리하기  ')).toBe('할 일에 적었습니다: 로그 정리하기')
  expect(items(stored)).toEqual([{ id: 1, text: '로그 정리하기', status: 'pending', createdAt: NOW, createdTurn: 2, createdSession: 'session-1' }])
  expect(await todo($, '')).toBe('할 일: 대기 1\n○ 로그 정리하기')
  expect(await todo($, '   ')).toBe('할 일: 대기 1\n○ 로그 정리하기')
})

test('/todo writes onto what the store holds now: another session\'s item written meanwhile stays', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on)
  await start($)
  await todo($, '여기서 적음')
  // Another session of the same project, after this one read the list.
  const record = parseTodoRecord(stored[KEY])
  stored[KEY] = { items: [...record.items, item(record.nextId, 'pending', { text: '다른 세션' })], nextId: record.nextId + 1 }

  await todo($, '다시 여기서')
  expect(items(stored).map(one => [one.id, one.text])).toEqual([
    [1, '여기서 적음'],
    [2, '다른 세션'],
    [3, '다시 여기서'],
  ])
})

test('/todo is listed, runs mid-answer, and refuses past 200 items', async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on, { [KEY]: { items: Array.from({ length: MAX_TODOS }, (_, i) => item(i + 1, 'pending')), nextId: MAX_TODOS + 1 } })
  await start($)

  expect(standIn.commands.find(command => command.name === 'todo')).toMatchObject({ immediate: true, argumentHint: '[내용]' })
  expect(await todo($, '하나 더')).toMatch(/200개라 더 적을 수 없습니다/)
  expect(items(stored)).toHaveLength(MAX_TODOS)
})

test("the model's tool lists, adds and sets a status, the answer it runs in on what it takes up or finishes", async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on, { [KEY]: { items: [item(1, 'pending', { text: '테스트 정리', createdTurn: 4, createdSession: 'old' })], nextId: 2 } })
  await start($)

  expect(standIn.tools.map(tool => tool.name)).toEqual(['user_todos'])
  // Short, in English, and plainly not the model's own task list.
  expect(standIn.tools[0]?.description).toMatch(/^The user's own to-do and idea list/)
  expect(standIn.tools[0]?.description.length).toBeLessThan(400)
  expect(standIn.tools[0]?.inputSchema).toMatchObject({ required: ['action'] })

  await answer($, '첫 질문', 't1')
  await $.turn.start({ text: '할 일 보고 진행해', turnId: 't2' })
  const listed = await $.tool.call({ tool: TOOL, action: 'list' })
  expect(listed.result).toBe(
    "The user's to-do list for this project (1 items). This is answer #2 of the current session.\n- id 1 [pending] 테스트 정리 (written during answer #4 of an earlier session)",
  )

  expect((await $.tool.call({ tool: TOOL, action: 'add', text: '문서 갱신' })).result).toBe('Added id 2.')
  expect((await $.tool.call({ tool: TOOL, action: 'set_status', id: 1, status: 'done' })).result).toBe('id 1 is now done.')
  expect(items(stored)).toEqual([
    { id: 1, text: '테스트 정리', status: 'done', createdAt: NOW, createdTurn: 4, createdSession: 'old', turn: 2, turnSession: 'session-1' },
    { id: 2, text: '문서 갱신', status: 'pending', createdAt: NOW, createdTurn: 2, createdSession: 'session-1' },
  ])

  expect((await $.tool.call({ tool: TOOL, action: 'set_status', id: 9, status: 'done' })).deny).toBe('No item has id 9.')
  expect((await $.tool.call({ tool: TOOL, action: 'set_status', id: 1, status: 'finished' })).deny).toMatch(/needs status/)
  expect((await $.tool.call({ tool: TOOL, action: 'add' })).deny).toBe('add needs text.')
  expect((await $.tool.call({ tool: TOOL, action: 'remove' })).deny).toMatch(/action must be/)
})

test('the last box has tabs: the contents, or the to-dos, the shown one bold and kept for the next session', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { [KEY]: { items: [item(1, 'pending'), item(2, 'in_progress', { turn: 3 }), item(3, 'done', { turn: 2 })], nextId: 4 } })
  await start($)
  await answer($, '첫 질문', 't1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // Waiting and in progress counted.
  expect((await ui.find({ key: 'title-contents' }))?.text).toBe('╭── ▾ 목차 1 │ 할 일 2 ')
  expect((await ui.find({ type: 'Text', text: '목차 1' }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: '할 일 2' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'turn-t1' })).toBeDefined()
  expect(await ui.find({ key: 'todo-1' })).toBeUndefined()

  await ui.press({ key: 'tab-todo' })
  expect(stored.sidebarTab).toBe('todo')
  expect((await ui.find({ type: 'Text', text: '할 일 2' }))?.props.bold).toBe(true)
  expect(await ui.find({ key: 'turn-t1' })).toBeUndefined()
  // In progress, waiting, done; the answer number only on what is taken up or done.
  expect(await rowKeys(ui)).toEqual(['todo-2', 'todo-1', 'todo-3'])
  expect((await ui.find({ key: 'todo-2' }))?.text).toBe('◐ 일 2 #3 ✕')
  expect((await ui.find({ key: 'todo-1' }))?.text).toBe('○ 일 1 ↗ ✕')
  expect((await ui.find({ key: 'todo-3' }))?.text).toBe('✓ 일 3 #2 ✕')
  expect((await ui.find({ key: 'todo-clear-done' }))?.text).toBe('완료 1개 지우기')
  expect((await ui.find({ key: 'todo-input' }))?.type).toBe('Input')
  await ui.unmount()

  // The next session opens on the tab chosen.
  await start($)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await again.find({ key: 'todo-1' })).toBeDefined()
  await again.press({ key: 'tab-contents' })
  expect(stored.sidebarTab).toBe('contents')
  expect(await again.find({ key: 'todo-1' })).toBeUndefined()
  await again.unmount()
})

test('a press on the sign cycles the status, ✕ deletes, "완료 N개 지우기" clears the done; the field writes one', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending'), item(2, 'done')], nextId: 3 } })
  await start($)
  await answer($, '첫 질문', 't1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'todo-status-1' })
  expect(items(stored).find(one => one.id === 1)).toMatchObject({ status: 'in_progress' })
  // A press sets no answer number.
  expect(items(stored).find(one => one.id === 1)?.turn).toBeUndefined()
  expect((await ui.find({ key: 'todo-1' }))?.text).toBe('◐ 일 1 ✕')
  for (const status of ['done', 'on_hold', 'pending']) {
    await ui.press({ key: 'todo-status-1' })
    expect(items(stored).find(one => one.id === 1)?.status).toBe(status)
  }

  await ui.press({ key: 'todo-clear-done' })
  expect(items(stored).map(one => one.id)).toEqual([1])
  expect(await ui.find({ key: 'todo-clear-done' })).toBeUndefined()

  await ui.input({ key: 'todo-input', text: '  입력칸에서  ' })
  expect(items(stored).map(one => [one.id, one.text, one.createdTurn])).toEqual([
    [1, '일 1', undefined],
    [3, '입력칸에서', 1],
  ])
  expect(await ui.find({ key: 'todo-3' })).toBeDefined()
  // Enter on an empty field writes nothing.
  await ui.input({ key: 'todo-input', text: '   ' })
  expect(items(stored)).toHaveLength(2)

  await ui.press({ key: 'todo-delete-1' })
  expect(items(stored).map(one => one.id)).toEqual([3])
  await ui.unmount()
})

test('↗ offers a waiting item in the prompt box; sent as offered, that answer takes it up', async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending', { text: '인증 버그 고치기' }), item(2, 'pending', { text: '문서 정리' })], nextId: 3 } })
  await start($)
  await answer($, '첫 질문', 't1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'todo-send-1' })
  expect(standIn.suggestions).toEqual(['인증 버그 고치기'])

  // Sent as offered, spaces around aside: in progress, and this answer's number.
  await $.turn.start({ text: '  인증 버그 고치기\n', turnId: 't2' })
  expect(items(stored).find(one => one.id === 1)).toMatchObject({ status: 'in_progress', turn: 2, turnSession: 'session-1' })
  expect((await ui.find({ key: 'todo-1' }))?.text).toBe('◐ 인증 버그 고치기 #2 ✕')
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't2', durationMs: 1000 })

  // Edited before it was sent: the offer is forgotten, and a later question of the same text takes nothing.
  await ui.press({ key: 'todo-send-2' })
  await $.turn.start({ text: '문서 정리 말고 다른 것', turnId: 't3' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't3', durationMs: 1000 })
  await $.turn.start({ text: '문서 정리', turnId: 't4' })
  expect(items(stored).find(one => one.id === 2)?.status).toBe('pending')

  // A subagent's start is not the person's question.
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't4', durationMs: 1000 })
  await ui.press({ key: 'todo-send-2' })
  await $.turn.start({ text: '문서 정리', turnId: 'a1', agentId: 'ag-1' })
  expect(items(stored).find(one => one.id === 2)?.status).toBe('pending')
  await $.turn.start({ text: '문서 정리', turnId: 't5' })
  expect(items(stored).find(one => one.id === 2)).toMatchObject({ status: 'in_progress', turn: 5 })
  await ui.unmount()
})

test('↗ while the prompt box cannot take it says why, and nothing is taken up', async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  standIn.isSuggestionShown = false
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'todo-send-1' })
  expect(standIn.toasts.at(-1)).toMatchObject({ text: expect.stringMatching(/입력창이 비어 있고/) })
  await $.turn.start({ text: '일 1', turnId: 't1' })
  expect(items(stored)[0]?.status).toBe('pending')
  await ui.unmount()
})

test("another session's change shows as an answer starts; past twelve, or in a short pane, fewer and \"외 N개\"", async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'tab-todo' }))?.text).toBe('할 일 1')
  stored[KEY] = { items: Array.from({ length: 15 }, (_, i) => item(i + 1, 'pending')), nextId: 16 }
  await $.turn.start({ text: '질문', turnId: 't1' })
  expect((await ui.find({ key: 'tab-todo' }))?.text).toBe('할 일 15')
  expect((await rowKeys(ui)).length).toBe(12)
  expect((await ui.find({ type: 'Text', text: /^외 \d+개$/ }))?.text).toBe('외 3개')
  await ui.unmount()

  const short = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 28 } } })
  const shown = (await rowKeys(short)).length
  expect(shown).toBeLessThan(12)
  expect(shown).toBeGreaterThan(0)
  expect((await short.find({ type: 'Text', text: /^외 \d+개$/ }))?.text).toBe(`외 ${15 - shown}개`)
  await short.unmount()
})

test('a surface with no field draws the tab without one; a folded box unfolds on a press of a tab', async ($, on) => {
  standInForEngine(on)
  memoryStore(on, { sidebarFolded: ['contents'], [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile', props: PANE_PROPS })
  expect((await ui.find({ key: 'box-contents' }))?.text).toMatch(/^╶── ▸ 목차 0 │ 할 일 1 ─+$/)
  await ui.press({ key: 'tab-todo' })
  expect(await ui.find({ key: 'todo-1' })).toBeDefined()
  expect(await ui.find({ key: 'todo-input' })).toBeUndefined()
  await ui.unmount()
})

test('a write the store refuses (over its 4 MiB) is said: a toast for the field, a refusal for the model', async ($, on) => {
  const standIn = standInForEngine(on)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ deny: 'store over 4 MiB' }))
  await start($)
  await answer($, '첫 질문', 't1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'tab-todo' })
  await ui.input({ key: 'todo-input', text: '적히지 않을 일' })
  expect(standIn.toasts.at(-1)).toMatchObject({ text: expect.stringMatching(/^할 일을 저장하지 못했습니다: .*4 MiB/) })
  await ui.unmount()

  expect((await $.tool.call({ tool: TOOL, action: 'add', text: '적히지 않을 일' })).deny).toMatch(/could not be read or written: .*4 MiB/)
  expect(await todo($, '적히지 않을 일')).toMatch(/^할 일을 다루지 못했습니다: .*4 MiB/)
})
