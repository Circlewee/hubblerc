import type { EngineInterface } from 'claude-code'

import { EFFORT_KEY_ACTION, togglePicker } from '../../effort/effort-picker'
import type { Segment } from '../../shared/style'
import { peerCopyText, refreshPeerName } from '../../status/peer'
import type { PeerName } from '../../status/peer'
import { clipCells } from '../sidebar-format'
import type { Frame } from './frame'

export type StatusDrawing = {
  /** The band's line 1 as the sidebar draws it, one part a line. */
  status: readonly Segment[][]
  /** The session's id ('' none) and its name as `/rename` set it (read from the transcript: shown only while the registry is unread). */
  id: string
  name: string | null
  /** What another session messages this one by (the session registry's name), null unread. */
  peer: PeerName | null
  /** When the last request went out and what it carried. */
  request: readonly Segment[]
  /** likely's spend, '' with no API key. */
  likelyLine: string
}

/** The band's status, one item a line; the session; the last request; likely's spend. `$` only on a press. */
export function statusBox($: EngineInterface, f: Frame, s: StatusDrawing): JSX.Element {
  const { Box, Text, Button } = f.parts
  const { status, id, name, peer, request, likelyLine } = s
  // One name: the registry's (a rename sets it), else the `/rename` name read from the transcript, else the short id.
  const label = peer?.name ?? name ?? id.slice(0, 8)

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
        // The session's one name: what another session messages it by. A press copies it with the
        // start: what another session's SendMessage finds it by (it does not find a session id).
        <Box key="session">
          <Button
            key="session-id"
            plain
            onPress={() => {
              void copySession($, id, peer)
            }}
          >
            <Text dimColor wrap="truncate-end">
              {clipCells(label, Math.max(1, f.inner))}
            </Text>
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

/** Copies what another session messages this one by, read again at the press; the session id when the registry has none. */
async function copySession($: EngineInterface, id: string, known: PeerName | null): Promise<void> {
  const peer = (await refreshPeerName($).catch(() => undefined)) ?? known ?? undefined
  const copyText = peer === undefined ? id : peerCopyText(peer)
  const what = peer === undefined ? '세션 id를' : '메시지용 세션 이름을'
  const copied = await $.ui.copy({ text: copyText })
  $.ui.toast(copied.isCopied ? `${what} 복사했습니다: ${copyText}` : `${what} 복사하지 못했습니다: ${copied.reason ?? ''}`)
}
