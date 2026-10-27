import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { completeTurn, IGNORED_TOOLS, noteFiveHourUsed, noteShellChanges, recordRun, startShellWatch, startTurn, trackLines, trackPrompts } from './activity'
import { rememberAnswer, startAutoEffort } from './auto-effort'
import { showBand } from './band'
import { showBashPurpose } from './bash-purpose'
import { answerCommands, registerCommand } from './commands'
import { startDevice } from './device'
import { controlEffort, startEffort } from './effort'
import { closeEffortPicker } from './effort-picker'
import { startRelaunch } from './relaunch'
import { restoreTurns } from './restore'
import { checkSetup } from './setup'
import { layoutOption, showSidebar, startSidebar } from './sidebar'
import { gitWatchPaths, markRunning, noteCall, noteTranscript, refreshStatus, requestGitRefresh, startStatus, unmarkRunning } from './status'
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
    await startDevice($).catch(() => undefined)
    await startRelaunch($).catch(() => undefined)
    await checkSetup($).catch(() => undefined)

    return started
  })

  on('turn.start', async ($, e, next) => {
    await startTurn($, e).catch(() => undefined)
    if (e.agentId === undefined) await closeEffortPicker($).catch(() => undefined)
    // Not awaited: the repository is read while the model starts its answer, before any tool runs;
    // the status too, so what changed while idle (an edit in an editor) shows as the question goes.
    if (e.agentId === undefined) void startShellWatch($, e.turnId).catch(() => undefined)
    if (e.agentId === undefined) void requestGitRefresh($).catch(() => undefined)
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
      await noteShellChanges($, e.turnId).catch(() => undefined)
    }

    return done
  }).catch(($, e, next) => next(e))

  // The classic SessionStart hands the transcript's path (the session's name is read from it) and
  // takes the files the engine is to watch: git's own, so a commit made anywhere asks for git.
  on('classic.SessionStart', async ($, e, next) => {
    noteTranscript(e.transcript_path)
    const result = await next(e)
    const paths = await gitWatchPaths($, e.cwd).catch(() => [])
    if (paths.length === 0) return result

    return { ...result, watchPaths: [...(result.watchPaths ?? []), ...paths] }
  }).catch(($, e, next) => next(e))

  on('classic.FileChanged', async ($, e, next) => {
    if (e.file_path.includes('.git/')) void requestGitRefresh($).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteTranscript(e.transcript_path)

    return next(e)
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
