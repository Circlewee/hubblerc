import type { BoxProps, ElementConstructor, EngineInterface } from 'claude-code'

import type { DeviceInfo } from '../../../types'
import { THEME_COLORS } from '../../shared/style'
import { requestRestart } from '../../system/relaunch'
import type { CatMood } from '../cat-images'
import { CHANGELOG_URL, versionNote } from '../device'
import { PICTURE_KEY, PICTURE_ROWS } from '../picture'
import type { Frame } from './frame'

export type DeviceDrawing = {
  info: DeviceInfo | null
  lines: readonly string[]
  note: ReturnType<typeof versionNote>
  /** The cat's picture and its width in cells; none drawn when null. */
  picture: { png: string } | null
  pictureColumns: number
  Image: ElementConstructor<BoxProps> | undefined
  mood: CatMood
  mark: string
  isRestartPending: boolean
}

/**
 * A cat that shows what the session does, and the machine and the engine: the cat a picture beside
 * the lines where the terminal draws one, else the lines alone. `$` only on a press.
 */
export function deviceBox($: EngineInterface, f: Frame, d: DeviceDrawing): JSX.Element {
  const { Box, Text, Button, Link } = f.parts
  const { info: deviceInfo, lines, note, picture, pictureColumns, Image, mood, mark, isRestartPending } = d

  return f.box(
    'device',
    'Device',
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
}
