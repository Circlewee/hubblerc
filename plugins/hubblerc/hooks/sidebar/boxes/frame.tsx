import type { BoxProps, ButtonProps, ElementConstructor, LinkProps, TextProps } from 'claude-code'

import { textStyle } from '../../shared/style'
import type { Segment } from '../../shared/style'
import { cellWidth } from '../../shared/text-width'

/** The sidebar's boxes, by the id their fold is kept under. */
export type SectionId = 'device' | 'status' | 'relay' | 'files' | 'contents'

/** The elements a box draws with, as `$.ui.resolve` gave them to the sidebar's drawing. */
export type Parts = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
}

/** What a box's title draws on its top border, and the cells it takes. */
export type Heading = { element: JSX.Element; cells: number }

/** What each box of the sidebar draws with: the elements, the room inside a box, and the box itself. */
export type Frame = {
  parts: Parts
  /** The desktop app (and VS Code): no cat, no borders, the effort value as text. */
  isApp: boolean
  /** What a box holds: the width less the box's frame. */
  inner: number
  box: (id: SectionId, title: string | ((isFolded: boolean) => Heading), body: JSX.Element) => JSX.Element
  segmentText: (segment: Segment, key: string) => JSX.Element
}

/** The frame the boxes of one drawing share; `onFold` is a press on a box's title. */
export function frame(
  parts: Parts,
  { isApp, width, inner, foldedIds, onFold }: { isApp: boolean; width: number; inner: number; foldedIds: readonly string[]; onFold: (id: SectionId) => void },
): Frame {
  const { Box, Text, Button } = parts

  const segmentText = (segment: Segment, key: string) => (
    <Text key={key} {...textStyle(segment)}>
      {segment.text}
    </Text>
  )

  /** The arrow and the title, one press that folds the box. */
  const titleHeading = (id: SectionId, title: string, isFolded: boolean): Heading => ({
    cells: 3 + cellWidth(title) + 1,
    element: (
      <Button
        key={`fold-${id}`}
        plain
        onPress={() => {
          onFold(id)
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

  return { parts, isApp, inner, box, segmentText }
}
