import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { EffortLevel } from '../types'
import { activityParts, COLORS, EFFORT_LEVELS, isEffortLevel, lastAnswer, SEPARATOR, statusParts } from './band-format'
import type { Segment } from './band-format'

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

/**
 * The engine keybinding action the effort control answers to. A mod cannot add a keybinding of its
 * own, but a Button naming an engine action is pressed by the person's chord for that action from
 * the prompt while the Button is drawn; this one belongs to the diff panel, whose own handler only
 * takes it while that panel is open. ~/.claude/keybindings.json binds ctrl+x e to it (Option+E types an accent on macOS).
 */
const EFFORT_KEY_ACTION = 'app:cycleDiffBase'
/** The slider closes by itself after this long. */
const PICKER_OPEN_MS = 10_000
const LEVEL_LABELS: Record<EffortLevel, string> = { low: 'low', medium: 'med', high: 'high', xhigh: 'xhigh', max: 'max' }

/**
 * The three lines above the prompt, in place of the claude-hud status line:
 * 1. model · effort │ context │ 5h and 7d limits │ project branch
 * 2. what runs now, or the todo in progress, or that it waits
 * 3. the last answer's summary, or the effort slider while it is open
 *
 * Colors only where something needs attention, by the terminal's own color names.
 */
export function showBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [turnList, runningList, todoList, agentList, figures, gitInfo, projectName, modelId, override, engine, pickerOpenedAt] =
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
      ])
    // Read so the timer's writes redraw elapsed times and countdowns.
    await read($, tick)
    const now = await $.clock.now()

    const effort = override ?? engine
    const line1 = statusParts(
      { model: modelId, effort, isOverridden: override !== null, usage: figures, project: projectName, git: gitInfo, now },
      e.props.bodyColumns,
    )
    const line2 = activityParts(runningList, agentList, todoList, e.props.isWorking, now).join(SEPARATOR)
    const isIdle = runningList.length === 0 && line2.startsWith('·')

    const { Box, Text, Button } = $.ui.resolve(e)

    const segmentText = (segment: Segment) => (
      <Text
        {...(segment.color === undefined ? {} : { color: segment.color })}
        {...(segment.dim === true ? { dimColor: true } : {})}
        {...(segment.bold === true ? { bold: true } : {})}
      >
        {segment.text}
      </Text>
    )

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
            {level === effort ? (
              <Text color={COLORS.effort} bold>
                {LEVEL_LABELS[level]}
              </Text>
            ) : (
              <Text>{LEVEL_LABELS[level]}</Text>
            )}
          </Button>
        ))}
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
        <Text dimColor>숫자로 선택 · ctrl+x e 닫기</Text>
      </Box>
    )

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
          <Text dimColor wrap="truncate-end">
            {lastAnswer(turnList)}
          </Text>
        )}
      </Box>
    )
  })
}

/** Opens the effort slider in line 3, or closes it when open. Open, it closes by itself later. */
async function togglePicker($: EngineInterface): Promise<void> {
  if ((await read($, effortPicker)) !== null) {
    await update($, effortPicker, () => null)

    return
  }

  const openedAt = await $.clock.now()
  await update($, effortPicker, () => openedAt)
  $.clock.after(PICKER_OPEN_MS, () => {
    void update($, effortPicker, current => (current === openedAt ? null : current))
  })
}

/** Sends this session's requests at `level` from now on (null: at the engine's), and closes the slider. */
async function choose($: EngineInterface, level: EffortLevel | null): Promise<void> {
  await update($, effortOverride, () => (level !== null && isEffortLevel(level) ? level : null))
  await update($, effortPicker, () => null)
}

/** At a main-loop turn's start: a slider left open closes. */
export async function closeEffortPicker($: EngineInterface): Promise<void> {
  if ((await read($, effortPicker)) !== null) await update($, effortPicker, () => null)
}
