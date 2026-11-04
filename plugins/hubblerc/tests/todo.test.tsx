import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  addItem,
  cleanTodoText,
  clearDone,
  editItem,
  MAX_TODOS,
  MAX_TRASH,
  nextStatus,
  parseTodoRecord,
  removeItem,
  restoreItems,
  rowTailCells,
  setItemStatus,
  sortTodos,
  TODO_USAGE,
  todoListText,
  footerRows,
  todoRows,
  todoLeastRows,
  todosShown,
  todoStoreKey,
  todoToolList,
  trashListText,
} from '../hooks/todo-format'
import { shareRows } from '../hooks/sidebar-format'
import { pluginId, sha256Hex, storeFileName } from '../hooks/store-file'
import type { TodoRecord, UserTodo } from '../hooks/todo-format'
import { cellWidth } from '../hooks/band-format'
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

/** The field an edit of item `id` draws: its key is new to each edit (`todo-edit-<id>-…`). */
async function editField(ui: { findAll: (query: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]> }, id: number) {
  return (await ui.findAll({ type: 'Input' })).find(found => found.key?.startsWith(`todo-edit-${id}-`) === true)
}

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
  expect(removeItem(record, 2, NOW)?.items.map(one => one.id)).toEqual([1])
  expect(removeItem(record, 9, NOW)).toBeNull()
  expect(clearDone(record, NOW).items.map(one => one.id)).toEqual([1])
})

test('the tab shows twelve at most, fewer in fewer rows with a row for "외 N개"', () => {
  // Items, then the footer: "완료 N개 지우기", "↶ 되돌리기", the field.
  expect(footerRows(1, 0, true)).toBe(2)
  expect(footerRows(2, 3, true)).toBe(3)
  expect(footerRows(0, 0, false)).toBe(0)
  expect(todoRows(3, footerRows(1, 0, true))).toBe(5)
  expect(todoRows(0, footerRows(0, 0, true))).toBe(2)
  expect(todoRows(20, footerRows(0, 0, false))).toBe(13)
  expect(todosShown(3, 10, footerRows(1, 0, true))).toBe(3)
  expect(todosShown(20, 40, footerRows(0, 0, true))).toBe(12)
  // Six rows less the field and "지우기": four, one of them "외 N개".
  expect(todosShown(20, 6, footerRows(2, 0, true))).toBe(3)
  expect(todosShown(20, 1, footerRows(2, 0, true))).toBe(1)
})

test('the lists say each item, the model\'s with ids and the answers it was written and taken up in', () => {
  const list = [
    item(1, 'done', { turn: 9, turnSession: 'old' }),
    item(2, 'pending', { createdTurn: 3, createdSession: 'old' }),
    item(3, 'in_progress', { createdTurn: 12, createdSession: 'now', turn: 14, turnSession: 'now' }),
    item(4, 'on_hold'),
  ]
  expect(todoListText(list)).toBe(['할 일: 진행 1 · 대기 1 · 보류 1 · 완료 1', '3. ⏳ 일 3  #14', '2. 📌 일 2', '4. 💤 일 4', '1. ✅ 일 1  #9', TODO_USAGE].join('\n'))
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
  expect(await todo($, '')).toBe(`할 일: 대기 1\n1. 📌 로그 정리하기\n${TODO_USAGE}`)
  expect(await todo($, '   ')).toBe(`할 일: 대기 1\n1. 📌 로그 정리하기\n${TODO_USAGE}`)
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

  expect(standIn.commands.find(command => command.name === 'todo')).toMatchObject({ immediate: true, argumentHint: '[내용 | 수정 <번호> <내용> | 휴지통 | 복원 <번호>]' })
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
  expect((await ui.find({ key: 'todo-2' }))?.text).toBe('⏳ 일 2 #3 ✕ ')
  expect((await ui.find({ key: 'todo-1' }))?.text).toBe('📌 일 1 ↗  ✕ ')
  expect((await ui.find({ key: 'todo-3' }))?.text).toBe('✅ 일 3 #2 ✕ ')
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
  expect((await ui.find({ key: 'todo-1' }))?.text).toBe('⏳ 일 1 ✕ ')
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
  expect((await ui.find({ key: 'todo-1' }))?.text).toBe('⏳ 인증 버그 고치기 #2 ✕ ')
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

// The field is drawn only where `$.ui.resolve` hands an `Input` (the mobile table had none). The
// 2.1.318 kit hands every surface the whole table, mobile too, and a test cannot rewrite it (the
// engine raises no `ui.resolve`): the tab is checked on mobile, the field's absence no longer.
test('the tab draws on mobile; a folded box unfolds on a press of a tab', async ($, on) => {
  standInForEngine(on)
  memoryStore(on, { sidebarFolded: ['contents'], [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile', props: PANE_PROPS })
  expect((await ui.find({ key: 'box-contents' }))?.text).toMatch(/^╶── ▸ 목차 0 │ 할 일 1 ─+$/)
  await ui.press({ key: 'tab-todo' })
  expect(await ui.find({ key: 'todo-1' })).toBeDefined()
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

test('a row: an emoji sign in its own colours, ↗ and ✕ three cells each, the text cut to the width', async ($, on) => {
  standInForEngine(on)
  memoryStore(on, {
    sidebarTab: 'todo',
    [KEY]: { items: [item(1, 'pending', { text: '긴 '.repeat(60) }), item(2, 'done', { turn: 4 }), item(3, 'on_hold')], nextId: 4 },
  })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // A space each side inside the button: three cells to press, the sign in the middle of the focus mark.
  expect((await ui.find({ key: 'todo-send-1' }))?.text).toBe(' ↗ ')
  expect((await ui.find({ key: 'todo-delete-1' }))?.text).toBe(' ✕ ')
  expect((await ui.find({ key: 'todo-status-1' }))?.text).toBe('📌')
  // An emoji keeps its colours: no dim, no colour on the sign; a done or held item dims its text.
  for (const sign of ['✅', '💤']) expect((await ui.find({ type: 'Text', text: sign }))?.props).toEqual({})
  expect((await ui.find({ type: 'Text', text: ' 일 2' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: ' 일 3' }))?.props.dimColor).toBe(true)
  // The sign's two cells counted: the row stays within the box's 52, a cell before the tail.
  const row = (await ui.find({ key: 'todo-1' }))?.text ?? ''
  expect(row.endsWith('… ↗  ✕ ')).toBe(true)
  // The tail as the width is counted: ` #N`, then ` ↗ ` and ` ✕ `.
  expect([item(1, 'pending'), item(2, 'in_progress', { turn: 3 }), item(3, 'done', { turn: 12 }), item(4, 'on_hold', { turn: 5 })].map(rowTailCells)).toEqual([6, 6, 7, 3])
  expect(cellWidth(row)).toBeLessThanOrEqual(52 - 1)
  expect(cellWidth(row)).toBeGreaterThanOrEqual(52 - 2)
  await ui.unmount()
})

// ── Trash, undo, edit ─────────────────────────────────────────────

test('a delete moves items to the trash as they were; restored, they come back so; the trash keeps the last fifty', () => {
  const record: TodoRecord = { items: [item(1, 'pending'), item(2, 'done', { turn: 4, turnSession: 's' }), item(3, 'done')], nextId: 4 }
  const one = removeItem(record, 2, NOW + 1)
  expect(one?.items.map(other => other.id)).toEqual([1, 3])
  expect(one?.trash).toEqual([{ ...item(2, 'done', { turn: 4, turnSession: 's' }), deletedAt: NOW + 1 }])
  const both = clearDone(record, NOW + 2)
  expect(both.items.map(other => other.id)).toEqual([1])
  expect(both.trash?.map(other => [other.id, other.status, other.deletedAt])).toEqual([
    [2, 'done', NOW + 2],
    [3, 'done', NOW + 2],
  ])

  const back = restoreItems(both, [2, 9])
  expect(back?.restored).toEqual([item(2, 'done', { turn: 4, turnSession: 's' })])
  expect(back?.record.items.map(other => other.id)).toEqual([1, 2])
  expect(back?.record.trash?.map(other => other.id)).toEqual([3])
  expect(restoreItems(both, [9])).toBeNull()
  // No room past 200: left in the trash.
  const full: TodoRecord = { items: Array.from({ length: MAX_TODOS }, (_, i) => item(i + 10, 'pending')), nextId: 300, trash: [{ ...item(5, 'done'), deletedAt: NOW }] }
  expect(restoreItems(full, [5])).toBeNull()

  // Fifty kept, the oldest gone; read back, ids past the trash's too, an item's id not twice.
  let many: TodoRecord = { items: Array.from({ length: 60 }, (_, i) => item(i + 1, 'pending')), nextId: 61 }
  for (let id = 1; id <= 60; id += 1) many = removeItem(many, id, NOW + id) ?? many
  expect(many.trash?.length).toBe(MAX_TRASH)
  expect(many.trash?.[0]?.id).toBe(11)
  const read = parseTodoRecord({ items: [item(1, 'pending')], nextId: 2, trash: [{ ...item(1, 'done'), deletedAt: 5 }, { ...item(70, 'on_hold'), deletedAt: 6 }, { id: 'x' }] })
  expect(read.trash).toEqual([{ ...item(70, 'on_hold'), deletedAt: 6 }])
  expect(read.nextId).toBe(71)
  expect(parseTodoRecord({ items: [], nextId: 1 }).trash).toBeUndefined()

  expect(editItem(record, 2, '고친 일')?.items[1]).toEqual(item(2, 'done', { text: '고친 일', turn: 4, turnSession: 's' }))
  expect(editItem(record, 9, 'x')).toBeNull()
})

test('never "외 1개": its row shows the item; the to-do tab keeps its footer and a few items however short the pane', () => {
  expect(todosShown(2, 3, 2)).toBe(2)
  expect(todosShown(13, 40, 0)).toBe(13)
  expect(todosShown(5, 4, 1)).toBe(2)
  expect(todoLeastRows(2, 2)).toBe(4)
  expect(todoLeastRows(0, 1)).toBe(2)
  expect(todoLeastRows(9, 3)).toBe(6)
  expect(shareRows(10, 40, 4, 3, 4)).toEqual({ files: 6, toc: 4 })
  expect(shareRows(6, 40, 4, 3, 4)).toEqual({ files: 3, toc: 4 })
})

test('the trash and /todo list as text, each by its number', () => {
  const at = new Date(2026, 10, 4, 15, 30).getTime()
  expect(trashListText([{ ...item(2, 'done'), deletedAt: at }, { ...item(5, 'pending'), deletedAt: at + 60_000 }])).toBe(
    ['휴지통 2개 (최근 50개까지):', '5. 📌 일 5 · 11-04 15:31 지움', '2. ✅ 일 2 · 11-04 15:30 지움', '되살리기: /todo 복원 <번호>'].join('\n'),
  )
  expect(trashListText([])).toBe('휴지통이 비어 있습니다.')
  expect(todoListText([])).toBe(`적어 둔 할 일이 없습니다.\n${TODO_USAGE}`)
  expect(TODO_USAGE).toContain('/todo 수정 <번호> <내용>')
  expect(TODO_USAGE).toContain('/todo 휴지통')
  expect(TODO_USAGE).toContain('/todo 복원 <번호>')
})

test('with two items in a tall pane both show, the files expanded beside them or not (2026-11-04: one and "외 1개")', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending'), item(2, 'done')], nextId: 3 } })
  await start($)
  for (let i = 0; i < 73; i += 1) {
    await $.turn.start({ text: `질문 ${i}`, turnId: `t${i}` })
    await $.tool.call({ tool: 'Write', file_path: `/repo/hubblerc/f${i}.ts`, content: 'x\n' })
    await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: `t${i}`, durationMs: 1000 })
  }
  await standIn.clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await rowKeys(ui)).toEqual(['todo-1', 'todo-2'])
  await ui.press({ key: 'inside-more' })
  expect(await rowKeys(ui)).toEqual(['todo-1', 'todo-2'])
  expect(await ui.find({ type: 'Text', text: /^외 \d+개$/ })).toBeUndefined()
  expect(await ui.find({ key: 'todo-clear-done' })).toBeDefined()
  await ui.unmount()

  const short = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 30 } } })
  expect(await rowKeys(short)).toEqual(['todo-1', 'todo-2'])
  await short.unmount()
})

test('✕ and "완료 N개 지우기" leave "↶ 되돌리기 (N개)"; it brings them back as they were, and goes with the next change, ↗ or session', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending'), item(2, 'done', { turn: 3 }), item(3, 'done'), item(4, 'pending')], nextId: 5 } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'todo-undo' })).toBeUndefined()

  await ui.press({ key: 'todo-clear-done' })
  expect(items(stored).map(one => one.id)).toEqual([1, 4])
  expect((await ui.find({ key: 'todo-undo' }))?.text).toBe('↶ 되돌리기 (2개)')
  await ui.press({ key: 'todo-undo' })
  expect(items(stored).map(one => [one.id, one.status, one.turn])).toEqual([
    [1, 'pending', undefined],
    [4, 'pending', undefined],
    [2, 'done', 3],
    [3, 'done', undefined],
  ])
  expect(parseTodoRecord(stored[KEY]).trash).toBeUndefined()
  expect(await ui.find({ key: 'todo-undo' })).toBeUndefined()

  // The next change takes it away: a status, a write, ↗.
  await ui.press({ key: 'todo-delete-1' })
  expect((await ui.find({ key: 'todo-undo' }))?.text).toBe('↶ 되돌리기 (1개)')
  await ui.press({ key: 'todo-status-4' })
  expect(await ui.find({ key: 'todo-undo' })).toBeUndefined()
  await ui.press({ key: 'todo-delete-2' })
  await ui.input({ key: 'todo-input', text: '새 일' })
  expect(await ui.find({ key: 'todo-undo' })).toBeUndefined()
  await ui.press({ key: 'todo-delete-3' })
  await ui.press({ key: 'todo-send-5' })
  expect(await ui.find({ key: 'todo-undo' })).toBeUndefined()
  await ui.unmount()

  // A new session starts without it.
  await ui.unmount().catch(() => undefined)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await again.press({ key: 'todo-delete-5' })
  expect(await again.find({ key: 'todo-undo' })).toBeDefined()
  await again.unmount()
  await start($)
  const later = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await later.find({ key: 'todo-undo' })).toBeUndefined()
  await later.unmount()
})

test('/todo 휴지통 lists what was deleted; /todo 복원 <번호> brings one back; neither takes a word for a number', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { [KEY]: { items: [item(1, 'pending')], nextId: 3, trash: [{ ...item(2, 'in_progress', { turn: 6 }), deletedAt: NOW }] } })
  await start($)

  expect(await todo($, '휴지통')).toMatch(/^휴지통 1개 \(최근 50개까지\):\n2\. ⏳ 일 2 · \d\d-\d\d \d\d:\d\d 지움\n되살리기: \/todo 복원 <번호>$/)
  expect(await todo($, '복원 2')).toBe('되살렸습니다: 2. ⏳ 일 2')
  expect(items(stored).find(one => one.id === 2)).toMatchObject({ status: 'in_progress', turn: 6 })
  expect(await todo($, '휴지통')).toBe('휴지통이 비어 있습니다.')
  expect(await todo($, '복원 2')).toBe('휴지통에 2번이 없습니다. /todo 휴지통으로 번호를 보세요.')
  // Not a number: an item to write.
  expect(await todo($, '복원 버튼 만들기')).toBe('할 일에 적었습니다: 복원 버튼 만들기')
  expect(await todo($, '')).toContain('3. 📌 복원 버튼 만들기')
})

test('/todo 수정 <번호> <내용> rewrites an item, its status and answer kept; a missing number or text says why', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { [KEY]: { items: [item(1, 'done', { turn: 4 }), item(2, 'pending')], nextId: 3 } })
  await start($)

  expect(await todo($, '수정 1   더 나은 말로  ')).toBe('고쳤습니다: 1. 더 나은 말로')
  expect(items(stored)[0]).toEqual(item(1, 'done', { turn: 4, text: '더 나은 말로' }))
  expect(await todo($, '수정 9 무엇')).toBe('9번 할 일이 없습니다. /todo로 번호를 보세요.')
  expect(await todo($, '수정 2')).toBe('새 내용이 없습니다: /todo 수정 2 <내용>')
  expect(await todo($, `수정 2 ${'가'.repeat(600)}`)).toMatch(/\(500자가 넘어 앞부분만\)$/)
  expect([...(items(stored)[1]?.text ?? '')]).toHaveLength(500)
  // No number: an item to write.
  expect(await todo($, '수정 버튼 색')).toBe('할 일에 적었습니다: 수정 버튼 색')
})

test('a press on an item\'s text edits it below: Enter saves, empty cancels, the pane letting the keyboard go cancels', async ($, on) => {
  standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'in_progress', { turn: 2 }), item(2, 'pending')], nextId: 3 } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await ui.find({ key: 'todo-input' })).toBeDefined()

  await ui.press({ key: 'todo-text-1' })
  const field = await editField(ui, 1)
  expect(field?.props).toMatchObject({ value: '일 1', label: '수정 중 ', submitLabel: '저장' })
  expect(await ui.find({ key: 'todo-input' })).toBeUndefined()
  // The row edited stands out.
  expect((await ui.find({ type: 'Text', text: ' 일 1' }))?.props).toMatchObject({ bold: true })
  // The rows the tab takes do not change: the field is the same row.
  expect(await rowKeys(ui)).toEqual(['todo-1', 'todo-2'])

  await ui.input({ key: (await editField(ui, 1))?.key ?? '', text: '고친 일 1' })
  expect(items(stored)[0]).toEqual(item(1, 'in_progress', { turn: 2, text: '고친 일 1' }))
  expect(await editField(ui, 1)).toBeUndefined()
  expect(await ui.find({ key: 'todo-input' })).toBeDefined()

  // Empty: cancelled, nothing written.
  await ui.press({ key: 'todo-text-2' })
  await ui.input({ key: (await editField(ui, 2))?.key ?? '', text: '   ' })
  expect(items(stored)[1]?.text).toBe('일 2')
  expect(await editField(ui, 2)).toBeUndefined()

  // Esc hands the keyboard back: the pane, having held it, drawn without it cancels.
  await ui.press({ key: 'todo-text-2' })
  await ui.redraw({ ...PANE_PROPS, isFocused: true })
  expect(await editField(ui, 2)).toBeDefined()
  await ui.redraw({ ...PANE_PROPS, isFocused: false })
  expect(await editField(ui, 2)).toBeUndefined()
  expect(await ui.find({ key: 'todo-input' })).toBeDefined()
  expect(items(stored)[1]?.text).toBe('일 2')

  // An edit whose item is deleted ends.
  await ui.press({ key: 'todo-text-2' })
  await ui.press({ key: 'todo-delete-2' })
  expect(await editField(ui, 2)).toBeUndefined()
  await ui.unmount()
})

// ── The store watched ─────────────────────────────────────────────

test('SHA-256 as the engine names a plugin\'s store file by its id', () => {
  expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  // The files on the Mac it was found on (2026-11-04).
  expect(storeFileName('hubblerc@inline')).toBe('hubblerc_inline-c039cadca8b5.json')
  expect(storeFileName('hubblerc@hubblerc')).toBe('hubblerc_hubblerc-3be9b6e2c135.json')
  expect(pluginId('hubblerc', '/Users/me/.claude/plugins/cache/hubblerc/hubblerc/0.10.0')).toBe('hubblerc@hubblerc')
  expect(pluginId('hubblerc', '/Users/me/vault/project/hubblerc/plugins/hubblerc')).toBe('hubblerc@inline')
})

test('the store file is watched; another session\'s change to it shows at once, no answer needed', async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  mock.env(on, { HOME: '/home/me' })
  const file = '/home/me/.claude/plugins/store/hubblerc_inline-c039cadca8b5.json'
  standIn.existing.push(file)
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  await start($)

  const started = await $.classic.SessionStart({ source: 'startup', cwd: '/repo/hubblerc', transcript_path: '/home/me/.claude/projects/x/session-1.jsonl' } as never)
  expect((started as { watchPaths?: string[] }).watchPaths).toEqual(['/repo/hubblerc/.git/HEAD', '/repo/hubblerc/.git/index', '/repo/hubblerc/.git/logs/HEAD', file])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'tab-todo' }))?.text).toBe('할 일 1')
  stored[KEY] = { items: [item(1, 'pending'), item(2, 'pending')], nextId: 3 }
  // Another file changing reads nothing.
  await $.classic.FileChanged({ file_path: '/home/me/other.json', event: 'change' } as never)
  await standIn.clock.settle()
  expect((await ui.find({ key: 'tab-todo' }))?.text).toBe('할 일 1')
  await $.classic.FileChanged({ file_path: file, event: 'change' } as never)
  await standIn.clock.settle()
  expect((await ui.find({ key: 'tab-todo' }))?.text).toBe('할 일 2')
  await ui.unmount()
})

test('where the named store file is not there, the plugin\'s files in the store folder are watched', async ($, on) => {
  standInForEngine(on)
  memoryStore(on, {})
  mock.env(on, { HOME: '/home/me' })
  on('fs.list', (_, e) => ({
    value: ['hubblerc_local-0123456789ab.json', 'other_market-0123456789ab.json', 'hubblerc_notes.txt'].map(name => ({ name, kind: 'file' as const, size: 2, mtimeMs: 0, isLink: false })),
  }))
  on('classic.SessionStart', () => ({}))
  await start($)
  const started = await $.classic.SessionStart({ source: 'startup', cwd: '/repo/hubblerc', transcript_path: '/home/me/.claude/projects/x/session-1.jsonl' } as never)
  expect((started as { watchPaths?: string[] }).watchPaths?.slice(3)).toEqual(['/home/me/.claude/plugins/store/hubblerc_local-0123456789ab.json'])
})

// ── The keyboard to the edit field in one press ───────────────────
// The 2.1.318 kit does not hand `$.ui.focus` to a test's hook ("no implementation for ui.focus", the
// hook never called): the move itself cannot be stood in. What is checked: the open asking the
// keyboard, its arguments and when it is made, and what `/todo` says when the move fails.

const SIDEBAR_PANE = { id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true }

/** The last line `/todo` writes. */
async function lastLine($: Engine): Promise<string> {
  return (await todo($, ''))?.split('\n').at(-1) ?? ''
}

test('a press on an item\'s text asks the keyboard for the pane (same title and width, nothing else) before moving it to the field', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  await start($)
  standIn.panes = [{ ...SIDEBAR_PANE }]
  const opensAtStart = standIn.opened.length

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'todo-text-1' })
  expect(standIn.opened.slice(opensAtStart)).toEqual([{ id: 'hubblerc', title: 'hubblerc', columns: 56, focus: true }])
  expect(standIn.panes).toEqual([{ ...SIDEBAR_PANE, isFocused: true }])
  // The pane got the keyboard: a failure here could only be the move's own.
  expect(await lastLine($)).not.toContain('패널이 키보드를 받지 못함')
  expect(await editField(ui, 1)).toBeDefined()
  await ui.unmount()
})

test('a pane that holds the keyboard already is not opened again', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  await start($)
  standIn.panes = [{ ...SIDEBAR_PANE, isFocused: true }]
  const opensAtStart = standIn.opened.length

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, isFocused: true } })
  await ui.press({ key: 'todo-text-1' })
  expect(standIn.opened.length).toBe(opensAtStart)
  expect(await editField(ui, 1)).toBeDefined()
  await ui.unmount()
})

test('the keyboard refused (text in the prompt box): the edit stays open, unfocused, and /todo says why at its end', async ($, on) => {
  const standIn = standInForEngine(on)
  memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  standIn.grantsFocus = false
  await start($)
  standIn.panes = [{ ...SIDEBAR_PANE }]

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'todo-text-1' })
  expect(standIn.opened.at(-1)).toEqual({ id: 'hubblerc', title: 'hubblerc', columns: 56, focus: true })
  // Drawn without the keyboard it never held: not a cancel.
  await ui.redraw(PANE_PROPS)
  expect(await editField(ui, 1)).toBeDefined()
  expect(await lastLine($)).toMatch(/^\(디버그\) 수정 칸으로 키보드를 옮기지 못함 \d\d:\d\d: .+ \(패널이 키보드를 받지 못함: .*\)$/)
  // A second press, on the field: the person's own, the pane takes the keyboard; leaving it then cancels.
  await ui.redraw({ ...PANE_PROPS, isFocused: true })
  await ui.redraw(PANE_PROPS)
  expect(await editField(ui, 1)).toBeUndefined()
  await ui.unmount()
})

test('editing an item again after saving it draws a field new to the engine, filled with the saved text', async ($, on) => {
  const standIn = standInForEngine(on)
  const stored = memoryStore(on, { sidebarTab: 'todo', [KEY]: { items: [item(1, 'pending')], nextId: 2 } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })

  await ui.press({ key: 'todo-text-1' })
  const first = await editField(ui, 1)
  expect(first?.props.value).toBe('일 1')
  await ui.input({ key: first?.key ?? '', text: '고친 일' })
  expect(items(stored)[0]?.text).toBe('고친 일')

  // The same item again, the clock not moved: another key all the same, and the saved text in it.
  await ui.press({ key: 'todo-text-1' })
  const second = await editField(ui, 1)
  expect(second?.key).not.toBe(first?.key)
  expect(second?.props.value).toBe('고친 일')
  // Empty Enter cancels; the next edit is a new field too.
  await ui.input({ key: second?.key ?? '', text: '' })
  await standIn.clock.advance(1000)
  await ui.press({ key: 'todo-text-1' })
  const third = await editField(ui, 1)
  expect([first?.key, second?.key]).not.toContain(third?.key)
  expect(third?.props.value).toBe('고친 일')
  // The field that writes a new item keeps its one key: it draws no value to lose.
  expect((await ui.findAll({ type: 'Input' })).map(found => found.key)).toEqual([third?.key])
  await ui.input({ key: third?.key ?? '', text: '' })
  expect((await ui.findAll({ type: 'Input' })).map(found => found.key)).toEqual(['todo-input'])
  await ui.unmount()
})
