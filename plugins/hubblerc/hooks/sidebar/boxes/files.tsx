import { THEME_COLORS } from '../../shared/style'
import type { Segment } from '../../shared/style'
import { cellWidth } from '../../shared/text-width'
import { clipCells, fileUrl, shortPath } from '../sidebar-format'
import type { FileLayout, SessionFile } from '../sidebar-format'
import type { Frame } from './frame'

const MAX_TURN_REFS = 4

export type FilesDrawing = {
  /** The files shown: all of them, or as many as the rows hold. */
  shown: FileLayout
  isExpanded: boolean
  /** Whether the rows hold fewer than all: "줄이기" stands while every file shows. */
  isCut: boolean
  /** A press on "외 N개 더 보기": every file; on "줄이기": back to what the rows hold. */
  onExpand: () => void
  onCollapse: () => void
}

/**
 * The files the session changed, with the answers that changed them: those in the repository first,
 * then each folder outside under a rule of its own.
 */
export function filesBox(f: Frame, d: FilesDrawing): JSX.Element {
  const { Box, Text, Button, Link } = f.parts
  const { shown: shownFiles, isExpanded: isFilesExpanded, isCut, onExpand: expandFiles, onCollapse } = d
  const inner = f.inner

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
        {counts.map((segment, i) => f.segmentText(segment, `count-${i}`))}
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
  const more = (count: number, key: string) =>
    count > 0 ? (
      <Button key={key} plain onPress={expandFiles}>
        <Text dimColor>{`외 ${count}개 더 보기`}</Text>
      </Button>
    ) : null

  return f.box(
    'files',
    'Files',
    <Box flexDirection="column">
      {shownFiles.inside.map(fileRow)}
      {more(shownFiles.insideHidden, 'inside-more')}
      {isFilesExpanded && isCut ? (
        <Button
          key="files-collapse"
          plain
          onPress={() => {
            onCollapse()
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
}
