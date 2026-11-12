import type { EngineInterface } from 'claude-code'

import { EFFORT_KEY_ACTION, togglePicker } from '../../effort/effort-picker'
import type { Segment } from '../../shared/style'
import { clipCells } from '../sidebar-format'
import type { Frame } from './frame'

export type StatusDrawing = {
  /** The band's line 1 as the sidebar draws it, one part a line. */
  status: readonly Segment[][]
  /** The session's id ('' none) and its name as `/rename` set it. */
  id: string
  name: string | null
  /** When the last request went out and what it carried. */
  request: readonly Segment[]
  /** likely's spend, '' with no API key. */
  likelyLine: string
}

/** The band's status, one item a line; the session; the last request; likely's spend. `$` only on a press. */
export function statusBox($: EngineInterface, f: Frame, s: StatusDrawing): JSX.Element {
  const { Box, Text, Button } = f.parts
  const { status, id, name, request, likelyLine } = s

  return f.box(
    'status',
    'Status',
    <Box flexDirection="column">
      {status.map((part, i) => (
        <Box key={`status-${i}`}>
          {part.map((segment, j) =>
            segment.role === 'effort' && !f.isApp ? (
              <Button
                key="effort"
                plain
                action={EFFORT_KEY_ACTION}
                onPress={() => {
                  void togglePicker($)
                }}
              >
                {f.segmentText(segment, 'effort-text')}
              </Button>
            ) : (
              f.segmentText(segment, `status-${i}-${j}`)
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
              {clipCells(name, Math.max(1, f.inner - 11))}
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
      {request.length === 0 ? null : <Box key="request">{request.map((segment, i) => f.segmentText(segment, `request-${i}`))}</Box>}
      {likelyLine === '' ? null : (
        <Text key="likely" wrap="truncate-end" dimColor>
          {likelyLine}
        </Text>
      )}
    </Box>,
  )
}
