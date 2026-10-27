import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { EffortLevel, TurnRecord } from '../types'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const running = atom({ plugin: 'hubblerc', key: 'running' } as const, [])
const agents = atom({ plugin: 'hubblerc', key: 'agents' } as const, [])
const effortOverride = atom({ plugin: 'hubblerc', key: 'effortOverride' } as const, null)
const effortAuto = atom({ plugin: 'hubblerc', key: 'effortAuto' } as const, null)
const restartPending = atom({ plugin: 'hubblerc', key: 'restartPending' } as const, false)

/**
 * Restarting onto a newer Claude Code, keeping the session: the sidebar's "재시작" or `/relaunch`
 * asks for it, and once nothing runs (the answer done, no call, no subagent left) hubblerc writes
 * the session's id to the file the shell function named (`shell/relaunch.zsh`,
 * `$HUBBLERC_RELAUNCH_FILE`) and runs `/exit`; the function opens the session again with
 * `--resume`, on the binary now installed.
 *
 * What runs is never cut: a restart asked mid-answer waits for it. A command left running in the
 * background (`run_in_background`) is not seen, and ends with the process.
 */

// The shell function sets `HUBBLERC_RELAUNCH_FILE`: where the session's id goes for it to resume.
// Read by its literal name, as the engine lists the variables a module reads.

/** Where what the session chose waits across the restart: the turns with their times, the effort. */
export const SNAPSHOT_KEY = 'restartSnapshot'
/** A snapshot older than this is another restart's leftover. */
const SNAPSHOT_MAX_AGE_MS = 10 * 60_000
/** The store holds 4 MB for every session together: a snapshot over this is not kept. */
const SNAPSHOT_MAX_CHARS = 1_000_000
/** How often a waiting restart looks again whether anything still runs. */
const WAIT_CHECK_MS = 2000
/** How soon a restart asked with nothing running goes. */
const RESTART_DELAY_MS = 200

export type RestartSnapshot = {
  sessionId: string
  savedAt: number
  turns: TurnRecord[]
  effortOverride: EffortLevel | null
  effortAuto: boolean | null
}

/** Set once `/exit` is on its way, so a second look does not ask again. */
let isRestarting = false
/** The timer a waiting restart looks again by: running only while one waits. */
let waitTimer: { cancel: () => void } | undefined

/** At session.start: a fresh start. */
export async function startRelaunch($: EngineInterface): Promise<void> {
  isRestarting = false
  stopWaiting()
  await update($, restartPending, () => false)
}

function startWaiting($: EngineInterface): void {
  stopWaiting()
  waitTimer = $.clock.every(WAIT_CHECK_MS, () => {
    void maybeRestart($).catch(() => undefined)
  })
}

function stopWaiting(): void {
  waitTimer?.cancel()
  waitTimer = undefined
}

/** Whether the shell function launched this session: without it, nothing would open it again. */
export async function canRelaunch($: EngineInterface): Promise<boolean> {
  const file = await $.env.get('HUBBLERC_RELAUNCH_FILE')

  return file !== undefined && file !== ''
}

/**
 * "재시작" and `/relaunch`: asks for a restart (at once when nothing runs, else when it ends), or,
 * asked already, takes it back. Says what it did; without the shell function, why it cannot.
 */
export async function requestRestart($: EngineInterface): Promise<string> {
  if (!(await canRelaunch($))) return '셸 함수 없이 띄운 세션이라 다시 띄울 수 없습니다. `/setup`을 실행한 뒤 새 터미널에서 Claude Code를 여세요.'

  const isPending = await update($, restartPending, pending => !pending)
  if (!isPending) {
    stopWaiting()

    return '재시작 예약을 취소했습니다.'
  }
  if (!(await isBusy($))) {
    // A moment later, not from inside `/relaunch`: the test kit refused `/exit` run from there.
    $.clock.after(RESTART_DELAY_MS, () => {
      void maybeRestart($).catch(() => undefined)
    })

    return '재시작합니다.'
  }
  startWaiting($)

  return '진행 중인 작업이 끝나면 재시작합니다. 다시 실행하면 취소됩니다.'
}

/** Something still runs: the main answer, a call, or a subagent. */
async function isBusy($: EngineInterface): Promise<boolean> {
  const [list, calls, seen] = await Promise.all([read($, turns), read($, running), read($, agents)])

  return list.at(-1)?.durationMs === null || calls.length > 0 || seen.some(agent => agent.status === 'running' || agent.status === 'pending')
}

/** Restarts when one was asked for and nothing runs; else leaves it for the next look. */
export async function maybeRestart($: EngineInterface): Promise<void> {
  if (isRestarting || !(await read($, restartPending)) || (await isBusy($))) return

  const file = await $.env.get('HUBBLERC_RELAUNCH_FILE')
  if (file === undefined || file === '') return
  isRestarting = true
  stopWaiting()
  // Nothing to resume: the file emptied, so the shell function does not open it again.
  const fail = async (error: unknown) => {
    isRestarting = false
    await update($, restartPending, () => false)
    await $.fs.write(file, '').catch(() => undefined)
    $.ui.toast(`재시작하지 못했습니다: ${String(error)}`)
  }
  try {
    const sessionId = await $.session.id()
    await saveSnapshot($, sessionId).catch(() => undefined)
    await $.fs.write(file, sessionId)
  } catch (error) {
    await fail(error)

    return
  }
  // Not awaited: `/exit` is queued until the session is idle, and `/relaunch` asking for it is
  // itself a command the session is running.
  void $.command.run({ command: 'exit' }).catch(fail)
}

async function saveSnapshot($: EngineInterface, sessionId: string): Promise<void> {
  const [list, override, auto] = await Promise.all([read($, turns), read($, effortOverride), read($, effortAuto)])
  const snapshot: RestartSnapshot = { sessionId, savedAt: await $.clock.now(), turns: list, effortOverride: override, effortAuto: auto }
  if (JSON.stringify(snapshot).length > SNAPSHOT_MAX_CHARS) return
  await $.store.set(SNAPSHOT_KEY, snapshot)
}

/**
 * At session.start: what this session saved as it restarted, put back (the turns with their
 * times, the effort it chose) and dropped from the store. False when there is none for it.
 */
export async function restoreSnapshot($: EngineInterface, sessionId: string): Promise<boolean> {
  const saved = (await $.store.get(SNAPSHOT_KEY)) as RestartSnapshot | undefined | null
  if (saved === undefined || saved === null) return false
  await $.store.delete(SNAPSHOT_KEY)
  const isFresh = (await $.clock.now()) - saved.savedAt <= SNAPSHOT_MAX_AGE_MS
  if (saved.sessionId !== sessionId || !isFresh || !Array.isArray(saved.turns)) return false

  await update($, turns, () => saved.turns)
  await update($, effortOverride, () => saved.effortOverride ?? null)
  await update($, effortAuto, () => saved.effortAuto ?? null)

  return true
}
