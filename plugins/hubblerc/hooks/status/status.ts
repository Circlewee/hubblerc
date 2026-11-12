import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionUsage, Timer, ToolCallResult } from 'claude-code'

import type { AgentSeen, ModelLimit, RunningCall, UsageSnapshot } from '../../types'
import { parseGitStatus } from './git'
import { bashPurpose } from '../activity/bash-purpose'
import { addFiveHourPoint } from './forecast'
import { MODEL_LIMITS_GAP_MS, MODEL_LIMITS_KEY, parseModelLimits, readSharedModelLimits, refusalWaitMs, USAGE_URL } from './model-limits'
import type { SharedModelLimits } from './model-limits'
import { isSidebarShown } from '../shared/pane'
import { isRecord } from '../shared/values'
import { refreshTodos } from '../todo/todo'
import { refreshLikelyStatus } from '../likely/likely'

const running = atom({ plugin: 'hubblerc', key: 'running' } as const, [])
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
const ultracode = atom({ plugin: 'hubblerc', key: 'ultracode' } as const, false)

/** While something runs, elapsed times redraw every second. */
const TICK_MS = 1000
/** Idle, the timer wakes this often: enough to see a subagent start in the background. */
const IDLE_TICK_MS = 5000
/** Usage, git and the model are read again this often even when idle (reset countdowns move). */
const SLOW_REFRESH_MS = 30_000
/** Git is read at most this often when a tool, a turn or a change in `.git` asks for it. */
const GIT_GAP_MS = 2000
/** The calls that may change files: git is read again after each, whichever loop ran it. */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])
/** What a session's name is kept under in its transcript (`/rename`), a row appended again now and then. */
const TITLE_ROW = '"type":"custom-title"'
/** How much of the transcript's end a periodic read of the name looks through. */
const TITLE_TAIL_BYTES = 262_144
const MAX_RUNNING = 50

type CallInput = { tool: string; tool_use_id?: string; agentId?: string }

/**
 * A main-loop answer is running: set as a question starts and cleared as its answer ends
 * (register.tsx), so the timer reads no transcript-sized state each second.
 */
let isAnswering = false
/** The status timer and its interval; `wakeStatus` puts it back to each second. Set by startStatus. */
let statusTimer: Timer | null = null
let statusTimerMs = 0
let wakeStatus: (() => void) | null = null
/** When `refreshStatus` last read everything: the 30-second read is left out soon after one (an answer's end). */
let lastStatusAt = 0
/**
 * The weekly limits of single models as the usage endpoint last gave them (to this session or to
 * another: the store's record), when it may be asked next (the wall clock) and how many times in a
 * row it refused. The module's: `refreshStatus` writes the snapshot whole, so each one carries the
 * limits.
 */
let modelLimits: ModelLimit[] = []
let nextModelLimitsAt = 0
let modelLimitsRefusals = 0
/** The sidebar has shown once this session and the limits were looked for: after that only as an answer ends. */
let hasLookedForModelLimits = false
/** No sign-in the usage endpoint takes (an API key, a gateway): not asked this session. */
let isModelLimitsOff = false

/**
 * At session.start (a reload included): forget the calls the previous copy was watching, read
 * everything once, and start the timer that keeps elapsed times and countdowns moving.
 *
 * The timer wakes every second while something runs (an answer, a call, a subagent) and every
 * fifth second otherwise; a question or a call that starts puts it back to each second at once.
 * Every 30 seconds it reads usage, the model and git again, and the session's name and the to-dos
 * while the sidebar shows. Git is read besides when a call that may change files ends and as a
 * question goes out.
 */
export async function startStatus($: EngineInterface): Promise<void> {
  await update($, running, () => [])
  lastStatusAt = 0
  hasLookedForModelLimits = false
  isModelLimitsOff = false
  modelLimits = []
  nextModelLimitsAt = 0
  modelLimitsRefusals = 0
  // What the store holds of the models' limits, before the first snapshot: a restart or a reload
  // draws them at once and asks the endpoint nothing.
  await takeSharedModelLimits($).catch(() => undefined)
  // The last answer still open (a reload while it ran): read once here, then kept by noteAnswering.
  isAnswering = await read($, turns)
    .then(list => list.at(-1)?.durationMs === null)
    .catch(() => false)
  await refreshStatus($)
  await refreshSessionName($, true).catch(() => undefined)
  await startUltracode($).catch(() => undefined)

  let lastSlow = await $.clock.now()
  // How many times the timer was woken: a tick whose reads came before a wake keeps each second.
  let wakes = 0
  const tickOnce = async () => {
    const wakesBefore = wakes
    const now = await $.clock.now()
    // Each read on its own: one failing must not keep the redraw back, or countdowns and
    // uptime stand still (a "1분 전" that never moved was seen on screen).
    const isRunning = await read($, running)
      .then(list => list.length > 0)
      .catch(() => false)
    const isSlow = now - lastSlow >= SLOW_REFRESH_MS
    const hasAgents = await refreshAgents($).catch(() => false)
    if (isSlow) {
      lastSlow = now
      // Read under half the period ago (an answer just ended): not again.
      if (now - lastStatusAt >= SLOW_REFRESH_MS / 2) await refreshStatus($).catch(() => undefined)
      if (await isSidebarShown($).catch(() => false)) {
        // Once, when the sidebar first shows: after that only as an answer ends.
        if (!hasLookedForModelLimits) void refreshModelLimits($).catch(() => undefined)
        await refreshSessionName($).catch(() => undefined)
        // Another session's to-dos (the same project) show within the half minute.
        await refreshTodos($).catch(() => undefined)
        // Another session's decisions, and a new day's count, show within the half minute.
        await refreshLikelyStatus($).catch(() => undefined)
      }
    }
    // An answer running counts too: the sidebar's cat moves while it streams.
    const isBusy = isRunning || isAnswering || hasAgents
    if (isSlow || isBusy) await update($, tick, () => now)
    pace(isBusy || wakes !== wakesBefore ? TICK_MS : IDLE_TICK_MS)
  }
  const pace = (ms: number) => {
    if (statusTimer !== null && statusTimerMs === ms) return
    statusTimer?.cancel()
    statusTimerMs = ms
    statusTimer = $.clock.every(ms, () => {
      void tickOnce().catch(() => undefined)
    })
  }
  wakeStatus = () => {
    wakes += 1
    pace(TICK_MS)
  }
  statusTimer?.cancel()
  statusTimer = null
  pace(isAnswering ? TICK_MS : IDLE_TICK_MS)
}

/** As a main-loop question starts or its answer ends (register.tsx): starting, the timer goes to each second at once. */
export function noteAnswering(isRunning: boolean): void {
  isAnswering = isRunning
  if (isRunning) wakeStatus?.()
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
  wakeStatus?.()

  return id
}

/** After the call ended, however it ended. */
export async function unmarkRunning($: EngineInterface, id: string): Promise<void> {
  await update($, running, list => list.filter(item => item.id !== id))
}

/** After a call ran: git again if it may have changed files (a failed one too); then what a successful one changed. */
export async function noteCall($: EngineInterface, e: CallInput, ran: ToolCallResult, startedAt: number): Promise<void> {
  if (ran.deny !== undefined) return
  if (FILE_TOOLS.has(String(e.tool))) await requestGitRefresh($)
  if (ran.isError === true) return
  await afterCall($, String(e.tool), e, ran, startedAt)
}

async function afterCall($: EngineInterface, tool: string, e: CallInput, ran: ToolCallResult, startedAt: number): Promise<void> {
  if (tool === 'Agent') {
    const agentId = isRecord(ran.result) && typeof ran.result.agentId === 'string' ? ran.result.agentId : undefined
    if (agentId !== undefined) {
      await update($, agentStarts, starts => ({ ...starts, [agentId]: startedAt }))
      await refreshAgents($)
    }
  }
}

/**
 * Reads the model, folder, usage and git again (after each answer, and every 30 seconds), and logs
 * the 5-hour window. Each is written only when it changed, so a read that finds nothing new redraws
 * nothing.
 */
export async function refreshStatus($: EngineInterface): Promise<void> {
  const [modelId, cwd] = await Promise.all([$.session.model(), $.session.cwd()])
  if ((await read($, model)) !== modelId) await update($, model, () => modelId)
  const name = cwd.split('/').filter(Boolean).pop() ?? cwd
  if ((await read($, project)) !== name) await update($, project, () => name)
  await refreshUsage($)
  lastStatusAt = await $.clock.now()
  const info = await readGit($, cwd)
  if (JSON.stringify(info) !== JSON.stringify(await read($, git))) await update($, git, () => info)
}

/**
 * Reads the context's fill and the rate-limit windows again, and logs the 5-hour window. Besides
 * `refreshStatus`, as each request returns (effort.ts): the engine holds what the last response
 * reported, so mid-answer the figures move with the requests and no request is made for them.
 */
export async function refreshUsage($: EngineInterface): Promise<void> {
  const figuresNow = snapshot(await $.session.usage())
  if (JSON.stringify(figuresNow) !== JSON.stringify(await read($, usage))) await update($, usage, () => figuresNow)
  // The 5-hour window's reading joins the log when it moved: the burn-out forecast paces from it.
  const now = await $.clock.now()
  const log = addFiveHourPoint(await read($, fiveHourLog), figuresNow.fiveHour, now)
  if (log !== null) await update($, fiveHourLog, () => log)
}

/**
 * Reads the weekly limits of single models (Fable's) from the usage endpoint `/usage` reads, with
 * the session's own sign-in (`$.session.authorize()`: the token stays with the engine). Only the
 * sidebar draws them, so only while it shows, and only under a subscription's sign-in. Called as
 * an answer ends (not awaited there: the request takes up to a second) and once when the sidebar
 * first shows.
 *
 * The endpoint limits how often an account asks (429), and the engine's own `/usage` shares that
 * allowance. So the sessions ask as one: what an ask learned and when the next may go are kept in
 * the store, a session whose turn it is not takes the record and makes no request, and a refusal
 * (429, 403) is left alone for what the endpoint names, or the gap doubled each time, an hour at most.
 */
export async function refreshModelLimits($: EngineInterface): Promise<void> {
  if (isModelLimitsOff) return
  const now = await $.clock.now()
  if (now < nextModelLimitsAt) {
    hasLookedForModelLimits = true

    return
  }
  // No request is made for the handle.
  const auth = await $.session.authorize()
  if (auth === null || auth.kind !== 'bearer') {
    isModelLimitsOff = true

    return
  }
  // Closed, nothing is spent: the first answer after it shows looks.
  if (!(await isSidebarShown($))) return
  hasLookedForModelLimits = true
  // Another session may have asked since: its answer, and its turn, stand.
  await takeSharedModelLimits($)
  if (now < nextModelLimitsAt) return showModelLimits($)

  // The turn is taken in the store before the request goes, so a session ending an answer meanwhile waits.
  nextModelLimitsAt = now + MODEL_LIMITS_GAP_MS
  await shareModelLimits($)
  const response = await $.http.fetch(USAGE_URL, { auth: auth.handle })
  if (response.status === 429 || response.status === 403) {
    modelLimitsRefusals += 1
    nextModelLimitsAt = now + refusalWaitMs(response.headers, modelLimitsRefusals)
  } else if (response.ok) {
    modelLimitsRefusals = 0
    modelLimits = parseModelLimits(response.text) ?? modelLimits
  }
  await shareModelLimits($)
  await showModelLimits($)
}

/**
 * The store's record of the models' limits, taken as this session's; with none, or a store that
 * cannot be read, the session goes by what it holds itself.
 */
async function takeSharedModelLimits($: EngineInterface): Promise<void> {
  const shared = readSharedModelLimits(await $.store.get(MODEL_LIMITS_KEY).catch(() => undefined))
  if (shared === null) return
  modelLimits = shared.limits
  nextModelLimitsAt = shared.nextAt
  modelLimitsRefusals = shared.refusals
}

/** This session's record into the store for the others; a store that refuses the write leaves each session asking for itself. */
async function shareModelLimits($: EngineInterface): Promise<void> {
  const record: SharedModelLimits = { limits: modelLimits, nextAt: nextModelLimitsAt, refusals: modelLimitsRefusals }
  await $.store.set(MODEL_LIMITS_KEY, record).catch(() => undefined)
}

/** The limits into the snapshot the sidebar reads, when they differ from what it holds. */
async function showModelLimits($: EngineInterface): Promise<void> {
  const shown = (await read($, usage))?.modelLimits ?? []
  if (JSON.stringify(shown) === JSON.stringify(modelLimits)) return
  await update($, usage, figures => (figures === null ? figures : withModelLimits(figures)))
}

function withModelLimits(figures: UsageSnapshot): UsageSnapshot {
  const { modelLimits: _before, ...rest } = figures

  return modelLimits.length === 0 ? rest : { ...rest, modelLimits }
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

/** Reads git again; written only when it changed, so a read that finds nothing new redraws nothing. */
export async function refreshGit($: EngineInterface): Promise<void> {
  const info = await readGit($, await $.session.cwd())
  if (JSON.stringify(info) !== JSON.stringify(await read($, git))) await update($, git, () => info)
}

let lastGitAt = 0
let isGitQueued = false

/**
 * Git read again because something may have changed it: at once, or, read under `GIT_GAP_MS` ago,
 * once when that gap is up; asks meanwhile fold into that one.
 */
export async function requestGitRefresh($: EngineInterface): Promise<void> {
  if (isGitQueued) return
  const wait = lastGitAt + GIT_GAP_MS - (await $.clock.now())
  if (wait <= 0) {
    lastGitAt = await $.clock.now()
    await refreshGit($)

    return
  }
  isGitQueued = true
  $.clock.after(wait, () => {
    isGitQueued = false
    void (async () => {
      lastGitAt = await $.clock.now()
      await refreshGit($)
    })().catch(() => undefined)
  })
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
    limits: figures.rateLimits.map(limit => ({ kind: limit.kind, percent: limit.percentUsed })),
    ...(modelLimits.length === 0 ? {} : { modelLimits }),
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

/** After `/rename` asks it, the transcript is read again this long after, for a name the engine chose. */
const RENAME_READS_MS = [1000, 3000]

/**
 * After `/rename` (or `/name`) ran: the name it was given shows at once, the sidebar shown or not.
 * Given none, the engine chooses one and appends its row: the transcript's end is read a second
 * and three seconds on. A name given is not read back at once (the row may not be written yet, and
 * the old one would come back); the 30-second read confirms it.
 */
export async function noteRename($: EngineInterface, args: string): Promise<void> {
  const name = args.trim()
  if (name !== '') {
    await update($, sessionName, () => name)

    return
  }
  for (const ms of RENAME_READS_MS) {
    $.clock.after(ms, () => {
      void refreshSessionName($).catch(() => undefined)
    })
  }
}

/**
 * The transcript row of the engine's `/effort` output that says ultracode is on or off: at its start
 * (`Ultracode on (this session only): …`, `Ultracode off. …`) or at its end, after a level the
 * slider set (`Set effort level to high (…): … · Ultracode on`).
 */
// The row's own `content` field (quotes unescaped): a tool call or message quoting the words does not match.
const ULTRACODE_ROW = '"content":"<local-command-stdout>[^<]*Ultracode (on|off)'
/** How far back from the transcript's end to look for it: right after `/effort`, it is the last thing written. */
const ULTRACODE_TAIL_BYTES = 65_536
/** After `/effort` runs, the transcript is read this long after, for the row it writes. */
const EFFORT_READS_MS = [500, 2000]
/** When this session started: an ultracode row older than it is another session's (a resume). */
let sessionStartedAt = 0

/**
 * At session.start: ultracode is off unless the `ultracode` setting starts every session in it.
 * The engine hands a mod nothing else of it (no setting, `/config` row or render prop changes when
 * `/effort ultracode` turns it on [checked in a session]).
 */
async function startUltracode($: EngineInterface): Promise<void> {
  sessionStartedAt = await $.clock.now()
  const setting = await $.settings.read({ key: 'ultracode' })
  await update($, ultracode, () => setting === true)
}

/**
 * After the engine's `/effort` ran (with arguments or through its slider, Tab toggling ultracode):
 * what it said of ultracode, read from the transcript a moment later. A level alone says nothing
 * of it and leaves it as it was, as the engine does.
 */
export function noteEffortCommand($: EngineInterface): void {
  for (const ms of EFFORT_READS_MS) {
    $.clock.after(ms, () => {
      void refreshUltracode($).catch(() => undefined)
    })
  }
}

async function refreshUltracode($: EngineInterface): Promise<void> {
  const path = await findTranscript($)
  if (path === undefined) return
  const ran = await $.process.run(['/bin/sh', '-c', `tail -c ${ULTRACODE_TAIL_BYTES} "$1" | grep -E "$2" | tail -n 1`, 'sh', path, ULTRACODE_ROW], { timeoutMs: 3000 })
  const said = ultracodeIn(ran.stdout, sessionStartedAt)
  if (said !== undefined && said !== (await read($, ultracode))) await update($, ultracode, () => said)
}

/**
 * Whether a transcript row of `/effort`'s output turned ultracode on or off; undefined when the
 * text is no such row, or one written before `since` (another session's, in a resumed transcript).
 */
export function ultracodeIn(line: string, since = 0): boolean | undefined {
  try {
    const row = JSON.parse(line.trim()) as { timestamp?: unknown; message?: { content?: unknown } }
    const content = row.message?.content
    if (typeof content !== 'string') return undefined
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
    if (Number.isNaN(at) || at < since) return undefined
    const said = /^<local-command-stdout>[^<]*\bUltracode (on|off)\b/.exec(content)

    return said === null ? undefined : said[1] === 'on'
  } catch {
    return undefined
  }
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
