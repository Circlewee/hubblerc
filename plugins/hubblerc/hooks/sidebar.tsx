import { atom, read, update } from 'claude-code'
import type { CommandPresentation, EngineInterface, On, RenderViewport } from 'claude-code'

import { activityParts, cellWidth, COLORS, statusParts, textStyle } from './band-format'
import type { Segment } from './band-format'
import { promptKey } from './activity'
import { EFFORT_KEY_ACTION, togglePicker } from './effort-picker'
import { clipCells, sessionFiles, tocEntries } from './sidebar-format'
import type { TocEntry } from './sidebar-format'

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
const tick = atom({ plugin: 'hubblerc', key: 'tick' } as const, 0)

export const SIDEBAR_ID = 'hubblerc'
const SIDEBAR_TITLE = 'hubblerc'
/** The width the dock is asked for; the engine holds it to 24..45% of the terminal. */
const SIDEBAR_COLUMNS = 56
const MAX_FILES_SHOWN = 12
const MAX_TURN_REFS = 4
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

/** At session.start: a fresh start for the module state; under the band layout a sidebar left from another layout closes. */
export async function startSidebar($: EngineInterface, layout: Layout): Promise<void> {
  isOpening = false
  isClosing = false
  isDismissed = false
  isPeeking = false
  if (layout !== 'band') return
  if ((await $.ui.panes()).some(open => open.id === SIDEBAR_ID)) await $.ui.close({ id: SIDEBAR_ID })
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
 * The sidebar: the band's status, one item a line; what runs; the files the session changed, with
 * the answers that changed them; and the contents, the session's answers newest first, each a press
 * away from its place in the conversation. What each answer did is on its own closing line, not here.
 */
export function showSidebar(on: On, layout: Layout): void {
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

    const [turnList, runningList, todoList, agentList, figures, gitInfo, projectName, modelId, override, engine] =
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
      ])
    // Read so the timer's writes redraw elapsed times and countdowns.
    await read($, tick)
    const now = await $.clock.now()

    const { Box, Text, Button } = $.ui.resolve(e)
    const width = e.props.bodyColumns

    const status = statusParts(
      { model: modelId, effort: override ?? engine, isOverridden: override !== null, usage: figures, project: projectName, git: gitInfo, now },
      Number.POSITIVE_INFINITY,
    )
    const isWorking = turnList.at(-1)?.durationMs === null
    const activity = activityParts(runningList, agentList, todoList, isWorking, now)
    const files = sessionFiles(turnList)
    const entries = tocEntries(turnList, now)

    const segmentText = (segment: Segment, key: string) => (
      <Text key={key} {...textStyle(segment)}>
        {segment.text}
      </Text>
    )

    return (
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

        <Box flexDirection="column" marginTop={1}>
          {activity.map((line, i) => (
            <Text key={`activity-${i}`} wrap="truncate-end" {...(line.startsWith('·') ? { dimColor: true } : { color: COLORS.running })}>
              {line}
            </Text>
          ))}
        </Box>

        {files.length === 0 ? null : (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{`변경 파일 ${files.length}`}</Text>
            {files.slice(0, MAX_FILES_SHOWN).map(file => {
              const refs = file.turns.slice(-MAX_TURN_REFS).map(n => `#${n}`)
              const counts: Segment[] = [
                ...(file.added > 0 ? [{ text: ` +${file.added}`, color: COLORS.ok }] : []),
                ...(file.removed > 0 ? [{ text: ` −${file.removed}`, color: COLORS.alert }] : []),
                { text: `  ${file.turns.length > MAX_TURN_REFS ? '… ' : ''}${refs.join(' ')}`, dim: true },
              ]
              const room = width - 2 - counts.reduce((sum, segment) => sum + cellWidth(segment.text), 0)

              return (
                <Box key={`file-${file.path}`} paddingLeft={2}>
                  <Text>{clipCells(file.name, room)}</Text>
                  {counts.map((segment, i) => segmentText(segment, `count-${i}`))}
                </Box>
              )
            })}
            {files.length > MAX_FILES_SHOWN ? (
              <Box paddingLeft={2}>
                <Text dimColor>{`외 ${files.length - MAX_FILES_SHOWN}개`}</Text>
              </Box>
            ) : null}
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>{entries.length === 0 ? '아직 기록된 답변이 없습니다' : '목차'}</Text>
        </Box>
        {entries.map(entry => {
          const failed = entry.failed > 0 ? ` 실패 ${entry.failed}` : ''
          const head = `#${entry.number} `
          const room = width - 2 - cellWidth(head) - cellWidth(failed) - cellWidth(entry.time) - 1
          const label = head + clipCells(entry.title, room)
          const mark = failed === '' ? null : <Text color={COLORS.alert}>{failed}</Text>
          const canJump = entry.target !== undefined || entry.key !== undefined

          return (
            <Box key={`entry-${entry.id}`} paddingLeft={2} justifyContent="space-between">
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
              <Text {...(entry.isRunning ? { color: COLORS.running } : { dimColor: true })}>{entry.time}</Text>
            </Box>
          )
        })}
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
