import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  addItem,
  cleanTodoText,
  clearDone,
  isStatus,
  MAX_TODOS,
  nextStatus,
  oneLine,
  parseTodoRecord,
  removeItem,
  setItemStatus,
  todoListText,
  todoStoreKey,
  todoToolList,
} from './todo-format'
import type { SidebarTab, TodoRecord, TurnRef, UserTodo, UserTodoStatus } from './todo-format'
import { clipCells } from './sidebar-format'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const sidebarTab = atom({ plugin: 'hubblerc', key: 'sidebarTab' } as const, 'contents')
const userTodoVersion = atom({ plugin: 'hubblerc', key: 'userTodoVersion' } as const, 0)

/** Where the sidebar's tab is kept across sessions. */
const TAB_KEY = 'sidebarTab'
/** The model's tool, as registered; the engine lists it as `mcp__hubblerc__user_todos`, the name its calls carry. */
const TOOL_NAME = 'user_todos'
const TODO_TOOL_PATTERN = /^mcp__hubblerc__user_todos$/
const TOOL_DESCRIPTION =
  "The user's own to-do and idea list for this project, kept apart from your task tools. Use it when the user asks about their to-dos or ideas. " +
  'list: each item with its id, status, text and the answer (#N) it was written in. add: append text. set_status: change one by id; set done when you finish one.'

/**
 * The project's list as last read, and the store key it was read under. Kept in the module, not in
 * state: up to 200 texts of 500 characters, and the sidebar reads state every second. A drawing
 * reads `userTodoVersion`, bumped on each change, to be drawn again.
 */
let loaded: { key: string; record: TodoRecord; signature: string } | null = null

/**
 * The last item offered in the prompt box by its ↗, till the next question: sent as offered, it is
 * taken up by that answer; sent otherwise, the offer is forgotten.
 */
let offered: { id: number; text: string } | null = null

/** At session.start: the tab chosen in an earlier session, the project's list, and the model's tool. */
export async function startTodos($: EngineInterface): Promise<void> {
  loaded = null
  offered = null
  const tab = await $.store.get(TAB_KEY).catch(() => undefined)
  if (tab === 'contents' || tab === 'todo') await update($, sidebarTab, () => tab)
  await refreshTodos($).catch(() => undefined)
  await $.tool
    .register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'set_status'] },
          id: { type: 'integer', description: 'set_status: the item' },
          text: { type: 'string', description: 'add: the item' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'on_hold'], description: 'set_status: the new status' },
        },
        required: ['action'],
      },
    })
    .catch(() => undefined)
}

/**
 * Reads the project's list again: another session may have changed it. At session.start, as a
 * main-loop answer starts, on a press of a tab, and on the 30-second tick while the sidebar shows.
 */
export async function refreshTodos($: EngineInterface): Promise<void> {
  const key = todoStoreKey(await $.session.root())
  await keep($, key, parseTodoRecord(await $.store.get(key)))
}

/** The list for a drawing, read from the store when the module has none (a fresh copy of it). */
export async function todosForDrawing($: EngineInterface): Promise<UserTodo[]> {
  if (loaded === null) {
    try {
      const key = todoStoreKey(await $.session.root())
      const record = parseTodoRecord(await $.store.get(key))
      // No state is written while drawing: the module keeps it, the next change bumps the version.
      loaded = { key, record, signature: JSON.stringify(record) }
    } catch {
      return []
    }
  }

  return loaded.record.items
}

/** Keeps a record read or written, and redraws the readers when it changed. */
async function keep($: EngineInterface, key: string, record: TodoRecord): Promise<void> {
  const signature = JSON.stringify(record)
  if (loaded !== null && loaded.key === key && loaded.signature === signature) return
  loaded = { key, record, signature }
  await update($, userTodoVersion, n => n + 1)
}

/**
 * A change, made on the list as the store holds it now (another session may have written since it
 * was read), then written back. `change` answers null to leave the list as it is.
 */
async function changeTodos($: EngineInterface, change: (record: TodoRecord) => TodoRecord | null): Promise<TodoRecord | null> {
  const key = todoStoreKey(await $.session.root())
  const current = parseTodoRecord(await $.store.get(key))
  const next = change(current)
  if (next === null) {
    await keep($, key, current)

    return null
  }
  await $.store.set(key, next)
  await keep($, key, next)

  return next
}

/** The answer running now, or the last one, by its number in this session; 0 before the first. */
async function currentTurn($: EngineInterface): Promise<TurnRef> {
  const list = await read($, turns)
  const session = await $.session.id().catch(() => '')

  return { turn: list.length, session }
}

type AddOutcome = { item: UserTodo; isClipped: boolean } | { error: 'empty' | 'full' }

/** Writes a new waiting item, with when and in which answer it was written. */
export async function addTodo($: EngineInterface, text: string): Promise<AddOutcome> {
  const cleaned = cleanTodoText(text)
  if (cleaned.text === '') return { error: 'empty' }
  const written = await currentTurn($)
  const at = await $.clock.now()
  const added: { item?: UserTodo } = {}
  await changeTodos($, record => {
    const result = addItem(record, cleaned.text, at, written)
    if (result !== null) added.item = result.item

    return result?.record ?? null
  })

  return added.item === undefined ? { error: 'full' } : { item: added.item, isClipped: cleaned.isClipped }
}

const FULL_TEXT = `할 일이 ${MAX_TODOS}개라 더 적을 수 없습니다. 완료한 것을 지운 뒤 적어 주세요.`

/** A press's or a field's change: a failure (the store full or unreadable) said in a toast, not lost. */
async function pressed($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  await work().catch((error: unknown) => {
    $.ui.toast(`할 일을 저장하지 못했습니다: ${String(error)}`)
  })
}

/** The sidebar's field, on Enter: a new item; a refusal as a toast (the field is emptied either way). */
export async function addTodoFromField($: EngineInterface, text: string): Promise<void> {
  await pressed($, async () => {
    const outcome = await addTodo($, text)
    if ('item' in outcome) {
      if (outcome.isClipped) $.ui.toast('500자가 넘어 앞부분만 적었습니다.')

      return
    }
    if (outcome.error === 'full') $.ui.toast(FULL_TEXT)
  })
}

/** `/todo 내용` writes an item; `/todo` alone lists them. */
export async function runTodoCommand($: EngineInterface, args: string): Promise<string> {
  if (args.trim() === '') {
    await refreshTodos($)

    return todoListText(loaded?.record.items ?? [])
  }
  const outcome = await addTodo($, args)
  if ('error' in outcome) return outcome.error === 'full' ? FULL_TEXT : '적을 내용이 없습니다.'

  return `할 일에 적었습니다: ${clipCells(oneLine(outcome.item.text), 60)}${outcome.isClipped ? ' (500자가 넘어 앞부분만)' : ''}`
}

/** A press on an item's sign: its next status. A press sets no answer number. */
export async function cycleTodo($: EngineInterface, id: number): Promise<void> {
  await pressed($, () =>
    changeTodos($, record => {
      const item = record.items.find(other => other.id === id)

      return item === undefined ? null : setItemStatus(record, id, nextStatus(item.status))
    }),
  )
}

export async function deleteTodo($: EngineInterface, id: number): Promise<void> {
  await pressed($, () => changeTodos($, record => removeItem(record, id)))
}

/** "완료 N개 지우기". */
export async function clearDoneTodos($: EngineInterface): Promise<void> {
  await pressed($, () => changeTodos($, record => (record.items.some(item => item.status === 'done') ? clearDone(record) : null)))
}

/**
 * ↗ on a waiting item: offered as the prompt box's dim suggestion, Tab to take. The box takes it
 * only while it is empty and no answer runs; else a toast says so.
 */
export async function offerTodo($: EngineInterface, item: UserTodo): Promise<void> {
  const shown = await $.prompt.suggest({ text: item.text }).catch(() => ({ isShown: false }))
  if (shown.isShown) {
    offered = { id: item.id, text: item.text }

    return
  }
  $.ui.toast('입력창이 비어 있고 답변이 진행 중이 아닐 때만 입력창에 넣을 수 있습니다.')
}

/**
 * At a main-loop turn's start, after its record opened: the list read again, and an item offered by
 * its ↗ and sent as offered is taken up by this answer (in progress, its number).
 */
export async function startTodoTurn($: EngineInterface, text: string): Promise<void> {
  const pending = offered
  offered = null
  if (pending === null || text.trim() !== pending.text.trim()) {
    await refreshTodos($)

    return
  }
  const taken = await currentTurn($)
  await changeTodos($, record => setItemStatus(record, pending.id, 'in_progress', taken))
}

/** A press on a tab: kept for the next session, and the list read again. */
export async function selectTab($: EngineInterface, tab: SidebarTab): Promise<void> {
  await update($, sidebarTab, () => tab)
  await $.store.set(TAB_KEY, tab).catch(() => undefined)
  await refreshTodos($).catch(() => undefined)
}

/**
 * The model's tool: `list`, `add`, and `set_status`, which sets the answer it runs in on an item
 * it takes up or finishes. A call it cannot do is refused with the reason.
 */
export function serveTodoTool(on: On): void {
  // A pattern: the types list a registered tool's name only once this machine's session has loaded it.
  on('tool.call', { tool: TODO_TOOL_PATTERN }, async ($, e) => {
    try {
      return await answerTodoTool($, e as unknown as Record<string, unknown>)
    } catch (error) {
      return { deny: `The user's to-do list could not be read or written: ${String(error)}` }
    }
  }).catch(() => ({ deny: "The user's to-do list could not be read or written." }))
}

/** What the tool answers a call: the text the model reads, or why it was refused. */
export async function answerTodoTool($: EngineInterface, input: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const action = input.action
  if (action === 'list') {
    await refreshTodos($)

    return { result: todoToolList(loaded?.record.items ?? [], await currentTurn($)) }
  }
  if (action === 'add') {
    if (typeof input.text !== 'string') return { deny: 'add needs text.' }
    const outcome = await addTodo($, input.text)
    if ('error' in outcome) return { deny: outcome.error === 'full' ? `The list is full (${MAX_TODOS} items).` : 'add needs a non-empty text.' }

    return { result: `Added id ${outcome.item.id}${outcome.isClipped ? ' (cut to its first 500 characters)' : ''}.` }
  }
  if (action === 'set_status') {
    const id = input.id
    const status: unknown = input.status
    if (typeof id !== 'number' || !Number.isInteger(id)) return { deny: 'set_status needs an integer id.' }
    if (!isStatus(status)) return { deny: 'set_status needs status: pending, in_progress, done or on_hold.' }
    const taken = await currentTurn($)
    const changed = await changeTodos($, record => setItemStatus(record, id, status as UserTodoStatus, taken))
    if (changed === null) return { deny: `No item has id ${id}.` }

    return { result: `id ${id} is now ${status}.` }
  }

  return { deny: 'action must be list, add or set_status.' }
}
