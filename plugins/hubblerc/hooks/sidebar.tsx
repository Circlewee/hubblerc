import { atom, read, update } from 'claude-code'
import type { CommandPresentation, EngineInterface, On, RenderViewport } from 'claude-code'

import { activityParts, cellWidth, requestSegments, statusParts, textStyle, THEME_COLORS } from './band-format'
import type { Segment } from './band-format'
import { promptKey } from './activity'
import { EFFORT_KEY_ACTION, togglePicker } from './effort-picker'
import { CHANGELOG_URL, deviceLines, versionNote } from './device'
import { burnoutMinutes, requestTime } from './forecast'
import { CAT_PALETTE, catFrame, catMood, pixelRows } from './pixel-art'
import { clipCells, fileLayout, fileRows, fileUrl, fitFileLayout, sessionFiles, shareRows, shortPath, tocEntries, tocPage, tocPageSize, tocRows } from './sidebar-format'
import type { FileLimits, SessionFile, TocEntry } from './sidebar-format'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const running = atom({ plugin: 'hubblerc', key: 'running' } as const, [])
const todos = atom({ plugin: 'hubblerc', key: 'todos' } as const, [])
const agents = atom({ plugin: 'hubblerc', key: 'agents' } as const, [])
const usage = atom({ plugin: 'hubblerc', key: 'usage' } as const, null)
const git = atom({ plugin: 'hubblerc', key: 'git' } as const, null)
const project = atom({ plugin: 'hubblerc', key: 'project' } as const, '')
const model = atom({ plugin: 'hubblerc', key: 'model' } as const, '')
const effortOverride = atom({ plugin: 'hubblerc', key: 'effortOverride' } as const, null)
const engineEffort = atom({ plugin: 'hubblerc', key: 'engineEffort' } as const, null)
const effortAuto = atom({ plugin: 'hubblerc', key: 'effortAuto' } as const, null)
const autoPick = atom({ plugin: 'hubblerc', key: 'autoPick' } as const, null)
const tocPageIndex = atom({ plugin: 'hubblerc', key: 'tocPage' } as const, 0)
const tick = atom({ plugin: 'hubblerc', key: 'tick' } as const, 0)
const fiveHourLog = atom({ plugin: 'hubblerc', key: 'fiveHourLog' } as const, [])
const lastRequestAt = atom({ plugin: 'hubblerc', key: 'lastRequestAt' } as const, null)
const folded = atom({ plugin: 'hubblerc', key: 'folded' } as const, [])
const filesExpanded = atom({ plugin: 'hubblerc', key: 'filesExpanded' } as const, false)
const device = atom({ plugin: 'hubblerc', key: 'device' } as const, null)
const streamPhase = atom({ plugin: 'hubblerc', key: 'streamPhase' } as const, null)
const effortLog = atom({ plugin: 'hubblerc', key: 'effortLog' } as const, [])

/** The sidebar's boxes, by the id their fold is kept under. */
export type SectionId = 'device' | 'status' | 'activity' | 'files' | 'contents'
/** Where the folds are kept across sessions. */
const FOLDED_KEY = 'sidebarFolded'
/** Cells a box takes from the width: its border and a cell of padding, each side. */
const BOX_FRAME = 4

export const SIDEBAR_ID = 'hubblerc'
const SIDEBAR_TITLE = 'hubblerc'
/** The width the dock is asked for; the engine holds it to 24..45% of the terminal. */
const SIDEBAR_COLUMNS = 56
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

  const pane = (await $.ui.panes()).find(open => open.id === SIDEBAR_ID)
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

  return pane !== undefined && pane.isPlaced && pane.isShown
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

    const [turnList, runningList, todoList, agentList, figures, gitInfo, projectName, modelId, override, engine, auto, pick, pageIndex, log, lastRequest, foldedIds, isFilesExpanded, deviceInfo, phase, requestLog] =
      await Promise.all([
        read($, turns),
        read($, running),
        read($, todos),
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
        read($, effortLog),
      ])
    // Read so the timer's writes redraw elapsed times and countdowns.
    await read($, tick)
    const now = await $.clock.now()

    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    /** What a box holds: the width less the box's frame. */
    const inner = Math.max(1, width - BOX_FRAME)

    const isAuto = (auto ?? autoByDefault) && override === null
    const effort = override ?? (isAuto ? (pick?.level ?? null) : engine)
    const burnout = burnoutMinutes(log, figures?.fiveHour, now)
    const status = statusParts(
      { model: modelId, effort, isOverridden: override !== null, isAuto, usage: figures, project: projectName, git: gitInfo, now, burnout, isRoomy: true, palette: THEME_COLORS, barColumns: inner },
      Number.POSITIVE_INFINITY,
    )
    const isWorking = turnList.at(-1)?.durationMs === null
    // When the last request went out and what it carried, the cache's share of its input; mid-answer too.
    const request = requestSegments(requestTime(lastRequest), requestLog.at(-1), THEME_COLORS)
    const activity = activityParts(runningList, agentList, todoList, isWorking, now)
    const files = sessionFiles(turnList, gitInfo)
    const all = tocEntries(turnList, now)

    const segmentText = (segment: Segment, key: string) => (
      <Text key={key} {...textStyle(segment)}>
        {segment.text}
      </Text>
    )

    /**
     * A box with its title on the top border (`╭── ▾ 상태 ───╮`), the title a press that folds it;
     * folded, the title alone on a rule as wide as the box (`╶── ▸ 상태 ────`).
     *
     * The title is the box's sibling, not its child: a child drawn over the border vanished on
     * screen (2.1.310), the border painted over it. Laid out `column-reverse`, the box comes first
     * and is painted first; the title row after it sits above it and, by a margin of -1, on its top
     * border, painted last.
     */
    const box = (id: SectionId, title: string, body: JSX.Element) => {
      const isFolded = foldedIds.includes(id)
      const heading = (
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
      )

      if (isFolded) {
        const rule = Math.max(0, width - 3 - 3 - cellWidth(title) - 1)

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

    // The machine and the engine, beside a cat drawn in half blocks that shows what the session does.
    const lines = deviceLines(deviceInfo)
    const note = versionNote(deviceInfo)
    const lastDone = turnList.findLast(turn => turn.durationMs !== null)
    const mood = catMood({
      isWorking,
      isToolRunning: runningList.length > 0 || agentList.some(agent => agent.status === 'running' || agent.status === 'pending'),
      phase,
      lastFailed: lastDone !== undefined && lastDone.runs.some(run => run.isError),
    })
    const cat = catFrame(mood, Math.floor(now / 1000))
    const catRows = pixelRows(cat.art, CAT_PALETTE)
    const deviceBox = box(
      'device',
      '장비',
      // A row of air above and below: the cat and its lines sit apart from the borders.
      <Box key="device-body" columnGap={2} paddingY={1}>
        <Box flexDirection="column" flexShrink={0}>
          {catRows.map((row, y) => (
            <Box key={`cat-${y}`}>
              {row.map((run, x) => (
                <Text key={`cat-${y}-${x}`} {...(run.color === undefined ? {} : { color: run.color })} {...(run.backgroundColor === undefined ? {} : { backgroundColor: run.backgroundColor })}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
        {/* Beside the head: z, ?, !; a column of its own, so the lines never move. */}
        <Box width={1} flexShrink={0} marginLeft={-1}>
          <Text key="cat-mark" {...(mood === 'startled' ? { color: THEME_COLORS.alert, bold: true } : { dimColor: true })}>
            {cat.mark === '' ? ' ' : cat.mark}
          </Text>
        </Box>
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
                {note?.kind === 'restart' ? <Text dimColor> 재시작</Text> : null}
              </Text>
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
              segment.role === 'effort' ? (
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
        {request.length === 0 ? null : <Box key="request">{request.map((segment, i) => segmentText(segment, `request-${i}`))}</Box>}
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
      boxRows('device', 2 + Math.max(catRows.length, deviceText)) +
      boxRows('status', status.length + (request.length === 0 ? 0 : 1)) +
      boxRows('activity', activity.length) +
      (files.length === 0 ? 0 : boxRows('files', 0)) +
      boxRows('contents', 0)
    // No rows given (a surface that does not say): nothing is cut.
    const bodyRows = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : Number.POSITIVE_INFINITY
    const room = bodyRows - above
    const share = shareRows(
      room,
      isFilesOpen ? fileRows(fileLayout(files, FILE_LIMITS)) : 0,
      isContentsOpen ? tocRows(all.length, TOC_PAGE_SIZE) : 0,
    )
    const limited = fitFileLayout(files, FILE_LIMITS, share.files)
    const isCut = limited.insideHidden > 0 || limited.foldersHidden > 0 || limited.outside.some(group => group.hidden > 0)
    const shownFiles = isFilesExpanded ? fileLayout(files, NO_FILE_LIMITS) : limited
    // Every file shown, the contents keep what the files leave, or their least.
    const contentsRoom = isFilesExpanded && isFilesOpen ? Math.max(Math.min(3, share.toc), room - fileRows(shownFiles, isCut)) : share.toc
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

    const contentsBox = box(
      'contents',
      pages === 1 ? `목차 ${all.length}` : `목차 #${entries.at(-1)?.number ?? ''}~${entries[0]?.number ?? ''} / ${all.length}`,
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
      </Box>,
    )

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
  if (target === undefined) {
    $.ui.toast(`#${entry.number}의 질문이 아직 화면에 그려지지 않아 이동할 수 없습니다.`)

    return
  }

  const moved = await $.ui.scroll({ to: { requestId: target.requestId }, block: target.block }).catch((error: unknown) => ({
    deny: String(error),
  }))
  if (moved.deny !== undefined) $.ui.toast(`#${entry.number}(으)로 이동하지 못했습니다: ${moved.deny}`)
}

/** The page numbers the pager offers: up to seven around the page shown, the first and last kept. */
function pageNumbers(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i)
  const start = Math.min(Math.max(0, page - 3), pages - 7)

  return Array.from({ length: 7 }, (_, i) => start + i)
}
