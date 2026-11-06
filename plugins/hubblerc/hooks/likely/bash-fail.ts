import type { EngineInterface, ToolCallResult } from 'claude-code'

import { likely, hasApiKey, recordOutcome } from './likely'
import type { Question } from './method'

/**
 * The first use of decisions: before each Bash call runs (the main loop's and every subagent's), a
 * decision in the background on whether it will fail; as the call ends, what happened is appended
 * as its outcome. The command never waits for the decision.
 */
export const BASH_TASK = 'bash-fail'

export const BASH_QUESTION: Question = {
  type: 'predicate',
  name: 'fails',
  instructions: 'Will this shell command fail when it runs, ending with a non-zero exit code or reporting an error?',
}

/** One decision in this many runs with thinking (adaptive, low effort), to compare its calibration with thinking off. */
export const THINKING_EVERY = 10

/** Bash decisions started since the module loaded: what picks the ones with thinking. */
let started = 0

type BashCall = { tool: string; tool_use_id?: string; agentId?: string; command?: unknown; description?: unknown; run_in_background?: unknown }

/**
 * Before a Bash call runs: its decision, started and not awaited. The promise answers the decision's
 * id, or null when none was made (a limit, a failure). No key, a command run in the background (its
 * end is not seen here) or an empty one: no decision at all.
 */
export function predictBashFailure($: EngineInterface, e: BashCall): Promise<string | null> | undefined {
  if (!hasApiKey() || e.run_in_background === true) return undefined
  const command = typeof e.command === 'string' ? e.command : ''
  if (command.trim() === '') return undefined
  started += 1
  const thinking = started % THINKING_EVERY === 0
  const meta: Record<string, string> = {}
  if (e.tool_use_id !== undefined) meta.toolUseId = e.tool_use_id
  if (e.agentId !== undefined) meta.agentId = e.agentId

  return (async () => {
    // The session groups a machine's decisions: a later replay can give a command the ones before it in its session.
    const [cwd, sessionId] = await Promise.all([$.session.cwd().catch(() => ''), $.session.id().catch(() => '')])
    if (sessionId !== '') meta.sessionId = sessionId
    const description = typeof e.description === 'string' ? e.description : ''
    const result = await likely($, { task: BASH_TASK, input: bashInput(command, description, cwd), questions: [BASH_QUESTION], samples: 5, thinking, meta })

    return 'skipped' in result || result.logPath === undefined ? null : result.id
  })().catch(() => null)
}

/** What the model is shown of a Bash call. */
export function bashInput(command: string, description: string, cwd: string): string {
  return [
    'A command Claude Code is about to run with its Bash tool (zsh on macOS).',
    `Command:\n${command}`,
    ...(description === '' ? [] : [`What it is for: ${description}`]),
    ...(cwd === '' ? [] : [`Working folder: ${cwd}`]),
  ].join('\n\n')
}

/**
 * How a Bash call ended, as the activity record counts it: failed when the tool reported an error (a
 * non-zero exit), not when it answered. Unknowable (null) when it was refused before running, moved
 * to the background, or interrupted. A failure's exit code is noted (`exit 2`) when its text gives one.
 */
export function bashOutcome(ran: ToolCallResult): { failed: boolean | null; note?: string } {
  if (ran.deny !== undefined) return { failed: null, note: 'denied' }
  if (ran.isError === true) {
    if (/interrupted/i.test(ran.text ?? '')) return { failed: null, note: 'interrupted' }
    // A failed command's text starts `Exit code N` (as the test stand-in has it; to be seen in a real log).
    const code = /^Exit code (\d+)/.exec(ran.text ?? '')?.[1]

    return code === undefined ? { failed: true } : { failed: true, note: `exit ${code}` }
  }
  const result = ran.result as { interrupted?: unknown; backgroundTaskId?: unknown } | undefined
  if (typeof result === 'object' && result !== null) {
    if (typeof result.backgroundTaskId === 'string') return { failed: null, note: 'background' }
    if (result.interrupted === true) return { failed: null, note: 'interrupted' }
  }

  return { failed: false }
}

/**
 * After the Bash call ended: its outcome appended once its decision is logged, matched by the
 * decision the call started (whichever ends first).
 */
export async function noteBashOutcome($: EngineInterface, pending: Promise<string | null>, ran: ToolCallResult): Promise<void> {
  const outcome = bashOutcome(ran)
  const id = await pending
  if (id === null) return
  await recordOutcome($, id, outcome.failed, outcome.note)
}
