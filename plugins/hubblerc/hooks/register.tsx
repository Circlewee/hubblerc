import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { completeTurn, IGNORED_TOOLS, noteFiveHourUsed, recordRun, startTurn, trackLines, trackPrompts } from './activity'
import { rememberAnswer, startAutoEffort } from './auto-effort'
import { showBand } from './band'
import { showBashPurpose } from './bash-purpose'
import { answerCommands, registerCommand } from './commands'
import { controlEffort, startEffort } from './effort'
import { closeEffortPicker } from './effort-picker'
import { restoreTurns } from './restore'
import { layoutOption, showSidebar, startSidebar } from './sidebar'
import { markRunning, noteCall, refreshStatus, startStatus, unmarkRunning } from './status'
import { findTurnForLine, summarize } from './summary'
import { showToolLines } from './tool-lines'

// The validator reads state sources per file, so each file that reads `turns` declares it.
const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

// One hook per event with no matcher (the engine refuses a second): each feature's part of an
// event runs from here, each on its own so one failing leaves the others.
export const register: Register = (on, options) => {
  const layout = layoutOption(options.layout)
  const autoByDefault = options.autoEffort === true

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerCommand($).catch(() => undefined)
    await restoreTurns($).catch(() => undefined)
    await startStatus($).catch(() => undefined)
    await startEffort($).catch(() => undefined)
    await startSidebar($, layout).catch(() => undefined)

    return started
  })

  on('turn.start', async ($, e, next) => {
    await startTurn($, e).catch(() => undefined)
    if (e.agentId === undefined) await closeEffortPicker($).catch(() => undefined)
    await startAutoEffort($, e, autoByDefault).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (IGNORED_TOOLS.has(String(e.tool))) return next(e)

    const startedAt = await $.clock.now()
    const id = await markRunning($, e, startedAt).catch(() => undefined)

    try {
      const ran = await next(e)
      const ms = (await $.clock.now()) - startedAt
      await recordRun($, e, ran, ms).catch(() => undefined)
      await noteCall($, e, ran, startedAt).catch(() => undefined)

      return ran
    } finally {
      if (id !== undefined) await unmarkRunning($, id).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // Before next: the duration must be on the turn when the engine appends its closing row.
    await completeTurn($, e).catch(() => undefined)
    rememberAnswer(e)
    const done = await next(e)
    if (e.agentId === undefined) {
      await refreshStatus($).catch(() => undefined)
      await noteFiveHourUsed($, e.turnId).catch(() => undefined)
    }

    return done
  }).catch(($, e, next) => next(e))

  trackLines(on)
  trackPrompts(on)
  answerCommands(on, layout)
  controlEffort(on, autoByDefault)
  showBashPurpose(on)
  showToolLines(on)
  showBand(on, layout, autoByDefault)
  showSidebar(on, layout, autoByDefault)

  // The line that closes a turn ("Baked for 2m 13s") gets the turn's activity on the line under it.
  // Under it, not beside it: the engine's line takes the row's free width and squeezes a sibling to the edge.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.waitingFor !== undefined) return drawn

    const turn = findTurnForLine(await read($, turns), e.requestId, e.props.durationMs)
    const summary = turn === undefined ? '' : summarize(turn)
    if (summary === '') return drawn

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>
          <Text dimColor>{summary}</Text>
        </Box>
      </Box>
    )
  })
}
