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

/** An item deleted (✕, "완료 N개 지우기"), kept to restore: as it was, its status too, and when it went. */
export type TrashedTodo = UserTodo & { deletedAt: number }

/**
 * What one project keeps in the store: its items, the id the next one takes, and the deleted items
 * (the last `MAX_TRASH`, oldest first; absent while none). One record, so a delete and its trash are
 * one write.
 */
export type TodoRecord = { items: UserTodo[]; nextId: number; trash?: TrashedTodo[] }

/** Which tab the sidebar's last box shows. */
export type SidebarTab = 'contents' | 'todo'

export const MAX_TODOS = 200
export const MAX_TODO_CHARS = 500
/** Deleted items kept per project; past it the oldest go. */
export const MAX_TRASH = 50
/** Items the sidebar's tab shows at most; fewer in a pane too short for them. */
export const TODO_PAGE_SIZE = 12

export const STATUSES: readonly UserTodoStatus[] = ['pending', 'in_progress', 'done', 'on_hold']

/**
 * The sign a status is drawn with (the person's pick, 2026-11-04): emoji drawn as emoji with no
 * variation selector, two cells each. An emoji keeps its own colours, so neither dim nor a theme
 * colour reaches it: a dim item dims its text alone.
 */
export const STATUS_MARK: Record<UserTodoStatus, string> = { pending: '📌', in_progress: '⏳', done: '✅', on_hold: '💤' }

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
 * What ↗ puts in at the prompt box's cursor among a draft: the item's text, as written (its lines
 * kept), with a space before it when the character before the cursor is not whitespace and one after
 * it likewise, so it never sticks to a word. An empty box takes the text alone.
 */
export function draftInsertText(box: { text: string; cursor: number }, text: string): string {
  const at = Math.min(Math.max(box.cursor, 0), box.text.length)
  const isWord = (char: string) => char !== '' && !/\s/.test(char)
  const before = at > 0 ? box.text.slice(at - 1, at) : ''

  return `${isWord(before) ? ' ' : ''}${text}${isWord(box.text.slice(at, at + 1)) ? ' ' : ''}`
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
  const trash: TrashedTodo[] = []
  for (const entry of Array.isArray(raw.trash) ? raw.trash : []) {
    const item = parseItem(entry)
    if (item === null || seen.has(item.id)) continue
    seen.add(item.id)
    const deletedAt = (entry as { deletedAt?: unknown }).deletedAt
    trash.push({ ...item, deletedAt: typeof deletedAt === 'number' ? deletedAt : 0 })
  }
  const highest = [...items, ...trash].reduce((max, item) => Math.max(max, item.id), 0)
  const stated = typeof raw.nextId === 'number' && Number.isInteger(raw.nextId) ? raw.nextId : 1
  const record: TodoRecord = { items, nextId: Math.max(stated, highest + 1) }
  if (trash.length > 0) record.trash = trash.slice(-MAX_TRASH)

  return record
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

/** The record with `gone` moved to its trash, deleted at `at`; the trash kept to its last `MAX_TRASH`. */
function toTrash(record: TodoRecord, gone: readonly UserTodo[], at: number): TodoRecord {
  const ids = new Set(gone.map(item => item.id))
  const trash = [...(record.trash ?? []), ...gone.map(item => ({ ...item, deletedAt: at }))].slice(-MAX_TRASH)

  return { ...record, items: record.items.filter(item => !ids.has(item.id)), trash }
}

/** The record with item `id` moved to the trash; null when no item has it. */
export function removeItem(record: TodoRecord, id: number, at: number): TodoRecord | null {
  const item = record.items.find(other => other.id === id)

  return item === undefined ? null : toTrash(record, [item], at)
}

/** The record with its done items moved to the trash. */
export function clearDone(record: TodoRecord, at: number): TodoRecord {
  return toTrash(
    record,
    record.items.filter(item => item.status === 'done'),
    at,
  )
}

/**
 * The record with the trashed items `ids` back in the list as they were (status, answers, id). As
 * many as `MAX_TODOS` leaves room for, the rest left in the trash; null when none of them is there.
 */
export function restoreItems(record: TodoRecord, ids: readonly number[]): { record: TodoRecord; restored: UserTodo[] } | null {
  const wanted = new Set(ids)
  const room = MAX_TODOS - record.items.length
  const restored: UserTodo[] = []
  for (const trashed of record.trash ?? []) {
    if (!wanted.has(trashed.id) || restored.length >= room) continue
    const { deletedAt: _, ...item } = trashed
    restored.push(item)
  }
  if (restored.length === 0) return null
  const back = new Set(restored.map(item => item.id))
  const trash = (record.trash ?? []).filter(item => !back.has(item.id))
  const next: TodoRecord = { items: [...record.items, ...restored], nextId: record.nextId }
  if (trash.length > 0) next.trash = trash

  return { record: next, restored }
}

/** The record with item `id`'s text replaced, its status and answers kept; null when no item has it. */
export function editItem(record: TodoRecord, id: number, text: string): TodoRecord | null {
  if (!record.items.some(item => item.id === id)) return null

  return { ...record, items: record.items.map(item => (item.id === id ? { ...item, text } : item)) }
}

/** The rows under the items: "완료 N개 지우기", "↶ 되돌리기", the field. */
export function footerRows(done: number, undo: number, hasInput: boolean): number {
  return (done > 0 ? 1 : 0) + (undo > 0 ? 1 : 0) + (hasInput ? 1 : 0)
}

/** The rows the tab's body wants: up to `size` items (an empty list's line), "외 N개", and the footer's rows. */
export function todoRows(count: number, footer: number, size = TODO_PAGE_SIZE): number {
  const items = count === 0 ? 1 : Math.min(count, size) + (count > size ? 1 : 0)

  return items + footer
}

/**
 * Items the tab shows in `rows` rows, at most `size`: a row less for "외 N개" when they do not all fit;
 * one at least. Never "외 1개": its row shows the one item instead.
 */
export function todosShown(count: number, rows: number, footer: number, size = TODO_PAGE_SIZE): number {
  const room = rows - footer
  if (count <= Math.min(size, room)) return count
  const shown = Math.min(count, Math.max(1, Math.min(size, room - 1)))

  return count - shown === 1 ? count : shown
}

/**
 * The rows the tab keeps however short the pane (the files, expanded, taking the rest): its footer
 * and up to three items, or the empty list's line.
 */
export function todoLeastRows(count: number, footer: number): number {
  return footer + Math.max(1, Math.min(count, 3))
}

/** What `/todo` does, under its list. */
export const TODO_USAGE = '적기 /todo 내용 · 고치기 /todo 수정 <번호> <내용> · 지운 것 /todo 휴지통 · 되살리기 /todo 복원 <번호>'

/**
 * `/todo` with nothing after it: the list as text, the way the tab orders it, each item by its number
 * (its id: what `/todo 수정` takes, never reused), then the usage.
 */
export function todoListText(items: readonly UserTodo[]): string {
  if (items.length === 0) return `적어 둔 할 일이 없습니다.\n${TODO_USAGE}`

  const counts = (['in_progress', 'pending', 'on_hold', 'done'] as const)
    .map(status => [status, items.filter(item => item.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${STATUS_LABEL[status]} ${count}`)
  const rows = sortTodos(items).map(item => `${item.id}. ${STATUS_MARK[item.status]} ${oneLine(item.text)}${showsTurn(item) ? `  #${item.turn}` : ''}`)

  return [`할 일: ${counts.join(' · ')}`, ...rows, TODO_USAGE].join('\n')
}

/** `/todo 휴지통`: the deleted items, the last deleted first, each by its number, status and when it went. */
export function trashListText(trash: readonly TrashedTodo[]): string {
  if (trash.length === 0) return '휴지통이 비어 있습니다.'
  const rows = [...trash].reverse().map(item => `${item.id}. ${STATUS_MARK[item.status]} ${oneLine(item.text)} · ${clockText(item.deletedAt)} 지움`)

  return [`휴지통 ${trash.length}개 (최근 ${MAX_TRASH}개까지):`, ...rows, '되살리기: /todo 복원 <번호>'].join('\n')
}

/** `11-04 15:30`, local time. */
function clockText(ms: number): string {
  const date = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
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

/** How many cells a row's tail takes: ` #14`, then the buttons ` ↗ ` and ` ✕ `, three cells each. */
export function rowTailCells(item: UserTodo): number {
  return (showsTurn(item) ? cellWidth(` #${item.turn}`) : 0) + (item.status === 'pending' ? 3 : 0) + 3
}
