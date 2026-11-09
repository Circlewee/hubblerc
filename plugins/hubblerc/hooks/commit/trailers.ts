import type { EngineInterface, On } from 'claude-code'

import { findCommits, shellQuote, withAround } from './commit-command'
import type { CommandWord, CommitSpot } from './commit-command'

/**
 * Commit trailers: every `git commit` Claude runs through Bash gets lines a machine reads, naming
 * the agent, the session, the model, the effort and the machine, so a commit leads back to the
 * conversation that made it. The command is rewritten before the engine's permission prompt sees
 * it; a form this reader cannot follow is left as it is (the trailers are missing, the commit is not).
 *
 * `git config hubblerc.trailers false` in a repository turns them off there (it lives in that
 * repository's `.git/config`, never in a commit). Claude Code's own attribution lines
 * (`Co-Authored-By`, the PR's "Generated with") are dropped in every repository.
 */

/** What the last model request of each loop went out with ('' for the main loop). */
type Sent = { model: string; effort: string | undefined; isAuto: boolean }

/** Requests are noted per loop; subagents come and go, so only the latest few are kept. */
const MAX_LOOPS = 50
const sentBy = new Map<string, Sent>()

let device: Promise<string | undefined> | undefined

/** Notes the model and effort a loop's request went out with: what that loop's commits are signed with. */
export function noteRequest(agentId: string | undefined, model: string, effort: string | undefined, isAuto: boolean): void {
  const key = agentId ?? ''
  sentBy.delete(key)
  sentBy.set(key, { model, effort, isAuto })
  if (sentBy.size > MAX_LOOPS) {
    const oldest = sentBy.keys().next().value
    if (oldest !== undefined) sentBy.delete(oldest)
  }
}

export function signCommits(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // An amend keeps the trailers the commit already has: git would add a second set beside them. A
    // commit that names Agent or Session itself (a Codex-style brief followed as written) is signed
    // already: a second set would give the commit two Agent lines.
    const spots = findCommits(e.command)?.filter(spot => !spot.isAmend && !hasOwnTrailers(spot.args))
    if (spots === undefined || spots.length === 0) return next(e)
    if (!(await isOnHere($, spots))) return next(e)

    const lines = await trailerLines($, e.agentId)
    const after = lines.map(line => ` --trailer ${shellQuote(line)}`).join('')

    // Nothing goes before `commit`: the command still starts `git commit`, so a person's
    // `Bash(git commit:*)` rule still matches it at the permission prompt.
    return next({ ...e, command: withAround(e.command, spots, '', after) })
  }).catch(($, e, next) => next(e))

  // The texts the engine asks the model to end a commit or a pull request with: none.
  on('attribution.text', ($, e, next) => (e.kind === 'commit' || e.kind === 'pr' ? { text: '' } : next(e))).catch(($, e, next) => next(e))
}

/** Options of `git commit` whose next word is their value, never an option of its own (`-m "--trailer …"`). */
const VALUE_OPTIONS = new Set(['-m', '-F', '-c', '-C', '-t', '--message', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message', '--cleanup', '--pathspec-from-file'])

/**
 * Whether the words of one `git commit` give an Agent or Session trailer: a `--trailer` word followed
 * by a word that starts `Agent:` or `Session:`, or one `--trailer=Agent: …`. A message (`-m`'s value)
 * and the commands that follow are not looked at.
 */
export function hasOwnTrailers(args: readonly CommandWord[]): boolean {
  const isOwn = (value: string) => /^\s*(?:Agent|Session)\s*[:=]/i.test(value)
  for (let at = 0; at < args.length; at += 1) {
    const text = args[at]?.text ?? ''
    if (VALUE_OPTIONS.has(text)) at += 1
    else if (text === '--trailer') {
      if (isOwn(args[at + 1]?.text ?? '')) return true
      at += 1
    } else if (text.startsWith('--trailer=') && isOwn(text.slice('--trailer='.length))) return true
  }

  return false
}

/** The effort as the trailer reads it: an auto pick says so. */
export function effortLabel(effort: string, isAuto: boolean): string {
  return isAuto ? `auto · ${effort}` : effort
}

/** The trailer lines, in their order; a value not known is left out rather than guessed. */
export async function trailerLines($: EngineInterface, agentId: string | undefined): Promise<string[]> {
  const lines = ['Agent: claude', `Session: ${oneLine(await $.session.id())}`]
  const sent = sentBy.get(agentId ?? '')
  if (sent !== undefined) lines.push(`Model: ${oneLine(sent.model)}`)
  if (sent?.effort !== undefined) lines.push(`Effort: ${oneLine(effortLabel(sent.effort, sent.isAuto))}`)
  const machine = await deviceLabel($)
  if (machine !== undefined) lines.push(`Device: ${oneLine(machine)}`)

  return lines
}

/**
 * The machine as its model and chip, "MacBook Pro (M3 Pro)": read once, on the first commit. The
 * computer's name is not used; it carries the owner's name ("…의-MacBook-Pro").
 */
export function deviceLabel($: EngineInterface): Promise<string | undefined> {
  device ??= readDevice($)

  return device
}

/** Forgets what was noted and read: for tests. */
export function resetTrailers(): void {
  sentBy.clear()
  device = undefined
}

async function readDevice($: EngineInterface): Promise<string | undefined> {
  const ran = await $.process.run(['/usr/sbin/system_profiler', 'SPHardwareDataType'], { timeoutMs: 10_000 }).catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) return undefined

  return deviceFrom(ran.stdout)
}

/** "Model Name: MacBook Pro" and "Chip: Apple M3 Pro" (an Intel Mac: "Processor Name: …") → "MacBook Pro (M3 Pro)". */
export function deviceFrom(profile: string): string | undefined {
  const name = /^\s*Model Name:\s*(.+)$/m.exec(profile)?.[1]?.trim()
  if (name === undefined || name === '') return undefined
  const chip = (/^\s*Chip:\s*(.+)$/m.exec(profile)?.[1] ?? /^\s*Processor Name:\s*(.+)$/m.exec(profile)?.[1])?.trim().replace(/^Apple\s+/, '')

  return chip === undefined || chip === '' ? name : `${name} (${chip})`
}

/** Off where any repository the command commits in says `hubblerc.trailers false`. */
async function isOnHere($: EngineInterface, spots: readonly CommitSpot[]): Promise<boolean> {
  const cwd = await $.session.cwd().catch(() => undefined)
  for (const spot of spots) {
    const dir = spot.dir === undefined ? cwd : spot.dir.startsWith('/') || cwd === undefined ? spot.dir : `${cwd}/${spot.dir}`
    const argv = dir === undefined ? ['git', 'config', '--bool', 'hubblerc.trailers'] : ['git', '-C', dir, 'config', '--bool', 'hubblerc.trailers']
    const ran = await $.process.run(argv, { timeoutMs: 5_000 }).catch(() => undefined)
    if (ran?.stdout.trim() === 'false') return false
  }

  return true
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}
