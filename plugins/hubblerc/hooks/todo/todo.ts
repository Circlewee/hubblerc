import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  addItem,
  cleanTodoText,
  clearDone,
  draftInsertText,
  editItem,
  isStatus,
  MAX_TODOS,
  nextStatus,
  oneLine,
  parseTodoRecord,
  removeItem,
  restoreItems,
  setItemStatus,
  STATUS_MARK,
  todoListText,
  todoStoreKey,
  todoToolList,
  trashListText,
} from './todo-format'
import type { SidebarTab, TodoRecord, TurnRef, UserTodo, UserTodoStatus } from './todo-format'
import { askSidebarKeyboard, SIDEBAR_ID } from '../shared/pane'
import { clipCells } from '../sidebar/sidebar-format'

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
 * The last item ↗ put in the prompt box, till the next main-loop question, and how. `isInDraft`
 * false: as the box's dim suggestion, taken up by a question of its text alone. True: put into the
 * person's draft at the cursor, taken up by a question that holds its text. Sent otherwise (the item
 * erased or edited), the offer is forgotten.
 */
let offered: { id: number; text: string; isInDraft: boolean } | null = null

/**
 * The items the last ✕ or "완료 N개 지우기" moved to the trash, by their project's key: what
 * "↶ 되돌리기" brings back. Gone on the next change to the list made in this session (a write, a
 * status, a delete, an edit), on ↗, and with the session. The module's, not state: a press writes it.
 */
let undo: { key: string; ids: number[] } | null = null

/**
 * The item the sidebar's field edits, by its project's key and id, and the key of the field this edit
 * draws; `sawFocus` once a drawing found the pane holding the keyboard. Esc never reaches a pane's
 * field (it hands the keyboard back), so the pane losing the keyboard while editing is the cancel: a
 * click elsewhere cancels too. Gone with a reload or the item.
 */
let editing: { key: string; id: number; field: string; sawFocus: boolean } | null = null
/** Edits started since the module loaded: with the time, what makes each edit's field key new. */
let edits = 0

/** At session.start: the tab chosen in an earlier session, the project's list, and the model's tool. */
export async function startTodos($: EngineInterface): Promise<void> {
  loaded = null
  offered = null
  undo = null
  editing = null
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

/** The project's items as the store holds them now. */
export async function currentTodos($: EngineInterface): Promise<UserTodo[]> {
  await refreshTodos($)

  return loaded?.record.items ?? []
}

/** Keeps a record read or written, and redraws the readers when it changed. */
async function keep($: EngineInterface, key: string, record: TodoRecord): Promise<void> {
  const signature = JSON.stringify(record)
  if (loaded !== null && loaded.key === key && loaded.signature === signature) return
  loaded = { key, record, signature }
  await update($, userTodoVersion, n => n + 1)
}

/** Draws the readers again: what the module keeps beside the list (the undo, the edit, a suggestion) changed. */
export async function redrawTodos($: EngineInterface): Promise<void> {
  await redraw($)
}

async function redraw($: EngineInterface): Promise<void> {
  await update($, userTodoVersion, n => n + 1)
}

/**
 * A change, made on the list as the store holds it now (another session may have written since it
 * was read), then written back. `change` answers null to leave the list as it is. Any change takes
 * the undo away: the one a delete leaves is set after it.
 */
export async function changeTodos($: EngineInterface, change: (record: TodoRecord) => TodoRecord | null): Promise<TodoRecord | null> {
  const key = todoStoreKey(await $.session.root())
  const current = parseTodoRecord(await $.store.get(key))
  const next = change(current)
  if (undo !== null) {
    undo = null
    await redraw($)
  }
  if (next === null) {
    await keep($, key, current)

    return null
  }
  await $.store.set(key, next)
  await keep($, key, next)

  return next
}

/** The answer running now, or the last one, by its number in this session; 0 before the first. */
export async function currentTurn($: EngineInterface): Promise<TurnRef> {
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

/**
 * `/todo 내용` writes an item; `/todo` alone lists them. `/todo 수정 <번호> <내용>`, `/todo 휴지통` and
 * `/todo 복원 <번호>` only as written so: `/todo 수정 버튼 색` (no number) is an item to write.
 */
export async function runTodoCommand($: EngineInterface, args: string): Promise<string> {
  const text = args.trim()
  if (text === '') {
    await refreshTodos($)

    return todoListText(loaded?.record.items ?? [])
  }
  const [word = ''] = text.split(/\s/, 1)
  const rest = text.slice(word.length).trim()
  const numbered = /^(\d+)(?:\s+([\s\S]*))?$/.exec(rest)
  if (word === '휴지통' && rest === '') {
    await refreshTodos($)

    return trashListText(loaded?.record.trash ?? [])
  }
  if (word === '복원' && numbered !== null && numbered[2] === undefined) return restoreTodo($, Number(numbered[1]))
  if (word === '수정' && numbered !== null) {
    const id = Number(numbered[1])
    const outcome = await editTodo($, id, numbered[2] ?? '')
    if ('error' in outcome) return outcome.error === 'empty' ? `새 내용이 없습니다: /todo 수정 ${id} <내용>` : `${id}번 할 일이 없습니다. /todo로 번호를 보세요.`

    return `고쳤습니다: ${id}. ${clipCells(oneLine(outcome.item.text), 60)}${outcome.isClipped ? ' (500자가 넘어 앞부분만)' : ''}`
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

/** ✕: the item to the trash; "↶ 되돌리기" brings it back until the next change. */
export async function deleteTodo($: EngineInterface, id: number): Promise<void> {
  await pressed($, async () => {
    const at = await $.clock.now()
    if ((await changeTodos($, record => removeItem(record, id, at))) !== null) await leaveUndo($, [id])
  })
}

/** "완료 N개 지우기": the done items to the trash, "↶ 되돌리기" bringing them all back. */
export async function clearDoneTodos($: EngineInterface): Promise<void> {
  await pressed($, async () => {
    const at = await $.clock.now()
    const gone: number[] = []
    await changeTodos($, record => {
      gone.push(...record.items.filter(item => item.status === 'done').map(item => item.id))

      return gone.length > 0 ? clearDone(record, at) : null
    })
    if (gone.length > 0) await leaveUndo($, gone)
  })
}

async function leaveUndo($: EngineInterface, ids: number[]): Promise<void> {
  undo = { key: todoStoreKey(await $.session.root()), ids }
  await redraw($)
}

/** How many items "↶ 되돌리기" brings back for the list drawn; 0: no button. */
export function undoCount(): number {
  return undo !== null && loaded !== null && undo.key === loaded.key ? undo.ids.length : 0
}

/** "↶ 되돌리기": the items of the last delete back from the trash as they were. */
export async function undoDelete($: EngineInterface): Promise<void> {
  const pending = undo
  if (pending === null) return
  await pressed($, async () => {
    const back = await changeTodos($, record => restoreItems(record, pending.ids)?.record ?? null)
    if (back === null) $.ui.toast('되돌릴 항목이 휴지통에 없습니다(다른 세션에서 되살렸거나 목록이 가득 찼습니다).')
  })
}

/**
 * A press on an item's text: the field below edits it (filled with the text), and the keyboard moved
 * there in one press. A mouse press leaves the keys in the prompt, and `$.ui.focus` moves the ring of
 * a pane holding them only: so the pane asks for them first (`askSidebarKeyboard`). Refused (text in
 * the prompt box, a dialog), a second press on the field is still needed. The edit is not cancelled
 * meanwhile: it ends on the pane losing the keyboard only once it held it (`editTarget`).
 */
export async function startEditTodo($: EngineInterface, id: number): Promise<void> {
  const key = loaded?.key
  if (key === undefined) return
  edits += 1
  const field = `todo-edit-${id}-${(await $.clock.now()).toString(36)}-${edits}`
  editing = { key, id, field, sawFocus: false }
  await redraw($)
  await askSidebarKeyboard($).catch(() => undefined)
  // Refused, the field still takes a second press (the `/todo` line saying why went, 2026-11-06).
  await $.ui.focus({ requestId: SIDEBAR_ID, key: field }).catch(() => undefined)
}

/**
 * The key of the field the current edit draws ('' while none): a field of its own, so leaving the
 * edit draws the empty one afresh, and new to each edit. The engine keeps what a field holds by its
 * key, and a field Enter emptied came back empty over its `value` when the same item was edited again
 * under the same key (2026-11-05, on screen); a key it has not seen takes the `value`.
 */
export function editFieldKey(): string {
  return editing?.field ?? ''
}

/**
 * While drawing: the item the field edits, or null. The edit ends here, in the module, when its item
 * is gone, the project changed, or the pane, having held the keyboard, let it go (Esc, a click away).
 */
export function editTarget(items: readonly UserTodo[], isFocused: boolean): UserTodo | null {
  const current = editing
  const item = current !== null && loaded !== null && current.key === loaded.key ? items.find(other => other.id === current.id) : undefined
  if (current === null || item === undefined) {
    editing = null

    return null
  }
  if (isFocused) {
    current.sawFocus = true
  } else if (current.sawFocus) {
    editing = null

    return null
  }

  return item
}

/** The edit field, on Enter: the text saved (status and answers kept); empty, the edit cancelled. */
export async function saveEditFromField($: EngineInterface, id: number, value: string): Promise<void> {
  editing = null
  if (value.trim() === '') {
    await redraw($)

    return
  }
  await pressed($, async () => {
    const outcome = await editTodo($, id, value)
    if ('error' in outcome) $.ui.toast(outcome.error === 'missing' ? '고칠 항목이 목록에 없습니다.' : '내용이 비어 있습니다.')
    else if (outcome.isClipped) $.ui.toast('500자가 넘어 앞부분만 적었습니다.')
  })
  await redraw($)
}

type EditOutcome = { item: UserTodo; isClipped: boolean } | { error: 'empty' | 'missing' }

/** Item `id`'s text replaced; its status and answers stay. */
export async function editTodo($: EngineInterface, id: number, text: string): Promise<EditOutcome> {
  const cleaned = cleanTodoText(text)
  if (cleaned.text === '') return { error: 'empty' }
  const changed = await changeTodos($, record => editItem(record, id, cleaned.text))
  const item = changed?.items.find(other => other.id === id)

  return item === undefined ? { error: 'missing' } : { item, isClipped: cleaned.isClipped }
}

/** `/todo 복원 <번호>`: a deleted item back as it was. */
async function restoreTodo($: EngineInterface, id: number): Promise<string> {
  let reason = ''
  const changed = await changeTodos($, record => {
    if (!(record.trash ?? []).some(item => item.id === id)) reason = `휴지통에 ${id}번이 없습니다. /todo 휴지통으로 번호를 보세요.`
    else if (record.items.length >= MAX_TODOS) reason = FULL_TEXT

    return reason === '' ? (restoreItems(record, [id])?.record ?? null) : null
  })
  const item = changed?.items.find(other => other.id === id)
  if (item === undefined) return reason || `${id}번을 되살리지 못했습니다.`

  return `되살렸습니다: ${id}. ${STATUS_MARK[item.status]} ${clipCells(oneLine(item.text), 60)}`
}

/**
 * ↗ on a waiting item: offered as the prompt box's dim suggestion, Tab to take, which the box shows
 * only while it is empty and no answer runs. Else (text in the box, an answer running) the text goes
 * into the draft at the cursor, a space put between it and a word on either side (`draftInsertText`).
 * A question sent while an answer runs waits in the queue, taken to come as the next turn.start (not
 * yet seen on screen), and is matched there. Refused there too (a dialog holds the keys, no box), a
 * toast says so.
 */
export async function offerTodo($: EngineInterface, item: UserTodo): Promise<void> {
  if (undo !== null) {
    undo = null
    await redraw($)
  }
  const shown = await $.prompt.suggest({ text: item.text }).catch(() => ({ isShown: false }))
  if (shown.isShown) {
    offered = { id: item.id, text: item.text, isInDraft: false }

    return
  }
  // The engine's read never rejects; a box it cannot read is taken as empty (nothing to space from).
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const filled = await $.prompt.fill({ text: draftInsertText(box, item.text), mode: 'insert' }).catch(() => ({ isFilled: false }))
  if (filled.isFilled) {
    offered = { id: item.id, text: item.text, isInDraft: true }

    return
  }
  $.ui.toast('입력창에 넣지 못했습니다. 대화상자가 열려 있으면 닫고 다시 누르세요.')
}

/**
 * At a main-loop turn's start, after its record opened: the list read again, and an item offered by
 * its ↗ and sent is taken up by this answer (in progress, its number). Sent is, for a suggestion, a
 * question of its text alone (spaces around aside); for a draft it went into, a question holding it.
 * Answers whether an item was taken up so: the question then needs no judging against the to-dos.
 */
export async function startTodoTurn($: EngineInterface, text: string): Promise<boolean> {
  const pending = offered
  offered = null
  if (pending === null || !isOfferSent(pending, text)) {
    await refreshTodos($)

    return false
  }
  const taken = await currentTurn($)

  return (await changeTodos($, record => setItemStatus(record, pending.id, 'in_progress', taken))) !== null
}

/** Whether the question sent carries the offer as it was put in: alone as a suggestion, anywhere in a draft. */
function isOfferSent(offer: { text: string; isInDraft: boolean }, question: string): boolean {
  const wanted = offer.text.trim()

  return offer.isInDraft ? question.includes(wanted) : question.trim() === wanted
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
