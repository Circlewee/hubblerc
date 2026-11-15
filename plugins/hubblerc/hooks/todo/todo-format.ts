import { cellWidth } from '../shared/text-width'

/**
 * The person's own to-dos (`/todo`, the sidebar's "할 일" tab, the model's `user_todos` tool): a
 * note and a queue, kept per project and per machine in `$.store`. Not Claude's own task list
 * (TodoWrite, TaskCreate), which hubblerc no longer follows (2026-11-06).
 */
export type UserTodoStatus = 'pending' | 'in_progress' | 'done' | 'on_hold'

export type UserTodo = {
  /** Unique in its project, never reused: what the model's tool names it by. */
  id: number
  /** The title: what a row shows. */
  text: string
  /** What goes with the title: context, files, decisions, steps; ↗ hands it over with the title. Absent, none. */
  detail?: string
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
/** A detail's characters at most: 250 items and trash at this length stay well under the store's 4 MiB a value. */
export const MAX_DETAIL_CHARS = 2000
/** A text without a detail longer than this is no title: all of it goes to the detail, its start the title. */
export const TITLE_SPLIT_CHARS = 200
/** The characters of the title such a text keeps, then "…". */
const SPLIT_TITLE_CHARS = 80
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

/** A title and its detail as written: trimmed, each to its limit; `isClipped` when either was cut. */
export type ShapedTodo = { text: string; detail?: string; isClipped: boolean }

/**
 * A title and detail from what was written. With no detail given (the sidebar's fields, `/todo`), the
 * first line is the title and the lines after it the detail. A title over `TITLE_SPLIT_CHARS`
 * characters goes whole to the detail's head, its first `SPLIT_TITLE_CHARS` the title with "…": a
 * long note to keep was cut at 500 or split into several items (2026-11-16, reported). An empty title
 * with a detail takes the detail's start so.
 */
export function shapeTodo(written: string, detail?: string): ShapedTodo {
  let title = written.trim()
  let body = (detail ?? '').trim()
  if (detail === undefined) {
    const lineEnd = title.indexOf('\n')
    if (lineEnd >= 0) {
      body = title.slice(lineEnd + 1).trim()
      title = title.slice(0, lineEnd).trim()
    }
  }
  if (title === '' && body !== '') title = splitTitle(body)
  else if ([...title].length > TITLE_SPLIT_CHARS) {
    body = body === '' ? title : `${title}\n\n${body}`
    title = splitTitle(title)
  }
  const chars = [...body]
  const isClipped = chars.length > MAX_DETAIL_CHARS
  if (isClipped) body = chars.slice(0, MAX_DETAIL_CHARS).join('').trimEnd()

  return body === '' ? { text: title, isClipped } : { text: title, detail: body, isClipped }
}

function splitTitle(text: string): string {
  const flat = [...oneLine(text)]

  return flat.length <= SPLIT_TITLE_CHARS ? flat.join('') : `${flat.slice(0, SPLIT_TITLE_CHARS).join('').trimEnd()}…`
}

/**
 * What ↗ hands over: the title, a blank line, the detail; the detail alone when the title is its
 * start cut with "…" (`shapeTodo` made it so), not to say the start twice.
 */
export function offerText(item: Pick<UserTodo, 'text' | 'detail'>): string {
  if (item.detail === undefined) return item.text
  if (item.text.endsWith('…') && oneLine(item.detail).startsWith(item.text.slice(0, -1))) return item.detail

  return `${item.text}\n\n${item.detail}`
}

/** What the edit field holds: the title, then the detail on the lines under it (`shapeTodo` reads it back so). */
export function editText(item: Pick<UserTodo, 'text' | 'detail'>): string {
  return item.detail === undefined ? item.text : `${item.text}\n${item.detail}`
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
 * Where a project root is in the main working tree, from `git rev-parse --path-format=absolute
 * --show-prefix --git-dir --git-common-dir` run in it: the root itself in the main tree (the two
 * directories are one) or when the answer is not of that shape; in a linked worktree, the main
 * tree's root (the common directory's parent; a bare repository's own directory) with the root's
 * path inside the checkout.
 */
export function mainTreePath(root: string, answer: string): string {
  const lines = answer.split('\n')
  if (lines.length < 3) return root
  const [prefix = '', gitDir = '', commonDir = ''] = lines.map(line => line.trim())
  if (gitDir === '' || commonDir === '' || gitDir === commonDir) return root
  const main = commonDir.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : commonDir
  const inside = prefix.replace(/\/+$/, '')

  return inside === '' ? main : `${main}/${inside}`
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
  if (typeof raw.detail === 'string') {
    const detail = [...raw.detail.trim()].slice(0, MAX_DETAIL_CHARS).join('').trimEnd()
    if (detail !== '') item.detail = detail
  }
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
export function addItem(record: TodoRecord, text: string, at: number, written: TurnRef, detail?: string): { record: TodoRecord; item: UserTodo } | null {
  if (record.items.length >= MAX_TODOS) return null
  const item: UserTodo = { id: record.nextId, text, status: 'pending', createdAt: at }
  if (detail !== undefined && detail !== '') item.detail = detail
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

/**
 * The record with item `id`'s title replaced, its status and answers kept, and its detail: kept
 * (undefined), removed (null) or replaced. Null when no item has the id.
 */
export function editItem(record: TodoRecord, id: number, text: string, detail?: string | null): TodoRecord | null {
  if (!record.items.some(item => item.id === id)) return null

  return {
    ...record,
    items: record.items.map(item => {
      if (item.id !== id) return item
      const { detail: kept, ...rest } = item
      const next = detail === undefined ? kept : detail === null || detail === '' ? undefined : detail

      return next === undefined ? { ...rest, text } : { ...rest, text, detail: next }
    }),
  }
}

/** The rows under the items: a suggestion ("시작?", "완료?"), "완료 N개 지우기", "↶ 되돌리기", the field's rows (0, none). */
export function footerRows(done: number, undo: number, inputRows: number, hasSuggestion = false): number {
  return (hasSuggestion ? 1 : 0) + (done > 0 ? 1 : 0) + (undo > 0 ? 1 : 0) + inputRows
}

/**
 * The tab's two fields: the one that writes an item, and the one that edits the item whose text was
 * pressed. The engine draws a label as `label: `, so the one that writes has none (an empty label
 * still draws ": ").
 */
export const TODO_FIELDS = {
  add: { label: undefined, submitLabel: '추가' },
  edit: { label: '수정 중', submitLabel: '저장' },
} as const

/** The rows a field grows to; past them its text scrolls within. */
export const FIELD_MOST_ROWS = 4

/**
 * The cells a field's text wraps at in a pane `columns` wide, as the terminal's engine (2.1.325)
 * reckons them: the pane's body columns less `label: `, and less the hint drawn beside it while it has
 * focus, ` ⏎ 저장 · shift+⏎ new line` when that leaves half the pane (the longer of its two spellings),
 * else ` ⏎ 저장`; 12 at least. The engine counts the whole pane's width whatever box holds the field,
 * so the field is drawn outside the boxes, as wide as the pane.
 */
export function fieldTextCells(columns: number, field: { label: string | undefined; submitLabel: string }): number {
  const room = columns - (field.label === undefined ? 0 : cellWidth(`${field.label}: `))
  const short = ` ⏎ ${field.submitLabel}`
  const long = `${short} · shift+⏎ new line`
  const hint = room - cellWidth(long) >= columns / 2 ? long : short

  return Math.max(12, room - cellWidth(hint))
}

/**
 * The rows a field needs to show all of `text` wrapped at `width` cells, the caret's cell after the
 * last line counted, from 1 to `FIELD_MOST_ROWS`. One row is never asked for a text that fills it:
 * a field one row tall cut a long text and did not follow the caret into it (2026-11-16, reported),
 * while one of several rows wraps and scrolls within.
 */
export function fieldRows(text: string, width: number): number {
  const needed = text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil((cellWidth(line) + 1) / width)), 0)

  return Math.min(FIELD_MOST_ROWS, Math.max(1, needed))
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
  const rows = sortTodos(items).map(
    item => `${item.id}. ${STATUS_MARK[item.status]} ${oneLine(item.text)}${item.detail === undefined ? '' : `  +detail ${[...item.detail].length}자`}${showsTurn(item) ? `  #${item.turn}` : ''}`,
  )

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

    return `- id ${item.id} [${item.status}] ${item.text} (${notes.join('; ')})${item.detail === undefined ? '' : `\n  detail: ${detailStart(item.detail)}`}`
  })

  return [`The user's to-do list for this project (${items.length} items). ${here}`, ...rows].join('\n')
}

/** Characters of a detail the list shows; list with the item's id for all of it. */
const LIST_DETAIL_CHARS = 200

function detailStart(detail: string): string {
  const flat = [...oneLine(detail)]
  if (flat.length <= LIST_DETAIL_CHARS) return flat.join('')

  return `${flat.slice(0, LIST_DETAIL_CHARS).join('')}… (${flat.length} characters; list with this id for all)`
}

/** `list` with an id: that item whole, its detail as written. */
export function todoToolItem(item: UserTodo): string {
  const head = `id ${item.id} [${item.status}] ${item.text}`

  return item.detail === undefined ? `${head}\nNo detail.` : `${head}\ndetail:\n${item.detail}`
}

/** The mark after a row's title when the item has a detail. */
export const DETAIL_MARK = ' ⋯'

/** How many cells a row's tail takes: ` ⋯` for a detail, ` #14`, then the buttons ` ↗ ` and ` ✕ `, three cells each. */
export function rowTailCells(item: UserTodo): number {
  return (item.detail === undefined ? 0 : cellWidth(DETAIL_MARK)) + (showsTurn(item) ? cellWidth(` #${item.turn}`) : 0) + (item.status === 'pending' ? 3 : 0) + 3
}
