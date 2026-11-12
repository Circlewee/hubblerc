import { THEME_COLORS } from '../../shared/style'
import { cellWidth } from '../../shared/text-width'
import type { SidebarTab } from '../../todo/todo-format'
import { clipCells } from '../sidebar-format'
import type { TocEntry } from '../sidebar-format'
import type { Frame, Heading } from './frame'

export type ContentsDrawing = {
  /** How many answers the session has: none, a line says so. */
  count: number
  /** The answers on the page shown, newest first; the page and how many there are. */
  entries: readonly TocEntry[]
  page: number
  pages: number
  /** A press on an answer: its place in the conversation; on the pager: another page. */
  onJump: (entry: TocEntry) => void
  onPage: (page: number) => void
}

/** The contents: the session's answers newest first, each a press away from its place, and a pager. */
export function contentsBody(f: Frame, d: ContentsDrawing): JSX.Element {
  const { Box, Text, Button } = f.parts
  const { entries, page, pages, onJump, onPage: goTo } = d
  const inner = f.inner

  return (
    <Box flexDirection="column">
      {d.count === 0 ? <Text dimColor>아직 기록된 답변이 없습니다</Text> : null}
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
                  onJump(entry)
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
}

/** The page numbers the pager offers: up to seven around the page shown, the first and last kept. */
function pageNumbers(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i)
  const start = Math.min(Math.max(0, page - 3), pages - 7)

  return Array.from({ length: 7 }, (_, i) => start + i)
}

export type TabsDrawing = {
  shownTab: SidebarTab
  contents: ContentsDrawing
  /** The to-dos not done: the tab's count. */
  openTodos: number
  /** A press on the arrow folds the box; on a tab's name shows that tab, unfolding a folded box. */
  onFold: () => void
  onTab: (tab: SidebarTab, isFolded: boolean) => void
}

/**
 * The contents and the to-dos share the last box, its title the tabs: `╭── ▾ Contents 12 │ Todos 3 ──`.
 * The arrow folds the box; a tab's name shows that tab (and unfolds a folded box), the shown one bold.
 */
export function tabsHeading(f: Frame, d: TabsDrawing): (isFolded: boolean) => Heading {
  const { Box, Text, Button } = f.parts
  const { shownTab, contents, onFold, onTab } = d
  const { entries, pages, count } = contents
  const contentsLabel = shownTab === 'contents' && pages > 1 ? `Contents #${entries.at(-1)?.number ?? ''}~${entries[0]?.number ?? ''} / ${count}` : `Contents ${count}`
  const todoLabel = `Todos ${d.openTodos}`
  const tabButton = (tab: SidebarTab, label: string, isFolded: boolean) => (
    <Button
      key={`tab-${tab}`}
      plain
      onPress={() => {
        onTab(tab, isFolded)
      }}
    >
      <Text {...(tab === shownTab ? { bold: true } : { dimColor: true })}>{label}</Text>
    </Button>
  )

  return (isFolded: boolean) => ({
    cells: 3 + cellWidth(contentsLabel) + 3 + cellWidth(todoLabel) + 1,
    element: (
      <Box key="tabs-contents">
        <Button
          key="fold-contents"
          plain
          onPress={() => {
            onFold()
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
}
