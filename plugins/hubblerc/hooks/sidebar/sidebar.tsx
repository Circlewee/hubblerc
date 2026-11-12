import { atom, read, update } from 'claude-code'
import type { CommandPresentation, ElementConstructor, EngineInterface, InputProps, On, RenderViewport } from 'claude-code'

import { THEME_COLORS } from '../shared/style'
import { requestSegments, statusParts } from '../status/band-format'
import { promptKey } from '../activity/activity'
import { deviceLines, versionNote } from './device'
import { burnoutMinutes, requestTime } from '../status/forecast'
import { ANSWER_ID, isAppSurface, SIDEBAR_COLUMNS, SIDEBAR_ID, SIDEBAR_TITLE } from '../shared/pane'
import { openAnswer } from '../activity/answer'
import { catImageAt, catMark, catMood } from './cat-images'
import { notePicture, PICTURE_ROWS, startPictures } from './picture'
import { fileLayout, fileRows, fitFileLayout, sessionFiles, shareRows, tocEntries, tocPage, tocPageSize, tocRows } from './sidebar-format'
import type { FileLimits, TocEntry } from './sidebar-format'
import { editTarget, selectTab, todosForDrawing, undoCount } from '../todo/todo'
import { todoSuggestion } from '../todo/todo-judge'
import { footerRows, openCount, sortTodos, todoLeastRows, todoRows, todosShown } from '../todo/todo-format'
import type { SidebarTab } from '../todo/todo-format'
import { statusLine } from '../likely/cost'
import { contentsBody, tabsHeading } from './boxes/contents'
import { deviceBox } from './boxes/device'
import { filesBox } from './boxes/files'
import { frame } from './boxes/frame'
import type { SectionId } from './boxes/frame'
import { statusBox } from './boxes/status'
import { relayBox } from './boxes/relay'
import { todoBody } from './boxes/todo'
import { relayLines } from '../relay/relay-status'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const running = atom({ plugin: 'hubblerc', key: 'running' } as const, [])
const agents = atom({ plugin: 'hubblerc', key: 'agents' } as const, [])
const usage = atom({ plugin: 'hubblerc', key: 'usage' } as const, null)
const git = atom({ plugin: 'hubblerc', key: 'git' } as const, null)
const project = atom({ plugin: 'hubblerc', key: 'project' } as const, '')
const model = atom({ plugin: 'hubblerc', key: 'model' } as const, '')
const effortOverride = atom({ plugin: 'hubblerc', key: 'effortOverride' } as const, null)
const engineEffort = atom({ plugin: 'hubblerc', key: 'engineEffort' } as const, null)
const ultracode = atom({ plugin: 'hubblerc', key: 'ultracode' } as const, false)
const effortAuto = atom({ plugin: 'hubblerc', key: 'effortAuto' } as const, null)
const autoPick = atom({ plugin: 'hubblerc', key: 'autoPick' } as const, null)
const tocPageIndex = atom({ plugin: 'hubblerc', key: 'tocPage' } as const, 0)
const tick = atom({ plugin: 'hubblerc', key: 'tick' } as const, 0)
const fiveHourLog = atom({ plugin: 'hubblerc', key: 'fiveHourLog' } as const, [])
const lastRequestAt = atom({ plugin: 'hubblerc', key: 'lastRequestAt' } as const, null)
const folded = atom({ plugin: 'hubblerc', key: 'folded' } as const, [])
const filesExpanded = atom({ plugin: 'hubblerc', key: 'filesExpanded' } as const, false)
const device = atom({ plugin: 'hubblerc', key: 'device' } as const, null)
const catPicture = atom({ plugin: 'hubblerc', key: 'catPicture' } as const, 'unknown')
const catImageCount = atom({ plugin: 'hubblerc', key: 'catImageCount' } as const, 0)
const streamPhase = atom({ plugin: 'hubblerc', key: 'streamPhase' } as const, null)
const restartPending = atom({ plugin: 'hubblerc', key: 'restartPending' } as const, false)
const lastRequest = atom({ plugin: 'hubblerc', key: 'lastRequest' } as const, null)
const sessionId = atom({ plugin: 'hubblerc', key: 'sessionId' } as const, '')
const sessionName = atom({ plugin: 'hubblerc', key: 'sessionName' } as const, null)
const sidebarTab = atom({ plugin: 'hubblerc', key: 'sidebarTab' } as const, 'contents')
const userTodoVersion = atom({ plugin: 'hubblerc', key: 'userTodoVersion' } as const, 0)
const likelyStatus = atom({ plugin: 'hubblerc', key: 'likelyStatus' } as const, null)
const relayStatus = atom({ plugin: 'hubblerc', key: 'relayStatus' } as const, null)

/** Where the folds are kept across sessions. */
const FOLDED_KEY = 'sidebarFolded'
/** Cells a box takes from the width: its border and a cell of padding, each side. */
const BOX_FRAME = 4

/**
 * Twelve files in all at most; each folder outside the repository shows two, three folders at most;
 * the repository six at least. A pane too short for them shows fewer (`fitFileLayout`).
 */
const FILE_LIMITS: FileLimits = { total: 12, minInside: 6, folders: 3, perFolder: 2 }
/** Every file, once the person asked for the rest. */
const NO_FILE_LIMITS: FileLimits = { total: Infinity, minInside: Infinity, folders: Infinity, perFolder: Infinity }
/** Answers on one page of the contents at most; fewer in a pane too short for them. */
const TOC_PAGE_SIZE = 10
/** The engine docks a pane beside the fullscreen transcript from this many columns; below, it sits above the prompt. */
const DOCK_COLUMNS = 110

/**
 * Where the status and the timeline show (the `layout` option):
 * - auto: follows the terminal. Under the fullscreen layout, wide enough to dock, the sidebar; else
 *   the band, the sidebar closing as it would drop above the prompt and coming back on a widening
 * - sidebar: the sidebar wherever the engine places it, the band only while it cannot
 * - band: the band; the sidebar only by `/panel`
 */
export type Layout = 'auto' | 'sidebar' | 'band'

export function layoutOption(value: unknown): Layout {
  return value === 'sidebar' || value === 'band' ? value : 'auto'
}

// Module state, which a reload forgets: then the sidebar is opened again if the layout wants it.
/** Set while an open or a close is on its way, so a redraw in between does not ask twice. */
let isOpening = false
let isClosing = false
/** The person closed the sidebar: it stays closed until `/panel`, or under auto a narrow terminal. */
let isDismissed = false
/** `/panel` opened it on a terminal too narrow to dock: auto leaves it above the prompt until it closes. */
let isPeeking = false
/**
 * The conversation's question rows as they were drawn: what each shows (`promptKey`) to the ids of
 * the rows showing it, in the order drawn. Kept in the module (a drawing may not write state); a
 * reload loses it and the engine draws the rows again as the plugin loads.
 */
const questionRows = new Map<string, string[]>()
const MAX_QUESTION_ROWS = 2000
let questionRowCount = 0

/**
 * From the band's drawing: opens the sidebar when the layout wants it and the person has not closed
 * it, and says whether it is up in the band's place (the band then stands aside).
 *
 * The engine places a pane it was not asked for from 144 columns (110 for one the person opened
 * before); below, it waits undrawn and the band stays. Docking narrows the band's column, which
 * draws the band again to step aside.
 */
export async function syncSidebar($: EngineInterface, layout: Layout, viewport: RenderViewport | undefined): Promise<boolean> {
  if (layout === 'band') return false

  const panes = await $.ui.panes()
  const pane = panes.find(open => open.id === SIDEBAR_ID)
  const canDock = viewport?.isFullscreen === true && viewport.columns >= DOCK_COLUMNS
  // Under auto a narrow terminal ends a close by hand: the next widening brings the sidebar back.
  if (layout === 'auto' && !canDock) isDismissed = false

  const isWanted = layout === 'sidebar' || canDock
  if (pane === undefined && isWanted && !isDismissed && !isOpening) {
    isOpening = true
    void $.ui
      .open({ id: SIDEBAR_ID, title: SIDEBAR_TITLE, columns: SIDEBAR_COLUMNS })
      .catch(() => undefined)
      .finally(() => {
        isOpening = false
      })
  }

  // An answer's pane in front of the sidebar (a tab beside it) keeps the band aside too: it closes
  // back to the sidebar.
  const answer = panes.find(open => open.id === ANSWER_ID)

  return pane !== undefined && pane.isPlaced && (pane.isShown || (answer !== undefined && answer.isPlaced && answer.isShown))
}

/**
 * At session.start: a fresh start for the module state, the boxes folded in an earlier session
 * folded again; under the band layout a sidebar left from another layout closes.
 */
export async function startSidebar($: EngineInterface, layout: Layout): Promise<void> {
  isOpening = false
  isClosing = false
  isDismissed = false
  isPeeking = false
  await loadFolds($).catch(() => undefined)
  // Each second till the terminal has said whether it draws the cat's picture.
  startPictures($)
  if (layout !== 'band') return
  if ((await $.ui.panes()).some(open => open.id === SIDEBAR_ID)) await $.ui.close({ id: SIDEBAR_ID })
}

async function loadFolds($: EngineInterface): Promise<void> {
  const saved = await $.store.get(FOLDED_KEY)
  if (!Array.isArray(saved)) return
  const ids = saved.filter((id): id is string => typeof id === 'string')
  await update($, folded, () => ids)
}

/** A press on a box's title: folds it to one line, or unfolds it; kept for the next session too. */
async function toggleFold($: EngineInterface, id: SectionId): Promise<void> {
  const ids = await update($, folded, list => (list.includes(id) ? list.filter(other => other !== id) : [...list, id]))
  await $.store.set(FOLDED_KEY, ids).catch(() => undefined)
}

/**
 * `/panel` (ctrl+x ctrl+p): closes the sidebar when it shows (it then stays closed), else opens it at
 * any width. Under auto, one opened too narrow to dock stays above the prompt until it closes or docks.
 * Says nothing when it did what was asked: the sidebar coming or going is the answer.
 */
export async function toggleSidebar($: EngineInterface, layout: Layout, presentation: CommandPresentation): Promise<string | undefined> {
  const pane = (await $.ui.panes()).find(open => open.id === SIDEBAR_ID)

  if (pane !== undefined && pane.isPlaced && pane.isShown) {
    isDismissed = true
    await $.ui.close({ id: SIDEBAR_ID })

    return undefined
  }

  isDismissed = false
  const isNarrow = !presentation.isFullscreen || presentation.columns < DOCK_COLUMNS
  if (layout === 'auto' && isNarrow) isPeeking = true
  const opened = await $.ui.open({ id: SIDEBAR_ID, title: SIDEBAR_TITLE, columns: SIDEBAR_COLUMNS })

  return opened.isPlaced ? undefined : `사이드바가 아직 그려지지 않았습니다: ${opened.reason}`
}

/**
 * The sidebar, in four boxes each titled on its top border: the band's status, one item a line,
 * and how long since the last request; what runs; relay's runs not finished, only while there are
 * any (`boxes/relay.tsx`); the files the session changed, with the answers
 * that changed them; and the contents, the session's answers newest first, each a press away from
 * its place in the conversation. A press on a box's title folds it to one line, and back. What each
 * answer did is on its own closing line, not here.
 */
export function showSidebar(on: On, layout: Layout, autoByDefault: boolean): void {
  on('ui.render', { component: 'Pane', requestId: SIDEBAR_ID }, async ($, e) => {
    // Under auto the sidebar does not sit above the prompt (the terminal narrowed): it closes and the band takes over.
    if (e.props.placement === 'dock') isPeeking = false
    if (layout === 'auto' && e.surface === 'terminal' && e.props.placement === 'inline' && !isPeeking && !isClosing) {
      isClosing = true
      void $.ui
        .close({ id: SIDEBAR_ID })
        .catch(() => undefined)
        .finally(() => {
          isClosing = false
        })
    }

    const [turnList, runningList, agentList, figures, gitInfo, projectName, modelId, override, engine, auto, pick, pageIndex, log, lastRequestTime, foldedIds, isFilesExpanded, deviceInfo, phase, isRestartPending, lastSample, id, name] =
      await Promise.all([
        read($, turns),
        read($, running),
        read($, agents),
        read($, usage),
        read($, git),
        read($, project),
        read($, model),
        read($, effortOverride),
        read($, engineEffort),
        read($, effortAuto),
        read($, autoPick),
        read($, tocPageIndex),
        read($, fiveHourLog),
        read($, lastRequestAt),
        read($, folded),
        read($, filesExpanded),
        read($, device),
        read($, streamPhase),
        read($, restartPending),
        read($, lastRequest),
        read($, sessionId),
        read($, sessionName),
      ])
    // Read so the pictures, once loaded, redraw the cat.
    await read($, catImageCount)
    const isUltracode = await read($, ultracode)
    // likely's spend, one line when an API key is set (`hooks/likely/`).
    const decisions = await read($, likelyStatus)
    const likelyLine = decisions === null ? '' : statusLine(decisions)
    // relay's runs not finished, in small: written as a run's state is saved, never read from files here.
    const relayRuns = await read($, relayStatus)
    // Read so the timer's writes redraw elapsed times and countdowns.
    await read($, tick)
    const now = await $.clock.now()
    const shownTab: SidebarTab = await read($, sidebarTab)
    // The list is the module's; the version, bumped on each change, redraws.
    await read($, userTodoVersion)
    const userTodos = sortTodos(await todosForDrawing($))

    // The desktop app (and VS Code): no cat, no borders, the effort value as text (`isAppSurface`).
    const isApp = isAppSurface(e.surface)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // The field the to-do tab writes with: absent where the surface draws none (mobile).
    const Input = (elements as { Input?: ElementConstructor<InputProps> }).Input
    // The terminal's picture leaf: absent elsewhere, and given up on where the terminal draws its alt.
    const pictureState = await read($, catPicture)
    const Image = e.surface === 'terminal' && pictureState !== 'blocked' ? (elements as { Image?: typeof elements.Box }).Image : undefined
    const width = e.props.bodyColumns
    /** What a box holds: the width less the box's frame. */
    const inner = Math.max(1, width - BOX_FRAME)
    // Each task's line fitted to the box: the title takes what the status and the tail leave.
    const relay = relayLines(relayRuns, THEME_COLORS, inner)

    const isAuto = (auto ?? autoByDefault) && override === null
    // A pick without a level: the turn's model has no row in auto's table, so the engine's effort went out.
    const effort = override ?? (isAuto ? (pick === null ? null : (pick.level ?? '기준 없음')) : engine)
    const burnout = burnoutMinutes(log, figures?.fiveHour, now)
    const status = statusParts(
      { model: modelId, effort, isOverridden: override !== null, isAuto, isUltracode, usage: figures, project: projectName, git: gitInfo, now, burnout, isRoomy: true, palette: THEME_COLORS, barColumns: inner },
      Number.POSITIVE_INFINITY,
    )
    const isWorking = turnList.at(-1)?.durationMs === null
    // When the last request went out and what it carried, the cache's share of its input; mid-answer too.
    const request = requestSegments(requestTime(lastRequestTime), lastSample, THEME_COLORS)
    const files = sessionFiles(turnList, gitInfo)
    const all = tocEntries(turnList, now)
    // Each box is drawn by its own function (`boxes/`) from what was read here.
    const f = frame({ Box, Text, Button, Link }, { isApp, width, inner, foldedIds, onFold: id => void toggleFold($, id) })

    // A cat that shows what the session does, and the machine and the engine: the cat a picture beside
    // the lines where the terminal draws one, else the lines alone.
    const lines = deviceLines(deviceInfo)
    const note = versionNote(deviceInfo)
    const lastDone = turnList.findLast(turn => turn.durationMs !== null)
    const mood = catMood({
      isWorking,
      isToolRunning: runningList.length > 0 || agentList.some(agent => agent.status === 'running' || agent.status === 'pending'),
      phase,
      lastFailed: lastDone !== undefined && lastDone.runs.some(run => run.isError),
    })
    const second = Math.floor(now / 1000)
    // The cat is a picture, its pixels square in a box as tall as the lines beside it: the PNGs in
    // assets/cat for the mood, a frame a second. Drawn while the terminal has not said whether it
    // draws pictures (one that cannot shows the blank `alt`). None in the app, where the terminal
    // refused the picture, or with no PNGs: the lines alone (the half-block cat and the art drawn as
    // a PNG went, 2026-11-06).
    const image = Image === undefined || isApp ? null : catImageAt(mood, second)
    const picture = image === null ? null : { png: image.png }
    const pictureColumns = image === null ? 0 : Math.max(1, Math.round((PICTURE_ROWS * 2 * image.width) / Math.max(1, image.height)))
    notePicture($, picture, pictureColumns, pictureState, now)

    // What the twelve left out is a press away: the whole list. Then "줄이기" stands where the
    // repository's "외 N개" stood, between its files and the folders outside, and puts it back.
    const expandFiles = () => {
      void update($, filesExpanded, () => true)
    }

    // The sidebar fits the pane's height: the boxes above take what they hold, the files and the
    // contents share the rest, each showing fewer (and "외 N개", more pages) as rows run short.
    // A box takes its two borders; folded, one row.
    const boxRows = (id: SectionId, body: number) => (foldedIds.includes(id) ? 1 : 2 + body)
    const deviceText =
      (lines.length === 0 && deviceInfo?.version === undefined ? 1 : lines.length) +
      (deviceInfo?.version === undefined ? 0 : 1) +
      (deviceInfo?.pluginVersion === undefined ? 0 : 1)
    const isFilesOpen = files.length > 0 && !foldedIds.includes('files')
    const isContentsOpen = !foldedIds.includes('contents')
    const above =
      // Air above and below; a picture beside the lines, or the lines alone.
      boxRows('device', 2 + (picture === null ? deviceText : Math.max(PICTURE_ROWS, deviceText))) +
      boxRows('status', status.length + (id === '' ? 0 : 1) + (request.length === 0 ? 0 : 1) + (likelyLine === '' ? 0 : 1)) +
      (relay.length === 0 ? 0 : boxRows('relay', relay.length)) +
      (files.length === 0 ? 0 : boxRows('files', 0)) +
      boxRows('contents', 0)
    // No rows given (a surface that does not say): nothing is cut.
    const bodyRows = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : Number.POSITIVE_INFINITY
    const room = bodyRows - above
    // The last box's share is its shown tab's: the contents' pages, or the to-dos and the field below them.
    const doneCount = userTodos.filter(item => item.status === 'done').length
    const hasField = Input !== undefined
    // "↶ 되돌리기" after a delete, and the item the field edits: the module's, kept outside state.
    const undoN = undoCount()
    const edited = hasField ? editTarget(userTodos, e.props.isFocused) : null
    // A judgment waiting on a press ("시작?", "완료?"): the module's too, a row above the footer's others.
    const suggested = todoSuggestion(userTodos)
    const todoFooter = footerRows(doneCount, undoN, hasField, suggested !== null)
    // However short the pane, the last box keeps three rows of the contents, or the to-dos' footer and
    // a few of them: three rows once left the to-dos one item and "외 1개" under the files (2026-11-04).
    const contentsLeast = shownTab === 'todo' ? todoLeastRows(userTodos.length, todoFooter) : 3
    const share = shareRows(
      room,
      isFilesOpen ? fileRows(fileLayout(files, FILE_LIMITS)) : 0,
      !isContentsOpen ? 0 : shownTab === 'todo' ? todoRows(userTodos.length, todoFooter) : tocRows(all.length, TOC_PAGE_SIZE),
      3,
      contentsLeast,
    )
    const limited = fitFileLayout(files, FILE_LIMITS, share.files)
    const isCut = limited.insideHidden > 0 || limited.foldersHidden > 0 || limited.outside.some(group => group.hidden > 0)
    const shownFiles = isFilesExpanded ? fileLayout(files, NO_FILE_LIMITS) : limited
    // Every file shown, the contents keep what the files leave, or their least.
    const contentsRoom = isFilesExpanded && isFilesOpen ? Math.max(Math.min(contentsLeast, share.toc), room - fileRows(shownFiles, isCut)) : share.toc
    const { entries, page, pages } = tocPage(all, pageIndex, tocPageSize(all.length, contentsRoom, TOC_PAGE_SIZE))
    const goTo = (to: number) => {
      void update($, tocPageIndex, () => Math.min(Math.max(0, to), pages - 1))
    }

    const shownTodos = userTodos.slice(0, todosShown(userTodos.length, contentsRoom, todoFooter))
    const contents = { count: all.length, entries, page, pages, onJump: (entry: TocEntry) => void jumpTo($, entry), onPage: goTo }
    const tabs = tabsHeading(f, {
      shownTab,
      contents,
      openTodos: openCount(userTodos),
      onFold: () => void toggleFold($, 'contents'),
      onTab: (tab, isFolded) => void selectTab($, tab).then(() => (isFolded ? toggleFold($, 'contents') : undefined)),
    })
    const lastBody = shownTab === 'todo' ? todoBody($, f, { items: userTodos, shown: shownTodos, edited, Input, doneCount, undoN, suggested }) : contentsBody(f, contents)

    return (
      <Box flexDirection="column">
        {deviceBox($, f, { info: deviceInfo, lines, note, picture, pictureColumns, Image, mood, mark: catMark(mood), isRestartPending })}
        {statusBox($, f, { status, id, name, request, likelyLine })}
        {relay.length === 0 ? null : relayBox(f, relay)}
        {files.length === 0 ? null : filesBox(f, { shown: shownFiles, isExpanded: isFilesExpanded, isCut, onExpand: expandFiles, onCollapse: () => void update($, filesExpanded, () => false) })}
        {f.box('contents', tabs, lastBody)}
      </Box>
    )
  })

  // Watches the question rows drawn, so the contents can scroll to an answer whose row id was not kept.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const key = promptKey(e.props.text)
    if (key !== '' && questionRowCount < MAX_QUESTION_ROWS) {
      const ids = questionRows.get(key) ?? []
      if (!ids.includes(e.requestId)) {
        ids.push(e.requestId)
        questionRows.set(key, ids)
        questionRowCount += 1
      }
    }

    return next(e)
  })

  // The person's close (its mark, ctrl+x x) holds until `/panel`, or under auto a narrow terminal.
  // Any close draws the band again (bumping the tick it reads), which comes back in the sidebar's place.
  on('ui.close', { id: SIDEBAR_ID }, async ($, e, next) => {
    if (e.origin.kind === 'person') isDismissed = true
    isPeeking = false
    const closed = await next(e)
    await update($, tick, n => n + 1)

    return closed
  }).catch(($, e, next) => next(e))
}

/**
 * Scrolls the conversation to an answer: its question's row at the top (by the id kept as it was
 * appended, else by what it shows among the rows drawn), or else its closing line at the bottom.
 */
async function jumpTo($: EngineInterface, entry: TocEntry): Promise<void> {
  const drawn = entry.key === undefined ? undefined : questionRows.get(entry.key)?.[entry.occurrence]
  const target =
    entry.target?.block === 'start' ? entry.target : drawn !== undefined ? { requestId: drawn, block: 'start' as const } : entry.target
  // No row to scroll to, or the scroll refused (the row not drawn, a long session's top out of
  // reach): the answer opens in a pane of its own instead (2026-11-05).
  if (target === undefined) {
    await openAnswer($, entry)

    return
  }

  const moved = await $.ui.scroll({ to: { requestId: target.requestId }, block: target.block }).catch((error: unknown) => ({
    deny: String(error),
  }))
  if (moved.deny !== undefined) await openAnswer($, entry)
}
