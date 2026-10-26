import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { EffortLevel } from '../types'
import { activityParts, COLORS, EFFORT_LEVELS, lastAnswer, requestSegments, SEPARATOR, statusParts, textStyle } from './band-format'
import type { Segment } from './band-format'
import { choose, EFFORT_KEY_ACTION, togglePicker } from './effort-picker'
import { burnoutMinutes, cacheShare, requestTime } from './forecast'
import { syncSidebar } from './sidebar'
import type { Layout } from './sidebar'

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
const effortPicker = atom({ plugin: 'hubblerc', key: 'effortPicker' } as const, null)
const effortAuto = atom({ plugin: 'hubblerc', key: 'effortAuto' } as const, null)
const autoPick = atom({ plugin: 'hubblerc', key: 'autoPick' } as const, null)
const fiveHourLog = atom({ plugin: 'hubblerc', key: 'fiveHourLog' } as const, [])
const lastRequestAt = atom({ plugin: 'hubblerc', key: 'lastRequestAt' } as const, null)

const LEVEL_LABELS: Record<EffortLevel, string> = { low: 'low', medium: 'med', high: 'high', xhigh: 'xhigh', max: 'max' }

/**
 * The three lines above the prompt, in place of the claude-hud status line:
 * 1. model · effort │ context │ 5h and 7d limits (a burn-out chip when 5h runs out soon) │ project branch
 * 2. what runs now, or the todo in progress, or that it waits
 * 3. the last answer's summary and, while idle, how long since the last request; or the effort slider while it is open
 *
 * Colors only where something needs attention, by the terminal's own color names.
 */
export function showBand(on: On, layout: Layout, autoByDefault: boolean): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isSidebarUp = await syncSidebar($, layout, e.viewport).catch(() => false)
    if (e.props.hasSurvey) return next(e)

    const [turnList, runningList, todoList, agentList, figures, gitInfo, projectName, modelId, override, engine, pickerOpenedAt, auto, pick, log, lastRequest] =
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
        read($, effortPicker),
        read($, effortAuto),
        read($, autoPick),
        read($, fiveHourLog),
        read($, lastRequestAt),
      ])
    // Read so the timer's writes redraw elapsed times and countdowns.
    await read($, tick)
    const now = await $.clock.now()

    const isAuto = (auto ?? autoByDefault) && override === null
    const effort = override ?? (isAuto ? (pick?.level ?? null) : engine)
    const burnout = burnoutMinutes(log, figures?.fiveHour, now)
    const line1 = statusParts(
      { model: modelId, effort, isOverridden: override !== null, isAuto, usage: figures, project: projectName, git: gitInfo, now, burnout },
      e.props.bodyColumns,
    )
    const line2 = activityParts(runningList, agentList, todoList, e.props.isWorking, now).join(SEPARATOR)
    const isIdle = runningList.length === 0 && line2.startsWith('·')
    const isAnswering = e.props.isWorking || turnList.at(-1)?.durationMs === null
    // While idle: when the last request went out and how much of the last answer the cache served.
    const lastDone = turnList.findLast(turn => turn.durationMs !== null)
    const request = isAnswering ? [] : requestSegments(requestTime(lastRequest), cacheShare(lastDone?.tokens))

    const { Box, Text, Button } = $.ui.resolve(e)

    const segmentText = (segment: Segment) => <Text {...textStyle(segment)}>{segment.text}</Text>

    const slider = (
      // Two cells between every control, so a level's hotkey never runs into the label before it.
      <Box columnGap={2}>
        <Text dimColor>effort</Text>
        {EFFORT_LEVELS.map((level, i) => (
          <Button
            key={`effort-${level}`}
            plain
            hotkey={String(i + 1)}
            onPress={() => {
              void choose($, level)
            }}
          >
            {!isAuto && level === effort ? (
              <Text color={COLORS.effort} bold>
                {LEVEL_LABELS[level]}
              </Text>
            ) : (
              <Text>{LEVEL_LABELS[level]}</Text>
            )}
          </Button>
        ))}
        <Button
          key="effort-auto"
          plain
          hotkey="6"
          onPress={() => {
            void choose($, 'auto')
          }}
        >
          {isAuto ? (
            <Text color={COLORS.effort} bold>
              auto
            </Text>
          ) : (
            <Text>auto</Text>
          )}
        </Button>
        <Button
          key="effort-reset"
          plain
          hotkey="0"
          onPress={() => {
            void choose($, null)
          }}
        >
          <Text dimColor>엔진 설정</Text>
        </Button>
        <Text dimColor>숫자로 선택 · ctrl+x ctrl+e 닫기</Text>
      </Box>
    )

    // The sidebar shows the status in the band's place; the slider still opens here, where a bare digit picks.
    if (isSidebarUp) return pickerOpenedAt === null ? next(e) : <Box marginTop={1}>{slider}</Box>

    return (
      // A row of air above, from the transcript's last line. The row under the band is the engine's,
      // where its notices show, so the band does not reach into it.
      <Box flexDirection="column" marginTop={1}>
        <Box>
          {line1.map((part, i) => [
            i > 0 && <Text dimColor>{SEPARATOR}</Text>,
            part.map(segment =>
              segment.role === 'effort' ? (
                <Button
                  key="effort"
                  plain
                  action={EFFORT_KEY_ACTION}
                  onPress={() => {
                    void togglePicker($)
                  }}
                >
                  {segmentText(segment)}
                </Button>
              ) : (
                segmentText(segment)
              ),
            ),
          ])}
        </Box>
        <Text wrap="truncate-end" {...(isIdle ? { dimColor: true } : { color: COLORS.running })}>
          {line2}
        </Text>
        {pickerOpenedAt !== null ? (
          slider
        ) : (
          <Box>
            <Text dimColor wrap="truncate-end">
              {lastAnswer(turnList)}
            </Text>
            {request.length === 0 ? null : (
              // Kept whole: the summary before it gives way first.
              <Box flexShrink={0}>
                <Text dimColor>{SEPARATOR}</Text>
                {request.map(segment => segmentText(segment))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
