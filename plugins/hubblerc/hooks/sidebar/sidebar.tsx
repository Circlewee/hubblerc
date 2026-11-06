import { atom, read, update } from 'claude-code'
import type { CommandPresentation, ElementConstructor, EngineInterface, InputProps, On, RenderViewport, Timer } from 'claude-code'

import { textStyle, THEME_COLORS } from '../shared/style'
import type { Segment } from '../shared/style'
import { cellWidth } from '../shared/text-width'
import { activityParts, requestSegments, statusParts } from '../status/band-format'
import { promptKey } from '../activity/activity'
import { EFFORT_KEY_ACTION, togglePicker } from '../effort/effort-picker'
import { CHANGELOG_URL, deviceLines, versionNote } from './device'
import { burnoutMinutes, requestTime } from '../status/forecast'
import { ANSWER_ID, isAppSurface, isSidebarShown, SIDEBAR_COLUMNS, SIDEBAR_ID, SIDEBAR_TITLE } from '../shared/pane'
import { openAnswer } from '../activity/answer'
import { catImageAt, catMark, catMood } from './cat-images'
import { requestRestart } from '../system/relaunch'
import { clipCells, fileLayout, fileRows, fileUrl, fitFileLayout, sessionFiles, shareRows, shortPath, tocEntries, tocPage, tocPageSize, tocRows } from './sidebar-format'
import type { FileLimits, SessionFile, TocEntry } from './sidebar-format'
import { addTodoFromField, clearDoneTodos, cycleTodo, deleteTodo, editFieldKey, editTarget, offerTodo, saveEditFromField, selectTab, startEditTodo, todosForDrawing, undoCount, undoDelete } from '../todo/todo'
import { footerRows, oneLine, openCount, rowTailCells, showsTurn, sortTodos, STATUS_MARK, todoLeastRows, todoRows, todosShown } from '../todo/todo-format'
import type { SidebarTab, UserTodo } from '../todo/todo-format'
import { statusLine } from '../likely/cost'

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

/** The sidebar's boxes, by the id their fold is kept under. */
export type SectionId = 'device' | 'status' | 'activity' | 'files' | 'contents'
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
const MAX_TURN_REFS = 4
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
  probeTimer = null
  startProbe($)
  sentPicture = null
  sentAt = Number.NEGATIVE_INFINITY
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

/** The cat as a picture: as tall as the lines beside it. */
const PICTURE_ROWS = 5
/** The picture's key in the drawing: what a blit names. */
const PICTURE_KEY = 'cat-picture'
/** A blit refused because the terminal drew the picture's `alt`: no placeholder images, or a file it cannot read. */
const NO_PICTURE = /placeholder|\balt\b|cannot read/i
/** The picture the sidebar last drew, for the probe to send again; null while it draws none. */
let drawnPicture: { source: { png: string }; columns: number; rows: number } | null = null

/**
 * Whether the terminal draws the cat's picture: once the sidebar has drawn one, a blit of the same
 * source answers. Refused for the `alt`, the cat goes and the lines stand alone (the sidebar redraws on
 * the write); refused for anything else (not mounted yet), the next second asks again. Asked from
 * a timer: a render hook writes no state.
 */
async function probePicture($: EngineInterface): Promise<boolean> {
  if ((await read($, catPicture)) !== 'unknown') return true
  const drawn = drawnPicture
  if (drawn === null) return false
  const result = await $.ui.blit({ requestId: SIDEBAR_ID, key: PICTURE_KEY, ...drawn }).catch((error: unknown) => ({ deny: String(error) }))
  if (result.deny !== undefined && !NO_PICTURE.test(result.deny)) return false
  if (result.deny === undefined) {
    sentPicture = drawn.source.png
    sentAt = await $.clock.now()
  }
  await update($, catPicture, () => (result.deny === undefined ? 'shown' : 'blocked'))

  return true
}

const PROBE_MS = 1000
/** Seconds the probe waits for a drawn picture before it stops; the sidebar's next drawing starts it again. */
const PROBE_IDLE_TICKS = 10
let probeTimer: Timer | null = null

/**
 * Asks each second whether the terminal draws the picture, till it has said. With no picture drawn
 * for ten seconds (a band layout, a closed sidebar) it stops rather than wake each second all
 * session; the sidebar's next drawing of a picture starts it again while that is not known.
 */
function startProbe($: EngineInterface): void {
  if (probeTimer !== null) return
  let idleTicks = 0
  const stop = () => {
    timer.cancel()
    if (probeTimer === timer) probeTimer = null
  }
  const timer = $.clock.every(PROBE_MS, () => {
    idleTicks = drawnPicture === null ? idleTicks + 1 : 0
    void probePicture($)
      .then(isKnown => {
        if (isKnown || idleTicks >= PROBE_IDLE_TICKS) stop()
      })
      .catch(() => undefined)
  })
  probeTimer = timer
}

/**
 * How long after the picture was last sent a sign of the person back sends it again: keys typed
 * one after another send it once.
 */
const RESEND_GAP_MS = 10_000
/** The picture last sent to the terminal (a new frame drawn, or a blit) and when. */
let sentPicture: string | null = null
let sentAt = Number.NEGATIVE_INFINITY
/** A resend under way: the keys typed meanwhile start none. */
let isResending = false

/**
 * As the person shows they are back (a key in the prompt box, a question; register.tsx): the cat's
 * picture sent again, if ten seconds have gone since it last was and the sidebar shows. Orca drops
 * a picture while its tab is hidden behind another, and a drawing with an unchanged source sends
 * nothing, so an idle cat stays blank till this; a moving cat's new frames are sent anyway. No
 * timer: a sidebar woken every two seconds to send it cost more than all else idle (2026-11-06).
 * Once the sidebar is closed or hidden the picture is forgotten, so the keys after it ask nothing;
 * the sidebar's next drawing records it again.
 */
export async function resendPicture($: EngineInterface): Promise<void> {
  const drawn = drawnPicture
  if (drawn === null || isResending) return
  isResending = true
  try {
    const now = await $.clock.now()
    if (now - sentAt < RESEND_GAP_MS) return
    if ((await read($, catPicture)) !== 'shown') return
    if (!(await isSidebarShown($))) {
      if (drawnPicture === drawn) drawnPicture = null

      return
    }
    await $.ui.blit({ requestId: SIDEBAR_ID, key: PICTURE_KEY, ...drawn })
    sentPicture = drawn.source.png
    sentAt = now
  } finally {
    isResending = false
  }
}

/**
 * The sidebar, in four boxes each titled on its top border: the band's status, one item a line,
 * and how long since the last request; what runs; the files the session changed, with the answers
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

    const isAuto = (auto ?? autoByDefault) && override === null
    const effort = override ?? (isAuto ? (pick?.level ?? null) : engine)
    const burnout = burnoutMinutes(log, figures?.fiveHour, now)
    const status = statusParts(
      { model: modelId, effort, isOverridden: override !== null, isAuto, isUltracode, usage: figures, project: projectName, git: gitInfo, now, burnout, isRoomy: true, palette: THEME_COLORS, barColumns: inner },
      Number.POSITIVE_INFINITY,
    )
    const isWorking = turnList.at(-1)?.durationMs === null
    // When the last request went out and what it carried, the cache's share of its input; mid-answer too.
    const request = requestSegments(requestTime(lastRequestTime), lastSample, THEME_COLORS)
    const activity = activityParts(runningList, agentList, isWorking, now)
    const files = sessionFiles(turnList, gitInfo)
    const all = tocEntries(turnList, now)

    const segmentText = (segment: Segment, key: string) => (
      <Text key={key} {...textStyle(segment)}>
        {segment.text}
      </Text>
    )

    /** What a box's title draws on its top border, and the cells it takes. */
    type Heading = { element: JSX.Element; cells: number }
    /** The arrow and the title, one press that folds the box. */
    const titleHeading = (id: SectionId, title: string, isFolded: boolean): Heading => ({
      cells: 3 + cellWidth(title) + 1,
      element: (
        <Button
          key={`fold-${id}`}
          plain
          onPress={() => {
            void toggleFold($, id)
          }}
        >
          <Text dimColor>{isFolded ? ' ▸ ' : ' ▾ '}</Text>
          <Text bold>{title}</Text>
          <Text> </Text>
        </Button>
      ),
    })

    /**
     * A box with its title on the top border (`╭── ▾ 상태 ───╮`), the title a press that folds it;
     * folded, the title alone on a rule as wide as the box (`╶── ▸ 상태 ────`). A box with tabs
     * draws its own heading.
     *
     * The title is the box's sibling, not its child: a child drawn over the border vanished on
     * screen (2.1.310), the border painted over it. Laid out `column-reverse`, the box comes first
     * and is painted first; the title row after it sits above it and, by a margin of -1, on its top
     * border, painted last.
     */
    const box = (id: SectionId, title: string | ((isFolded: boolean) => Heading), body: JSX.Element) => {
      const isFolded = foldedIds.includes(id)
      const { element: heading, cells } = typeof title === 'string' ? titleHeading(id, title, isFolded) : title(isFolded)

      // The app draws no border and no title over one: the title on its own row, a dim rule under it.
      if (isApp) {
        return (
          <Box key={`box-${id}`} flexDirection="column">
            <Box key={`title-${id}`}>{heading}</Box>
            {isFolded ? null : (
              <Text key={`rule-${id}`} dimColor wrap="truncate-end">
                {'─'.repeat(width)}
              </Text>
            )}
            {isFolded ? null : (
              <Box flexDirection="column" paddingX={1}>
                {body}
              </Box>
            )}
          </Box>
        )
      }

      if (isFolded) {
        const rule = Math.max(0, width - 3 - cells)

        return (
          <Box key={`box-${id}`}>
            <Text dimColor>╶──</Text>
            {heading}
            <Text dimColor>{'─'.repeat(rule)}</Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column-reverse">
          <Box key={`box-${id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {body}
          </Box>
          {/* As wide as it is written, so the rest of the top border stays; it draws its corner itself. */}
          <Box key={`title-${id}`} marginBottom={-1} alignSelf="flex-start">
            <Text dimColor>╭──</Text>
            {heading}
          </Box>
        </Box>
      )
    }

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
    const mark = catMark(mood)
    drawnPicture = picture === null ? null : { source: picture, columns: pictureColumns, rows: PICTURE_ROWS }
    // A new source goes to the terminal with this drawing.
    if (picture !== null && picture.png !== sentPicture) {
      sentPicture = picture.png
      sentAt = now
    }
    // Drawn while the probe had stopped (nothing drawn in its first ten seconds): ask again.
    if (picture !== null && pictureState === 'unknown') startProbe($)
    const deviceBox = box(
      'device',
      '장비',
      // A row of air above and below: the cat and its lines sit apart from the borders.
      <Box key="device-body" {...(picture === null ? {} : { columnGap: 2 })} paddingY={1}>
        {picture !== null && Image !== undefined ? (
          <Box key="cat" flexShrink={0}>
            <Image key={PICTURE_KEY} source={picture} columns={pictureColumns} rows={PICTURE_ROWS} alt=" " />
            {/* Beside the head: z, ?, !; a column of its own, so nothing moves. */}
            <Box key="cat-mark-box" width={1} flexShrink={0}>
              <Text key="cat-mark" {...(mood === 'startled' ? { color: THEME_COLORS.alert, bold: true } : { dimColor: true })}>
                {mark === '' ? ' ' : mark}
              </Text>
            </Box>
          </Box>
        ) : null}
        <Box flexDirection="column">
          {lines.length === 0 && deviceInfo?.version === undefined ? <Text dimColor>장비 정보를 읽는 중</Text> : null}
          {lines.map((line, i) => (
            <Text key={`device-${i}`} wrap="truncate-end" dimColor>
              {line}
            </Text>
          ))}
          {deviceInfo?.version === undefined ? null : (
            // A later version beside the running one, a link to what changed: cyan when released, yellow
            // with "재시작" when installed and a restart away. (↻ is the 5h reset's: not used here.)
            <Box key="device-version">
              <Text wrap="truncate-end">
                {`Claude Code ${deviceInfo.version}`}
                {note === null ? null : (
                  <Text {...(note.kind === 'restart' ? { color: THEME_COLORS.warn } : { color: THEME_COLORS.effort })}>
                    {' ↑ '}
                    <Link href={CHANGELOG_URL}>{note.version}</Link>
                  </Text>
                )}
              </Text>
              {/* A press restarts onto it, keeping the session: once what runs ends; again, it is taken back. */}
              {note?.kind === 'restart' ? (
                <Button
                  key="restart"
                  plain
                  onPress={() => {
                    void requestRestart($).then(text => $.ui.toast(text))
                  }}
                >
                  {isRestartPending ? <Text color={THEME_COLORS.warn}> 재시작 대기</Text> : <Text dimColor> 재시작</Text>}
                </Button>
              ) : null}
            </Box>
          )}
          {deviceInfo?.pluginVersion === undefined ? null : (
            // hubblerc itself, and whether it runs from the folder it is made in (`hcc`) or the installed copy.
            <Text key="plugin-version" wrap="truncate-end">
              {`hubblerc ${deviceInfo.pluginVersion}`}
              {deviceInfo.isDevBuild === true ? <Text dimColor> dev</Text> : null}
            </Text>
          )}
        </Box>
      </Box>,
    )

    const statusBox = box(
      'status',
      '상태',
      <Box flexDirection="column">
        {status.map((part, i) => (
          <Box key={`status-${i}`}>
            {part.map((segment, j) =>
              segment.role === 'effort' && !isApp ? (
                <Button
                  key="effort"
                  plain
                  action={EFFORT_KEY_ACTION}
                  onPress={() => {
                    void togglePicker($)
                  }}
                >
                  {segmentText(segment, 'effort-text')}
                </Button>
              ) : (
                segmentText(segment, `status-${i}-${j}`)
              ),
            )}
          </Box>
        ))}
        {id === '' ? null : (
          // The session: its name as `/rename` set it (none, none shown), and its short id, a press
          // that copies the whole id (what `claude --resume` takes).
          <Box key="session">
            {name === null ? null : (
              <Text key="session-name" wrap="truncate-end">
                {clipCells(name, Math.max(1, inner - 11))}
                <Text dimColor> · </Text>
              </Text>
            )}
            <Button
              key="session-id"
              plain
              onPress={() => {
                void $.ui.copy({ text: id }).then(copied => $.ui.toast(copied.isCopied ? `세션 id를 복사했습니다: ${id}` : `세션 id를 복사하지 못했습니다: ${copied.reason ?? ''}`))
              }}
            >
              <Text dimColor>{id.slice(0, 8)}</Text>
            </Button>
          </Box>
        )}
        {request.length === 0 ? null : <Box key="request">{request.map((segment, i) => segmentText(segment, `request-${i}`))}</Box>}
        {likelyLine === '' ? null : (
          <Text key="likely" wrap="truncate-end" dimColor>
            {likelyLine}
          </Text>
        )}
      </Box>,
    )

    const activityBox = box(
      'activity',
      '작업',
      <Box flexDirection="column">
        {activity.map((line, i) => (
          <Text key={`activity-${i}`} wrap="truncate-end" {...(line.startsWith('·') ? { dimColor: true } : { color: THEME_COLORS.running })}>
            {line}
          </Text>
        ))}
      </Box>,
    )

    // What is left to commit in this repository stands out; a committed file goes dim with a tick,
    // and a file outside the repository (git never commits it) goes dim under its folder's rule.
    // Its name is a link to the file, as a path in the conversation is: under the fullscreen layout
    // the engine opens a clicked `file:` link itself, elsewhere the terminal does.
    // git's own signs mark the two that are neither: `?` a file git does not track yet (bright, as
    // it is left to commit), `!` one `.gitignore` keeps out (dim, as git never commits it).
    const fileRow = (file: SessionFile) => {
      const isDim = file.isCommitted || file.isOutside || file.isIgnored
      const refs = file.turns.slice(-MAX_TURN_REFS).map(n => `#${n}`)
      const counts: Segment[] = [
        ...(file.isCommitted ? [{ text: ' ✓', dim: true }] : []),
        ...(file.isUntracked ? [{ text: ' ?', color: THEME_COLORS.warn }] : []),
        ...(file.isIgnored ? [{ text: ' !', dim: true }] : []),
        ...(file.added > 0 ? [{ text: ` +${file.added}`, ...(isDim ? { dim: true } : { color: THEME_COLORS.ok }) }] : []),
        ...(file.removed > 0 ? [{ text: ` −${file.removed}`, ...(isDim ? { dim: true } : { color: THEME_COLORS.alert }) }] : []),
        { text: `  ${file.turns.length > MAX_TURN_REFS ? '… ' : ''}${refs.join(' ')}`, dim: true },
      ]
      const room = inner - counts.reduce((sum, segment) => sum + cellWidth(segment.text), 0)

      return (
        <Box key={`file-${file.path}`}>
          <Text {...(isDim ? { dimColor: true } : {})}>
            {file.path.startsWith('/') ? <Link href={fileUrl(file.path)}>{clipCells(file.name, room)}</Link> : clipCells(file.name, room)}
          </Text>
          {counts.map((segment, i) => segmentText(segment, `count-${i}`))}
        </Box>
      )
    }
    /** `┄┄ ~/.claude/…/memory ┄┄┄┄`: a rule with a label on it, as wide as the box holds. */
    const labelledRule = (label: string, key: string) => {
      // Two cells of rule at least after the label, so it reads as a rule.
      const text = shortPath(label, Math.max(1, inner - 6))

      return (
        <Text key={key} dimColor>
          {`┄┄ ${text} ${'┄'.repeat(Math.max(0, inner - 4 - cellWidth(text)))}`}
        </Text>
      )
    }
    // What the twelve left out is a press away: the whole list. Then "줄이기" stands where the
    // repository's "외 N개" stood, between its files and the folders outside, and puts it back.
    const expandFiles = () => {
      void update($, filesExpanded, () => true)
    }
    const more = (count: number, key: string) =>
      count > 0 ? (
        <Button key={key} plain onPress={expandFiles}>
          <Text dimColor>{`외 ${count}개 더 보기`}</Text>
        </Button>
      ) : null

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
      boxRows('activity', activity.length) +
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
    const todoFooter = footerRows(doneCount, undoN, hasField)
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

    const filesBox =
      files.length === 0
        ? null
        : box(
            'files',
            '파일',
            <Box flexDirection="column">
              {shownFiles.inside.map(fileRow)}
              {more(shownFiles.insideHidden, 'inside-more')}
              {isFilesExpanded && isCut ? (
                <Button
                  key="files-collapse"
                  plain
                  onPress={() => {
                    void update($, filesExpanded, () => false)
                  }}
                >
                  <Text dimColor>줄이기</Text>
                </Button>
              ) : null}
              {shownFiles.outside.map(group => (
                <Box key={`outside-${group.folder}`} flexDirection="column">
                  {labelledRule(group.folder, `folder-${group.folder}`)}
                  {group.files.map(fileRow)}
                  {more(group.hidden, `more-${group.folder}`)}
                </Box>
              ))}
              {shownFiles.foldersHidden > 0 ? (
                <Button key="folders-more" plain onPress={expandFiles}>
                  {labelledRule(`다른 폴더 ${shownFiles.foldersHidden}개 더 보기`, 'folders-more-rule')}
                </Button>
              ) : null}
            </Box>,
          )

    const contentsBody = (
      <Box flexDirection="column">
        {all.length === 0 ? <Text dimColor>아직 기록된 답변이 없습니다</Text> : null}
        {entries.map(entry => {
          const failed = entry.failed > 0 ? ` 실패 ${entry.failed}` : ''
          const head = `#${entry.number} `
          const room = inner - cellWidth(head) - cellWidth(failed) - cellWidth(entry.time) - 1
          const label = head + clipCells(entry.title, room)
          const mark = failed === '' ? null : <Text color={THEME_COLORS.alert}>{failed}</Text>
          const canJump = entry.target !== undefined || entry.key !== undefined

          return (
            <Box key={`entry-${entry.id}`} justifyContent="space-between">
              {!canJump ? (
                // Nothing to find its row by.
                <Text>
                  {label}
                  {mark}
                </Text>
              ) : (
                <Button
                  key={`turn-${entry.id}`}
                  plain
                  onPress={() => {
                    void jumpTo($, entry)
                  }}
                >
                  {label}
                  {mark}
                </Button>
              )}
              <Text {...(entry.isRunning ? { color: THEME_COLORS.running } : { dimColor: true })}>{entry.time}</Text>
            </Box>
          )
        })}
        {pages > 1 ? (
          // Pages run from the newest answers (1) back; the arrows point the way the numbers do.
          <Box columnGap={2}>
            {page > 0 ? (
              <Button key="toc-newer" plain onPress={() => goTo(page - 1)}>
                ◀ 최근
              </Button>
            ) : (
              <Text dimColor>◀ 최근</Text>
            )}
            {pageNumbers(page, pages).map(n =>
              n === page ? (
                <Text key={`toc-page-${n}`} color={THEME_COLORS.effort} bold>
                  {String(n + 1)}
                </Text>
              ) : (
                <Button key={`toc-page-${n}`} plain onPress={() => goTo(n)}>
                  {String(n + 1)}
                </Button>
              ),
            )}
            {page < pages - 1 ? (
              <Button key="toc-older" plain onPress={() => goTo(page + 1)}>
                이전 ▶
              </Button>
            ) : (
              <Text dimColor>이전 ▶</Text>
            )}
          </Box>
        ) : null}
      </Box>
    )

    // The to-dos: in progress, waiting, on hold, done, as many as the rows hold (twelve at most) and
    // "외 N개"; under them "완료 N개 지우기", "↶ 되돌리기" after a delete, and the field that writes one
    // (or edits the item whose text was pressed, that row marked).
    const shownTodos = userTodos.slice(0, todosShown(userTodos.length, contentsRoom, todoFooter))
    const todoRow = (item: UserTodo) => {
      const isEdited = edited?.id === item.id
      const isDim = !isEdited && (item.status === 'done' || item.status === 'on_hold')
      const mark = STATUS_MARK[item.status]
      // The sign (an emoji, two cells), a space, the text; then a cell at least before the tail.
      const room = inner - cellWidth(`${mark} `) - rowTailCells(item) - 1
      const text = (
        <Text {...(isEdited ? { bold: true, color: THEME_COLORS.effort } : isDim ? { dimColor: true } : {})}>{` ${clipCells(oneLine(item.text), room)}`}</Text>
      )

      // ↗ and ✕ hold a space each side, three cells to press, the sign in the middle of the focus mark.
      return (
        <Box key={`todo-${item.id}`} justifyContent="space-between">
          <Box>
            {/* A press moves it on: waiting, in progress, done, on hold, waiting. An emoji keeps its colours: no dim, no theme colour. */}
            <Button
              key={`todo-status-${item.id}`}
              plain
              onPress={() => {
                void cycleTodo($, item.id)
              }}
            >
              <Text>{mark}</Text>
            </Button>
            {/* A press on the text edits it in the field below; no field (mobile), no press. */}
            {hasField ? (
              <Button
                key={`todo-text-${item.id}`}
                plain
                onPress={() => {
                  void startEditTodo($, item.id)
                }}
              >
                {text}
              </Button>
            ) : (
              text
            )}
          </Box>
          <Box>
            {showsTurn(item) ? <Text dimColor>{` #${item.turn}`}</Text> : null}
            {item.status === 'pending' ? (
              <Button
                key={`todo-send-${item.id}`}
                plain
                onPress={() => {
                  void offerTodo($, item)
                }}
              >
                <Text color={THEME_COLORS.effort}> ↗ </Text>
              </Button>
            ) : null}
            <Button
              key={`todo-delete-${item.id}`}
              plain
              onPress={() => {
                void deleteTodo($, item.id)
              }}
            >
              <Text dimColor> ✕ </Text>
            </Button>
          </Box>
        </Box>
      )
    }
    const todoBody = (
      <Box flexDirection="column">
        {userTodos.length === 0 ? <Text dimColor>적어 둔 할 일이 없습니다</Text> : null}
        {shownTodos.map(todoRow)}
        {userTodos.length > shownTodos.length ? (
          <Text key="todo-more" dimColor>
            {`외 ${userTodos.length - shownTodos.length}개`}
          </Text>
        ) : null}
        {doneCount > 0 ? (
          <Button
            key="todo-clear-done"
            plain
            onPress={() => {
              void clearDoneTodos($)
            }}
          >
            <Text dimColor>{`완료 ${doneCount}개 지우기`}</Text>
          </Button>
        ) : null}
        {undoN > 0 ? (
          <Button
            key="todo-undo"
            plain
            onPress={() => {
              void undoDelete($)
            }}
          >
            <Text color={THEME_COLORS.effort}>{`↶ 되돌리기 (${undoN}개)`}</Text>
          </Button>
        ) : null}
        {/* Enter writes it; the engine empties the field after. Editing, a field of its own holds the
            item's text: Enter saves, empty cancels, and so does the pane letting the keyboard go (Esc). */}
        {Input === undefined ? null : edited !== null ? (
          <Input
            key={editFieldKey()}
            label="수정 중 "
            value={edited.text}
            placeholder="비우고 Enter면 취소"
            submitLabel="저장"
            onSubmit={value => {
              void saveEditFromField($, edited.id, value)
            }}
          />
        ) : (
          <Input
            key="todo-input"
            placeholder="할 일 적기"
            submitLabel="추가"
            onSubmit={value => {
              void addTodoFromField($, value)
            }}
          />
        )}
      </Box>
    )

    // The contents and the to-dos share the last box, its title the tabs: `╭── ▾ 목차 12 │ 할 일 3 ──`.
    // The arrow folds the box; a tab's name shows that tab (and unfolds a folded box), the shown one bold.
    const contentsLabel = shownTab === 'contents' && pages > 1 ? `목차 #${entries.at(-1)?.number ?? ''}~${entries[0]?.number ?? ''} / ${all.length}` : `목차 ${all.length}`
    const todoLabel = `할 일 ${openCount(userTodos)}`
    const tabButton = (tab: SidebarTab, label: string, isFolded: boolean) => (
      <Button
        key={`tab-${tab}`}
        plain
        onPress={() => {
          void selectTab($, tab).then(() => (isFolded ? toggleFold($, 'contents') : undefined))
        }}
      >
        <Text {...(tab === shownTab ? { bold: true } : { dimColor: true })}>{label}</Text>
      </Button>
    )
    const tabsHeading = (isFolded: boolean) => ({
      cells: 3 + cellWidth(contentsLabel) + 3 + cellWidth(todoLabel) + 1,
      element: (
        <Box key="tabs-contents">
          <Button
            key="fold-contents"
            plain
            onPress={() => {
              void toggleFold($, 'contents')
            }}
          >
            <Text dimColor>{isFolded ? ' ▸ ' : ' ▾ '}</Text>
          </Button>
          {tabButton('contents', contentsLabel, isFolded)}
          <Text dimColor> │ </Text>
          {tabButton('todo', todoLabel, isFolded)}
          <Text> </Text>
        </Box>
      ),
    })
    const contentsBox = box('contents', tabsHeading, shownTab === 'todo' ? todoBody : contentsBody)

    return (
      <Box flexDirection="column">
        {deviceBox}
        {statusBox}
        {activityBox}
        {filesBox}
        {contentsBox}
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

/** The page numbers the pager offers: up to seven around the page shown, the first and last kept. */
function pageNumbers(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i)
  const start = Math.min(Math.max(0, page - 3), pages - 7)

  return Array.from({ length: 7 }, (_, i) => start + i)
}
