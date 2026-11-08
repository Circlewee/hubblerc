import type { EngineInterface, On } from 'claude-code'

import { findActiveRuns, markDispatched, repoRoot, sha256 } from './relay'
import type { ActiveRun } from './relay'
import { checkTask, sameCommit, taskKey } from './relay-format'
import type { RelayTask } from './relay-format'

/**
 * relay's gates, as hooks. Gate 1 looks at a worker about to start (`orca orchestration
 * worker-start`, a subagent whose prompt names a run's brief) while a run of this repository is
 * active: the brief must be the run's own, unchanged since it was written, on the model it names,
 * and clear of the tasks running. Gate 2's second half warns at an answer's end when the run holds
 * finished work no other model has verified at the current HEAD.
 *
 * Cost: every Bash and Agent call pays a text test and nothing else. Only a call that names
 * `worker-start` or a run's brief reads the files, and the repository's top folder is asked of git
 * once. No timers, no watching.
 */

const ORCA_COMMANDS = new Set(['orca', 'orca-dev', 'orca-ide'])
/** Options of `worker-start` that take no value; every other `--option` takes the word after it. */
const FLAGS = new Set(['--json', '--keep-open', '--full'])
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
const GIT_MS = 10_000

/** A brief's path in a prompt: `.relay/runs/<run>/tasks/<id>-r<n>.md` (a report or checks file is not one). */
const BRIEF_PATH = /\.relay\/runs\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,30})\/tasks\/([A-Za-z][A-Za-z0-9_.]{0,19})-r(\d+)\.md(?![\w-])/g

/** Remembered for the session: the repository's top folder (asked of git once, not on every call). */
let rootOnce: Promise<string | undefined> | undefined

function rootOf($: EngineInterface): Promise<string | undefined> {
  rootOnce ??= repoRoot($).catch(() => undefined)

  return rootOnce
}

// ── Reading a command ──────────────────────────────────────────────

/** The words of a command, a list for each simple command (split at `&&`, `||`, `;`, `|`, `&` and newlines outside quotes). */
export function commandWords(command: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let isWord = false
  let quote: '"' | "'" | undefined
  const endWord = () => {
    if (isWord) words.push(word)
    word = ''
    isWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? ''
    if (quote === "'") {
      if (ch === "'") quote = undefined
      else word += ch
    } else if (quote === '"') {
      if (ch === '"') quote = undefined
      else if (ch === '\\' && i + 1 < command.length) word += command[(i += 1)] ?? ''
      else word += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      isWord = true
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[(i += 1)] ?? ''
      isWord = true
    } else if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') endCommand()
    else if (/\s/.test(ch)) endWord()
    else {
      word += ch
      isWord = true
    }
  }
  endCommand()

  return commands
}

/** A launch of `orca orchestration worker-start`, and the options it gave. */
export type OrcaStart = { options: Map<string, string | true> }

/** The `worker-start` among a command's commands, or undefined when the command starts no worker. */
export function readWorkerStart(command: string): OrcaStart | undefined {
  for (const words of commandWords(command)) {
    const first = words.findIndex(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
    const program = words[first]?.split('/').at(-1) ?? ''
    if (!ORCA_COMMANDS.has(program)) continue
    const at = words.findIndex((word, i) => i > first && word === 'orchestration' && words[i + 1] === 'worker-start')
    if (at < 0) continue
    const options = new Map<string, string | true>()
    const rest = words.slice(at + 2)
    for (let i = 0; i < rest.length; i += 1) {
      const word = rest[i] ?? ''
      if (!word.startsWith('--')) continue
      const equals = word.indexOf('=')
      if (equals > 0) options.set(word.slice(0, equals), word.slice(equals + 1))
      else if (FLAGS.has(word) || rest[i + 1] === undefined || (rest[i + 1] ?? '').startsWith('--')) options.set(word, true)
      else options.set(word, rest[(i += 1)] ?? '')
    }

    return { options }
  }

  return undefined
}

/** Whether two model names are the same: equal, or an alias (`opus`) and an ID that holds it (`claude-opus-5-5`). */
export function sameModel(asked: string, wanted: string): boolean {
  const a = asked.trim().toLowerCase()
  const b = wanted.trim().toLowerCase()
  if (a === '' || b === '') return false

  return a === b || MODEL_ALIASES.some(alias => (a === alias && b.includes(alias)) || (b === alias && a.includes(alias)))
}

/** The briefs a prompt names: `<run>`, `<id>`, `<rev>` for each, once. */
export function briefsIn(prompt: string): { run: string; id: string; rev: number }[] {
  const found = new Map<string, { run: string; id: string; rev: number }>()
  for (const match of prompt.matchAll(BRIEF_PATH)) {
    const [, run = '', id = '', rev = '0'] = match
    found.set(`${run}/${id}-r${rev}`, { run, id, rev: Number(rev) })
  }

  return [...found.values()]
}

const normalPath = (path: string): string => path.replace(/\/{2,}/g, '/').replace(/(^|\/)\.\//g, '$1')

// ── The checks both launches share ──────────────────────────────────────────────

/** Why a brief may not be launched now: cancelled, overlapping a running task, edited since it was written. */
async function briefProblems($: EngineInterface, run: ActiveRun, task: RelayTask): Promise<string[]> {
  const key = taskKey(task)
  const problems: string[] = []
  if (task.status === 'cancelled') problems.push(`${key}는 취소된 판입니다(새 판이 이어받음): 새 판의 지시서로 띄우세요.`)
  const others = { ...run.state, tasks: run.state.tasks.filter(other => other !== task) }
  problems.push(...checkTask(others, { ...task, readFirst: [] }).denials.filter(reason => reason.startsWith('돌고 있는')))
  const spec = await $.fs.read(task.specPath).catch(() => undefined)
  if (typeof spec !== 'string') problems.push(`지시서 파일을 읽지 못했습니다: ${task.specPath}`)
  else if ((await sha256($, spec)) !== task.specHash) problems.push(`보낸 뒤 고친 지시서입니다(${key}): relay task로 새 판을 만드세요.`)

  return problems
}

const refused = (key: string, problems: readonly string[]): { deny: string } => ({ deny: [`relay 지시서 ${key}로는 워커를 띄울 수 없습니다:`, ...problems.map(problem => `- ${problem}`)].join('\n') })

// ── Orca ──────────────────────────────────────────────

export type OrcaGate = { deny: string } | { pass: true; mark?: { root: string; run: string; task: string } }

/** Gate 1 for `orca orchestration worker-start` in a Bash command; the caller has tested the command for "worker-start" already. */
export async function checkOrcaStart($: EngineInterface, command: string): Promise<OrcaGate> {
  const start = readWorkerStart(command)
  if (start === undefined) return { pass: true }
  const root = await rootOf($)
  if (root === undefined) return { pass: true }
  const runs = await findActiveRuns($, root)
  if (runs.length === 0) return { pass: true }

  const option = (name: string): string | undefined => {
    const value = start.options.get(name)

    return typeof value === 'string' ? value : undefined
  }
  const file = option('--spec-file')
  if (file === undefined || file === '-' || file === '') {
    if (option('--comment')?.includes('no-relay') === true) return { pass: true }

    return { deny: `relay 묶음 ${runs.map(run => run.run).join(', ')}이 진행 중입니다. 워커는 relay task가 쓴 지시서 파일(--spec-file)로 띄우세요. 이 묶음과 상관없는 워커면 명령에 --comment no-relay를 붙이세요.` }
  }

  const cwd = await $.session.cwd().catch(() => undefined)
  const path = normalPath(file.startsWith('/') || cwd === undefined ? file : `${cwd}/${file}`)
  for (const run of runs) {
    const task = run.state.tasks.find(other => normalPath(other.specPath) === path)
    if (task === undefined) continue
    const key = taskKey(task)
    const problems = await briefProblems($, run, task)
    const model = option('--model')
    if (model === undefined) problems.push(`--model이 없습니다: 지시서의 모델 ${task.model}을 적으세요(안 적으면 워커가 물려받은 모델로 돌아 비용이 커집니다).`)
    else if (model.trim() !== task.model.trim()) problems.push(`--model ${model}이 지시서의 모델 ${task.model}과 다릅니다.`)
    const effort = option('--effort')
    if (effort === undefined) problems.push(`--effort가 없습니다: 지시서의 effort ${task.effort}를 적으세요.`)
    else if (effort.trim() !== task.effort.trim()) problems.push(`--effort ${effort}가 지시서의 effort ${task.effort}와 다릅니다.`)

    return problems.length > 0 ? refused(key, problems) : { pass: true, mark: { root, run: run.run, task: key } }
  }

  // A file that is none of an active run's briefs is other work.
  return { pass: true }
}

/** The dispatch id in what `worker-start` printed (`dispatchId=ctx_…`, or JSON's `"dispatchId": "ctx_…"`). */
export function dispatchIdIn(text: string): string | undefined {
  return /dispatch_?id["']?\s*[:=]\s*["']?([A-Za-z0-9_.-]+)/i.exec(text)?.[1]
}

/** What a Bash call printed, wherever the engine put it. */
function printed(ran: unknown): string {
  const call = ran as { text?: unknown; result?: { stdout?: unknown } | string } | null
  if (typeof call?.text === 'string') return call.text
  if (typeof call?.result === 'string') return call.result

  return typeof call?.result?.stdout === 'string' ? call.result.stdout : ''
}

// ── Subagents ──────────────────────────────────────────────

export type SpawnGate = { deny: string } | { pass: true; mark?: { root: string; run: string; task: string } }

/** Gate 1 for a subagent about to start. Only a prompt that names an active run's brief is looked at. */
export async function checkSpawn($: EngineInterface, prompt: string, model: string | undefined): Promise<SpawnGate> {
  const named = briefsIn(prompt)
  if (named.length === 0) return { pass: true }
  const root = await rootOf($)
  if (root === undefined) return { pass: true }
  const runs = await findActiveRuns($, root)
  const marks: { root: string; run: string; task: string }[] = []
  for (const { run: name, id, rev } of named) {
    const run = runs.find(other => other.run === name)
    const task = run?.state.tasks.find(other => other.id === id && other.rev === rev)
    if (run === undefined || task === undefined) continue
    const problems = await briefProblems($, run, task)
    if (model === undefined || model.trim() === '') problems.push(`모델이 지정되지 않았습니다: Agent의 model에 지시서의 모델 ${task.model}을 적으세요(안 적으면 물려받은 모델로 돌아 비용이 커집니다).`)
    else if (!sameModel(model, task.model)) problems.push(`model ${model}이 지시서의 모델 ${task.model}과 다릅니다.`)
    if (problems.length > 0) return refused(taskKey(task), problems)
    marks.push({ root, run: run.run, task: taskKey(task) })
  }

  return marks.length === 1 ? { pass: true, mark: marks[0] } : { pass: true }
}

// ── The answer's end ──────────────────────────────────────────────

/**
 * At a main answer's end: a line when an active run has finished work and no task still running,
 * and its last verdict is missing or of another commit than HEAD. Nothing when the repository has no
 * run folder (one existence test).
 */
export async function unverifiedLine($: EngineInterface): Promise<string | undefined> {
  const root = await rootOf($)
  if (root === undefined) return undefined
  const runs = await findActiveRuns($, root)
  const candidates = runs.filter(({ state }) => {
    const isOpen = state.tasks.some(task => task.status === 'running' || task.status === 'needs_context' || task.status === 'blocked')

    return !isOpen && state.tasks.some(task => task.status === 'done' || task.status === 'done_with_concerns')
  })
  if (candidates.length === 0) return undefined
  const ran = await $.process.run(['git', 'rev-parse', 'HEAD'], { cwd: root, timeoutMs: GIT_MS }).catch(() => undefined)
  const head = ran?.exitCode === 0 ? ran.stdout.trim() : ''
  const lines: string[] = []
  for (const { run, state } of candidates) {
    const last = state.verdicts.at(-1)
    if (head !== '' && last !== undefined && sameCommit(last.commit, head)) continue
    lines.push(`⚠ relay ${run}: 검증되지 않은 판입니다(HEAD ${head === '' ? '미확인' : head.slice(0, 7)}, 마지막 판정 ${last === undefined ? '없음' : last.commit.slice(0, 7)}). 끝내기 전에 package → 다른 모델 검증 → finish.`)
  }

  return lines.length === 0 ? undefined : lines.join('\n')
}

// ── Hooks ──────────────────────────────────────────────

/** Gate 1's hooks: Bash (Orca) and the subagent's start. A gate that fails lets the call through. */
export function gateLaunches(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // The text test first: a call that starts no worker costs nothing more.
    if (!e.command.includes('worker-start')) return next(e)
    const gate = await checkOrcaStart($, e.command)
    if ('deny' in gate) return { deny: gate.deny }

    const ran = await next(e)
    const { mark } = gate
    if (mark !== undefined && !('deny' in ran) && !('isError' in ran && ran.isError === true)) {
      // The receipt names the dispatch; if it is not found the lead marks it by hand.
      const id = dispatchIdIn(printed(ran))
      if (id !== undefined) await markDispatched($, mark.root, mark.run, mark.task, `orca dispatch:${id}`).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    if (!e.prompt.includes('.relay/runs/')) return next(e)
    const gate = await checkSpawn($, e.prompt, e.model)
    if ('deny' in gate) return { deny: gate.deny }

    const started = await next(e)
    const { mark } = gate
    if (mark !== undefined && 'agentId' in started && started.agentId !== undefined) {
      await markDispatched($, mark.root, mark.run, mark.task, `subagent ${started.agentId}`).catch(() => undefined)
    }

    return started
  }).catch(($, e, next) => next(e))
}
