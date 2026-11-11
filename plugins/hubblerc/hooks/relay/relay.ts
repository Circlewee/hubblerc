import type { EngineInterface, On, ProcessRunResult } from 'claude-code'

import {
  briefText,
  carriedTries,
  checkTask,
  checksFile,
  checksText,
  commitLines,
  decisionRows,
  dispatchedFile,
  effectiveTasks,
  filesToReview,
  findTask,
  finishProblems,
  isBusy,
  LIVE_BLOCKED,
  statusLabel,
  isByLead,
  isCriterionId,
  isDone,
  isPending,
  isRun,
  isRunName,
  isTestFile,
  judgeVerdict,
  lastLines,
  latestRevs,
  localDate,
  outsideScope,
  parseNumstat,
  effortRan,
  parseReport,
  parseVerdict,
  progressText,
  reportFile,
  reportMismatches,
  RUN_PREFIX,
  runDir,
  sameCommit,
  specFile,
  STATUS_OF,
  TASK_ID,
  taskKey,
  TASK_STATUSES,
  VERDICT_SCHEMA,
  verifierInstructions,
  withoutSections,
  withLogRow,
  withTasks,
} from './relay-format'
import type { BriefInput, CheckOutcome, Criterion, FileChange, RelayPackage, RelayState, RelayTask, RunnerKind, TaskStatus } from './relay-format'
import { noteRun, runStatus, setRuns, statusText } from './relay-status'
import type { RelayRunStatus } from '../../types'
import { THEME_COLORS } from '../shared/style'

/**
 * relay's tool: the steps of the lead/worker skill (hubblerc:relay) that have one right answer.
 * The lead (Claude) judges; this starts a run, writes briefs, checks reports, runs the done-when
 * commands itself, builds the verifier's package and closes the run. Its record lives in the
 * working repository's `.relay/runs/<run>/`, kept out of git by a `*` .gitignore in that folder.
 * One lead per run writes it: state.json is read, changed and written whole, each change of a run
 * after the one before it (a lock per run, in this module), so calls made at once lose nothing.
 * No timers.
 */

/** As registered; the engine lists it as `mcp__hubblerc__relay`. */
const TOOL_NAME = 'relay'
const RELAY_TOOL_PATTERN = /^mcp__hubblerc__relay$/
const TOOL_DESCRIPTION =
  'Machine steps of the relay skill (hubblerc:relay): start a run, write task briefs and check their overlap, record or cancel a dispatch, ' +
  'check a worker report, run the done-when commands, build the verifier package, record a verdict, list pending decisions, finish or abandon a run. ' +
  'Only for a lead following that skill.'

const ACTIONS = ['start', 'list', 'task', 'spec_text', 'dispatched', 'cancel', 'report', 'check', 'package', 'verdict', 'pending', 'finish', 'abandon'] as const

/** One criterion's command may run this long; one `check` call this long in all. */
const CHECK_MS = 120_000
const CHECK_TOTAL_MS = 600_000
const GIT_MS = 30_000
/** git status may not take the index lock a worker's commit needs. */
const NO_LOCKS = { GIT_OPTIONAL_LOCKS: '0' }

type Answer = { result: string } | { deny: string }

const strings = { type: 'array', items: { type: 'string' } } as const

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ACTIONS] },
    name: { type: 'string', description: 'start: short run name, lowercase letters, digits and -, 30 at most' },
    goal: { type: 'string', description: 'start: the run goal. task, spec_text: the task goal' },
    done_when: {
      type: 'array',
      description: 'start: the run done-when lines. task, spec_text: criteria; id defaults to C1, C2…',
      items: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { id: { type: 'string' }, text: { type: 'string' }, command: { type: 'string' }, expect_exit: { type: 'integer' } },
            required: ['text'],
          },
        ],
      },
    },
    run: { type: 'string', description: 'The run, <YYYY-MM-DD>-<name>, as start answered' },
    id: { type: 'string', description: 'task, spec_text: task id (T3). verdict: V1' },
    title: { type: 'string' },
    model: { type: 'string', description: 'task, spec_text: the worker model ID' },
    effort: { type: 'string' },
    edit_scope: { ...strings, description: 'Repository paths or globs the task may change, new files included' },
    reads: { ...strings, description: 'Inputs that must not change while the task runs' },
    targets: { ...strings, description: 'External targets (a server, a channel, an account)' },
    read_first: { ...strings, description: 'Absolute paths of earlier reports and tools' },
    runner_kind: { type: 'string', enum: ['claude', 'codex'] },
    task: { type: 'string', description: 'dispatched, cancel, report, check: T3 (latest revision) or T3-r2' },
    runner: { type: 'string', description: "dispatched: where it runs and how to reach it again ('orca dispatch:<id>', 'subagent <name|agentId>')" },
    reason: { type: 'string', description: 'cancel: why the task will not run. abandon: why the run is dropped' },
    confirmed_stopped: { type: 'boolean', description: 'cancel: true only once you checked that the running worker has stopped' },
    tasks: { ...strings, description: 'package: tasks to include; absent, every task done' },
  },
  required: ['action'],
} as const

/** How long session start waits to learn whether this folder holds a run still active. */
const START_LOOK_MS = 3000

/**
 * At session.start: the model's tool. Where the repository holds a run not yet finished, the tool
 * is listed with the rest (`isDeferred: false`), so the lead need not search for it; otherwise it
 * stays behind ToolSearch as before. Decided here once: the tool list changing mid-session voids
 * the prompt cache. Not a git folder, or a read that fails, is the second case.
 */
export async function registerRelayTool($: EngineInterface): Promise<void> {
  const root = await repoRoot($, START_LOOK_MS).catch(() => undefined)
  const active = root === undefined ? [] : await findActiveRuns($, root).catch(() => [])
  const spec = { name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown> }
  await $.tool.register(active.length === 0 ? spec : { ...spec, isDeferred: false }).catch(() => undefined)
  // The sidebar's relay box, from the runs just found: none, a box of none.
  await setRuns($, await summarize($, root, active, START_LOOK_MS)).catch(() => undefined)
}

/** Runs read, in small: each run's progress.md for the decisions waiting, HEAD once where there is a verdict to compare. */
async function summarize($: EngineInterface, root: string | undefined, active: readonly ActiveRun[], timeoutMs = GIT_MS): Promise<RelayRunStatus[]> {
  const head = root !== undefined && active.some(found => found.state.verdicts.length > 0) ? await headSha($, root, timeoutMs) : undefined
  const runs: RelayRunStatus[] = []
  for (const found of active) runs.push(runStatus(found.state, await readText($, `${found.dir}/progress.md`), head))

  return runs
}

/**
 * `/relay-status`: the runs not finished as the sidebar's relay box shows them, read now (and the
 * box put to what was read); with none, the run finished last.
 */
export async function relayStatusText($: EngineInterface): Promise<string> {
  const root = await repoRoot($)
  if (root === undefined) return '세션의 작업 폴더가 git 저장소가 아니어서 relay 묶음이 없습니다(relay 기록은 저장소 루트의 .relay/runs/에 둡니다).'
  const runs = await findRuns($, root)
  const shown = await summarize($, root, runs.filter(found => found.state.status === 'active'))
  await setRuns($, shown).catch(() => undefined)
  // Finished last: by its last verdict (finish takes a passing one), else by when it started. An abandoned run was never finished.
  const when = (state: RelayState) => state.verdicts.at(-1)?.at ?? state.createdAt
  const last = runs.filter(found => found.state.status === 'finished').reduce<ActiveRun | undefined>((latest, found) => (latest === undefined || when(found.state) > when(latest.state) ? found : latest), undefined)

  return statusText({ runs: shown }, THEME_COLORS, last?.run)
}

export function serveRelayTool(on: On): void {
  // A pattern: the types list a registered tool's name only once this machine's session has loaded it.
  on('tool.call', { tool: RELAY_TOOL_PATTERN }, async ($, e) => {
    try {
      return await answerRelayTool($, e as unknown as Record<string, unknown>)
    } catch (error) {
      return { deny: `relay 도구가 실패했습니다: ${String(error)}` }
    }
  }).catch(() => ({ deny: 'relay 도구가 실패했습니다.' }))
}

// ── The lock ──────────────────────────────────────────────

/** The last change queued for each run: a change waits for the one before it. */
const chains = new Map<string, Promise<void>>()

/**
 * Runs `work` after every earlier piece of work on the same run in this session has ended: what
 * reads, changes and writes a run's state goes through here. Not re-entrant: work inside it calls
 * the unlocked forms.
 */
export async function withRunLock<T>(root: string, run: string, work: () => Promise<T>): Promise<T> {
  const key = `${root}\n${run}`
  const before = chains.get(key) ?? Promise.resolve()
  let done: () => void = () => undefined
  const mine = new Promise<void>(resolve => {
    done = resolve
  })
  const tail = before.then(() => mine)
  chains.set(key, tail)
  await before
  try {
    return await work()
  } finally {
    done()
    if (chains.get(key) === tail) chains.delete(key)
  }
}

// ── Engine helpers ──────────────────────────────────────────────

async function git($: EngineInterface, root: string, args: readonly string[]): Promise<ProcessRunResult> {
  return $.process.run(['git', ...args], { cwd: root, timeoutMs: GIT_MS })
}

/** The working repository's top folder, from the session's working directory; undefined outside git. */
export async function repoRoot($: EngineInterface, timeoutMs = GIT_MS): Promise<string | undefined> {
  const ran = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs }).catch(() => undefined)
  const root = ran?.exitCode === 0 ? ran.stdout.trim() : ''

  return root === '' ? undefined : root
}

async function headSha($: EngineInterface, root: string, timeoutMs = GIT_MS): Promise<string | undefined> {
  const ran = await $.process.run(['git', 'rev-parse', 'HEAD'], { cwd: root, timeoutMs }).catch(() => undefined)
  const sha = ran?.exitCode === 0 ? ran.stdout.trim() : ''

  return sha === '' ? undefined : sha
}

type TreeChanges = { tracked: string[]; untracked: string[] }

/** What the working tree holds that HEAD does not, the run folders left out; undefined when git status fails. */
async function treeChanges($: EngineInterface, root: string): Promise<TreeChanges | undefined> {
  const ran = await $.process
    .run(['git', 'status', '--porcelain', '--untracked-files=all', '--', '.', `:(exclude)${RUN_PREFIX.split('/')[0]}`], { cwd: root, timeoutMs: GIT_MS, env: NO_LOCKS })
    .catch(() => undefined)
  if (ran?.exitCode !== 0) return undefined
  const changes: TreeChanges = { tracked: [], untracked: [] }
  for (const line of ran.stdout.split('\n')) {
    if (line.trim() === '') continue
    const path = line.slice(3).trim()
    if (path.startsWith('.relay/')) continue
    if (line.startsWith('??')) changes.untracked.push(path)
    else changes.tracked.push(path)
  }

  return changes
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  const text = await $.fs.read(path).catch(() => undefined)

  return typeof text === 'string' ? text : undefined
}

/** A text's SHA-256, hex: the environment's digest, or shasum when it has none. */
export async function sha256($: EngineInterface, text: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))

    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    const ran = await $.process.run(['/usr/bin/shasum', '-a', '256'], { stdin: text })

    return ran.stdout.trim().split(/\s+/)[0] ?? ''
  }
}

function isState(value: unknown): value is RelayState {
  const state = value as Partial<RelayState> | null
  return typeof state === 'object' && state !== null && state.version === 1 && typeof state.run === 'string' && Array.isArray(state.tasks) && Array.isArray(state.verdicts)
}

/** A run's state.json, or undefined when the run has none (or it is not one this tool wrote). */
export async function readState($: EngineInterface, root: string, run: string): Promise<RelayState | undefined> {
  if (!isRun(run)) return undefined
  const text = await readText($, `${runDir(root, run)}/state.json`)
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)

    return isState(value) ? value : undefined
  } catch {
    return undefined
  }
}

const progressPath = (root: string, run: string): string => `${runDir(root, run)}/progress.md`

/**
 * Writes the state; then the sidebar's relay box takes the run in small (relay-status.ts): every
 * save of the tool and of the gate comes through here. `progress` is progress.md as the caller
 * read or wrote it (null: not there), undefined to read it.
 */
async function writeState($: EngineInterface, root: string, state: RelayState, progress?: string | null): Promise<void> {
  await $.fs.write(`${runDir(root, state.run)}/state.json`, `${JSON.stringify(state, null, 2)}\n`)
  await noteSaved($, root, state, progress).catch(() => undefined)
}

/** A run no longer active (finished, abandoned) leaves the box with nothing read; an active one reads progress.md unless handed it, and HEAD only where there is a verdict. */
async function noteSaved($: EngineInterface, root: string, state: RelayState, progress?: string | null): Promise<void> {
  if (state.status !== 'active') return noteRun($, state, undefined, undefined)
  const text = progress === undefined ? await readText($, progressPath(root, state.run)) : (progress ?? undefined)
  const head = state.verdicts.length === 0 ? undefined : await headSha($, root)
  await noteRun($, state, text, head)
}

/** Draws progress.md's Tasks block again from its text as read; a warning when the file or its markers are gone. */
async function redrawTasks($: EngineInterface, root: string, state: RelayState, progress: string | undefined): Promise<string | undefined> {
  const path = progressPath(root, state.run)
  if (progress === undefined) return `progress.md가 없어 Tasks 표를 그리지 못했습니다: ${path}`
  const next = withTasks(progress, state.tasks)
  if (next === null) return `progress.md의 Tasks 표시(<!-- relay:tasks:start/end -->)가 없어 다시 그리지 않았습니다: ${path}`
  if (next !== progress) await $.fs.write(path, next)

  return undefined
}

/** Saves the state and draws its Tasks block, progress.md read once for both; the redraw's warning, if any. */
async function save($: EngineInterface, root: string, state: RelayState): Promise<string | undefined> {
  const progress = await readText($, progressPath(root, state.run))
  await writeState($, root, state, progress ?? null)

  return redrawTasks($, root, state, progress)
}

export type ActiveRun = { run: string; dir: string; state: RelayState }

/** Every run of this repository with a state this tool wrote, by name. Only reads. */
async function findRuns($: EngineInterface, top: string): Promise<ActiveRun[]> {
  const folder = `${top}/${RUN_PREFIX}`
  if (!(await $.fs.exists(folder).catch(() => false))) return []
  const entries = await $.fs.list(folder).catch(() => [])
  const found: ActiveRun[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir' || !isRun(entry.name)) continue
    const state = await readState($, top, entry.name)
    if (state !== undefined) found.push({ run: entry.name, dir: runDir(top, entry.name), state })
  }

  return found.sort((a, b) => a.run.localeCompare(b.run))
}

/** The runs of this repository still active, by name. Only reads: the gate hook calls it on each launch. */
export async function findActiveRuns($: EngineInterface, root?: string): Promise<ActiveRun[]> {
  const top = root ?? (await repoRoot($))
  if (top === undefined) return []

  return (await findRuns($, top)).filter(found => found.state.status === 'active')
}

// ── Commits ──────────────────────────────────────────────

type CommitLook = { missing: string[]; unsigned: string[]; offBase: string[]; files: string[]; outside: string[]; tests: string[]; subjects: string[] }

/**
 * What a task's own commits are and touch: the scope check uses them only, never Base..HEAD
 * (another worker's commits sit there too). With `base`, each found commit is also tested to
 * descend from it.
 */
async function lookAtCommits($: EngineInterface, root: string, task: RelayTask, shas: readonly string[], base?: string): Promise<CommitLook> {
  const look: CommitLook = { missing: [], unsigned: [], offBase: [], files: [], outside: [], tests: [], subjects: [] }
  const key = taskKey(task)
  for (const sha of shas) {
    const kind = await git($, root, ['cat-file', '-t', sha]).catch(() => undefined)
    if (kind?.exitCode !== 0 || kind.stdout.trim() !== 'commit') {
      look.missing.push(sha)
      continue
    }
    const trailers = await git($, root, ['log', '-1', '--format=%(trailers:key=Task,valueonly)', sha]).catch(() => undefined)
    if (!(trailers?.stdout ?? '').split('\n').some(line => line.trim() === key)) look.unsigned.push(sha)
    if (base !== undefined) {
      const ancestry = await git($, root, ['merge-base', '--is-ancestor', base, sha]).catch(() => undefined)
      if (ancestry?.exitCode !== 0) look.offBase.push(sha)
    }
    const subject = await git($, root, ['log', '-1', '--format=%s', sha]).catch(() => undefined)
    look.subjects.push(`${sha} ${subject?.stdout.trim() ?? ''}`.trim())
    const shown = await git($, root, ['show', '--name-only', '--format=', sha]).catch(() => undefined)
    for (const file of (shown?.stdout ?? '').split('\n').map(line => line.trim())) {
      if (file !== '' && !look.files.includes(file)) look.files.push(file)
    }
  }
  look.outside = outsideScope(look.files, task.editScope)
  look.tests = look.files.filter(isTestFile)

  return look
}

/**
 * Every commit since the run's base whose Run trailer names this run, by each Task trailer value it
 * carries ('' for none): what a package must show whatever the task's state (a cancel reverts no
 * code). Undefined when git log fails.
 */
async function runCommits($: EngineInterface, root: string, state: RelayState): Promise<Map<string, string[]> | undefined> {
  const found = new Map<string, string[]>()
  const ran = await git($, root, ['log', '--format=%H%x1f%(trailers:key=Task,valueonly,separator=%x2c)%x1f%(trailers:key=Run,valueonly,separator=%x2c)', `${state.base}..HEAD`]).catch(
    () => undefined,
  )
  if (ran?.exitCode !== 0 || ran.isStdoutTruncated) return undefined
  for (const line of ran.stdout.split('\n')) {
    const [sha = '', tasks = '', runs = ''] = line.split('\x1f')
    if (sha.trim() === '' || !runs.split(',').some(run => run.trim() === state.run)) continue
    const keys = tasks.split(',').map(task => task.trim()).filter(key => key !== '')
    for (const key of keys.length === 0 ? [''] : keys) found.set(key, [...(found.get(key) ?? []), sha.trim()])
  }

  return found
}

// ── Input ──────────────────────────────────────────────

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null

  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item !== '')
}

function criteriaFrom(value: unknown): Criterion[] | string {
  if (!Array.isArray(value)) return []
  const criteria: Criterion[] = []
  for (const [at, item] of value.entries()) {
    const raw = typeof item === 'string' ? { text: item } : (item as Record<string, unknown> | null)
    if (raw === null || typeof raw !== 'object' || text(raw.text) === '') return `done_when[${at}]에 text가 없습니다.`
    const id = text(raw.id) === '' ? `C${at + 1}` : text(raw.id)
    if (!isCriterionId(id)) return `기준 ID ${id}가 규칙(영문자로 시작, 영문자·숫자·_·., 20자 이하)에 맞지 않습니다.`
    const command = text(raw.command)
    const expect = raw.expect_exit
    if (expect !== undefined && (typeof expect !== 'number' || !Number.isInteger(expect))) return `done_when[${at}]의 expect_exit는 정수여야 합니다.`
    criteria.push({ id, text: text(raw.text), ...(command === '' ? {} : { command, expectExit: typeof expect === 'number' ? expect : 0 }) })
  }

  return criteria
}

/** A brief's fields from the call, or why they are wrong. */
function briefFrom(input: Record<string, unknown>): BriefInput | string {
  const id = text(input.id)
  if (!TASK_ID.test(id)) return 'id는 영문자로 시작하고 영문자·숫자·_·.만 쓴 20자 이하여야 합니다(예: T3). -는 판 번호(-r2)와 헷갈려 쓰지 않습니다.'
  const lists = { editScope: stringList(input.edit_scope), reads: stringList(input.reads), targets: stringList(input.targets), readFirst: stringList(input.read_first) }
  for (const [name, list] of Object.entries(lists)) if (list === null) return `${name}은 문자열 배열이어야 합니다.`
  const criteria = criteriaFrom(input.done_when)
  if (typeof criteria === 'string') return criteria
  const kind = input.runner_kind
  if (kind !== 'claude' && kind !== 'codex') return "runner_kind는 'claude' 또는 'codex'여야 합니다."
  if (text(input.title) === '') return 'title이 비었습니다.'
  if (text(input.goal) === '') return 'goal이 비었습니다.'

  return {
    id,
    title: text(input.title),
    goal: typeof input.goal === 'string' ? input.goal : '',
    model: text(input.model),
    effort: text(input.effort),
    editScope: lists.editScope ?? [],
    reads: lists.reads ?? [],
    targets: lists.targets ?? [],
    readFirst: lists.readFirst ?? [],
    criteria,
    runnerKind: kind as RunnerKind,
  }
}

const withWarnings = (lines: readonly string[], warnings: readonly (string | undefined)[]): string => {
  const shown = warnings.filter((warning): warning is string => warning !== undefined && warning !== '')

  return [...lines, ...(shown.length === 0 ? [] : ['', '경고:', ...shown.map(warning => `- ${warning}`)])].join('\n')
}

const STATE_GONE = (root: string, run: string) => `묶음이 없거나 state.json을 읽지 못했습니다: ${runDir(root, run)}`
const ABANDONED = (run: string) => `이미 버린 묶음입니다: ${run}`

/** Why a run takes no launch: finished or abandoned; undefined while it is active. */
const closedRun = (state: RelayState): string | undefined =>
  state.status === 'finished' ? `이미 끝난 묶음입니다: ${state.run}` : state.status === 'abandoned' ? ABANDONED(state.run) : undefined

// ── Actions ──────────────────────────────────────────────

/** What the tool answers a call: text the lead reads, or why it was refused. */
export async function answerRelayTool($: EngineInterface, input: Record<string, unknown>): Promise<Answer> {
  const action = input.action
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) return { deny: `action은 ${ACTIONS.join(', ')} 중 하나여야 합니다.` }
  if (action === 'spec_text') return specTextAction($, input)
  const root = await repoRoot($)
  if (root === undefined) return { deny: '세션의 작업 폴더가 git 저장소가 아닙니다: relay 기록은 저장소 루트의 .relay/runs/에 둡니다.' }
  if (action === 'start') return startAction($, root, input)
  if (action === 'list') return listAction($, root)

  const run = text(input.run)
  if (!isRun(run)) return { deny: 'run은 start가 돌려준 <YYYY-MM-DD>-<name> 형식이어야 합니다.' }
  if (action === 'dispatched') {
    const runner = text(input.runner)
    if (runner === '') return { deny: "runner가 비었습니다: 'orca dispatch:<id>' 또는 'subagent <name|agentId>'처럼 다시 연락할 주소를 적으세요." }

    return markDispatched($, root, run, text(input.task), runner)
  }
  // check writes no state, only its result file (its commands may run for minutes): it takes no lock.
  if (action === 'check') {
    const state = await readState($, root, run)
    if (state === undefined) return { deny: STATE_GONE(root, run) }
    // check runs commands and writes its result file: an abandoned run takes it no more than the other actions.
    if (state.status === 'abandoned') return { deny: ABANDONED(run) }

    return checkAction($, root, state, text(input.task))
  }

  return withRunLock(root, run, async () => {
    const state = await readState($, root, run)
    if (state === undefined) return { deny: STATE_GONE(root, run) }
    const isClosing = action === 'task' || action === 'cancel' || action === 'report' || action === 'finish' || action === 'abandon'
    if (isClosing && state.status === 'finished') return { deny: `이미 끝난 묶음입니다: ${run}` }
    // An abandoned run takes nothing that writes to it or runs a command (check, above, neither); pending only reads it.
    if (action !== 'pending' && state.status === 'abandoned') return { deny: ABANDONED(run) }
    switch (action) {
      case 'task':
        return taskAction($, root, state, input)
      case 'cancel':
        return cancelAction($, root, state, input)
      case 'report':
        return reportAction($, root, state, text(input.task))
      case 'package':
        return packageAction($, root, state, input.tasks)
      case 'verdict':
        return verdictAction($, root, state, text(input.id))
      case 'pending':
        return pendingAction($, root, state)
      case 'abandon':
        return abandonAction($, root, state, text(input.reason))
      default:
        return finishAction($, root, state)
    }
  })
}

async function startAction($: EngineInterface, root: string, input: Record<string, unknown>): Promise<Answer> {
  const name = text(input.name)
  if (!isRunName(name)) return { deny: 'name은 소문자·숫자·-만 쓴 30자 이하여야 합니다(예: todo-trash).' }
  const goal = text(input.goal)
  if (goal === '') return { deny: 'goal이 비었습니다.' }
  const doneWhen = (Array.isArray(input.done_when) ? input.done_when : [])
    .map(item => (typeof item === 'string' ? item : text((item as Record<string, unknown> | null)?.text)))
    .map(item => item.trim())
    .filter(item => item !== '')
  if (doneWhen.length === 0) return { deny: 'done_when이 비었습니다: 묶음의 완료 기준을 하나 이상 적으세요.' }
  const now = await $.clock.now()
  const run = `${localDate(now)}-${name}`

  return withRunLock(root, run, async () => {
    const dir = runDir(root, run)
    if (await $.fs.exists(dir).catch(() => false)) return { deny: `같은 묶음이 이미 있습니다: ${dir}. 이어받으려면 그 run을 쓰고, 새로 시작하려면 다른 name을 고르세요.` }
    const base = await headSha($, root)
    if (base === undefined) return { deny: 'git rev-parse HEAD가 실패했습니다: 커밋이 하나도 없는 저장소인지 보세요.' }
    const lead = await $.session.id().catch(() => '')
    const state: RelayState = { version: 1, run, goal, doneWhen, base, lead, status: 'active', createdAt: now, tasks: [], verdicts: [], packages: [] }

    const progress = progressText(state, now)
    await $.fs.write(`${dir}/.gitignore`, '*\n')
    await $.fs.write(`${dir}/progress.md`, progress)
    await $.fs.write(`${dir}/reviews/verdict.schema.json`, `${JSON.stringify(VERDICT_SCHEMA, null, 2)}\n`)
    await writeState($, root, state, progress)

    return { result: [`묶음을 시작했습니다: ${run}`, `폴더: ${dir}`, `진행 기록: ${dir}/progress.md`, `Base: ${base}`].join('\n') }
  })
}

async function listAction($: EngineInterface, root: string): Promise<Answer> {
  const runs = await findActiveRuns($, root)
  if (runs.length === 0) return { result: `이 저장소에 진행 중인 묶음이 없습니다(${root}/${RUN_PREFIX}).` }
  const lines = runs.map(({ run, dir, state }) => {
    const counts = TASK_STATUSES.map(status => [status, state.tasks.filter(task => task.status === status).length] as const)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${status} ${count}`)

    return `- ${run} · 목표: ${state.goal.replace(/\s+/g, ' ')} · 작업 ${state.tasks.length}개${counts.length === 0 ? '' : `(${counts.join(', ')})`} · ${dir}`
  })
  const note = runs.length > 1 ? ['', '여럿입니다: 어느 묶음을 이어받을지 사용자에게 물으세요.'] : []

  return { result: [`진행 중인 묶음 ${runs.length}개:`, ...lines, ...note].join('\n') }
}

async function taskAction($: EngineInterface, root: string, state: RelayState, input: Record<string, unknown>): Promise<Answer> {
  const brief = briefFrom(input)
  if (typeof brief === 'string') return { deny: brief }
  const earlier = state.tasks.filter(task => task.id === brief.id)
  // A worker still holds the task: a new revision would free its files while it writes them.
  const holding = earlier.filter(isBusy)
  if (holding.length > 0) {
    const named = holding.map(task => `${taskKey(task)}(${statusLabel(task)}${task.runner === null ? '' : ` · ${task.runner}`})`).join(', ')

    return { deny: `같은 작업의 ${named}가 돌고 있습니다: 먼저 report를 받거나, 워커가 멈춘 것을 확인한 뒤 cancel에 confirmed_stopped: true를 주세요.` }
  }
  const checked = checkTask(state, brief)
  if (checked.denials.length > 0) return { deny: checked.denials.join('\n') }
  const base = await headSha($, root)
  if (base === undefined) return { deny: 'git rev-parse HEAD가 실패했습니다.' }

  const previous = latestRevs(earlier)[0]
  const carried = carriedTries(previous, brief.criteria)
  const rev = (previous?.rev ?? 0) + 1
  const key = `${brief.id}-r${rev}`
  const dir = runDir(root, state.run)
  const specPath = specFile(dir, key)
  const reportTo = reportFile(dir, key)
  const spec = briefText(brief, { kind: 'full', run: state.run, key, base, reportTo, lead: state.lead, carried: carried.tries })
  await $.fs.write(specPath, spec)

  // A new revision takes over: an earlier one not running and not done is never to be reported on.
  const superseded: string[] = []
  for (const task of earlier) {
    if (!isBusy(task) && (task.status === 'ready' || task.status === 'needs_context' || task.status === 'blocked')) {
      task.status = 'cancelled'
      task.cancelReason = `새 판 ${key}가 이어받음`
      superseded.push(taskKey(task))
    }
  }
  const task: RelayTask = {
    id: brief.id,
    rev,
    title: brief.title,
    runner: null,
    model: brief.model,
    effort: brief.effort,
    editScope: brief.editScope,
    reads: brief.reads,
    targets: brief.targets,
    criteria: brief.criteria,
    status: 'ready',
    specPath,
    specHash: await sha256($, spec),
    dispatchedAt: null,
    reportedAt: null,
    tries: carried.tries,
  }
  state.tasks.push(task)
  const redrawn = await save($, root, state)

  return {
    result: withWarnings(
      [
        `지시서: ${specPath}`,
        `보고서 자리: ${reportTo}`,
        '띄울 때 이 파일을 지시서로 주세요(Orca: --spec-file, 서브에이전트: 프롬프트에 경로와 함께 내용).',
        'Orca worker-start·send, 서브에이전트 생성·SendMessage로 띄우면 hubblerc 관문이 검사·기록합니다. 관문이 기록하지 못했다고 하면 dispatched를 부르세요.',
        ...(superseded.length === 0 ? [] : [`앞 판을 취소로 바꿨습니다: ${superseded.join(', ')}(새 판을 워커에게 알리세요).`]),
        ...(previous === undefined ? [] : [`tries 이어 받음: ${carried.carried.join(', ') || '없음'} · 0부터 셈: ${carried.fresh.join(', ') || '없음'}`]),
      ],
      [...checked.warnings, redrawn],
    ),
  }
}

async function specTextAction($: EngineInterface, input: Record<string, unknown>): Promise<Answer> {
  const brief = briefFrom(input)
  if (typeof brief === 'string') return { deny: brief }
  const empty: RelayState = { version: 1, run: '', goal: '', doneWhen: [], base: '', lead: '', status: 'active', createdAt: 0, tasks: [], verdicts: [] }
  const checked = checkTask(empty, brief)
  if (checked.denials.length > 0) return { deny: checked.denials.join('\n') }
  const root = await repoRoot($)
  const base = (root === undefined ? undefined : await headSha($, root)) ?? '미확인'
  const lead = await $.session.id().catch(() => '')

  return { result: briefText(brief, { kind: 'light', base, lead }) }
}

/** The running tasks that share files or targets with this one, as warnings. */
function overlapWarnings(state: RelayState, task: RelayTask): string[] {
  const others = { ...state, tasks: state.tasks.filter(other => other !== task) }

  return checkTask(others, { ...task, readFirst: [] }).denials.filter(reason => reason.startsWith('돌고 있는'))
}

/** Writes the read-only copy of the brief as sent (made writable for the write, in case one is there). */
async function writeSentCopy($: EngineInterface, root: string, state: RelayState, task: RelayTask, text: string): Promise<string> {
  const copy = dispatchedFile(runDir(root, state.run), taskKey(task))
  await $.process.run(['/bin/chmod', '0644', copy], { timeoutMs: GIT_MS }).catch(() => undefined)
  await $.fs.write(copy, text)
  await $.process.run(['/bin/chmod', '0444', copy], { timeoutMs: GIT_MS }).catch(() => undefined)

  return copy
}

/** The brief as it stands, and why it is not the one `task` wrote (undefined when it is). */
async function briefNow($: EngineInterface, task: RelayTask): Promise<{ text: string; hash: string } | { problem: string }> {
  const text = await readText($, task.specPath)
  if (text === undefined) return { problem: `지시서 파일이 없습니다: ${task.specPath}` }
  const hash = await sha256($, text)
  if (hash !== task.specHash) return { problem: `${taskKey(task)}의 지시서가 task로 쓴 뒤에 바뀌었습니다. 보낸 지시서는 고치지 말고 task로 새 판을 만드세요.` }

  return { text, hash }
}

/** Running, with its runner and since when; saved. */
async function setRunning($: EngineInterface, root: string, state: RelayState, task: RelayTask, runner: string): Promise<string | undefined> {
  task.status = 'running'
  task.runner = runner
  task.dispatchedAt = await $.clock.now()
  delete task.blockReason
  delete task.workerLive

  return save($, root, state)
}

/**
 * A launch whose brief cannot be trusted: blocked, the worker's address kept so the lead can reach
 * it, and the task still holding its files (the worker went out and may be at work).
 */
async function setBlocked($: EngineInterface, root: string, state: RelayState, task: RelayTask, runner: string, reason: string): Promise<{ deny: string }> {
  task.status = 'blocked'
  task.runner = runner
  task.dispatchedAt = await $.clock.now()
  task.blockReason = reason
  task.workerLive = true
  await save($, root, state)

  return {
    deny: `${taskKey(task)}를 blocked로 두었습니다(${LIVE_BLOCKED}): ${reason} 워커(${runner})는 떠 있을 수 있어 이 작업이 파일을 계속 점유합니다. 워커를 멈추고, 멈춘 것을 확인한 뒤 cancel에 confirmed_stopped: true를 주고, 그다음 task로 새 판을 만드세요.`,
  }
}

/**
 * Notes a task launched by hand (the gate could not): only a ready task, its brief still the one
 * `task` wrote; that text is copied as the brief sent. A brief changed since leaves the task blocked
 * with why: what the worker was handed is not known. An overlap with a running task warns (the
 * worker is already out).
 */
export async function markDispatched($: EngineInterface, root: string, run: string, name: string, runner: string): Promise<Answer> {
  return withRunLock(root, run, async () => {
    const state = await readState($, root, run)
    if (state === undefined) return { deny: STATE_GONE(root, run) }
    const closed = closedRun(state)
    if (closed !== undefined) return { deny: closed }
    const task = findTask(state, name)
    if (task === undefined) return { deny: `작업이 없습니다: ${name}(${run})` }
    if (task.status !== 'ready') return { deny: `${taskKey(task)}는 ${task.status} 상태라 running으로 바꾸지 않습니다(ready인 판만). 새로 보낼 것이면 task로 새 판을 만드세요.` }
    const brief = await briefNow($, task)
    if ('problem' in brief) return setBlocked($, root, state, task, runner, brief.problem)
    const overlaps = overlapWarnings(state, task)
    const copy = await writeSentCopy($, root, state, task, brief.text)
    task.dispatchedHash = brief.hash
    const redrawn = await setRunning($, root, state, task, runner)

    return { result: withWarnings([`${taskKey(task)}: running · ${runner}`, `보낸 지시서 사본: ${copy}`], [...overlaps, redrawn]) }
  })
}

export type Reservation = {
  key: string
  /**
   * The launch went out: running, with its runner. When the brief changed while it was launched,
   * the task is left blocked and the answer says why (the gate shows it to the lead).
   */
  commit: (runner: string) => Promise<Answer>
  /** The launch failed: ready again. */
  release: () => Promise<void>
}

/**
 * For the gate hook, before a launch: inside the run's lock, a ready task whose brief is still the
 * one `task` wrote and that overlaps no running or launching task is set `launching`, which later
 * checks count as running; the brief's text is fixed then and copied as the brief sent. Then the
 * launch, then `commit(runner)` or `release()`. Two launches at once cannot both pass.
 */
export async function reserveDispatch($: EngineInterface, root: string, run: string, name: string): Promise<{ deny: string } | Reservation> {
  return withRunLock(root, run, async (): Promise<{ deny: string } | Reservation> => {
    const state = await readState($, root, run)
    if (state === undefined) return { deny: STATE_GONE(root, run) }
    const closed = closedRun(state)
    if (closed !== undefined) return { deny: closed }
    const task = findTask(state, name)
    if (task === undefined) return { deny: `작업이 없습니다: ${name}(${run})` }
    const key = taskKey(task)
    if (task.status !== 'ready') return { deny: `${key}는 ${task.status} 상태라 띄우지 않습니다(ready인 판만).` }
    const overlaps = overlapWarnings(state, task)
    if (overlaps.length > 0) return { deny: overlaps.join('\n') }
    const brief = await briefNow($, task)
    if ('problem' in brief) return { deny: brief.problem }
    await writeSentCopy($, root, state, task, brief.text)
    task.dispatchedHash = brief.hash
    task.status = 'launching'
    await save($, root, state)

    /** The reserved task as the state holds it now, if still launching. */
    const reserved = async () => {
      const now = await readState($, root, run)
      const found = now === undefined ? undefined : findTask(now, key)

      return now !== undefined && found !== undefined && found.status === 'launching' ? { now, found } : undefined
    }

    return {
      key,
      commit: runner =>
        withRunLock(root, run, async () => {
          const held = await reserved()
          if (held === undefined) return { deny: `${key}가 launching 상태가 아닙니다: running으로 바꾸지 않았습니다.` }
          // The brief as fixed at the reservation is what went out; one changed since is not to be trusted.
          const text = await readText($, held.found.specPath)
          const hash = text === undefined ? undefined : await sha256($, text)
          if (hash !== brief.hash) return setBlocked($, root, held.now, held.found, runner, `띄우는 동안 지시서가 바뀌었습니다(예약 때와 해시가 다름: ${held.found.specPath}).`)

          return { result: withWarnings([`${key}: running · ${runner}`], [await setRunning($, root, held.now, held.found, runner)]) }
        }),
      release: () =>
        withRunLock(root, run, async () => {
          const held = await reserved()
          if (held === undefined) return
          held.found.status = 'ready'
          delete held.found.dispatchedHash
          await save($, root, held.now)
        }),
    }
  })
}

async function cancelAction($: EngineInterface, root: string, state: RelayState, input: Record<string, unknown>): Promise<Answer> {
  const name = text(input.task)
  const task = findTask(state, name)
  if (task === undefined) return { deny: `작업이 없습니다: ${name}` }
  const key = taskKey(task)
  const reason = text(input.reason)
  if (reason === '') return { deny: 'reason이 비었습니다: 왜 띄우지 않는지 적으세요.' }
  if (task.status === 'cancelled') return { deny: `${key}는 이미 취소됐습니다.` }
  if (isDone(task)) return { deny: `${key}는 끝난 작업(${task.status})이라 취소하지 않습니다: 그 커밋은 검증 꾸러미에 들어갑니다.` }
  if (isBusy(task) && input.confirmed_stopped !== true) {
    return { deny: `${key}는 ${statusLabel(task)} 상태입니다${task.runner === null ? '' : `(${task.runner})`}: 워커가 멈춘 것을 확인한 뒤 confirmed_stopped: true를 주세요.` }
  }
  const was = statusLabel(task)
  const wasBusy = isBusy(task)
  task.status = 'cancelled'
  delete task.workerLive
  task.cancelReason = wasBusy ? `${reason} (워커 멈춤 확인됨)` : reason
  const redrawn = await save($, root, state)

  return { result: withWarnings([`${key}: ${was} → cancelled · ${task.cancelReason}`], [redrawn]) }
}

async function reportAction($: EngineInterface, root: string, state: RelayState, name: string): Promise<Answer> {
  const task = findTask(state, name)
  if (task === undefined) return { deny: `작업이 없습니다: ${name}` }
  const key = taskKey(task)
  const dir = runDir(root, state.run)
  const path = reportFile(dir, key)
  const reportText = await readText($, path)
  if (reportText === undefined) return { deny: `보고서가 없습니다: ${path}` }

  const report = parseReport(reportText)
  const mismatches = reportMismatches(report, task.criteria)
  const look = await lookAtCommits($, root, task, report.commits)
  if (look.missing.length > 0) mismatches.push(`없는 커밋: ${look.missing.join(', ')}`)
  const warnings: (string | undefined)[] = []
  const short = report.commits.filter(sha => !/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(sha))
  if (short.length > 0) warnings.push(`전체 SHA가 아닌 커밋: ${short.join(', ')}`)
  if (look.unsigned.length > 0) warnings.push(`꼬리말 Task: ${key}가 없는 커밋: ${look.unsigned.join(', ')}`)
  for (const criterion of report.criteria) {
    if (criterion.tries === null) continue
    const before = task.tries[criterion.id]
    if (before !== undefined && criterion.tries < before) warnings.push(`${criterion.id}의 tries가 ${before}에서 ${criterion.tries}로 줄었습니다(판을 넘어 누적해야 함).`)
    task.tries[criterion.id] = Math.max(before ?? 0, criterion.tries)
    if (criterion.tries > 3) warnings.push(`${criterion.id}의 tries가 ${criterion.tries}입니다(누적 3번까지).`)
  }
  const spec = await readText($, task.specPath)
  if (spec === undefined || (await sha256($, spec)) !== (task.dispatchedHash ?? task.specHash)) warnings.push('지시서가 보낸 뒤에 바뀌었거나 없습니다: 워커가 본 지시서와 다를 수 있습니다.')

  // The effort it ran at: what hubblerc signed its commits with, else what the report itself says.
  const signed: string[] = []
  for (const sha of report.commits.filter(sha => !look.missing.includes(sha))) {
    const trailer = await git($, root, ['log', '-1', '--format=%(trailers:key=Effort,valueonly)', sha]).catch(() => undefined)
    signed.push(...(trailer?.exitCode === 0 ? trailer.stdout : '').split('\n').map(line => line.trim()).filter(line => line !== ''))
  }
  const ran = effortRan(signed, report.modelEffort)
  if (ran === undefined) delete task.actualEffort
  else task.actualEffort = ran

  const status: TaskStatus = mismatches.length > 0 || report.status === null ? 'blocked' : STATUS_OF[report.status]
  // The worker reported: it is no longer out (a mismatch is its report to fix, not a live worker).
  const wasLive = task.workerLive === true
  delete task.workerLive
  task.status = status
  task.reportedAt = await $.clock.now()
  warnings.push(await save($, root, state))

  // The first line holds what a clean report says; a line follows only for something to act on.
  const passed = report.criteria.filter(criterion => criterion.result === 'pass').length
  const notPassed = report.criteria.filter(criterion => criterion.result !== 'pass')
  const criteria =
    report.criteria.length === 0 ? '기준 없음(워커 보고)' : notPassed.length === 0 ? `기준 ${passed} pass(워커 보고)` : `기준 ${passed}/${report.criteria.length} pass(워커 보고)`
  const commits = report.commits.length === 0 ? '커밋 없음' : `커밋 ${report.commits.map(sha => sha.slice(0, 7)).join(', ')}`
  const isDoneNow = status === 'done' || status === 'done_with_concerns'
  // Every criterion fixed at least once, passed or not: a pass the check then fails may have no tries left.
  const tried = task.criteria.filter(criterion => (task.tries[criterion.id] ?? 0) >= 1).map(criterion => `${criterion.id} ${task.tries[criterion.id]}`)
  const lines = [
    [`${key}: 보고 ${report.status ?? '없음'} → 상태 ${status}`, commits, criteria, ...(isDoneNow ? ['다음: check'] : [])].join(' · '),
    ...(wasLive ? ['띄운 뒤 막혀 있던 작업의 워커가 보고했습니다: 이제 점유하지 않습니다(보고대로 처리).'] : []),
    ...(notPassed.length === 0 ? [] : [`기준(워커 보고): ${notPassed.map(criterion => `${criterion.id} ${criterion.result}`).join(', ')}`]),
    ...(tried.length === 0 ? [] : [`tries: ${tried.join(', ')}`]),
    ...(look.outside.length === 0 ? [] : [`범위 밖 파일: ${look.outside.join(', ')}`]),
    ...(look.tests.length === 0 ? [] : [`테스트·검사 파일 변경: ${look.tests.join(', ')}`]),
    ...(ran === undefined || ran === task.effort.trim().toLowerCase() ? [] : [`effort: 지시서 ${task.effort} · 실제 ${ran}(${signed.length > 0 ? '커밋 꼬리말' : '보고서'})`]),
    // The report is to be read when it is not a plain DONE (concerns, a question), or when it disagrees.
    ...(report.status !== 'DONE' || mismatches.length > 0 ? [`보고서: ${path}`] : []),
    ...(mismatches.length === 0 ? [] : ['', '보고서 불일치(워커에게 고쳐 달라고 하세요):', ...mismatches.map(problem => `- ${problem}`)]),
  ]

  return { result: withWarnings(lines, warnings) }
}

/** A check's time as its first line says it: `14 ms`, `16.2초`. */
const duration = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}초`)

type Snapshot = { head: string | undefined; changes: TreeChanges | undefined }

async function snapshot($: EngineInterface, root: string): Promise<Snapshot> {
  return { head: await headSha($, root), changes: await treeChanges($, root) }
}

/** The tree's changes as one list, a file git does not know marked so. */
const uncommittedOf = (changes: TreeChanges): string[] => [...changes.tracked, ...changes.untracked.map(path => `${path} (git이 모름)`)]

/**
 * Why a command's result does not stand for HEAD: the tree not clean before or after it (a tracked
 * change, or a file git does not know, which a command may read as if it were committed), or HEAD moved.
 */
function snapshotProblems(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = []
  if (before.changes === undefined || after.changes === undefined) problems.push('git status를 읽지 못해 작업 트리를 확인하지 못함')
  else {
    const was = uncommittedOf(before.changes)
    if (was.length > 0) problems.push(`실행 전 커밋하지 않은 변경·git이 모르는 파일: ${was.join(', ')}`)
    const appeared = uncommittedOf(after.changes).filter(path => !was.includes(path))
    if (appeared.length > 0) problems.push(`실행 중 생기거나 바뀐 파일: ${appeared.join(', ')}`)
  }
  if (before.head === undefined || after.head === undefined || before.head !== after.head) problems.push(`실행 중 HEAD가 바뀜(${before.head?.slice(0, 7) ?? '미확인'} → ${after.head?.slice(0, 7) ?? '미확인'})`)

  return problems
}

async function checkAction($: EngineInterface, root: string, state: RelayState, name: string): Promise<Answer> {
  const task = findTask(state, name)
  if (task === undefined) return { deny: `작업이 없습니다: ${name}` }
  const key = taskKey(task)
  const startedAt = await $.clock.now()
  const before = await snapshot($, root)
  const outcomes: CheckOutcome[] = []
  // check takes no lock, so the run may be abandoned while it runs: before each command and before
  // the result file it reads the state again and stops there. A command already running ends first.
  let commandsRun = 0
  const stopped = async (): Promise<{ deny: string } | undefined> =>
    (await readState($, root, state.run))?.status === 'abandoned' ? { deny: `검사 도중 묶음이 버려져 멈췄습니다: ${state.run}(기준 명령 ${commandsRun}개를 돌린 뒤, 결과 파일은 쓰지 않음)` } : undefined
  for (const criterion of task.criteria) {
    const expectExit = criterion.expectExit ?? 0
    const base = { id: criterion.id, text: criterion.text, expectExit }
    if (criterion.command === undefined) {
      outcomes.push({ ...base, result: 'unverified', reason: '명령 없음: 검증자·사용자 확인' })
      continue
    }
    const halt = await stopped()
    if (halt !== undefined) return halt
    const left = CHECK_TOTAL_MS - ((await $.clock.now()) - startedAt)
    if (left <= 0) {
      outcomes.push({ ...base, command: criterion.command, result: 'unverified', reason: `한 번 부를 때 합계 ${CHECK_TOTAL_MS / 1000}초를 넘어 돌리지 않음` })
      continue
    }
    const limit = Math.min(CHECK_MS, left)
    const at = await $.clock.now()
    commandsRun += 1
    try {
      const ran = await $.process.run(['/bin/sh', '-c', criterion.command], { cwd: root, timeoutMs: limit })
      const ms = (await $.clock.now()) - at
      // A result stands for HEAD only on a clean tree that HEAD did not leave while it ran.
      const problems = snapshotProblems(before, await snapshot($, root))
      outcomes.push({
        ...base,
        command: criterion.command,
        result: problems.length > 0 ? 'unverified' : ran.exitCode === expectExit ? 'pass' : 'fail',
        exitCode: ran.exitCode,
        ms,
        stdout: lastLines(ran.stdout),
        stderr: lastLines(ran.stderr),
        ...(problems.length === 0 ? {} : { reason: problems.join('; ') }),
      })
    } catch (error) {
      outcomes.push({ ...base, command: criterion.command, result: 'unverified', ms: (await $.clock.now()) - at, reason: `${limit / 1000}초 안에 끝나지 않았거나 시작하지 못함: ${String(error)}` })
    }
  }
  const head = before.head ?? '미확인'
  const tree =
    before.changes === undefined
      ? '작업 트리: git status 실패'
      : uncommittedOf(before.changes).length === 0
        ? '작업 트리: 깨끗함(git이 모르는 파일도 없음)'
        : `작업 트리: 커밋하지 않은 변경·git이 모르는 파일 ${uncommittedOf(before.changes).join(', ')}`
  const path = checksFile(runDir(root, state.run), key)
  const halt = await stopped()
  if (halt !== undefined) return halt
  await $.fs.write(path, checksText(key, head, startedAt, outcomes, [tree]))

  // Where the worker's word and the commands disagree.
  const disagree: string[] = []
  const reportText = await readText($, reportFile(runDir(root, state.run), key))
  if (reportText !== undefined) {
    for (const said of parseReport(reportText).criteria) {
      const found = outcomes.find(outcome => outcome.id === said.id)
      if (found !== undefined && said.result === 'pass' && found.result === 'fail') disagree.push(`${said.id}: 워커는 pass, 명령은 fail`)
    }
  }
  // The first line holds the counts, the tree and the time; a line follows only for what is to be looked at.
  const isNoCommand = (outcome: CheckOutcome) => outcome.result === 'unverified' && outcome.command === undefined
  const of = (result: CheckOutcome['result']) => outcomes.filter(outcome => outcome.result === result)
  const unverified = of('unverified')
  const shown = outcomes.filter(outcome => outcome.result === 'fail' || (outcome.result === 'unverified' && !isNoCommand(outcome)))
  const isClean = before.changes !== undefined && uncommittedOf(before.changes).length === 0
  const treeShort = before.changes === undefined ? '트리 확인 실패' : isClean ? '트리 깨끗함' : `트리 변경 ${uncommittedOf(before.changes).length}개`
  const totalMs = outcomes.reduce((sum, outcome) => sum + (outcome.ms ?? 0), 0)
  const counts = [
    `pass ${of('pass').length}${of('pass').length === 0 ? '' : ` (${of('pass').map(outcome => outcome.id).join(' ')})`}`,
    ...(of('fail').length === 0 ? [] : [`fail ${of('fail').length} (${of('fail').map(outcome => outcome.id).join(' ')})`]),
    ...(unverified.length === 0 ? [] : [`미확인 ${unverified.length} (${unverified.map(outcome => (isNoCommand(outcome) ? `${outcome.id} 명령 없음` : outcome.id)).join(', ')})`]),
  ]
  const lines = [
    `${key} 검사 결과(HEAD ${head.slice(0, 7)}): ${[...counts, treeShort, duration(totalMs)].join(' · ')}`,
    ...(isClean ? [] : [tree]),
    ...shown.map(outcome => {
      const exit = outcome.exitCode === undefined ? '' : ` · exit ${outcome.exitCode}(기대 ${outcome.expectExit}) · ${duration(outcome.ms ?? 0)}`

      // The tries counted across revisions: one that fails with 3 behind it asks for another worker.
      return `- ${outcome.id}: ${outcome.result}${exit}${outcome.reason === undefined ? '' : ` · ${outcome.reason}`} · tries ${task.tries[outcome.id] ?? 0}`
    }),
    ...(shown.length === 0 ? [] : [`검사 결과 파일: ${path}`]),
  ]

  return { result: withWarnings(lines, disagree) }
}

/** The brief a package shows for a task: the copy sent, unchanged since; or why there is none to trust. */
async function sentBrief($: EngineInterface, root: string, state: RelayState, task: RelayTask): Promise<{ text: string; note?: string } | { problem: string }> {
  const key = taskKey(task)
  const spec = await readText($, task.specPath)
  if (spec === undefined) return { problem: `${key}: 지시서 파일이 없습니다(${task.specPath})` }
  const hash = await sha256($, spec)
  if (task.dispatchedHash === undefined) {
    if (hash !== task.specHash) return { problem: `${key}: 지시서가 쓴 뒤에 바뀌었습니다(보낸 기록 없음). 새 판으로 다시 보내세요.` }

    return { text: spec, note: '보낸 기록(dispatched)이 없어 쓴 때의 지시서를 담음' }
  }
  if (hash !== task.dispatchedHash) return { problem: `${key}: 지시서가 보낸 뒤에 바뀌었습니다(dispatched 때와 해시가 다름). 보낸 지시서는 고치지 말고 새 판으로.` }
  const copyPath = dispatchedFile(runDir(root, state.run), key)
  const copy = await readText($, copyPath)
  if (copy === undefined || (await sha256($, copy)) !== task.dispatchedHash) return { problem: `${key}: 보낸 지시서 사본이 없거나 바뀌었습니다(${copyPath}).` }

  if (task.dispatchedHash !== task.specHash) return { problem: `${key}: 보낸 지시서 사본이 task로 쓴 원본과 다릅니다(보내기 전에 고친 지시서). 새 판으로 다시 보내세요.` }

  return { text: copy }
}

async function packageAction($: EngineInterface, root: string, state: RelayState, names: unknown): Promise<Answer> {
  const asked = stringList(names)
  if (asked === null) return { deny: 'tasks는 문자열 배열이어야 합니다.' }
  const warnings: string[] = []
  let chosen: RelayTask[]
  if (asked.length > 0) {
    chosen = []
    for (const name of asked) {
      const task = findTask(state, name)
      if (task === undefined) return { deny: `작업이 없습니다: ${name}` }
      if (!isDone(task)) warnings.push(`${taskKey(task)}는 ${task.status} 상태입니다.`)
      if (!chosen.includes(task)) chosen.push(task)
    }
  } else {
    // Every task done as it stands: finish asks the last verdict's package to hold them all.
    chosen = effectiveTasks(state.tasks).filter(isDone)
  }
  if (chosen.length === 0) return { deny: '꾸러미에 넣을 작업이 없습니다: done인 작업이 없습니다. tasks로 직접 고르세요.' }

  const changes = await treeChanges($, root)
  if (changes === undefined) return { deny: 'git status를 읽지 못해 작업 트리를 확인하지 못했습니다: 꾸러미를 만들지 않았습니다.' }
  const uncommitted = uncommittedOf(changes)
  if (uncommitted.length > 0) return { deny: `작업 트리에 커밋하지 않은 변경·git이 모르는 파일이 있습니다: ${uncommitted.join(', ')}. 검증자는 커밋만 봅니다: 커밋하거나 치운 뒤 package하세요.` }
  const briefs = new Map<RelayTask, { text: string; note?: string }>()
  const problems: string[] = []
  for (const task of chosen) {
    const brief = await sentBrief($, root, state, task)
    if ('problem' in brief) problems.push(brief.problem)
    else briefs.set(task, brief)
  }
  if (problems.length > 0) return { deny: ['꾸러미를 만들지 않았습니다:', ...problems.map(problem => `- ${problem}`)].join('\n') }
  const signed = await runCommits($, root, state)
  if (signed === undefined) return { deny: `git log가 실패해 이 묶음(Run: ${state.run})의 커밋을 모으지 못했습니다: 꾸러미를 만들지 않았습니다. 다시 package하세요.` }

  const dir = runDir(root, state.run)
  const head = (await headSha($, root)) ?? '미확인'
  const entries = await $.fs.list(`${dir}/reviews`).catch(() => [])
  const taken = [
    ...entries.map(entry => /^V(\d+)-package\.md$/.exec(entry.name)?.[1]),
    ...(state.packages ?? []).map(pack => /^V(\d+)$/.exec(pack.id)?.[1]),
  ]
    .filter((n): n is string => n !== undefined)
    .map(Number)
  const id = `V${Math.max(0, ...taken) + 1}`
  const packagePath = `${dir}/reviews/${id}-package.md`
  const verdictPath = `${dir}/reviews/${id}-verdict.json`
  const schemaPath = `${dir}/reviews/verdict.schema.json`

  // Each commit's files once, by two readings that must agree: they decide what the verifier reviews.
  const fileChanges: FileChange[] = []
  const filesOf = new Map<string, ReturnType<typeof parseNumstat>>()
  const listFailures: string[] = []
  const commitFiles = async (sha: string, key: string) => {
    const known = filesOf.get(sha)
    if (known !== undefined) return known
    const numstat = await git($, root, ['show', '--numstat', '--no-renames', '--format=', sha]).catch(() => undefined)
    const named = await git($, root, ['show', '--name-only', '--no-renames', '--format=', sha]).catch(() => undefined)
    const files = parseNumstat(numstat?.stdout ?? '')
    if (numstat === undefined || numstat.exitCode !== 0 || numstat.isStdoutTruncated) listFailures.push(`${sha}: git show --numstat 실패(${numstat === undefined ? '실행 못 함' : numstat.isStdoutTruncated ? '출력 잘림' : `종료 코드 ${numstat.exitCode}`})`)
    else if (named === undefined || named.exitCode !== 0 || named.isStdoutTruncated) listFailures.push(`${sha}: git show --name-only 실패`)
    else {
      const byName = [...new Set(named.stdout.split('\n').map(line => line.trim()).filter(line => line !== ''))].sort()
      const byCount = [...new Set(files.map(file => file.path))].sort()
      if (byName.join('\n') !== byCount.join('\n')) listFailures.push(`${sha}: 바뀐 파일 목록이 서로 다름(numstat: ${byCount.join(', ') || '없음'} / name-only: ${byName.join(', ') || '없음'})`)
    }
    filesOf.set(sha, files)
    fileChanges.push(...files.map(file => ({ sha, key, ...file })))

    return files
  }

  /** A revision's commits, reported and found by trailer, with their files; its scope and test changes. */
  const revisionBlock = async (rev: RelayTask) => {
    const key = taskKey(rev)
    const reportText = await readText($, reportFile(dir, key))
    const reported = reportText === undefined ? [] : parseReport(reportText).commits
    const unreported = (signed.get(key) ?? []).filter(sha => !reported.some(other => sameCommit(other, sha)))
    const all = [...reported, ...unreported]
    const look = await lookAtCommits($, root, rev, all, state.base)
    const listed: string[] = []
    for (const [at, sha] of all.filter(other => !look.missing.includes(other)).entries()) listed.push(...commitLines(look.subjects[at] ?? sha, await commitFiles(sha, key)))
    const lines = [
      `#### ${key} (${rev.status}${rev.cancelReason === undefined ? '' : `: ${rev.cancelReason}`}${rev.blockReason === undefined ? '' : `: ${rev.blockReason}`})${reportText === undefined ? ' — 보고서 없음' : ''}`,
      ...(listed.length === 0 ? ['- 커밋 없음'] : listed),
      ...(unreported.length === 0 ? [] : [`- 보고에 없고 꼬리말(Task: ${key}, Run: ${state.run})로 찾은 커밋: ${unreported.join(', ')}`]),
      ...(look.missing.length === 0 ? [] : [`- 없는 커밋: ${look.missing.join(', ')}`]),
      ...(look.unsigned.length === 0 ? [] : [`- 꼬리말 Task: ${key}가 없는 커밋: ${look.unsigned.join(', ')}`]),
      ...(look.offBase.length === 0 ? [] : [`- Base(${state.base.slice(0, 7)})의 자손이 아닌 커밋: ${look.offBase.join(', ')}`]),
    ]

    return { lines, count: all.length, outside: look.outside.map(file => `${file} (${key})`), tests: look.tests.map(file => `${file} (${key})`) }
  }

  /** Every revision of a task id: their blocks, then what they changed outside the scope and in tests. */
  const taskCommits = async (taskId: string, heading: string) => {
    const blocks = []
    for (const rev of state.tasks.filter(task => task.id === taskId).sort((a, b) => a.rev - b.rev)) blocks.push(await revisionBlock(rev))
    const outside = blocks.flatMap(block => block.outside)
    const tests = blocks.flatMap(block => block.tests)
    const lines = [
      '',
      heading,
      ...blocks.flatMap(block => block.lines),
      '',
      `### Files outside the edit scope (every revision of ${taskId}): ${outside.length === 0 ? 'none' : outside.join(', ')}`,
      `### Test file changes (every revision of ${taskId}): ${tests.length === 0 ? 'none' : tests.join(', ')}`,
    ]

    return { lines, count: blocks.reduce((sum, block) => sum + block.count, 0) }
  }

  const parts = [
    `# Verification package ${id}: ${state.run}`,
    '',
    `- Run goal: ${state.goal.replace(/\s+/g, ' ')}`,
    `- Run done when: ${state.doneWhen.join('; ')}`,
    `- HEAD: ${head}`,
    `- Base: ${state.base}`,
    `- Tasks: ${chosen.map(taskKey).join(', ')}`,
  ]
  const ids = [...new Set(chosen.map(task => task.id))]
  for (const taskId of ids) {
    for (const task of chosen.filter(other => other.id === taskId)) {
      const key = taskKey(task)
      const brief = briefs.get(task)
      const reportText = await readText($, reportFile(dir, key))
      const checks = await readText($, checksFile(dir, key))
      parts.push(
        '',
        `## Task ${key}: ${task.title}`,
        '',
        `### Brief as sent (Rules and Report format left out)${brief?.note === undefined ? '' : ` — ${brief.note}`}`,
        withoutSections(brief?.text ?? '', ['Rules', 'Report format']).replace(/^# /gm, '#### ').trim(),
        '',
        "### Worker's report (its hand-over notes left out)",
        reportText === undefined ? '(보고서 없음)' : withoutSections(reportText, ['For whoever picks up']).replace(/^##? /gm, '#### ').trim(),
        '',
        '### Checks run by the relay tool (not the worker)',
        checks === undefined ? '(check를 돌리지 않았습니다)' : checks.replace(/^##? /gm, '#### ').trim(),
      )
    }
    // Every revision's commits: an earlier one's (cancelled, blocked) stay in HEAD too.
    parts.push(...(await taskCommits(taskId, `### Commits of every revision of ${taskId}`)).lines)
  }

  // The run's other commits: tasks outside this package (cancelled, blocked, not chosen) and commits
  // signed for the run with no known task. A cancel reverts no code: what is in HEAD is reviewed.
  const other: string[] = []
  for (const taskId of [...new Set(state.tasks.map(task => task.id))].filter(taskId => !ids.includes(taskId))) {
    const found = await taskCommits(taskId, `### Task ${taskId} (not in this package)`)
    if (found.count > 0) other.push(...found.lines)
  }
  const knownKeys = new Set(state.tasks.map(taskKey))
  const loose = [...signed.entries()].filter(([key]) => !knownKeys.has(key)).flatMap(([key, shas]) => shas.map(sha => ({ key, sha })))
  if (loose.length > 0) {
    other.push('', `### Commits signed Run: ${state.run} with no known task`)
    for (const { key, sha } of loose) {
      const subject = await git($, root, ['log', '-1', '--format=%s', sha]).catch(() => undefined)
      other.push(...commitLines(`${sha} ${subject?.stdout.trim() ?? ''}`.trim() + (key === '' ? ' (Task 꼬리말 없음)' : ` (Task: ${key})`), await commitFiles(sha, key === '' ? '?' : key)))
    }
  }
  if (other.length > 0) parts.push('', '## Other commits of this run', '이 꾸러미의 작업 밖이지만 이 묶음의 커밋이다. 취소는 코드를 되돌리지 않는다: 이 파일들도 검토한다.', ...other)

  if (listFailures.length > 0) return { deny: ['커밋이 바꾼 파일 목록을 확실히 읽지 못해 꾸러미를 만들지 않았습니다(검토할 파일이 빠질 수 있음). 다시 package하세요:', ...listFailures.map(failure => `- ${failure}`)].join('\n') }

  const at = await $.clock.now()
  const files = [...new Set(fileChanges.map(change => change.path))].sort()
  const pack: RelayPackage = { id, at, head, tasks: chosen.map(task => ({ key: taskKey(task), criteria: task.criteria.map(criterion => criterion.id) })), files }
  const required = chosen.flatMap(task => task.criteria.map(criterion => ({ id: `${taskKey(task)}:${criterion.id}`, text: criterion.text })))
  parts.push(
    '',
    filesToReview(root, fileChanges),
    '',
    verifierInstructions(verdictPath, schemaPath, required),
    '',
  )
  await $.fs.write(packagePath, parts.join('\n'))
  // A run started before a field was added gets the schema the verdict is now checked against.
  await $.fs.write(schemaPath, `${JSON.stringify(VERDICT_SCHEMA, null, 2)}\n`)
  state.packages = [...(state.packages ?? []), pack]
  await writeState($, root, state)

  return {
    result: withWarnings(
      [`검증 꾸러미 ${id}: ${packagePath}`, `판정 파일: ${verdictPath}`, `판정 형식: ${schemaPath}`, `담은 작업: ${chosen.map(taskKey).join(', ')} · HEAD ${head.slice(0, 7)} · 검토할 파일 ${files.length}개`],
      warnings,
    ),
  }
}

async function verdictAction($: EngineInterface, root: string, state: RelayState, id: string): Promise<Answer> {
  if (!/^V\d+$/.test(id)) return { deny: 'id는 V1처럼 package가 돌려준 번호여야 합니다.' }
  const pack = state.packages?.find(other => other.id === id)
  if (pack === undefined) return { deny: `꾸러미 ${id}의 기록이 없습니다: package가 만든 꾸러미의 판정만 받습니다.` }
  const path = `${runDir(root, state.run)}/reviews/${id}-verdict.json`
  const raw = await readText($, path)
  if (raw === undefined) return { deny: `판정 파일이 없습니다: ${path}` }
  const parsed = parseVerdict(raw)
  if ('problems' in parsed) return { deny: [`판정 형식이 틀렸습니다(${path}):`, ...parsed.problems.map(problem => `- ${problem}`)].join('\n') }
  const { verdict } = parsed
  const judged = judgeVerdict(verdict, pack)
  if (judged.problems.length > 0) return { deny: [`판정이 꾸러미 ${id}의 기준과 맞지 않습니다(${path}):`, ...judged.problems.map(problem => `- ${problem}`)].join('\n') }
  const at = await $.clock.now()
  state.verdicts = [...state.verdicts.filter(other => other.id !== id), { id, at, commit: verdict.commit, path, result: judged.result, ...(judged.reasons.length === 0 ? {} : { reasons: judged.reasons }) }]
  await writeState($, root, state)

  const head = await headSha($, root)
  const count = (result: string) => verdict.criteria.filter(criterion => criterion.result === result).length
  const severity = (level: string) => verdict.findings.filter(finding => finding.severity === level).length
  const notPassed = verdict.criteria.filter(criterion => criterion.result !== 'pass').map(criterion => `${criterion.id}(${criterion.result})`)
  const lines = [
    `판정 ${id}: 기록 ${judged.result} (판정 파일의 result ${verdict.result}) · 검증 모델 ${verdict.model} · 본 커밋 ${verdict.commit.slice(0, 7)}`,
    ...(judged.reasons.length === 0 ? [] : [`fail로 기록한 이유: ${judged.reasons.join('; ')}`]),
    `기준: pass ${count('pass')} · fail ${count('fail')} · unverified ${count('unverified')}${notPassed.length === 0 ? '' : ` (${notPassed.join(', ')})`}`,
    `지적: high ${severity('high')} · medium ${severity('medium')} · low ${severity('low')}`,
    `판정 파일: ${path}`,
  ]
  const warnings = [
    head === undefined || !sameCommit(verdict.commit, head) ? `검증한 판과 지금 판이 다름: 판정은 ${verdict.commit.slice(0, 7)}, 지금 HEAD는 ${head?.slice(0, 7) ?? '미확인'}` : undefined,
    sameCommit(verdict.commit, pack.head) ? undefined : `판정의 commit(${verdict.commit.slice(0, 7)})이 꾸러미 ${id}의 HEAD(${pack.head.slice(0, 7)})와 다릅니다.`,
  ]

  return { result: withWarnings(lines, warnings) }
}

async function decisions($: EngineInterface, root: string, state: RelayState) {
  const progress = await readText($, `${runDir(root, state.run)}/progress.md`)

  return progress === undefined ? undefined : decisionRows(progress)
}

const decisionLine = (row: { id: string; decision: string; by: string; status: string }) => `- ${row.id} · ${row.decision} · ${row.by} · ${row.status}`

async function pendingAction($: EngineInterface, root: string, state: RelayState): Promise<Answer> {
  const rows = await decisions($, root, state)
  if (rows === undefined) return { deny: `progress.md가 없습니다: ${runDir(root, state.run)}/progress.md` }
  const pending = rows.filter(isPending)
  if (pending.length === 0) return { result: '사용자 답을 기다리는 결정(asked·on hold)이 없습니다.' }

  return { result: [`사용자 답을 기다리는 결정 ${pending.length}개:`, ...pending.map(decisionLine)].join('\n') }
}

async function finishAction($: EngineInterface, root: string, state: RelayState): Promise<Answer> {
  const head = await headSha($, root)
  const changes = await treeChanges($, root)
  const reasons = finishProblems(state, head, changes === undefined ? undefined : uncommittedOf(changes))
  if (reasons.length > 0) return { deny: ['묶음을 끝내지 않았습니다:', ...reasons.map(reason => `- ${reason}`)].join('\n') }

  const last = state.verdicts.at(-1)
  state.status = 'finished'
  const redrawn = await save($, root, state)
  const rows = (await decisions($, root, state)) ?? []
  const pending = rows.filter(isPending)
  const byLead = rows.filter(isByLead)
  const lines = [
    `묶음을 끝냈습니다: ${state.run} · 판정 ${last?.id ?? ''} · HEAD ${head?.slice(0, 7) ?? ''}`,
    '',
    `사용자 답을 기다리는 결정(asked·on hold): ${pending.length === 0 ? '없음' : ''}`,
    ...pending.map(decisionLine),
    '',
    `리드가 정한 결정(사용자에게 모두 보고하세요): ${byLead.length === 0 ? '없음' : ''}`,
    ...byLead.map(row => `- ${row.id} · ${row.decision} — ${row.why} — 틀렸을 때: ${row.cost}`),
  ]

  return { result: withWarnings(lines, [redrawn]) }
}

/**
 * The run's commits still in HEAD: those signed with its Run trailer since its base, and those its
 * reports name that HEAD holds. Undefined when git log fails.
 */
async function commitsLeft($: EngineInterface, root: string, state: RelayState): Promise<string[] | undefined> {
  const signed = await runCommits($, root, state)
  if (signed === undefined) return undefined
  const shas = [...new Set([...signed.values()].flat())]
  const dir = runDir(root, state.run)
  for (const task of state.tasks) {
    const reportText = await readText($, reportFile(dir, taskKey(task)))
    for (const sha of reportText === undefined ? [] : parseReport(reportText).commits) {
      if (shas.some(other => sameCommit(other, sha))) continue
      const held = await git($, root, ['merge-base', '--is-ancestor', sha, 'HEAD']).catch(() => undefined)
      if (held?.exitCode === 0) shas.push(sha)
    }
  }
  const lines: string[] = []
  for (const sha of shas) {
    const subject = await git($, root, ['log', '-1', '--format=%s', sha]).catch(() => undefined)
    lines.push(`${sha.slice(0, 7)} ${subject?.exitCode === 0 ? subject.stdout.trim() : ''}`.trim())
  }

  return lines
}

/**
 * Drops a run the person gave up on (or a trial run with nothing to keep): refused while a task
 * holds a worker. The run is set abandoned with why and when; its tasks stay as they are. It is no
 * longer under way anywhere (list, the box, session start, the gate), and nothing more writes to
 * it. It reverts no code and verifies nothing: the answer lists the commits it leaves in HEAD.
 */
async function abandonAction($: EngineInterface, root: string, state: RelayState, reason: string): Promise<Answer> {
  if (reason === '') return { deny: 'reason이 비었습니다: 왜 이 묶음을 버리는지 적으세요.' }
  const holding = state.tasks.filter(isBusy)
  if (holding.length > 0) {
    const named = holding.map(task => `${taskKey(task)}(${statusLabel(task)}${task.runner === null ? '' : ` · ${task.runner}`})`).join(', ')

    return { deny: `워커를 잡고 있는 작업이 있어 버리지 않았습니다: ${named}. 워커를 멈추고, 멈춘 것을 확인한 뒤 cancel에 confirmed_stopped: true를 주세요.` }
  }
  const left = await commitsLeft($, root, state)
  const at = await $.clock.now()
  state.status = 'abandoned'
  state.abandonedAt = at
  state.abandonReason = reason
  const warnings = [await save($, root, state)]
  const path = progressPath(root, state.run)
  const progress = await readText($, path)
  const logged = progress === undefined ? null : withLogRow(progress, at, `묶음을 버림: ${reason}`)
  if (logged === null) warnings.push(`progress.md의 Log 표가 없어 버린 기록을 적지 못했습니다: ${path}`)
  else await $.fs.write(path, logged)
  const pending = ((await decisions($, root, state)) ?? []).filter(isPending)

  const lines = [
    `묶음을 버렸습니다: ${state.run} · 남은 커밋 ${left === undefined ? '미확인' : `${left.length}개`}`,
    `이유: ${reason}`,
    ...(left === undefined
      ? [`git log가 실패해 이 묶음(Run: ${state.run})의 커밋을 세지 못했습니다.`]
      : left.length === 0
        ? []
        : ['버리기는 코드를 되돌리지 않고, 이 커밋들은 검증된 것도 아닙니다(사용자에게 알리세요):', ...left.map(line => `- ${line}`)]),
    ...(pending.length === 0 ? [] : ['', `사용자 답을 기다리던 결정 ${pending.length}개:`, ...pending.map(decisionLine)]),
  ]

  return { result: withWarnings(lines, warnings) }
}
