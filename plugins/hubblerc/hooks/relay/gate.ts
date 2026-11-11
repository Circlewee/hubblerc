import type { AgentSpawnInput, EngineInterface, On } from 'claude-code'

import { findCommands } from '../commit/commit-command'
import type { CommandWord } from '../commit/commit-command'
import { findActiveRuns, repoRoot, reserveDispatch, sha256 } from './relay'
import type { ActiveRun } from './relay'
import { isBusy, sameCommit, taskKey } from './relay-format'
import type { RelayTask } from './relay-format'

/**
 * relay's gates, as hooks. Gate 1 looks at a worker about to start or to be sent a brief (`orca
 * orchestration worker-start` and `send`, a subagent whose prompt names a run's brief, a SendMessage
 * to one) while a run of this repository is active: the brief must be the run's own, ready, unchanged
 * since it was written, on the model it names, and clear of the tasks running. The check and the
 * claim on the task are one step (reserveDispatch, inside the run's lock), so two launches at once
 * cannot both pass; the claim becomes `running` when the launch went out and is let go when it did
 * not. A SendMessage to a finished subagent resumes it inside the call (an `agent.spawn` carrying
 * `resume`): that resume is the send's own and is not checked a second time. Gate 2's second half
 * warns at an answer's end when the run holds finished work no other model has verified at the
 * current HEAD.
 *
 * A call asking for help (`--help`, `-h`) starts nothing and passes unchecked.
 *
 * Cost: every Bash, Agent and SendMessage call pays a text test and nothing else. Only a call that
 * names `worker-start` or a run's brief reads the files, and the repository's top folder is asked of
 * git once. No timers, no watching.
 */

const ORCA_COMMANDS = new Set(['orca', 'orca-dev', 'orca-ide'])
/** Options of `orchestration` commands that take no value; every other `--option` takes the word after it. */
const FLAGS = new Set(['--json', '--keep-open', '--full', '--help'])
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
const GIT_MS = 10_000
const ONE_AT_A_TIME = '워커는 한 번에 하나씩 띄우세요.'

/** A path to something under `.relay/runs/` in a text, with the characters before it that belong to the path. */
const RUN_PATH = /[^\s"'`<>()[\]{},;|&]*\.relay\/runs\/[^\s"'`<>()[\]{},;|&]+/g

/** Remembered for the session: the repository's top folder (asked of git once, not on every call). */
let rootOnce: Promise<string | undefined> | undefined

function rootOf($: EngineInterface): Promise<string | undefined> {
  rootOnce ??= repoRoot($).catch(() => undefined)

  return rootOnce
}

// ── Reading a command ──────────────────────────────────────────────

/** An `orca orchestration worker-start` or `send` among a command's commands. */
export type OrcaCall = {
  sub: 'worker-start' | 'send'
  options: Map<string, string | true>
  /** Every word after the subcommand, unquoted: a brief named in `--body` is among them. */
  words: string[]
  /**
   * Whether the command holds anything that can move the working folder away from the session's
   * (`cd`, `pushd`, `popd`, a parenthesis or `$( )`, a backtick): a relative path in it then points
   * nowhere sure.
   */
  shifts: boolean
  /** Asks for the command's help (`--help` or `-h`, not as an option's value): it starts and sends nothing. */
  isHelp: boolean
}

/**
 * The orca launches in a Bash command, read as a shell does (quoted data, here-documents and
 * comments are no command). Undefined when the command cannot be followed.
 */
export function readOrcaCalls(command: string): OrcaCall[] | undefined {
  const commands = findCommands(command)
  if (commands === undefined) return undefined
  const calls: OrcaCall[] = []
  // The shell's scope is not followed (a subshell's cd stays in it): any such syntax counts for the whole command.
  const shifts = /[(`]/.test(command) || commands.some(words => ['cd', 'pushd', 'popd'].includes(words[0]?.text ?? ''))
  for (const words of commands) {
    const first = words[0]
    if (first === undefined) continue
    if (!ORCA_COMMANDS.has(first.text.split('/').at(-1) ?? '')) continue
    const at = words.findIndex((word, i) => i > 0 && word.text === 'orchestration')
    const sub = words[at + 1]?.text
    if (at < 0 || (sub !== 'worker-start' && sub !== 'send')) continue
    const rest = words.slice(at + 2)
    const options = new Map<string, string | true>()
    let isHelp = false
    for (let i = 0; i < rest.length; i += 1) {
      const word = rest[i]?.text ?? ''
      // An option's value is skipped below, so `--body -h` is no help.
      if (word === '-h') isHelp = true
      if (!word.startsWith('--')) continue
      const equals = word.indexOf('=')
      if (equals > 0) options.set(word.slice(0, equals), word.slice(equals + 1))
      else if (FLAGS.has(word) || rest[i + 1] === undefined || (rest[i + 1]?.text ?? '').startsWith('--')) options.set(word, true)
      else options.set(word, rest[(i += 1)]?.text ?? '')
    }
    calls.push({ sub, options, words: rest.map((word: CommandWord) => word.text), shifts, isHelp: isHelp || options.has('--help') })
  }

  return calls
}

/** Whether two model names are the same: equal, or an alias (`opus`) and an ID that holds it (`claude-opus-5-5`). */
export function sameModel(asked: string, wanted: string): boolean {
  const a = asked.trim().toLowerCase()
  const b = wanted.trim().toLowerCase()
  if (a === '' || b === '') return false

  return a === b || MODEL_ALIASES.some(alias => (a === alias && b.includes(alias)) || (b === alias && a.includes(alias)))
}

/** A path as an absolute one: relative to `cwd`, with `.`, `..` and repeated `/` taken out. */
export function resolvePath(path: string, cwd: string | undefined): string {
  const joined = path.startsWith('/') || cwd === undefined ? path : `${cwd}/${path}`
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return `/${parts.join('/')}`
}

/** The paths under `.relay/runs/` that a text names, as written (a sentence's closing punctuation cut off). */
export function runPathsIn(text: string): string[] {
  return [...text.matchAll(RUN_PATH)].map(match => match[0].replace(/[.:]+$/, ''))
}

/** Whether a text names something that could be a run's brief (`…/tasks/<id>-r<n>.md`): the test before any file is read. */
export function mayNameBrief(texts: readonly string[]): boolean {
  return texts.some(text => runPathsIn(text).some(path => /\/tasks\/[^/]*-r\d+\.md$/.test(path)))
}

/** The relative paths in a text that look like a run's brief (`…/tasks/<id>-r<n>.md` under `.relay/runs/`). */
export function relativeBriefPaths(texts: readonly string[]): string[] {
  return texts.flatMap(runPathsIn).filter(path => !path.startsWith('/') && /\/tasks\/[^/]*-r\d+\.md$/.test(path))
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

const isFailed = (ran: unknown): boolean => {
  const call = ran as { deny?: unknown; isError?: unknown } | null

  return call === null || call.deny !== undefined || call.isError === true
}

const MAX_WHY = 300

/** A text on one line, cut at `MAX_WHY` characters. */
const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > MAX_WHY ? `${line.slice(0, MAX_WHY - 1)}…` : line
}

/** A tool record as an object: the object itself, or a JSON object's text (what the model reads). */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trimStart().startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(value)

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Why a launch or a send did not go, as what answered it says; undefined when it went. A refusal
 * (`deny`, from a hook beneath or the engine), an error core reported (`isError`), or a record the
 * tool answered without error that says it did not go: SendMessage answers `{ success: false,
 * message }` (seen 2026-11-11 when a resume was declined; its record is `unknown` in the engine
 * types), and `{ isDelivered: false, reason }` is how `session.send` says so, should it come through.
 */
function failureOf(ran: unknown): string | undefined {
  if (ran === null || typeof ran !== 'object') return '결과가 없습니다'
  const call = ran as { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown }
  if (typeof call.deny === 'string') return oneLine(call.deny)
  const text = typeof call.text === 'string' ? call.text : undefined
  if (call.isError === true) return oneLine(text ?? (typeof call.result === 'string' ? call.result : '도구가 오류로 끝났습니다'))
  const record = recordOf(call.result) ?? recordOf(text)
  if (record === undefined || (record.success !== false && record.isDelivered !== false)) return undefined
  const why = [record.message, record.reason, record.error].find(value => typeof value === 'string' && value !== '')

  return oneLine(typeof why === 'string' ? why : (text ?? 'success: false'))
}

/**
 * The agent a SendMessage resumed, as its answer names it (`{ success: true, message: "Resuming
 * agent …", resumedAgentId: "<id>", … }`, seen 2026-11-11); undefined when it names none.
 */
function resumedIdIn(sent: unknown): string | undefined {
  const call = sent as { text?: unknown; result?: unknown } | null
  const record = recordOf(call?.result) ?? recordOf(call?.text)
  const id = record?.resumedAgentId

  return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
}

// ── Finding the brief ──────────────────────────────────────────────

type Named = { run: ActiveRun; task: RelayTask }

/** Every brief of the active runs by its absolute path. */
function briefsByPath(runs: readonly ActiveRun[]): Map<string, Named> {
  const known = new Map<string, Named>()
  for (const run of runs) for (const task of run.state.tasks) known.set(resolvePath(task.specPath, undefined), { run, task })

  return known
}

/** The briefs of the active runs that the paths in a text name (each path made absolute against `cwd` first). */
function briefsNamed(texts: readonly string[], runs: readonly ActiveRun[], cwd: string | undefined): Named[] {
  const known = briefsByPath(runs)
  const found = new Map<string, Named>()
  for (const path of texts.flatMap(runPathsIn)) {
    const named = known.get(resolvePath(path, cwd))
    if (named !== undefined) found.set(taskKey(named.task), named)
  }

  return [...found.values()]
}

/** The brief a launch or a follow-up is for: the one ready brief it names; a brief alone, whatever it is (the claim says why not); else a refusal. */
function pickBrief(named: readonly Named[]): Named | { deny: string } | undefined {
  if (named.length === 0) return undefined
  const ready = named.filter(({ task }) => task.status === 'ready')
  if (ready.length === 1) return ready[0]
  if (ready.length > 1) return { deny: `지시서가 둘 이상입니다(${ready.map(({ task }) => taskKey(task)).join(', ')}). ${ONE_AT_A_TIME}` }
  if (named.length === 1) return named[0]

  return { deny: `ready인 지시서가 없습니다(${named.map(({ task }) => `${taskKey(task)} ${task.status}`).join(', ')}): 새로 보낼 것이면 relay task로 새 판을 만드세요.` }
}

const refused = (key: string, problems: readonly string[]): { deny: string } => ({ deny: [`relay 지시서 ${key}로는 띄우거나 보낼 수 없습니다:`, ...problems.map(problem => `- ${problem}`)].join('\n') })

/** Why a brief may not go out as it is: changed since it was written, or gone. */
async function briefProblems($: EngineInterface, task: RelayTask): Promise<string[]> {
  const spec = await $.fs.read(task.specPath).catch(() => undefined)
  if (typeof spec !== 'string') return [`지시서 파일을 읽지 못했습니다: ${task.specPath}`]

  return (await sha256($, spec)) === task.specHash ? [] : [`보낸 뒤 고친 지시서입니다(${taskKey(task)}): relay task로 새 판을 만드세요.`]
}

// ── The claim on a task ──────────────────────────────────────────────

/**
 * A task to claim before the launch, and how the launch is told in the state afterwards: `brief` is
 * the brief's path as the state holds it, `act` whether a worker is started or a brief sent to one.
 */
export type Hold = { root: string; run: string; task: string; brief: string; act: 'launch' | 'send'; runnerOf: (receipt: string) => string }

export type Plan = { deny: string } | { pass: true; hold?: Hold }

/** How a launch went, as its receipt reads it: the text the runner is told by, or why it did not go (no note without one). */
type Receipt = { isOk: true; text: string } | { isOk: false; why?: string }

/** What the lead reads when a launch or a send failed and its claim was let go (or could not be). */
function failedNote(hold: Hold, why: string, isLetGo: boolean): string {
  const act = hold.act === 'send' ? '보내기' : '띄우기'
  if (!isLetGo) return `⚠ relay: ${hold.task} ${act}가 실패했는데 예약을 풀지 못했습니다(${why}). relay list로 상태를 보고, launching으로 남았으면 cancel로 정리하세요.`
  const then = hold.act === 'send' ? '원인을 고쳐 다시 보내거나 새 서브에이전트로 띄우세요' : '원인을 고쳐 다시 띄우세요'

  return `⚠ relay: ${hold.task} ${act}가 실패해 ready로 되돌렸습니다(${why}). running으로 기록하지 않았으니 dispatched는 부르지 말고, ${then}.`
}

/** What the lead should read after a launch: the claim could not become `running`, or became it with warnings. */
function noteOf(key: string, committed: { result: string } | { deny: string } | Error): string | undefined {
  if (committed instanceof Error) return `⚠ relay: ${key}를 running으로 기록하지 못했습니다(${committed.message}). 띄우기는 끝났으니 dispatched로 직접 기록하세요.`
  if ('deny' in committed) return `⚠ relay: ${committed.deny}`
  const warnings = committed.result.split('\n경고:\n')[1]
  if (warnings === undefined) return undefined

  return `⚠ relay: ${key} 기록에 경고가 있습니다 — ${warnings.split('\n').map(line => line.replace(/^- /, '')).filter(line => line !== '').join(' / ')}`
}

/**
 * Claims the task (checked and set in one step), runs the launch, and then makes the claim a
 * running task or lets it go: a refusal, a failure or an exception leaves the task ready. The launch
 * is over by then, so what the record said about it (blocked because the brief changed while it went
 * out, warnings) comes back as a note for the lead to read, never as a refusal; so does a failure
 * whose receipt says why (the task is ready again, not running).
 */
async function claimed<R>($: EngineInterface, hold: Hold, launch: () => Promise<R>, receipt: (ran: R) => Receipt): Promise<{ refused: string } | { ran: R; note: string | undefined }> {
  const held = await reserveDispatch($, hold.root, hold.run, hold.task)
  if ('deny' in held) return { refused: refused(hold.task, [held.deny]).deny }
  let ran: R
  try {
    ran = await launch()
  } catch (error) {
    await held.release().catch(() => undefined)
    throw error
  }
  const got = receipt(ran)
  if (!got.isOk) {
    const isLetGo = await held.release().then(
      () => true,
      () => false,
    )

    return { ran, note: got.why === undefined ? undefined : failedNote(hold, got.why, isLetGo) }
  }
  const committed = await held.commit(hold.runnerOf(got.text)).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))

  return { ran, note: noteOf(hold.task, committed) }
}

/**
 * A tool result with the note added to what the model reads after it (`context`), an errored one's
 * included; a refusal carries no context, so the note goes on its text.
 */
function withNote<R>(ran: R, note: string | undefined): R {
  if (note === undefined || ran === null || typeof ran !== 'object') return ran
  const call = ran as unknown as { deny?: unknown; context?: readonly string[] }
  if (typeof call.deny === 'string') return { ...ran, deny: `${call.deny}\n${note}` }

  return { ...ran, context: [...(call.context ?? []), note] }
}

/**
 * The SendMessage calls out now that carry a claimed brief. A message to a finished subagent resumes
 * it inside the call: the engine raises `agent.spawn` with `resume` and the message as the prompt,
 * and answers the call only after that spawn is decided (a resume declined there came back as the
 * call's `{ success: false }`, 2026-11-11). That resume is the send's own: the send was checked and
 * holds the claim, so the spawn passes unchecked, and how it went is kept here for the send's receipt.
 */
type Sending = { to: string; brief: string; resumed?: { deny?: string; agentId?: string } }
const sending = new Set<Sending>()

/**
 * The send out now that a resume belongs to, one resume a send: by the agent it addresses (the
 * resumed id, or the name the spawn carries), else by the claimed brief its prompt names.
 */
async function sendOf($: EngineInterface, e: AgentSpawnInput): Promise<Sending | undefined> {
  const resume = e.resume
  if (resume === undefined || sending.size === 0) return undefined
  const open = [...sending].filter(going => going.resumed === undefined)
  const addressed = open.find(going => going.to === resume.agentId || (e.name !== undefined && going.to === e.name))
  if (addressed !== undefined) return addressed
  if (!e.prompt.includes('.relay/runs/')) return undefined
  const cwd = await $.session.cwd().catch(() => undefined)
  const named = new Set(runPathsIn(e.prompt).map(path => resolvePath(path, cwd)))

  return open.find(going => named.has(going.brief))
}

/** Starts the resume a send caused, keeping whether it was refused (or threw), and the agent it reached, for the send's receipt. */
async function resumeOf<R extends { deny?: string }>(going: Sending, agentId: string, start: () => Promise<R>): Promise<R> {
  going.resumed = {}
  try {
    const started = await start()
    going.resumed = typeof started.deny === 'string' ? { deny: started.deny } : { agentId }

    return started
  } catch (error) {
    going.resumed = { deny: error instanceof Error ? error.message : String(error) }
    throw error
  }
}

/** Notes for subagents started, by the Agent call that started them: the spawn cannot carry one, its tool result can. */
const spawnNotes = new Map<string, string>()
const MAX_NOTES = 20

// ── Orca ──────────────────────────────────────────────

const orcaRunner = (id: string | undefined, fallback?: string): string => {
  if (id !== undefined) return `orca dispatch:${id}`
  if (fallback !== undefined && fallback !== '') return fallback.startsWith('dispatch:') ? `orca ${fallback}` : `orca dispatch:${fallback}`

  return 'orca (dispatch id 미확인)'
}

const optionOf = (call: OrcaCall, name: string): string | undefined => {
  const value = call.options.get(name)

  return typeof value === 'string' ? value : undefined
}

/** Gate 1 for the orca commands in a Bash command; the caller has tested the command's text already. */
export async function planOrca($: EngineInterface, command: string): Promise<Plan> {
  // A call asking for help starts and sends nothing: no check, no claim.
  const calls = readOrcaCalls(command)?.filter(call => !call.isHelp && (call.sub === 'worker-start' || mayNameBrief(call.words)))
  if (calls === undefined || calls.length === 0) return { pass: true }
  const root = await rootOf($)
  if (root === undefined) return { pass: true }
  const runs = await findActiveRuns($, root)
  if (runs.length === 0) return { pass: true }
  const cwd = await $.session.cwd().catch(() => undefined)

  // A worker started with no brief of the run is a refusal; one that says no-relay is other work.
  const isOther = (call: OrcaCall) => call.sub === 'worker-start' && optionOf(call, '--spec-file') === undefined && optionOf(call, '--comment')?.includes('no-relay') === true
  const sendsBrief = (call: OrcaCall) => call.sub === 'send' && briefsNamed(call.words, runs, cwd).length > 0

  // Where the command may have moved the working folder, a relative path to a brief points nowhere sure: absolute ones only.
  for (const call of calls) {
    const file = optionOf(call, '--spec-file')
    const relative = call.sub === 'worker-start' ? (file !== undefined && file !== '-' && file !== '' && !file.startsWith('/') ? [file] : []) : relativeBriefPaths(call.words)
    if (call.shifts && relative.length > 0) {
      return { deny: `지시서는 절대 경로로 주세요: 명령에 cd·pushd·괄호·$( ) 같은 위치를 바꿀 수 있는 구문이 있어 상대 경로(${relative[0]})가 어느 지시서인지 알 수 없습니다.` }
    }
  }
  const relevant = calls.filter(call => !isOther(call) && (call.sub === 'worker-start' || sendsBrief(call)))
  if (relevant.length === 0) return { pass: true }
  if (relevant.length > 1) return { deny: `한 명령에 워커를 띄우거나 지시서를 보내는 호출이 ${relevant.length}개 있습니다. ${ONE_AT_A_TIME}` }
  const call = relevant[0]
  if (call === undefined) return { pass: true }

  if (call.sub === 'send') {
    const picked = pickBrief(briefsNamed(call.words, runs, cwd))
    if (picked === undefined) return { pass: true }
    if ('deny' in picked) return picked
    const problems = await briefProblems($, picked.task)
    if (problems.length > 0) return refused(taskKey(picked.task), problems)
    const to = optionOf(call, '--to')

    return { pass: true, hold: { root, run: picked.run.run, task: taskKey(picked.task), brief: picked.task.specPath, act: 'send', runnerOf: receipt => orcaRunner(dispatchIdIn(receipt), to) } }
  }

  const file = optionOf(call, '--spec-file')
  if (file === undefined || file === '-' || file === '') {
    return { deny: `relay 묶음 ${runs.map(run => run.run).join(', ')}이 진행 중입니다. 워커는 relay task가 쓴 지시서 파일(--spec-file)로 띄우세요. 이 묶음과 상관없는 워커면 명령에 --comment no-relay를 붙이세요.` }
  }
  // A file that is none of an active run's briefs is other work.
  const picked = briefsByPath(runs).get(resolvePath(file, cwd))
  if (picked === undefined) return { pass: true }
  const task = picked.task
  const problems = await briefProblems($, task)
  const model = optionOf(call, '--model')
  if (model === undefined) problems.push(`--model이 없습니다: 지시서의 모델 ${task.model}을 적으세요(안 적으면 워커가 물려받은 모델로 돌아 비용이 커집니다).`)
  else if (model.trim() !== task.model.trim()) problems.push(`--model ${model}이 지시서의 모델 ${task.model}과 다릅니다.`)
  const effort = optionOf(call, '--effort')
  if (effort === undefined) problems.push(`--effort가 없습니다: 지시서의 effort ${task.effort}를 적으세요.`)
  else if (effort.trim() !== task.effort.trim()) problems.push(`--effort ${effort}가 지시서의 effort ${task.effort}와 다릅니다.`)
  if (problems.length > 0) return refused(taskKey(task), problems)

  return { pass: true, hold: { root, run: picked.run.run, task: taskKey(task), brief: task.specPath, act: 'launch', runnerOf: receipt => orcaRunner(dispatchIdIn(receipt)) } }
}

// ── Subagents ──────────────────────────────────────────────

/** Gate 1 for a subagent about to start: only a prompt naming a brief of an active run is looked at. */
export async function planSpawn($: EngineInterface, prompt: string, model: string | undefined): Promise<Plan> {
  if (!mayNameBrief([prompt])) return { pass: true }
  const root = await rootOf($)
  if (root === undefined) return { pass: true }
  const runs = await findActiveRuns($, root)
  const picked = pickBrief(briefsNamed([prompt], runs, await $.session.cwd().catch(() => undefined)))
  if (picked === undefined) return { pass: true }
  if ('deny' in picked) return picked
  const task = picked.task
  const problems = await briefProblems($, task)
  if (model === undefined || model.trim() === '') problems.push(`모델이 지정되지 않았습니다: Agent의 model에 지시서의 모델 ${task.model}을 적으세요(안 적으면 물려받은 모델로 돌아 비용이 커집니다).`)
  else if (!sameModel(model, task.model)) problems.push(`model ${model}이 지시서의 모델 ${task.model}과 다릅니다.`)
  if (problems.length > 0) return refused(taskKey(task), problems)

  return { pass: true, hold: { root, run: picked.run.run, task: taskKey(task), brief: task.specPath, act: 'launch', runnerOf: id => `subagent ${id === '' ? '(agent id 미확인)' : id}` } }
}

/**
 * Gate 1 for a message to a subagent: one carrying a brief of an active run is a new revision going
 * out. The model is not checked: the subagent keeps the one it runs on (a resume's content keys are
 * fixed, engine types).
 */
export async function planMessage($: EngineInterface, to: string, message: string): Promise<Plan> {
  if (!mayNameBrief([message])) return { pass: true }
  const root = await rootOf($)
  if (root === undefined) return { pass: true }
  const runs = await findActiveRuns($, root)
  const picked = pickBrief(briefsNamed([message], runs, await $.session.cwd().catch(() => undefined)))
  if (picked === undefined) return { pass: true }
  if ('deny' in picked) return picked
  const problems = await briefProblems($, picked.task)
  if (problems.length > 0) return refused(taskKey(picked.task), problems)

  // The receipt is the agentId the send reached (the resumed one, or the answer's), '' when neither names one: then the address.
  return { pass: true, hold: { root, run: picked.run.run, task: taskKey(picked.task), brief: picked.task.specPath, act: 'send', runnerOf: id => `subagent ${id === '' ? to : id}` } }
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
    const isOpen = state.tasks.some(task => isBusy(task) || task.status === 'needs_context' || task.status === 'blocked')

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

/** Whether a Bash command's text may hold a launch (the text test every Bash call pays). */
export function mayLaunch(command: string): boolean {
  return command.includes('worker-start') || (command.includes('send') && command.includes('.relay/runs'))
}

/** Gate 1's hooks: Bash (Orca), the subagent's start and SendMessage. A gate that fails lets the call through. */
export function gateLaunches(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // The text test first: a call that starts no worker costs nothing more.
    if (!mayLaunch(e.command)) return next(e)
    const plan = await planOrca($, e.command)
    if ('deny' in plan) return { deny: plan.deny }
    if (plan.hold === undefined) return next(e)
    // A failed orca command shows its own error: the task is ready again, with no note.
    const out = await claimed($, plan.hold, () => next(e), (ran): Receipt => (isFailed(ran) ? { isOk: false } : { isOk: true, text: printed(ran) }))

    return 'refused' in out ? { deny: out.refused } : withNote(out.ran, out.note)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const message = typeof e.message === 'string' ? e.message : ''
    if (!message.includes('.relay/runs/')) return next(e)
    const to = String(e.to)
    const plan = await planMessage($, to, message)
    if ('deny' in plan) return { deny: plan.deny }
    if (plan.hold === undefined) return next(e)
    const going: Sending = { to, brief: resolvePath(plan.hold.brief, undefined) }
    const send = async () => {
      sending.add(going)
      try {
        return await next(e)
      } finally {
        sending.delete(going)
      }
    }
    // A send that answered `success: false`, or whose resume was refused, did not go: the task is ready again.
    const out = await claimed($, plan.hold, send, (sent): Receipt => {
      const refusal = going.resumed?.deny
      const why = failureOf(sent) ?? (refusal === undefined ? undefined : oneLine(`재개가 거절됐습니다: ${refusal}`))
      if (why !== undefined) return { isOk: false, why }
      // The runner is the agent the send reached: the resumed one, else what the answer names, else the
      // address (an id reaches that worker again where a name may not).
      const reached = going.resumed?.agentId ?? resumedIdIn(sent)

      return { isOk: true, text: reached ?? '' }
    })

    return 'refused' in out ? { deny: out.refused } : withNote(out.ran, out.note)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    // The resume a SendMessage of a claimed brief caused: that send was checked and holds the claim.
    const going = await sendOf($, e)
    if (going !== undefined && e.resume !== undefined) return resumeOf(going, e.resume.agentId, () => next(e))
    if (!e.prompt.includes('.relay/runs/')) return next(e)
    const plan = await planSpawn($, e.prompt, e.model)
    if ('deny' in plan) return { deny: plan.deny }
    if (plan.hold === undefined) return next(e)
    const out = await claimed($, plan.hold, () => next(e), (started): Receipt => {
      const why = failureOf(started)
      if (why !== undefined) return { isOk: false, why }

      return { isOk: true, text: typeof started.agentId === 'string' ? started.agentId : '' }
    })
    if ('refused' in out) return { deny: out.refused }
    if (out.note !== undefined) {
      spawnNotes.set(e.tool_use_id, out.note)
      if (spawnNotes.size > MAX_NOTES) spawnNotes.delete(spawnNotes.keys().next().value ?? '')
    }

    return out.ran
  }).catch(($, e, next) => next(e))

  // The Agent call whose start left a note: the note goes with the call's result.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const note = spawnNotes.get(e.tool_use_id)
    if (note === undefined) return ran
    spawnNotes.delete(e.tool_use_id)

    return withNote(ran, note)
  }).catch(($, e, next) => next(e))
}
