import { cellWidth } from './band-format'

/**
 * The person's own to-dos (`/todo`, the sidebar's "할 일" tab, the model's `user_todos` tool): a
 * note and a queue, kept per project and per machine in `$.store`. Not Claude's own task list
 * (TodoWrite, TaskCreate: the `todos` state and the activity box's `▸ … 2/5`).
 */
export type UserTodoStatus = 'pending' | 'in_progress' | 'done' | 'on_hold'

export type UserTodo = {
  /** Unique in its project, never reused: what the model's tool names it by. */
  id: number
  text: string
  status: UserTodoStatus
  /** When it was written, in milliseconds. */
  createdAt: number
  /** The answer running, or the last one, when it was written, by its number in that session; absent before a session's first answer. */
  createdTurn?: number
  /** The session it was written in. */
  createdSession?: string
  /** The answer that took it up or finished it, shown as `#14` while it is in progress or done. A press that cycles the status sets none. */
  turn?: number
  /** The session of `turn`. */
  turnSession?: string
}

/** What one project keeps in the store: its items and the id the next one takes. */
export type TodoRecord = { items: UserTodo[]; nextId: number }

/** Which tab the sidebar's last box shows. */
export type SidebarTab = 'contents' | 'todo'

export const MAX_TODOS = 200
export const MAX_TODO_CHARS = 500
/** Items the sidebar's tab shows at most; fewer in a pane too short for them. */
export const TODO_PAGE_SIZE = 12

export const STATUSES: readonly UserTodoStatus[] = ['pending', 'in_progress', 'done', 'on_hold']

/** The sign a status is drawn with. */
export const STATUS_MARK: Record<UserTodoStatus, string> = { pending: '○', in_progress: '◐', done: '✓', on_hold: '—' }

/** In progress first, then waiting, on hold, done; within a status the order they were written in. */
const STATUS_ORDER: Record<UserTodoStatus, number> = { in_progress: 0, pending: 1, on_hold: 2, done: 3 }

/** A press on the status sign: waiting → in progress → done → on hold → waiting. */
const NEXT_STATUS: Record<UserTodoStatus, UserTodoStatus> = { pending: 'in_progress', in_progress: 'done', done: 'on_hold', on_hold: 'pending' }

export function nextStatus(status: UserTodoStatus): UserTodoStatus {
  return NEXT_STATUS[status]
}

export function isStatus(value: unknown): value is UserTodoStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/** The items in the order the sidebar and the lists show them. */
export function sortTodos(items: readonly UserTodo[]): UserTodo[] {
  return [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id - b.id)
}

/** Waiting and in progress: what the tab's title counts. */
export function openCount(items: readonly UserTodo[]): number {
  return items.filter(item => item.status === 'pending' || item.status === 'in_progress').length
}

/** Whether the row shows the answer that took the item up or finished it. */
export function showsTurn(item: UserTodo): boolean {
  return item.turn !== undefined && (item.status === 'in_progress' || item.status === 'done')
}

/** The text on one line, as a row shows it. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A text as it is kept: trimmed, at most `MAX_TODO_CHARS` characters; `isClipped` when it was longer. */
export function cleanTodoText(text: string): { text: string; isClipped: boolean } {
  const trimmed = text.trim()
  const chars = [...trimmed]
  if (chars.length <= MAX_TODO_CHARS) return { text: trimmed, isClipped: false }

  return { text: chars.slice(0, MAX_TODO_CHARS).join('').trimEnd(), isClipped: true }
}

/**
 * The store key of a project's to-dos: a hash of its root and the root's end, so a long path never
 * passes the store's 256 characters and the key still says whose it is.
 */
export function todoStoreKey(root: string): string {
  const tail = [...root].slice(-80).join('')

  return `userTodos:${hash(root)}:${tail}`
}

/** FNV-1a, 32 bits, as eight hex digits. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return h.toString(16).padStart(8, '0')
}

/**
 * A stored value read back as a record: what is not an item is dropped, a text over the limit
 * clipped, the items kept to `MAX_TODOS` and to one per id, and `nextId` past every id.
 */
export function parseTodoRecord(value: unknown): TodoRecord {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const list = Array.isArray(raw.items) ? raw.items : []
  const seen = new Set<number>()
  const items: UserTodo[] = []
  for (const entry of list) {
    const item = parseItem(entry)
    if (item === null || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
    if (items.length >= MAX_TODOS) break
  }
  const highest = items.reduce((max, item) => Math.max(max, item.id), 0)
  const stated = typeof raw.nextId === 'number' && Number.isInteger(raw.nextId) ? raw.nextId : 1

  return { items, nextId: Math.max(stated, highest + 1) }
}

function parseItem(value: unknown): UserTodo | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1) return null
  if (typeof raw.text !== 'string' || !isStatus(raw.status)) return null
  const text = cleanTodoText(raw.text).text
  if (text === '') return null

  const item: UserTodo = { id: raw.id, text, status: raw.status, createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0 }
  if (isTurn(raw.createdTurn)) item.createdTurn = raw.createdTurn
  if (typeof raw.createdSession === 'string') item.createdSession = raw.createdSession
  if (isTurn(raw.turn)) item.turn = raw.turn
  if (typeof raw.turnSession === 'string') item.turnSession = raw.turnSession

  return item
}

function isTurn(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Where an answer number points: the answer and its session, both absent when unknown. */
export type TurnRef = { turn: number; session: string }

/** The record with a new waiting item at the end; null when the project already holds `MAX_TODOS`. */
export function addItem(record: TodoRecord, text: string, at: number, written: TurnRef): { record: TodoRecord; item: UserTodo } | null {
  if (record.items.length >= MAX_TODOS) return null
  const item: UserTodo = { id: record.nextId, text, status: 'pending', createdAt: at }
  if (written.turn > 0) item.createdTurn = written.turn
  if (written.session !== '') item.createdSession = written.session

  return { record: { items: [...record.items, item], nextId: record.nextId + 1 }, item }
}

/**
 * The record with item `id` set to `status`; `taken` the answer that took it up or finished it, set
 * only as it goes in progress or done. Null when no item has the id.
 */
export function setItemStatus(record: TodoRecord, id: number, status: UserTodoStatus, taken?: TurnRef): TodoRecord | null {
  if (!record.items.some(item => item.id === id)) return null

  return {
    ...record,
    items: record.items.map(item => {
      if (item.id !== id) return item
      const next: UserTodo = { ...item, status }
      if (taken !== undefined && taken.turn > 0 && (status === 'in_progress' || status === 'done')) {
        next.turn = taken.turn
        if (taken.session === '') delete next.turnSession
        else next.turnSession = taken.session
      }

      return next
    }),
  }
}

/** The record without item `id`; null when no item has it. */
export function removeItem(record: TodoRecord, id: number): TodoRecord | null {
  if (!record.items.some(item => item.id === id)) return null

  return { ...record, items: record.items.filter(item => item.id !== id) }
}

/** The record without its done items. */
export function clearDone(record: TodoRecord): TodoRecord {
  return { ...record, items: record.items.filter(item => item.status !== 'done') }
}

/** The rows the tab's body wants: up to `size` items (an empty list's line), "외 N개", "완료 N개 지우기", the input. */
export function todoRows(count: number, done: number, hasInput: boolean, size = TODO_PAGE_SIZE): number {
  const items = count === 0 ? 1 : Math.min(count, size) + (count > size ? 1 : 0)

  return items + (done > 0 ? 1 : 0) + (hasInput ? 1 : 0)
}

/** Items the tab shows in `rows` rows, at most `size`: a row less for "외 N개" when they do not all fit; one at least. */
export function todosShown(count: number, rows: number, done: number, hasInput: boolean, size = TODO_PAGE_SIZE): number {
  const room = rows - (done > 0 ? 1 : 0) - (hasInput ? 1 : 0)
  if (count <= Math.min(size, room)) return count

  return Math.min(count, Math.max(1, Math.min(size, room - 1)))
}

/** `/todo` with nothing after it: the list as text, the way the tab orders it. */
export function todoListText(items: readonly UserTodo[]): string {
  if (items.length === 0) return '적어 둔 할 일이 없습니다. `/todo 내용`으로 적습니다.'

  const counts = (['in_progress', 'pending', 'on_hold', 'done'] as const)
    .map(status => [status, items.filter(item => item.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${STATUS_LABEL[status]} ${count}`)
  const rows = sortTodos(items).map(item => `${STATUS_MARK[item.status]} ${oneLine(item.text)}${showsTurn(item) ? `  #${item.turn}` : ''}`)

  return [`할 일: ${counts.join(' · ')}`, ...rows].join('\n')
}

const STATUS_LABEL: Record<UserTodoStatus, string> = { pending: '대기', in_progress: '진행', done: '완료', on_hold: '보류' }

/**
 * The tool's `list`, for the model: each item's id, status and text, and the answers it was
 * written in and taken up in, so it can tell a request already dealt with.
 */
export function todoToolList(items: readonly UserTodo[], now: TurnRef): string {
  const here = now.turn > 0 ? `This is answer #${now.turn} of the current session.` : 'No answer of the current session has started yet.'
  if (items.length === 0) return `The user's to-do list for this project is empty. ${here}`

  const where = (turn: number, session: string | undefined) => `#${turn}${session !== undefined && session !== now.session ? ' of an earlier session' : ''}`
  const rows = sortTodos(items).map(item => {
    const notes = [
      item.createdTurn === undefined ? 'written before any answer' : `written during answer ${where(item.createdTurn, item.createdSession)}`,
      ...(showsTurn(item) && item.turn !== undefined ? [`${item.status === 'done' ? 'done' : 'taken up'} in answer ${where(item.turn, item.turnSession)}`] : []),
    ]

    return `- id ${item.id} [${item.status}] ${item.text} (${notes.join('; ')})`
  })

  return [`The user's to-do list for this project (${items.length} items). ${here}`, ...rows].join('\n')
}

/** How many cells a row's tail takes: ` #14`, ` ↗`, ` ✕`. */
export function rowTailCells(item: UserTodo): number {
  return (showsTurn(item) ? cellWidth(` #${item.turn}`) : 0) + (item.status === 'pending' ? 2 : 0) + 2
}
