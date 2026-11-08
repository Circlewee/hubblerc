import type { EngineInterface, On, ProcessRunResult } from 'claude-code'

import {
  briefText,
  checkTask,
  checksFile,
  checksText,
  cutBytes,
  decisionRows,
  DIFF_LIMIT,
  fenced,
  findTask,
  isByLead,
  isCriterionId,
  isPending,
  isRun,
  isRunName,
  isTestFile,
  lastLines,
  latestRevs,
  localDate,
  outsideScope,
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
  withTasks,
} from './relay-format'
import type { BriefInput, CheckOutcome, Criterion, RelayState, RelayTask, RunnerKind, TaskStatus } from './relay-format'

/**
 * relay's tool: the steps of the lead/worker skill (hubblerc:relay) that have one right answer.
 * The lead (Claude) judges; this starts a run, writes briefs, checks reports, runs the done-when
 * commands itself, builds the verifier's package and closes the run. Its record lives in the
 * working repository's `.relay/runs/<run>/`, kept out of git by a `*` .gitignore in that folder.
 * One lead per run writes it, so state.json is read, changed and written whole. No timers.
 */

/** As registered; the engine lists it as `mcp__hubblerc__relay`. */
const TOOL_NAME = 'relay'
const RELAY_TOOL_PATTERN = /^mcp__hubblerc__relay$/
const TOOL_DESCRIPTION =
  'Machine steps of the relay skill (hubblerc:relay): start a run, write task briefs and check their overlap, record a dispatch, ' +
  'check a worker report, run the done-when commands, build the verifier package, record a verdict, list pending decisions, finish a run. ' +
  'Only for a lead following that skill.'

const ACTIONS = ['start', 'list', 'task', 'spec_text', 'dispatched', 'report', 'check', 'package', 'verdict', 'pending', 'finish'] as const

/** One criterion's command may run this long; one `check` call this long in all. */
const CHECK_MS = 120_000
const CHECK_TOTAL_MS = 600_000
const GIT_MS = 30_000

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
    task: { type: 'string', description: 'dispatched, report, check: T3 (latest revision) or T3-r2' },
    runner: { type: 'string', description: "dispatched: where it runs and how to reach it again ('orca dispatch:<id>', 'subagent <name|agentId>')" },
    tasks: { ...strings, description: 'package: tasks to include; absent, those done since the last verdict' },
  },
  required: ['action'],
} as const

/** At session.start: the model's tool. */
export async function registerRelayTool($: EngineInterface): Promise<void> {
  await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA as unknown as Record<string, unknown> }).catch(() => undefined)
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

// ── Engine helpers ──────────────────────────────────────────────

async function git($: EngineInterface, root: string, args: readonly string[]): Promise<ProcessRunResult> {
  return $.process.run(['git', ...args], { cwd: root, timeoutMs: GIT_MS })
}

/** The working repository's top folder, from the session's working directory; undefined outside git. */
export async function repoRoot($: EngineInterface): Promise<string | undefined> {
  const ran = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: GIT_MS }).catch(() => undefined)
  const root = ran?.exitCode === 0 ? ran.stdout.trim() : ''

  return root === '' ? undefined : root
}

async function headSha($: EngineInterface, root: string): Promise<string | undefined> {
  const ran = await git($, root, ['rev-parse', 'HEAD']).catch(() => undefined)
  const sha = ran?.exitCode === 0 ? ran.stdout.trim() : ''

  return sha === '' ? undefined : sha
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

async function writeState($: EngineInterface, root: string, state: RelayState): Promise<void> {
  await $.fs.write(`${runDir(root, state.run)}/state.json`, `${JSON.stringify(state, null, 2)}\n`)
}

/** Draws progress.md's Tasks block again; a warning when the file or its markers are gone. */
async function redrawTasks($: EngineInterface, root: string, state: RelayState): Promise<string | undefined> {
  const path = `${runDir(root, state.run)}/progress.md`
  const progress = await readText($, path)
  if (progress === undefined) return `progress.md가 없어 Tasks 표를 그리지 못했습니다: ${path}`
  const next = withTasks(progress, state.tasks)
  if (next === null) return `progress.md의 Tasks 표시(<!-- relay:tasks:start/end -->)가 없어 다시 그리지 않았습니다: ${path}`
  if (next !== progress) await $.fs.write(path, next)

  return undefined
}

/** Saves the state and draws its Tasks block; the redraw's warning, if any. */
async function save($: EngineInterface, root: string, state: RelayState): Promise<string | undefined> {
  await writeState($, root, state)

  return redrawTasks($, root, state)
}

export type ActiveRun = { run: string; dir: string; state: RelayState }

/** The runs of this repository still active, by name. Only reads: the gate hook calls it on each launch. */
export async function findActiveRuns($: EngineInterface, root?: string): Promise<ActiveRun[]> {
  const top = root ?? (await repoRoot($))
  if (top === undefined) return []
  const folder = `${top}/${RUN_PREFIX}`
  if (!(await $.fs.exists(folder).catch(() => false))) return []
  const entries = await $.fs.list(folder).catch(() => [])
  const found: ActiveRun[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir' || !isRun(entry.name)) continue
    const state = await readState($, top, entry.name)
    if (state?.status === 'active') found.push({ run: entry.name, dir: runDir(top, entry.name), state })
  }

  return found.sort((a, b) => a.run.localeCompare(b.run))
}

// ── Commits ──────────────────────────────────────────────

type CommitLook = { missing: string[]; unsigned: string[]; files: string[]; outside: string[]; tests: string[]; subjects: string[] }

/** What a task's own commits are and touch: the scope check uses them only, never Base..HEAD (another worker's commits sit there too). */
async function lookAtCommits($: EngineInterface, root: string, task: RelayTask, shas: readonly string[]): Promise<CommitLook> {
  const look: CommitLook = { missing: [], unsigned: [], files: [], outside: [], tests: [], subjects: [] }
  const key = taskKey(task)
  for (const sha of shas) {
    const kind = await git($, root, ['cat-file', '-t', sha]).catch(() => undefined)
    if (kind?.exitCode !== 0 || kind.stdout.trim() !== 'commit') {
      look.missing.push(sha)
      continue
    }
    const trailers = await git($, root, ['log', '-1', '--format=%(trailers:key=Task,valueonly)', sha]).catch(() => undefined)
    if (!(trailers?.stdout ?? '').split('\n').some(line => line.trim() === key)) look.unsigned.push(sha)
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
  const state = await readState($, root, run)
  if (state === undefined) return { deny: `묶음이 없거나 state.json을 읽지 못했습니다: ${runDir(root, run)}` }
  const isClosing = action === 'task' || action === 'dispatched' || action === 'report' || action === 'finish'
  if (isClosing && state.status === 'finished') return { deny: `이미 끝난 묶음입니다: ${run}` }

  switch (action) {
    case 'task':
      return taskAction($, root, state, input)
    case 'dispatched': {
      const runner = text(input.runner)
      if (runner === '') return { deny: "runner가 비었습니다: 'orca dispatch:<id>' 또는 'subagent <name|agentId>'처럼 다시 연락할 주소를 적으세요." }

      return markDispatched($, root, run, text(input.task), runner)
    }
    case 'report':
      return reportAction($, root, state, text(input.task))
    case 'check':
      return checkAction($, root, state, text(input.task))
    case 'package':
      return packageAction($, root, state, input.tasks)
    case 'verdict':
      return verdictAction($, root, state, text(input.id))
    case 'pending':
      return pendingAction($, root, state)
    default:
      return finishAction($, root, state)
  }
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
  const dir = runDir(root, run)
  if (await $.fs.exists(dir).catch(() => false)) return { deny: `같은 묶음이 이미 있습니다: ${dir}. 이어받으려면 그 run을 쓰고, 새로 시작하려면 다른 name을 고르세요.` }
  const base = await headSha($, root)
  if (base === undefined) return { deny: 'git rev-parse HEAD가 실패했습니다: 커밋이 하나도 없는 저장소인지 보세요.' }
  const lead = await $.session.id().catch(() => '')
  const state: RelayState = { version: 1, run, goal, doneWhen, base, lead, status: 'active', createdAt: now, tasks: [], verdicts: [] }

  await $.fs.write(`${dir}/.gitignore`, '*\n')
  await $.fs.write(`${dir}/progress.md`, progressText(state, now))
  await $.fs.write(`${dir}/reviews/verdict.schema.json`, `${JSON.stringify(VERDICT_SCHEMA, null, 2)}\n`)
  await writeState($, root, state)

  return { result: [`묶음을 시작했습니다: ${run}`, `폴더: ${dir}`, `진행 기록: ${dir}/progress.md`, `Base: ${base}`].join('\n') }
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
  const checked = checkTask(state, brief)
  if (checked.denials.length > 0) return { deny: checked.denials.join('\n') }
  const base = await headSha($, root)
  if (base === undefined) return { deny: 'git rev-parse HEAD가 실패했습니다.' }

  const earlier = state.tasks.filter(task => task.id === brief.id)
  const previous = latestRevs(earlier)[0]
  const rev = (previous?.rev ?? 0) + 1
  const key = `${brief.id}-r${rev}`
  const dir = runDir(root, state.run)
  const specPath = specFile(dir, key)
  const reportTo = reportFile(dir, key)
  const spec = briefText(brief, { kind: 'full', run: state.run, key, base, reportTo, lead: state.lead })
  await $.fs.write(specPath, spec)

  // A new revision takes over: an earlier one not yet done is never to be reported on.
  const superseded: string[] = []
  for (const task of earlier) {
    if (task.status === 'ready' || task.status === 'running' || task.status === 'needs_context' || task.status === 'blocked') {
      task.status = 'cancelled'
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
    tries: { ...(previous?.tries ?? {}) },
  }
  state.tasks.push(task)
  const redrawn = await save($, root, state)

  return {
    result: withWarnings(
      [
        `지시서: ${specPath}`,
        `보고서 자리: ${reportTo}`,
        '띄울 때 이 파일을 지시서로 주세요(Orca: --spec-file, 서브에이전트: 프롬프트에 경로와 함께 내용). 띄운 뒤 dispatched로 runner를 알려 주세요.',
        ...(superseded.length === 0 ? [] : [`앞 판을 취소로 바꿨습니다: ${superseded.join(', ')}(새 판을 워커에게 알리세요).`]),
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

/**
 * Notes a task launched: running, where, since when. A warning when its brief changed since it was
 * written (a brief once sent is not edited: make a new revision) or it overlaps a running task.
 * The gate hook calls it too, so it refuses only an unknown task.
 */
export async function markDispatched($: EngineInterface, root: string, run: string, name: string, runner: string): Promise<Answer> {
  const state = await readState($, root, run)
  if (state === undefined) return { deny: `묶음이 없거나 state.json을 읽지 못했습니다: ${runDir(root, run)}` }
  const task = findTask(state, name)
  if (task === undefined) return { deny: `작업이 없습니다: ${name}(${run})` }
  const warnings: (string | undefined)[] = []
  if (task.status !== 'ready') warnings.push(`${taskKey(task)}는 ${task.status} 상태였습니다: running으로 바꿉니다.`)
  const spec = await readText($, task.specPath)
  if (spec === undefined) warnings.push(`지시서 파일이 없습니다: ${task.specPath}`)
  else if ((await sha256($, spec)) !== task.specHash) warnings.push('지시서가 쓴 뒤에 바뀌었습니다. 보낸 지시서는 고치지 말고 task로 새 판을 만드세요.')
  const others = { ...state, tasks: state.tasks.filter(other => other !== task) }
  const checked = checkTask(others, { ...task, readFirst: [] })
  warnings.push(...checked.denials.filter(reason => reason.startsWith('돌고 있는')), ...checked.warnings.filter(reason => reason.startsWith('돌고 있는')))

  task.status = 'running'
  task.runner = runner
  task.dispatchedAt = await $.clock.now()
  warnings.push(await save($, root, state))

  return { result: withWarnings([`${taskKey(task)}: running · ${runner}`], warnings) }
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
  if (spec === undefined || (await sha256($, spec)) !== task.specHash) warnings.push('지시서가 보낸 뒤에 바뀌었거나 없습니다: 워커가 본 지시서와 다를 수 있습니다.')

  const status: TaskStatus = mismatches.length > 0 || report.status === null ? 'blocked' : STATUS_OF[report.status]
  task.status = status
  task.reportedAt = await $.clock.now()
  warnings.push(await save($, root, state))

  const summary = report.criteria.map(criterion => `${criterion.id} ${criterion.result}${criterion.tries === null ? '' : ` (tries ${criterion.tries})`}`).join(', ')
  const lines = [
    `${key}: 보고 ${report.status ?? '없음'} → 상태 ${status}`,
    `보고서: ${path}`,
    `기준(워커 보고, 증거 아님): ${summary === '' ? '없음' : summary}`,
    `커밋: ${report.commits.length === 0 ? '없음' : report.commits.join(', ')}`,
    `범위 밖 파일: ${look.outside.length === 0 ? '없음' : look.outside.join(', ')}`,
    `테스트·검사 파일 변경: ${look.tests.length === 0 ? '없음' : look.tests.join(', ')}`,
    ...(mismatches.length === 0 ? [] : ['', '보고서 불일치(워커에게 고쳐 달라고 하세요):', ...mismatches.map(problem => `- ${problem}`)]),
    ...(status === 'done' || status === 'done_with_concerns' ? ['', `다음: check로 기준 명령을 직접 돌리세요(${key}).`] : []),
  ]

  return { result: withWarnings(lines, warnings) }
}

async function checkAction($: EngineInterface, root: string, state: RelayState, name: string): Promise<Answer> {
  const task = findTask(state, name)
  if (task === undefined) return { deny: `작업이 없습니다: ${name}` }
  const key = taskKey(task)
  const startedAt = await $.clock.now()
  const outcomes: CheckOutcome[] = []
  for (const criterion of task.criteria) {
    const expectExit = criterion.expectExit ?? 0
    const base = { id: criterion.id, text: criterion.text, expectExit }
    if (criterion.command === undefined) {
      outcomes.push({ ...base, result: 'unverified', reason: '명령 없음: 검증자·사용자 확인' })
      continue
    }
    const left = CHECK_TOTAL_MS - ((await $.clock.now()) - startedAt)
    if (left <= 0) {
      outcomes.push({ ...base, command: criterion.command, result: 'unverified', reason: `한 번 부를 때 합계 ${CHECK_TOTAL_MS / 1000}초를 넘어 돌리지 않음` })
      continue
    }
    const limit = Math.min(CHECK_MS, left)
    const at = await $.clock.now()
    try {
      const ran = await $.process.run(['/bin/sh', '-c', criterion.command], { cwd: root, timeoutMs: limit })
      outcomes.push({
        ...base,
        command: criterion.command,
        result: ran.exitCode === expectExit ? 'pass' : 'fail',
        exitCode: ran.exitCode,
        ms: (await $.clock.now()) - at,
        stdout: lastLines(ran.stdout),
        stderr: lastLines(ran.stderr),
      })
    } catch (error) {
      outcomes.push({ ...base, command: criterion.command, result: 'unverified', ms: (await $.clock.now()) - at, reason: `${limit / 1000}초 안에 끝나지 않았거나 시작하지 못함: ${String(error)}` })
    }
  }
  const head = (await headSha($, root)) ?? '미확인'
  const path = checksFile(runDir(root, state.run), key)
  await $.fs.write(path, checksText(key, head, startedAt, outcomes))

  // Where the worker's word and the commands disagree.
  const disagree: string[] = []
  const reportText = await readText($, reportFile(runDir(root, state.run), key))
  if (reportText !== undefined) {
    for (const said of parseReport(reportText).criteria) {
      const found = outcomes.find(outcome => outcome.id === said.id)
      if (found !== undefined && said.result === 'pass' && found.result === 'fail') disagree.push(`${said.id}: 워커는 pass, 명령은 fail`)
    }
  }
  const lines = [
    `${key} 검사 결과(HEAD ${head.slice(0, 7)}): ${path}`,
    ...outcomes.map(outcome => {
      const exit = outcome.exitCode === undefined ? '' : ` · exit ${outcome.exitCode}(기대 ${outcome.expectExit}) · ${outcome.ms ?? 0} ms`

      return `- ${outcome.id}: ${outcome.result}${exit}${outcome.reason === undefined ? '' : ` · ${outcome.reason}`}`
    }),
    '워커 보고의 pass는 증거가 아닙니다: 이 결과가 기준의 결과입니다.',
  ]

  return { result: withWarnings(lines, disagree) }
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
      if (task.status !== 'done' && task.status !== 'done_with_concerns') warnings.push(`${taskKey(task)}는 ${task.status} 상태입니다.`)
      if (!chosen.includes(task)) chosen.push(task)
    }
  } else {
    const since = state.verdicts.at(-1)?.at ?? -Infinity
    chosen = state.tasks.filter(task => (task.status === 'done' || task.status === 'done_with_concerns') && (task.reportedAt ?? 0) > since)
  }
  if (chosen.length === 0) return { deny: '꾸러미에 넣을 작업이 없습니다: 마지막 판정 뒤에 done이 된 작업이 없습니다. tasks로 직접 고르세요.' }

  const dir = runDir(root, state.run)
  const head = (await headSha($, root)) ?? '미확인'
  const entries = await $.fs.list(`${dir}/reviews`).catch(() => [])
  const taken = entries.map(entry => /^V(\d+)-package\.md$/.exec(entry.name)?.[1]).filter((n): n is string => n !== undefined).map(Number)
  const id = `V${Math.max(0, ...taken) + 1}`
  const packagePath = `${dir}/reviews/${id}-package.md`
  const verdictPath = `${dir}/reviews/${id}-verdict.json`
  const schemaPath = `${dir}/reviews/verdict.schema.json`

  const parts = [
    `# Verification package ${id}: ${state.run}`,
    '',
    `- Run goal: ${state.goal.replace(/\s+/g, ' ')}`,
    `- Run done when: ${state.doneWhen.join('; ')}`,
    `- HEAD: ${head}`,
    `- Base: ${state.base}`,
    `- Tasks: ${chosen.map(taskKey).join(', ')}`,
  ]
  const shas: string[] = []
  for (const task of chosen) {
    const key = taskKey(task)
    const spec = (await readText($, task.specPath)) ?? '(지시서 파일 없음)'
    const reportText = await readText($, reportFile(dir, key))
    const commits = reportText === undefined ? [] : parseReport(reportText).commits
    const look = await lookAtCommits($, root, task, commits)
    for (const sha of commits) if (!look.missing.includes(sha) && !shas.includes(sha)) shas.push(sha)
    const checks = await readText($, checksFile(dir, key))
    parts.push(
      '',
      `## Task ${key}: ${task.title}`,
      '',
      '### Brief (Rules and Report format left out)',
      withoutSections(spec, ['Rules', 'Report format']).replace(/^# /gm, '#### ').trim(),
      '',
      "### Worker's report (its hand-over notes left out)",
      reportText === undefined ? '(보고서 없음)' : withoutSections(reportText, ['For whoever picks up']).replace(/^##? /gm, '#### ').trim(),
      '',
      '### Commits',
      ...(look.subjects.length === 0 ? ['- 없음'] : look.subjects.map(subject => `- ${subject}`)),
      ...(look.missing.length === 0 ? [] : [`- 없는 커밋: ${look.missing.join(', ')}`]),
      '',
      '### Checks run by the relay tool (not the worker)',
      checks === undefined ? '(check를 돌리지 않았습니다)' : checks.replace(/^##? /gm, '#### ').trim(),
      '',
      `### Files outside the edit scope: ${look.outside.length === 0 ? 'none' : look.outside.join(', ')}`,
      `### Test file changes: ${look.tests.length === 0 ? 'none' : look.tests.join(', ')}`,
    )
  }
  let diffs = ''
  for (const sha of shas) {
    const shown = await git($, root, ['show', '--format=fuller', sha]).catch(() => undefined)
    diffs += `${shown?.stdout ?? `(git show ${sha} 실패)`}\n`
  }
  const cut = cutBytes(diffs, DIFF_LIMIT)
  parts.push(
    '',
    '## Diffs',
    shas.length === 0 ? '(커밋 없음)' : fenced(cut.text, 'diff'),
    ...(cut.isCut ? [`(잘림: diff가 ${DIFF_LIMIT / 1024}KB를 넘어 앞부분만 담았습니다. 나머지는 git show로 직접 보세요.)`] : []),
    '',
    verifierInstructions(verdictPath, schemaPath),
    '',
  )
  await $.fs.write(packagePath, parts.join('\n'))

  return {
    result: withWarnings(
      [`검증 꾸러미 ${id}: ${packagePath}`, `판정 파일: ${verdictPath}`, `판정 형식: ${schemaPath}`, `담은 작업: ${chosen.map(taskKey).join(', ')} · HEAD ${head.slice(0, 7)}${cut.isCut ? ' · diff 잘림' : ''}`],
      warnings,
    ),
  }
}

async function verdictAction($: EngineInterface, root: string, state: RelayState, id: string): Promise<Answer> {
  if (!/^V\d+$/.test(id)) return { deny: 'id는 V1처럼 package가 돌려준 번호여야 합니다.' }
  const path = `${runDir(root, state.run)}/reviews/${id}-verdict.json`
  const raw = await readText($, path)
  if (raw === undefined) return { deny: `판정 파일이 없습니다: ${path}` }
  const parsed = parseVerdict(raw)
  if ('problems' in parsed) return { deny: [`판정 형식이 틀렸습니다(${path}):`, ...parsed.problems.map(problem => `- ${problem}`)].join('\n') }
  const { verdict } = parsed
  const at = await $.clock.now()
  state.verdicts = [...state.verdicts.filter(other => other.id !== id), { id, at, commit: verdict.commit, path, result: verdict.result }]
  await writeState($, root, state)

  const head = await headSha($, root)
  const count = (result: string) => verdict.criteria.filter(criterion => criterion.result === result).length
  const severity = (level: string) => verdict.findings.filter(finding => finding.severity === level).length
  const notPassed = verdict.criteria.filter(criterion => criterion.result !== 'pass').map(criterion => `${criterion.id}(${criterion.result})`)
  const lines = [
    `판정 ${id}: ${verdict.result} · 검증 모델 ${verdict.model} · 본 커밋 ${verdict.commit.slice(0, 7)}`,
    `기준: pass ${count('pass')} · fail ${count('fail')} · unverified ${count('unverified')}${notPassed.length === 0 ? '' : ` (${notPassed.join(', ')})`}`,
    `지적: high ${severity('high')} · medium ${severity('medium')} · low ${severity('low')}`,
    `판정 파일: ${path}`,
  ]
  const warnings = head === undefined || !sameCommit(verdict.commit, head) ? [`검증한 판과 지금 판이 다름: 판정은 ${verdict.commit.slice(0, 7)}, 지금 HEAD는 ${head?.slice(0, 7) ?? '미확인'}`] : []

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
  const reasons: string[] = []
  const open = state.tasks.filter(task => task.status === 'running' || task.status === 'needs_context' || task.status === 'blocked')
  if (open.length > 0) reasons.push(`끝나지 않은 작업: ${open.map(task => `${taskKey(task)}(${task.status})`).join(', ')}`)
  const last = state.verdicts.at(-1)
  const head = await headSha($, root)
  if (last === undefined) reasons.push('판정이 없습니다: package → 다른 모델 검증 → verdict 뒤에 끝내세요.')
  else {
    if (head === undefined || !sameCommit(last.commit, head)) reasons.push(`검증한 판과 지금 판이 다름: 다시 검증하세요(판정 ${last.id}는 ${last.commit.slice(0, 7)}, 지금 HEAD ${head?.slice(0, 7) ?? '미확인'}).`)
    if (last.result === 'fail') reasons.push(`마지막 판정 ${last.id}가 fail입니다.`)
  }
  if (reasons.length > 0) return { deny: ['묶음을 끝내지 않았습니다:', ...reasons.map(reason => `- ${reason}`)].join('\n') }

  state.status = 'finished'
  const redrawn = await save($, root, state)
  const rows = (await decisions($, root, state)) ?? []
  const pending = rows.filter(isPending)
  const byLead = rows.filter(isByLead)
  const unsent = state.tasks.filter(task => task.status === 'ready').map(taskKey)
  const lines = [
    `묶음을 끝냈습니다: ${state.run} · 판정 ${last?.id ?? ''} · HEAD ${head?.slice(0, 7) ?? ''}`,
    '',
    `사용자 답을 기다리는 결정(asked·on hold): ${pending.length === 0 ? '없음' : ''}`,
    ...pending.map(decisionLine),
    '',
    `리드가 정한 결정(사용자에게 모두 보고하세요): ${byLead.length === 0 ? '없음' : ''}`,
    ...byLead.map(row => `- ${row.id} · ${row.decision} — ${row.why} — 틀렸을 때: ${row.cost}`),
  ]

  return { result: withWarnings(lines, [unsent.length === 0 ? undefined : `띄우지 않은 작업이 남았습니다: ${unsent.join(', ')}`, redrawn]) }
}
