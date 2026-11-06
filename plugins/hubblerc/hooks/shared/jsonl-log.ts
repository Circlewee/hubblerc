import type { EngineInterface } from 'claude-code'

import { safeFileName } from './log-safety'

/**
 * A machine's own JSONL logs: one file per machine (`<machine>.jsonl`) in a log's folder, lines only
 * ever appended (`tee -a`), so one machine's log never writes over another's when the folder syncs.
 * Used by likely and by auto effort's record. A log file in iCloud Drive, not a local database: a
 * SQLite file synced while written can come apart, and a markdown log is hard to read back by machine.
 *
 * Plain functions by the log's folder: `$` reaches a function only as a call's argument.
 */

/** The folders made (and their files, private) this session: an append there needs no shell. */
const ready = new Set<string>()
/** Lines are appended one at a time, per folder. */
const queues = new Map<string, Promise<unknown>>()
let machine: string | null = null

/** At session.start: the folders made again on the first line, the machine's name read again. */
export function resetLogs(): void {
  ready.clear()
  machine = null
}

/** This machine's file in a log's folder. */
export async function logFileIn($: EngineInterface, dir: string): Promise<string> {
  machine ??= safeFileName(await machineName($))

  return `${dir}/${machine}.jsonl`
}

/** A line appended to this machine's file in `dir`, after the lines before it; answers the file. */
export function appendLogLine($: EngineInterface, dir: string, line: string): Promise<string> {
  const work = async () => {
    const path = await logFileIn($, dir)
    if (!ready.has(dir)) {
      const made = await $.process.run(['/bin/sh', '-c', 'umask 077 && mkdir -p "$1" && touch "$2"', 'sh', dir, path], { timeoutMs: 10_000 })
      if (made.exitCode !== 0) throw new Error(made.stderr.trim() || `기록 폴더를 만들지 못했습니다(${made.exitCode})`)
      ready.add(dir)
    }
    const ran = await $.process.run(['/usr/bin/tee', '-a', path], { stdin: `${line}\n`, timeoutMs: 10_000 })
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `기록을 쓰지 못했습니다(${ran.exitCode})`)

    return path
  }
  const run = (queues.get(dir) ?? Promise.resolve()).then(work, work)
  queues.set(
    dir,
    run.catch(() => undefined),
  )

  return run
}

/** The home folder ('' when unknown). */
export async function homeFolder($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

/**
 * The folder a log named `name` keeps by default: iCloud Drive's `hubblerc/<name>` where iCloud Drive
 * is on, else `~/.claude/hubblerc/<name>`.
 */
export async function defaultLogFolder($: EngineInterface, name: string): Promise<string> {
  const home = await homeFolder($)
  const icloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`
  if (await $.fs.exists(icloud).catch(() => false)) return `${icloud}/hubblerc/${name}`

  return `${home}/.claude/hubblerc/${name}`
}

/** The machine's name (its Sharing name, else its host name), as its log files are named. */
async function machineName($: EngineInterface): Promise<string> {
  for (const argv of [['/usr/sbin/scutil', '--get', 'ComputerName'], ['/bin/hostname', '-s']]) {
    const ran = await $.process.run(argv, { timeoutMs: 3000 }).catch(() => undefined)
    const name = ran?.exitCode === 0 ? ran.stdout.trim() : ''
    if (name !== '') return name
  }

  return 'mac'
}
