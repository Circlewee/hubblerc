import type { Segment } from '../../shared/style'
import type { Frame } from './frame'

/**
 * The relay runs of the repository not finished (`hooks/relay/relay-status.ts`): each run's name,
 * a line per task, the decisions waiting on the person and the last verdict. Drawn from state
 * alone; the sidebar draws no box while there is no such run.
 */
export function relayBox(f: Frame, lines: readonly Segment[][]): JSX.Element {
  const { Box, Text } = f.parts

  return f.box(
    'relay',
    'relay',
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={`relay-${i}`}>
          <Text wrap="truncate-end">{line.map((segment, j) => f.segmentText(segment, `relay-${i}-${j}`))}</Text>
        </Box>
      ))}
    </Box>,
  )
}
