import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionUsage, ToolCallResult } from 'claude-code'

import type { AgentSeen, RunningCall, UsageSnapshot } from '../types'
import { applyTaskUpdate, parseGitStatus, todosFromTodoWrite } from './band-format'
import { bashPurpose } from './bash-purpose'
import { addFiveHourPoint } from './forecast'

const running = atom({ plugin: 'hubblerc', key: 'running' } as const, [])
const todos = atom({ plugin: 'hubblerc', key: 'todos' } as const, [])
const agents = atom({ plugin: 'hubblerc', key: 'agents' } as const, [])
const agentStarts = atom({ plugin: 'hubblerc', key: 'agentStarts' } as const, {})
const usage = atom({ plugin: 'hubblerc', key: 'usage' } as const, null)
const git = atom({ plugin: 'hubblerc', key: 'git' } as const, null)
const project = atom({ plugin: 'hubblerc', key: 'project' } as const, '')
const model = atom({ plugin: 'hubblerc', key: 'model' } as const, '')
const tick = atom({ plugin: 'hubblerc', key: 'tick' } as const, 0)
const fiveHourLog = atom({ plugin: 'hubblerc', key: 'fiveHourLog' } as const, [])
const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const sessionName = atom({ plugin: 'hubblerc', key: 'sessionName' } as const, null)

/** While something runs, elapsed times redraw every second. */
const TICK_MS = 1000
/** Usage, git and the model are read again this often even when idle (reset countdowns move). */
const SLOW_REFRESH_MS = 30_000
/** Git is read this often, so a commit made outside shows soon. */
const GIT_REFRESH_MS = 5000
/** What a session's name is kept under in its transcript (`/rename`), a row appended again now and then. */
const TITLE_ROW = '"type":"custom-title"'
/** How much of the transcript's end a periodic read of the name looks through. */
const TITLE_TAIL_BYTES = 262_144
const MAX_RUNNING = 50

type CallInput = { tool: string; tool_use_id?: string; agentId?: string }

/**
 * At session.start (a reload included): forget the calls the previous copy was watching, read
 * everything once, and start the timer that keeps elapsed times and countdowns moving.
 */
export async function startStatus($: EngineInterface): Promise<void> {
  await update($, running, () => [])
  await refreshStatus($)
  await refreshSessionName($, true).catch(() => undefined)

  let lastSlow = await $.clock.now()
  $.clock.every(TICK_MS, () => {
    void (async () => {
      const now = await $.clock.now()
      // Each read on its own: one failing must not keep the redraw back, or countdowns and
      // uptime stand still (a "1분 전" that never moved was seen on screen).
      const hasAgents = await refreshAgents($).catch(() => false)
      const isRunning = await read($, running)
        .then(list => list.length > 0)
        .catch(() => false)
      // An answer running counts too: the sidebar's cat moves while it streams.
      const isAnswering = await read($, turns)
        .then(list => list.at(-1)?.durationMs === null)
        .catch(() => false)
      const isSlow = now - lastSlow >= SLOW_REFRESH_MS
      if (isSlow) {
        lastSlow = now
        await refreshStatus($).catch(() => undefined)
        await refreshSessionName($).catch(() => undefined)
      }
      if (isSlow || hasAgents || isRunning || isAnswering) await update($, tick, () => now)
    })().catch(() => undefined)
  })
  $.clock.every(GIT_REFRESH_MS, () => {
    void refreshGit($).catch(() => undefined)
  })
}

/** Before a tool call runs: it shows on line 2. Answers the id `unmarkRunning` takes. */
export async function markRunning($: EngineInterface, e: CallInput, startedAt: number): Promise<string> {
  const tool = String(e.tool)
  const id = e.tool_use_id ?? `${tool}@${startedAt}`
  const call: RunningCall = {
    id,
    tool,
    label: callLabel(tool, e),
    startedAt,
    ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
  }
  await update($, running, list => [...list, call].slice(-MAX_RUNNING))

  return id
}

/** After the call ended, however it ended. */
export async function unmarkRunning($: EngineInterface, id: string): Promise<void> {
  await update($, running, list => list.filter(item => item.id !== id))
}

/** After a call that succeeded: todos and subagents it changed. */
export async function noteCall($: EngineInterface, e: CallInput, ran: ToolCallResult, startedAt: number): Promise<void> {
  if (ran.deny !== undefined || ran.isError === true) return
  await afterCall($, String(e.tool), e, ran, startedAt)
  // A commit (or any git command) shows on the sidebar's files at once.
  const command = (e as unknown as { command?: unknown }).command
  if (e.tool === 'Bash' && e.agentId === undefined && typeof command === 'string' && /\bgit\b/.test(command)) await refreshGit($)
}

async function afterCall($: EngineInterface, tool: string, e: CallInput, ran: ToolCallResult, startedAt: number): Promise<void> {
  const args = e as unknown as Record<string, unknown>

  if (e.agentId === undefined) {
    if (tool === 'TodoWrite') {
      await update($, todos, () => todosFromTodoWrite(args.todos))
    } else if (tool === 'TaskCreate') {
      const taskId = taskIdOf(ran.result)
      const subject = typeof args.subject === 'string' ? args.subject : ''
      const activeForm = typeof args.activeForm === 'string' ? { activeForm: args.activeForm } : {}
      if (taskId !== undefined) {
        await update($, todos, list => [...list, { id: taskId, subject, status: 'pending' as const, ...activeForm }])
      }
    } else if (tool === 'TaskUpdate') {
      await update($, todos, list => applyTaskUpdate(list, args))
    }
  }

  if (tool === 'Agent') {
    const agentId = isRecord(ran.result) && typeof ran.result.agentId === 'string' ? ran.result.agentId : undefined
    if (agentId !== undefined) {
      await update($, agentStarts, starts => ({ ...starts, [agentId]: startedAt }))
      await refreshAgents($)
    }
  }
}

/** Reads the model, folder, usage and git again (after each answer, and every 30 seconds), and logs the 5-hour window. */
export async function refreshStatus($: EngineInterface): Promise<void> {
  const [modelId, cwd, figures] = await Promise.all([$.session.model(), $.session.cwd(), $.session.usage()])
  await update($, model, () => modelId)
  await update($, project, () => cwd.split('/').filter(Boolean).pop() ?? cwd)
  const figuresNow = snapshot(figures)
  await update($, usage, () => figuresNow)
  // The 5-hour window's reading joins the log when it moved: the burn-out forecast paces from it.
  const now = await $.clock.now()
  const log = addFiveHourPoint(await read($, fiveHourLog), figuresNow.fiveHour, now)
  if (log !== null) await update($, fiveHourLog, () => log)
  const info = await readGit($, cwd)
  await update($, git, () => info)
}

/** Reads the subagent list again; true while one is running or pending. */
async function refreshAgents($: EngineInterface): Promise<boolean> {
  const [list, starts] = await Promise.all([$.agent.list(), read($, agentStarts)])
  const seen: AgentSeen[] = list.map(agent => {
    const startedAt = starts[agent.id]

    return {
      id: agent.id,
      type: agent.type,
      description: agent.description,
      status: agent.status,
      ...(startedAt === undefined ? {} : { startedAt }),
    }
  })
  const before = await read($, agents)
  if (JSON.stringify(before) !== JSON.stringify(seen)) await update($, agents, () => seen)

  return seen.some(agent => agent.status === 'running' || agent.status === 'pending')
}

/** Each folder's repository top, once found (`''`: not in a repository). */
const roots = new Map<string, string>()

async function readGit($: EngineInterface, cwd: string) {
  try {
    if (!roots.has(cwd)) {
      const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 3000 })
      roots.set(cwd, top.exitCode === 0 ? top.stdout.trim() : '')
    }
    const root = roots.get(cwd) ?? ''
    // quotePath off: a Korean file name comes as itself, not octal escapes. No optional locks: run
    // every five seconds, a status that refreshed the index took .git/index.lock and a commit made
    // meanwhile failed on it (seen 2026-10-26).
    const { exitCode, stdout } = await $.process.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--branch', '--ignored'], {
      cwd,
      timeoutMs: 3000,
    })
    const info = exitCode === 0 ? parseGitStatus(stdout) : null
    if (info === null || root === '') return info

    const absolute = (paths: string[] | undefined) => (paths ?? []).map(path => `${root}/${path}`)

    return { ...info, root, changed: absolute(info.changed), untracked: absolute(info.untracked), ignored: absolute(info.ignored) }
  } catch {
    return null
  }
}

/** Reads git again: often, so a commit made anywhere shows within seconds; at once after Claude runs git. */
export async function refreshGit($: EngineInterface): Promise<void> {
  const info = await readGit($, await $.session.cwd())
  // Written only when it changed, so the five-second read redraws nothing on its own.
  if (JSON.stringify(info) !== JSON.stringify(await read($, git))) await update($, git, () => info)
}

function snapshot(figures: SessionUsage): UsageSnapshot {
  const window = (kind: string) => {
    const found = figures.rateLimits.find(limit => limit.kind === kind)

    return found === undefined
      ? undefined
      : { percent: found.percentUsed, ...(found.resetsAt === undefined ? {} : { resetsAt: found.resetsAt }) }
  }
  const fiveHour = window('five_hour')
  const sevenDay = window('seven_day')

  return {
    ...(figures.context.percent === undefined ? {} : { contextPercent: figures.context.percent }),
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(sevenDay === undefined ? {} : { sevenDay }),
    ...(figures.cost === undefined ? {} : { costUsd: figures.cost.usd }),
    limits: figures.rateLimits.map(limit => ({ kind: limit.kind, percent: limit.percentUsed })),
  }
}

/** The session's transcript, as a classic hook hands it (`transcript_path`); found by the session's id until one does. */
let transcriptPath: string | undefined

/** From a classic hook's input: where the session's transcript is. */
export function noteTranscript(path: string | undefined): void {
  if (path !== undefined && path !== '') transcriptPath = path
}

async function findTranscript($: EngineInterface): Promise<string | undefined> {
  if (transcriptPath !== undefined) return transcriptPath
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const dir = configDir !== undefined && configDir !== '' ? configDir : home !== undefined && home !== '' ? `${home}/.claude` : undefined
  if (dir === undefined) return undefined
  const found = await $.process.run(['/bin/sh', '-c', 'ls "$1"/projects/*/"$2".jsonl 2>/dev/null | head -n 1', 'sh', dir, await $.session.id()], { timeoutMs: 3000 })
  const path = found.stdout.trim()
  if (path !== '') transcriptPath = path

  return transcriptPath
}

/**
 * The session's name as `/rename` set it. The engine hands a mod no name; it keeps it in the
 * transcript as a `custom-title` row, appended again now and then, so the last one in the
 * transcript's end is the name now (`whole`: the whole transcript, at start). None found there
 * leaves the name known. Written only when it changed.
 */
export async function refreshSessionName($: EngineInterface, whole = false): Promise<void> {
  const path = await findTranscript($)
  if (path === undefined) return
  const script = whole ? 'grep -F "$2" "$1" | tail -n 1' : `tail -c ${TITLE_TAIL_BYTES} "$1" | grep -F "$2" | tail -n 1`
  const ran = await $.process.run(['/bin/sh', '-c', script, 'sh', path, TITLE_ROW], { timeoutMs: 3000 })
  const name = titleIn(ran.stdout)
  if (name !== undefined && name !== (await read($, sessionName))) await update($, sessionName, () => name)
}

/** The name in a transcript's `custom-title` row; null for a blank one, undefined when the text is no such row. */
export function titleIn(line: string): string | null | undefined {
  try {
    const row = JSON.parse(line.trim()) as { type?: unknown; customTitle?: unknown }
    if (row.type !== 'custom-title') return undefined

    return typeof row.customTitle === 'string' && row.customTitle.trim() !== '' ? row.customTitle : null
  } catch {
    return undefined
  }
}

/** What line 2 names a running call by: a Bash call's purpose, a file's name, a query. */
function callLabel(tool: string, e: CallInput): string {
  const args = e as unknown as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max)}…`)
  const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path

  switch (tool) {
    case 'Bash':
      return bashPurpose(args) ?? clip(text(args.command), 40)
    case 'Read':
    case 'Edit':
    case 'Write':
      return base(text(args.file_path))
    case 'NotebookEdit':
      return base(text(args.notebook_path))
    case 'WebSearch':
      return clip(text(args.query), 30)
    case 'WebFetch':
      return clip(text(args.url).replace(/^https?:\/\//, ''), 30)
    case 'Agent':
      return clip(text(args.description), 30)
    case 'Skill':
      return text(args.skill)
    default:
      return ''
  }
}

function taskIdOf(result: unknown): string | undefined {
  if (!isRecord(result) || !isRecord(result.task)) return undefined

  return typeof result.task.id === 'string' ? result.task.id : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
