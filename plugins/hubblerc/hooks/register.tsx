import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { completeTurn, isIgnoredTool, noteFiveHourUsed, noteMainTurn, noteShellChanges, recordRun, startTurn, trackLines, trackPrompts, watchShellBefore } from './activity/activity'
import { rememberAnswer, startAutoEffort } from './effort/auto-effort'
import { effortWord, noteEffortChange, noteTurnDone, resetEffortRecord } from './effort/effort-record'
import { signCommits } from './commit/trailers'
import { showAnswer } from './activity/answer'
import { showBand } from './status/band'
import { showBashPurpose } from './activity/bash-purpose'
import { answerCommands, registerCommand } from './commands'
import { startDevice } from './sidebar/device'
import { controlEffort, startEffort } from './effort/effort'
import { closeEffortPicker } from './effort/effort-picker'
import { noteBashOutcome, predictBashFailure } from './likely/bash-fail'
import { answerLikelyCommand, registerLikelyCommand } from './likely/command'
import { configureLikely, startLikely } from './likely/likely'
import { startRelaunch } from './system/relaunch'
import { restoreTurns } from './activity/restore'
import { checkSetup } from './system/setup'
import { resendPicture } from './sidebar/picture'
import { layoutOption, showSidebar, startSidebar } from './sidebar/sidebar'
import { markRunning, noteAnswering, noteCall, noteEffortCommand, noteRename, noteTranscript, refreshStatus, requestGitRefresh, startStatus, unmarkRunning } from './status/status'
import { findTurnForLine, summarize } from './activity/summary'
import { serveTodoTool, startTodos, startTodoTurn } from './todo/todo'
import { showToolLines } from './activity/tool-lines'

// The validator reads state sources per file, so each file that reads `turns` declares it.
const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

// One hook per event with no matcher (the engine refuses a second): each feature's part of an
// event runs from here, each on its own so one failing leaves the others.
export const register: Register = (on, options) => {
  const layout = layoutOption(options.layout)
  const autoByDefault = options.autoEffort === true
  configureLikely(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    resetEffortRecord()
    await registerCommand($).catch(() => undefined)
    await restoreTurns($).catch(() => undefined)
    await startStatus($).catch(() => undefined)
    await startEffort($).catch(() => undefined)
    await startSidebar($, layout).catch(() => undefined)
    await startTodos($).catch(() => undefined)
    await startLikely($).catch(() => undefined)
    await registerLikelyCommand($).catch(() => undefined)
    await startDevice($).catch(() => undefined)
    await startRelaunch($).catch(() => undefined)
    await checkSetup($).catch(() => undefined)

    return started
  })

  on('turn.start', async ($, e, next) => {
    await startTurn($, e).catch(() => undefined)
    if (e.agentId === undefined) noteAnswering(true)
    if (e.agentId === undefined) noteMainTurn(e.turnId, true)
    // After the turn's record opened: an item offered by its ↗ and sent as offered takes this answer's number.
    if (e.agentId === undefined) await startTodoTurn($, e.text).catch(() => undefined)
    if (e.agentId === undefined) await closeEffortPicker($).catch(() => undefined)
    // Not awaited: the status is read while the model starts its answer, so what changed while idle
    // (an edit in an editor) shows as the question goes.
    if (e.agentId === undefined) void requestGitRefresh($).catch(() => undefined)
    // The person is here: the cat's picture again, which Orca may have dropped behind another tab.
    if (e.agentId === undefined) void resendPicture($).catch(() => undefined)
    await startAutoEffort($, e, autoByDefault).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (isIgnoredTool(String(e.tool))) return next(e)

    // A call that may change files unseen waits for the running answer's first snapshot (once).
    await watchShellBefore($, String(e.tool)).catch(() => undefined)
    const startedAt = await $.clock.now()
    const id = await markRunning($, e, startedAt).catch(() => undefined)
    // Not awaited: the command runs while its failure is predicted; the outcome is paired as it ends.
    const decision = e.tool === 'Bash' ? predictBashFailure($, e) : undefined

    try {
      const ran = await next(e)
      const ms = (await $.clock.now()) - startedAt
      if (decision !== undefined) void noteBashOutcome($, decision, ran).catch(() => undefined)
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
    if (e.agentId === undefined) noteAnswering(false)
    if (e.agentId === undefined) noteMainTurn(e.turnId, false)
    rememberAnswer(e)
    const done = await next(e)
    if (e.agentId === undefined) {
      void noteTurnDone($, e.turnId).catch(() => undefined)
      await refreshStatus($).catch(() => undefined)
      await noteFiveHourUsed($, e.turnId).catch(() => undefined)
      await noteShellChanges($, e.turnId).catch(() => undefined)
    }

    return done
  }).catch(($, e, next) => next(e))

  // The classic SessionStart hands the transcript's path (the session's name is read from it). It
  // asks the engine to watch no files: watching git's and the store's cost an idle session about 1.35
  // seconds of CPU a minute (measured 2026-11-06); a commit made elsewhere and another session's
  // to-dos show as the next question starts or within the half minute.
  on('classic.SessionStart', async ($, e, next) => {
    noteTranscript(e.transcript_path)

    return next(e)
  }).catch(($, e, next) => next(e))

  // After the model changed, however (`/model` typed or picked, `/config`, a fallback): the band and
  // the sidebar name the new one at once, not at the next half minute.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refreshStatus($).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  // The engine's /rename (its alias /name folded in): the sidebar's session line shows the name at once.
  on('command.run', { command: 'rename' }, async ($, e, next) => {
    const ran = await next(e)
    await noteRename($, e.args).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  // The engine's /effort: ultracode, turned on or off by it or its slider, shows beside the effort.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    noteEffortCommand($)
    // A level set by hand after an auto pick: a signal on it (the slider's level is not known here).
    await noteEffortChange($, effortWord(e.args), 'engine').catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  // A key in the prompt box: the person is back (Orca may have dropped the cat's picture behind
  // another tab), so it is sent again, at most every ten seconds. Not awaited: the editor waits on
  // this hook for the box it shows.
  on('prompt.edit', ($, e, next) => {
    void resendPicture($).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteTranscript(e.transcript_path)

    return next(e)
  }).catch(($, e, next) => next(e))

  trackLines(on)
  trackPrompts(on)
  answerCommands(on, layout)
  serveTodoTool(on)
  answerLikelyCommand(on)
  controlEffort(on, autoByDefault)
  showBashPurpose(on)
  showToolLines(on)
  showBand(on, layout, autoByDefault)
  showSidebar(on, layout, autoByDefault)
  showAnswer(on)
  signCommits(on)

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
