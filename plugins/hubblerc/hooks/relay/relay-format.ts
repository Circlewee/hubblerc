/**
 * relay's pure parts: names, glob overlap, the texts the tool writes (brief, progress, package) and
 * the texts it reads (report, decisions table). No engine calls here; relay.ts does the I/O.
 */

/** `launching`: reserved for a launch under way (the gate hook), counted as running till it is committed or released. */
export type TaskStatus = 'ready' | 'launching' | 'running' | 'done' | 'done_with_concerns' | 'needs_context' | 'blocked' | 'cancelled'

export type Criterion = { id: string; text: string; command?: string; expectExit?: number }

export type RelayTask = {
  id: string
  rev: number
  title: string
  /** Where it runs and how to reach it again ('orca dispatch:<id>', 'subagent <name|agentId>'), set once launched. */
  runner: string | null
  model: string
  effort: string
  editScope: string[]
  reads: string[]
  targets: string[]
  criteria: Criterion[]
  status: TaskStatus
  specPath: string
  specHash: string
  dispatchedAt: number | null
  reportedAt: number | null
  /** Fixes made per criterion, counted across revisions. */
  tries: Record<string, number>
  /** The hash of the brief as sent (its copy is `tasks/<key>.dispatched.md`); absent before a dispatch. */
  dispatchedHash?: string
  /** Why it was cancelled, when it was. */
  cancelReason?: string
  /** Why the tool set it blocked itself (a brief changed while it was launched), when it did. */
  blockReason?: string
  /**
   * Blocked by the tool after its launch went out: the worker may still be at work, so the task
   * holds its files and targets as a running one does until the worker reports or is cancelled
   * with `confirmed_stopped`. A worker's own BLOCKED report never sets it (that worker stopped).
   */
  workerLive?: true
}

/** The result recorded: `fail` when any criterion its package asked for is not a pass, whatever the verdict's own result says. */
export type RelayVerdict = { id: string; at: number; commit: string; path: string; result: 'pass' | 'fail'; reasons?: string[] }

/** What a package handed the verifier: the tasks by revision, the criteria ids each must be judged on, the HEAD it showed. */
export type RelayPackage = {
  id: string
  at: number
  head: string
  tasks: { key: string; criteria: string[] }[]
  /** Every file its commits changed: a verdict must list each in `reviewed_files`. Absent on a package made before files were asked. */
  files?: string[]
}

export type RelayState = {
  version: 1
  run: string
  goal: string
  doneWhen: string[]
  base: string
  /** The lead's session id. */
  lead: string
  status: 'active' | 'finished'
  createdAt: number
  tasks: RelayTask[]
  verdicts: RelayVerdict[]
  /** Absent in a state written before packages were recorded. */
  packages?: RelayPackage[]
}

export type RunnerKind = 'claude' | 'codex'

/** What a brief is made from, as the lead hands it in (`task` and `spec_text`). */
export type BriefInput = {
  id: string
  title: string
  goal: string
  model: string
  effort: string
  editScope: string[]
  reads: string[]
  targets: string[]
  readFirst: string[]
  criteria: Criterion[]
  runnerKind: RunnerKind
}

export const RUN_PREFIX = '.relay/runs'
export const MAX_WORKERS = 3
export const TASK_ID = /^[A-Za-z][A-Za-z0-9_.]{0,19}$/
const RUN_NAME = /^[a-z0-9-]{1,30}$/
const RUN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,30}$/
const CRITERION_ID = /^[A-Za-z][A-Za-z0-9_.]{0,19}$/
export const TASK_STATUSES: readonly TaskStatus[] = ['ready', 'launching', 'running', 'done', 'done_with_concerns', 'needs_context', 'blocked', 'cancelled']

export const isRunName = (name: string): boolean => RUN_NAME.test(name) && !name.startsWith('-')
export const isRun = (run: string): boolean => RUN.test(run)
export const isCriterionId = (id: string): boolean => CRITERION_ID.test(id)

const pad = (n: number): string => String(n).padStart(2, '0')

/** The local date, `YYYY-MM-DD`. */
export function localDate(at: number): string {
  const d = new Date(at)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local date and time, `YYYY-MM-DD HH:MM`. */
export function localTime(at: number): string {
  const d = new Date(at)

  return `${localDate(at)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const taskKey = (task: { id: string; rev: number }): string => `${task.id}-r${task.rev}`
/** Holding a worker: launched, or a launch reserved. */
export const isBusy = (task: { status: TaskStatus; workerLive?: true }): boolean =>
  task.status === 'running' || task.status === 'launching' || (task.status === 'blocked' && task.workerLive === true)

/** Blocked after launch, its worker perhaps still out: what the lead does next. */
export const LIVE_BLOCKED = '띄운 뒤 막힘: 지시서가 바뀜 — 워커를 멈추고 cancel(confirmed_stopped)'

/** A task's status as a person reads it: a blocked task whose worker may be at work says so. */
export const statusLabel = (task: { status: TaskStatus; workerLive?: true }): string => (task.status === 'blocked' && task.workerLive === true ? `blocked (${LIVE_BLOCKED})` : task.status)
export const isDone = (task: { status: TaskStatus }): boolean => task.status === 'done' || task.status === 'done_with_concerns'
export const runDir = (root: string, run: string): string => `${root}/${RUN_PREFIX}/${run}`
export const specFile = (dir: string, key: string): string => `${dir}/tasks/${key}.md`
export const reportFile = (dir: string, key: string): string => `${dir}/tasks/${key}-report.md`
export const checksFile = (dir: string, key: string): string => `${dir}/tasks/${key}-checks.md`
/** The brief as it was sent, copied at the dispatch. */
export const dispatchedFile = (dir: string, key: string): string => `${dir}/tasks/${key}.dispatched.md`

/** The task a lead names: `A-r2` that revision, `A` the latest one. */
export function findTask(state: RelayState, name: string): RelayTask | undefined {
  const exact = state.tasks.find(task => taskKey(task) === name)
  if (exact !== undefined) return exact

  return latestRevs(state.tasks).find(task => task.id === name)
}

/** The latest revision of each task id, in the order the ids first appeared. */
export function latestRevs(tasks: readonly RelayTask[]): RelayTask[] {
  const latest = new Map<string, RelayTask>()
  for (const task of tasks) {
    const seen = latest.get(task.id)
    if (seen === undefined || task.rev > seen.rev) latest.set(task.id, task)
  }

  return [...latest.values()]
}

/** Whether two criteria ask the same: the same text, command and expected exit. */
export const sameCriterion = (a: Criterion, b: Criterion): boolean =>
  a.text === b.text && (a.command ?? '') === (b.command ?? '') && (a.command === undefined ? true : (a.expectExit ?? 0) === (b.expectExit ?? 0))

/**
 * The tries a new revision starts with: a criterion asked the same as in the revision before keeps
 * its count; one changed, or new, starts at 0 (its earlier failures were at another task).
 */
export function carriedTries(previous: RelayTask | undefined, criteria: readonly Criterion[]): { tries: Record<string, number>; carried: string[]; fresh: string[] } {
  const tries: Record<string, number> = {}
  const carried: string[] = []
  const fresh: string[] = []
  for (const criterion of criteria) {
    const before = previous?.criteria.find(other => other.id === criterion.id)
    const count = previous?.tries[criterion.id]
    if (before !== undefined && sameCriterion(before, criterion)) {
      if (count !== undefined) tries[criterion.id] = count
      carried.push(`${criterion.id}(${count ?? 0})`)
    } else fresh.push(before === undefined ? `${criterion.id}(새 기준)` : `${criterion.id}(기준 글이 바뀜)`)
  }

  return { tries, carried, fresh }
}

/** What stands for each task id: its latest revision not cancelled (none when all are). */
export function effectiveTasks(tasks: readonly RelayTask[]): RelayTask[] {
  return latestRevs(tasks.filter(task => task.status !== 'cancelled'))
}

// ── Paths ──────────────────────────────────────────────

const WILDCARD = /[*?[{]/

function normalPath(path: string): string {
  return path.trim().replace(/^\.\//, '').replace(/\/{2,}/g, '/')
}

/** The part of a pattern before its first wildcard. */
export function fixedPart(pattern: string): string {
  const path = normalPath(pattern)
  const at = path.search(WILDCARD)

  return at < 0 ? path : path.slice(0, at)
}

/**
 * Whether two path patterns may name a common file: one's fixed part is a prefix of the other's.
 * Coarse on purpose (`a/*.ts` and `a/b/c.ts` overlap): a false overlap only orders two tasks, a
 * missed one lets two workers write the same file.
 */
export function globsOverlap(a: string, b: string): boolean {
  const left = fixedPart(a)
  const right = fixedPart(b)

  return left.startsWith(right) || right.startsWith(left)
}

/** The pairs of patterns that overlap between two lists, as `a ↔ b`. */
export function overlaps(mine: readonly string[], theirs: readonly string[]): string[] {
  const found: string[] = []
  for (const a of mine) for (const b of theirs) if (globsOverlap(a, b)) found.push(a === b ? a : `${a} ↔ ${b}`)

  return found
}

function globRegex(pattern: string): RegExp {
  let source = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i] ?? ''
    if (c === '*' && pattern[i + 1] === '*') {
      const isDir = pattern[i + 2] === '/'
      source += isDir ? '(?:.*/)?' : '.*'
      i += isDir ? 3 : 2
      continue
    }
    if (c === '*') source += '[^/]*'
    else if (c === '?') source += '[^/]'
    else if (c === '{') {
      const end = pattern.indexOf('}', i)
      if (end < 0) source += '\\{'
      else {
        source += `(?:${pattern.slice(i + 1, end).split(',').map(part => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
        i = end + 1
        continue
      }
    } else source += c.replace(/[.+^$()|[\]\\}]/g, '\\$&')
    i += 1
  }

  return new RegExp(`^${source}$`)
}

/** Whether a repository path falls under a pattern: a glob, or a plain path naming the file or a folder above it. */
export function pathMatches(path: string, pattern: string): boolean {
  const file = normalPath(path)
  const glob = normalPath(pattern).replace(/\/$/, '/**')
  if (!WILDCARD.test(glob)) return file === glob || file.startsWith(`${glob}/`)

  return globRegex(glob).test(file)
}

export const outsideScope = (files: readonly string[], scope: readonly string[]): string[] => files.filter(file => !scope.some(pattern => pathMatches(file, pattern)))

const TEST_DIR = /(^|\/)(tests?|__tests__|spec)\//
const TEST_FILE = /\.(test|spec)\.[a-z]+$/
export const isTestFile = (path: string): boolean => TEST_DIR.test(path) || TEST_FILE.test(path)

// ── Checking a task ──────────────────────────────────────────────

export type TaskCheck = { denials: string[]; warnings: string[] }

/**
 * What `task` refuses and warns about, against the run as it stands. A running (or launching) task
 * that shares files (my edits with theirs, my reads with their edits, their reads with my edits) or
 * an external target refuses, another revision of the same task included; an earlier done task on
 * the same files whose report the brief does not read first warns. `rev`, when given, names the
 * input's own entry, left out. Pure: the gate hook calls it too.
 */
export function checkTask(state: RelayState, input: Omit<BriefInput, 'title' | 'goal' | 'runnerKind'> & { rev?: number }): TaskCheck {
  const denials: string[] = []
  const warnings: string[] = []
  if (input.model.trim() === '') denials.push('model이 비었습니다: 실제 모델 ID를 적으세요.')
  if (input.effort.trim() === '') denials.push('effort가 비었습니다.')
  if (input.criteria.length === 0) denials.push('done_when이 비었습니다: 완료 기준을 하나 이상 적으세요.')
  const ids = input.criteria.map(criterion => criterion.id)
  const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))]
  if (repeated.length > 0) denials.push(`기준 ID가 겹칩니다: ${repeated.join(', ')}`)

  const running = state.tasks.filter(task => isBusy(task) && !(task.id === input.id && task.rev === input.rev))
  for (const other of running) {
    const clashes = [
      ...overlaps(input.editScope, other.editScope).map(pair => `edit_scope ${pair}`),
      ...overlaps(input.reads, other.editScope).map(pair => `내 reads ↔ 그 edit_scope: ${pair}`),
      ...overlaps(input.editScope, other.reads).map(pair => `내 edit_scope ↔ 그 reads: ${pair}`),
      ...input.targets.filter(target => other.targets.includes(target)).map(target => `external target ${target}`),
    ]
    if (clashes.length > 0) {
      denials.push(`돌고 있는 ${taskKey(other)}와 겹칩니다(${clashes.join('; ')}). 순서대로 돌리세요: 앞 작업 ${taskKey(other)}가 끝난 뒤 그 커밋을 Base로.`)
    }
  }
  if (running.length >= MAX_WORKERS) warnings.push(`돌고 있는 작업이 이미 ${running.length}개입니다(기본 상한 ${MAX_WORKERS}): 더 띄우려면 사용자에게 물으세요.`)

  for (const done of state.tasks) {
    if (done.status !== 'done' && done.status !== 'done_with_concerns') continue
    if (overlaps(input.editScope, done.editScope).length === 0) continue
    const report = reportFile(dirOfSpec(done.specPath), taskKey(done))
    const tail = `tasks/${taskKey(done)}-report.md`
    if (!input.readFirst.some(path => path === report || normalPath(path).endsWith(tail))) {
      warnings.push(`같은 범위를 고친 ${taskKey(done)}가 끝났습니다: 후임 지시서의 read_first에 앞 보고서 ${report}를 넣으세요.`)
    }
  }

  return { denials, warnings }
}

/** The run folder a brief sits in (`<dir>/tasks/<key>.md`). */
export function dirOfSpec(specPath: string): string {
  return specPath.replace(/\/tasks\/[^/]+$/, '')
}

// ── Markdown pieces ──────────────────────────────────────────────

/** Inline code that survives backticks inside it. */
export function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(run => run[0].length))
  const ticks = '`'.repeat(longest + 1)

  return longest === 0 ? `${ticks}${text}${ticks}` : `${ticks} ${text} ${ticks}`
}

/** A fenced block that survives fences inside it. */
export function fenced(text: string, info = 'text'): string {
  const longest = Math.max(2, ...[...text.matchAll(/`{3,}/g)].map(run => run[0].length))
  const ticks = '`'.repeat(longest + 1)

  return `${ticks}${info}\n${text.replace(/\n$/, '')}\n${ticks}`
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
const cell = (text: string): string => oneLine(text).replace(/\|/g, '\\|')
const list = (items: readonly string[]): string => (items.length === 0 ? '없음' : items.join(', '))

type Section = { title: string; lines: string[] }

/** A markdown text cut at its `##` headings (outside fences); the part before the first is titled ''. */
export function sections(text: string): Section[] {
  const found: Section[] = [{ title: '', lines: [] }]
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (mark !== undefined) {
      if (fence === null) fence = mark
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null
    }
    const heading = fence === null && mark === undefined ? /^##\s+(.*?)\s*$/.exec(line) : null
    if (heading !== null) found.push({ title: heading[1] ?? '', lines: [line] })
    else found.at(-1)?.lines.push(line)
  }

  return found
}

const titled = (section: Section, name: string): boolean => section.title.toLowerCase().startsWith(name.toLowerCase())

/** The text without the `##` sections whose titles start with one of `names`. */
export function withoutSections(text: string, names: readonly string[]): string {
  return sections(text)
    .filter(section => !names.some(name => titled(section, name)))
    .map(section => section.lines.join('\n'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** A section's body lines (its heading off), or undefined when the text has none so titled. */
export function sectionBody(text: string, name: string): string[] | undefined {
  return sections(text)
    .find(section => section.title !== '' && titled(section, name))
    ?.lines.slice(1)
}

// ── The brief ──────────────────────────────────────────────

export type BriefContext =
  | { kind: 'full'; run: string; key: string; base: string; reportTo: string; lead: string }
  | { kind: 'light'; base: string; lead: string }

function trailerFlags(input: BriefInput, context: BriefContext): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const flags: string[] = []
  if (input.runnerKind === 'codex') {
    flags.push(`Agent: codex`, `Session: ${context.lead}`, `Model: ${input.model}`, `Effort: ${input.effort}`)
  }
  if (context.kind === 'full') flags.push(`Task: ${context.key}`, `Run: ${context.run}`)

  return flags.map(flag => `--trailer ${quote(flag)}`).join(' ')
}

function rules(input: BriefInput, context: BriefContext): string[] {
  const flags = trailerFlags(input, context)
  const commit = `git commit --only -m "<영어 제목>"${flags === '' ? '' : ` ${flags}`} -- <바꾼 파일들>`
  const signedBy =
    input.runnerKind === 'claude'
      ? '나머지 꼬리말(Agent·Session·Model·Effort·Device)은 hubblerc가 붙인다.'
      : 'Device 꼬리말은 넣지 않는다.'
  const reportRule =
    context.kind === 'full'
      ? '보고서는 Report to 폴더에 임시 파일로 다 쓴 뒤 이름을 바꾸고 완료를 알린다(메시지에는 경로만).'
      : '보고는 답으로 한다: 15줄 안팎. 증거·질문은 줄 수 때문에 버리지 않는다.'

  return [
    'Edit scope 안에서 이번 작업의 변경만 한다. 시작할 때 git status를 보고, 범위 안에 출처 모를 변경이 있으면 묻는다.',
    '범위 밖 파일(새 파일 포함)이 필요하면 먼저 묻는다.',
    '완료 기준과 테스트를 약화하지 않는다. 테스트를 바꿨으면 이유를 보고한다.',
    '목표·권한·입력·판정에 영향을 주는 것만 묻고 멈춘다(NEEDS_CONTEXT / BLOCKED). 사소한 선택(함수 이름, 파일 나누기, 문구)은 하고 나서 보고한다.',
    '같은 기준의 수정은 판을 넘어 누적 3번까지(tries). 통과하면 더 다듬지 않는다.',
    'push·배포·외부 전송·비용이 드는 일·되돌리기 어려운 일은 구체적인 승인 없이 하지 않는다.',
    `커밋: 새 파일은 먼저 \`git add <파일>\`(git이 모르는 파일은 --only로 커밋되지 않음), 그다음 \`${commit}\`. ${signedBy} 서명 줄(Co-Authored-By 등)은 넣지 않는다. 남이 스테이징한 변경은 건드리지 않는다. index.lock이면 3번까지 다시, 그래도 안 되면 BLOCKED(잠금 파일은 지우지 않음). stash·reset·checkout·clean·commit -a 금지.`,
    reportRule,
    '보고서 형식은 아래 Report format을 따른다.',
  ]
}

function reportFormat(input: BriefInput, context: BriefContext): string {
  const name = context.kind === 'full' ? context.key : input.id
  const criteria = input.criteria.map(criterion => `- ${criterion.id}: pass|fail|unverified · tries N · <관찰 사실>`)
  const form = [
    `# Report ${name}`,
    '- Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED',
    '- Change: committed | no_change | uncommitted',
    '- Commits: <이번 보고의 자기 커밋 전체 SHA, 여러 개면 쉼표, 없으면 none>',
    '- Model / effort: <실제 값, 모르면 미확인>',
    '- Found at start: none | unchecked | <사실>',
    '## Criteria',
    ...criteria,
    '## Concerns   (DONE_WITH_CONCERNS일 때만)',
    '## Test changes   (<파일>: <목적>, 없으면 none)',
    '## For whoever picks up',
    '- Tools: <경로 · 용도 · 한 번 도는 시간>',
    '- Tried and dropped: <방법 → 관찰된 실패>',
    '- Remaining changes: …',
    '- Decisions I made: <지시서가 정하지 않아 정한 것 — 이유>',
    '## Question   (NEEDS_CONTEXT / BLOCKED일 때만)',
  ].join('\n')

  return [
    fenced(form, 'markdown'),
    '',
    '- Criteria는 위 기준마다 정확히 한 줄(빠짐·중복 없이). tries는 판을 넘어 누적한 수정 횟수(다시 돌려 보기만 한 것은 세지 않음).',
    '- 상태: DONE = 모든 기준 통과',
    '- DONE_WITH_CONCERNS = 모든 기준 통과 + 기준 밖 걱정(Concerns에 적음)',
    '- NEEDS_CONTEXT = 답이 필요함(Question에 적음)',
    '- BLOCKED = 실패·시도 소진·확인 불가·실행 장애',
  ].join('\n')
}

function criterionLine(criterion: Criterion): string {
  const command = criterion.command === undefined ? '' : ` · ${inlineCode(criterion.command)} → exit ${criterion.expectExit ?? 0}`

  return `- ${criterion.id}: ${oneLine(criterion.text)}${command}`
}

/** A brief, as the worker reads it: head lines, Goal, Read first, Done when, Rules, Report format. */
export function briefText(input: BriefInput, context: BriefContext): string {
  const name = context.kind === 'full' ? context.key : input.id
  const head = [
    `- Base: ${context.base}   (비교 기준. checkout하지 말 것)`,
    `- Model / effort: ${input.model} / ${input.effort}`,
    `- Edit scope: ${list(input.editScope)}   (저장소 기준, 새 파일 포함)`,
    `- Reads: ${list(input.reads)}`,
    `- External targets: ${list(input.targets)}`,
    ...(context.kind === 'full' ? [`- Report to: ${context.reportTo}`] : []),
  ]
  const readFirst = input.readFirst.length === 0 ? ['- 없음'] : input.readFirst.map(path => `- ${path}`)

  return [
    `# Task ${name}: ${oneLine(input.title)}`,
    '',
    ...head,
    '',
    '## Goal',
    input.goal.trim(),
    '',
    '## Read first',
    ...readFirst,
    '',
    '## Done when',
    ...input.criteria.map(criterionLine),
    '',
    '## Rules',
    ...rules(input, context).map((rule, at) => `${at + 1}. ${rule}`),
    '',
    '## Report format',
    reportFormat(input, context),
    '',
  ].join('\n')
}

// ── progress.md ──────────────────────────────────────────────

export const TASKS_START = '<!-- relay:tasks:start -->'
export const TASKS_END = '<!-- relay:tasks:end -->'

export function progressText(state: RelayState, at: number): string {
  return [
    `# Progress: ${state.run}`,
    '',
    '## Now (overwrite)',
    `- Updated: ${localTime(at)} · Lead: ${state.lead.slice(0, 8)}`,
    `- Goal: ${oneLine(state.goal)}`,
    `- Done when: ${state.doneWhen.map(oneLine).join('; ')}`,
    `- Base: ${state.base.slice(0, 7)}`,
    '- Next:',
    '',
    '## Decisions (append; only Status changes)',
    '| ID | Decision | Why | Cost if wrong | By | Status |',
    '|---|---|---|---|---|---|',
    '',
    '## Tasks (relay가 다시 그림 — 손으로 고치지 말 것)',
    TASKS_START,
    TASKS_END,
    '',
    '## Tools (for whoever picks up)',
    '| Path | What | One run takes |',
    '|---|---|---|',
    '',
    '## Log (append; includes verification)',
    '| Time | What happened |',
    '|---|---|',
    '',
  ].join('\n')
}

export function tasksTable(tasks: readonly RelayTask[]): string {
  return [
    '| ID | What | Runner | Status |',
    '|---|---|---|---|',
    ...tasks.map(task => `| ${taskKey(task)} | ${cell(task.title)} | ${cell(task.runner ?? '-')} | ${cell(statusLabel(task))} |`),
  ].join('\n')
}

/** progress.md with its Tasks block drawn again, or null when the markers are gone. */
export function withTasks(progress: string, tasks: readonly RelayTask[]): string | null {
  const start = progress.indexOf(TASKS_START)
  const end = progress.indexOf(TASKS_END)
  if (start < 0 || end < start) return null

  return `${progress.slice(0, start + TASKS_START.length)}\n${tasksTable(tasks)}\n${progress.slice(end)}`
}

// ── The decisions table ──────────────────────────────────────────────

export type DecisionRow = { id: string; decision: string; why: string; cost: string; by: string; status: string; line: string }

function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')

  return inner.split(/(?<!\\)\|/).map(part => part.trim().replace(/\\\|/g, '|'))
}

/** The rows of progress.md's Decisions table, read leniently: blank lines, the header and rule rows skipped. */
export function decisionRows(progress: string): DecisionRow[] {
  const body = sectionBody(progress, 'Decisions') ?? []
  const rows: DecisionRow[] = []
  for (const line of body) {
    if (!line.trim().startsWith('|')) continue
    const parts = cells(line)
    if (parts.every(part => /^:?-*:?$/.test(part))) continue
    if ((parts[0] ?? '').toLowerCase() === 'id') continue
    const [id = '', decision = '', why = '', cost = '', by = ''] = parts
    const status = parts.length >= 6 ? (parts[5] ?? '') : (parts.at(-1) ?? '')
    rows.push({ id, decision, why, cost, by, status, line: line.trim() })
  }

  return rows
}

export const isPending = (row: DecisionRow): boolean => /^(asked|on[\s_-]?hold)$/i.test(row.status.trim())
export const isByLead = (row: DecisionRow): boolean => /^(by\s+)?(lead|리드)/i.test(row.by.trim())

// ── The report ──────────────────────────────────────────────

export type ReportStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED'
export type CriterionResult = 'pass' | 'fail' | 'unverified'

export type ParsedReport = {
  status: ReportStatus | null
  change: 'committed' | 'no_change' | 'uncommitted' | null
  commits: string[]
  modelEffort: string
  criteria: { id: string; result: CriterionResult; tries: number | null; note: string }[]
  concerns: string[]
  testChanges: string[]
}

const NONE = /^(none|없음|-|n\/a)$/i

function headValue(lines: readonly string[], key: string): string | undefined {
  const pattern = new RegExp(`^[-*]\\s*\\**${key.replace(/[/]/g, '\\/')}\\**\\s*:\\s*(.*)$`, 'i')
  for (const line of lines) {
    const found = pattern.exec(line.trim().replace(/`/g, ''))
    if (found !== null) return (found[1] ?? '').replace(/\*/g, '').trim()
  }

  return undefined
}

const contentLines = (lines: readonly string[] | undefined): string[] =>
  (lines ?? []).map(line => line.trim()).filter(line => line !== '' && !NONE.test(line.replace(/^[-*]\s*/, '')))

export function parseReport(text: string): ParsedReport {
  const all = sections(text)
  const head = all.filter(section => !/^(criteria|concerns|test changes|for whoever|question)/i.test(section.title)).flatMap(section => section.lines)
  const statusText = headValue(head, 'Status') ?? ''
  const status = (['DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED', 'DONE'] as const).find(word => new RegExp(`^${word}\\b`, 'i').test(statusText)) ?? null
  const changeText = (headValue(head, 'Change') ?? '').toLowerCase()
  const change = (['committed', 'no_change', 'uncommitted'] as const).find(word => changeText.startsWith(word)) ?? null
  const commitsText = headValue(head, 'Commits') ?? ''
  const commits = NONE.test(commitsText) ? [] : commitsText.split(/[\s,]+/).filter(sha => /^[0-9a-f]{4,64}$/i.test(sha))
  const criteria: ParsedReport['criteria'] = []
  for (const line of sectionBody(text, 'Criteria') ?? []) {
    const found = /^[-*]\s*\**([A-Za-z][A-Za-z0-9_.]*)\**\s*:\s*\**(pass|fail|unverified)\b\**(.*)$/i.exec(line.trim())
    if (found === null) continue
    const tries = /tries\s*(\d+)/i.exec(found[3] ?? '')
    criteria.push({ id: found[1] ?? '', result: (found[2] ?? '').toLowerCase() as CriterionResult, tries: tries === null ? null : Number(tries[1]), note: (found[3] ?? '').replace(/^\s*·\s*/, '').trim() })
  }

  return {
    status,
    change,
    commits,
    modelEffort: headValue(head, 'Model / effort') ?? '',
    criteria,
    concerns: contentLines(sectionBody(text, 'Concerns')),
    testChanges: contentLines(sectionBody(text, 'Test changes')),
  }
}

/** Where a report disagrees with itself or with its brief's criteria: each a reason the worker fixes. */
export function reportMismatches(report: ParsedReport, criteria: readonly Criterion[]): string[] {
  const problems: string[] = []
  if (report.status === null) problems.push('Status가 없거나 DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED가 아님')
  if (report.change === null) problems.push('Change가 없거나 committed / no_change / uncommitted가 아님')
  if (report.change === 'committed' && report.commits.length === 0) problems.push('Change가 committed인데 Commits에 SHA가 없음')
  if (report.change === 'no_change' && report.commits.length > 0) problems.push('Change가 no_change인데 Commits가 있음')
  const wanted = criteria.map(criterion => criterion.id)
  const seen = report.criteria.map(criterion => criterion.id)
  const missing = wanted.filter(id => !seen.includes(id))
  const repeated = [...new Set(seen.filter((id, at) => seen.indexOf(id) !== at))]
  const unknown = [...new Set(seen.filter(id => !wanted.includes(id)))]
  if (missing.length > 0) problems.push(`Criteria에 없는 기준: ${missing.join(', ')}`)
  if (repeated.length > 0) problems.push(`Criteria에 두 번 이상 나온 기준: ${repeated.join(', ')}`)
  if (unknown.length > 0) problems.push(`지시서에 없는 기준: ${unknown.join(', ')}`)
  if (report.status === 'DONE' || report.status === 'DONE_WITH_CONCERNS') {
    const notPassed = report.criteria.filter(criterion => criterion.result !== 'pass').map(criterion => `${criterion.id}(${criterion.result})`)
    if (notPassed.length > 0) problems.push(`${report.status}인데 통과하지 않은 기준: ${notPassed.join(', ')}`)
  }
  if (report.status === 'DONE_WITH_CONCERNS' && report.concerns.length === 0) problems.push('DONE_WITH_CONCERNS인데 Concerns가 비었음')
  // Done is delivered: committed, or nothing to commit. Work left in the tree is not what a verdict sees.
  if ((report.status === 'DONE' || report.status === 'DONE_WITH_CONCERNS') && report.change === 'uncommitted') problems.push(`${report.status}인데 Change가 uncommitted: 커밋한 뒤 보고해야 함`)

  return problems
}

export const STATUS_OF: Record<ReportStatus, TaskStatus> = {
  DONE: 'done',
  DONE_WITH_CONCERNS: 'done_with_concerns',
  NEEDS_CONTEXT: 'needs_context',
  BLOCKED: 'blocked',
}

// ── Checks ──────────────────────────────────────────────

export type CheckOutcome = {
  id: string
  text: string
  command?: string
  expectExit: number
  result: CriterionResult
  exitCode?: number
  ms?: number
  stdout?: string
  stderr?: string
  /** Why it is unverified, when it is. */
  reason?: string
}

export function lastLines(text: string, count = 20): string {
  const lines = text.replace(/\n$/, '').split('\n')

  return lines.slice(-count).join('\n')
}

export function checksText(key: string, head: string, at: number, outcomes: readonly CheckOutcome[], notes: readonly string[] = []): string {
  const count = (result: CriterionResult) => outcomes.filter(outcome => outcome.result === result).length
  const parts = [
    `# Checks ${key}`,
    `- Ran: ${localTime(at)} · HEAD ${head}`,
    `- Summary: pass ${count('pass')} · fail ${count('fail')} · unverified ${count('unverified')}`,
    ...notes.map(note => `- ${note}`),
    '- 워커 보고의 pass는 증거가 아니다: 이 결과가 기준의 결과다.',
  ]
  for (const outcome of outcomes) {
    parts.push('', `## ${outcome.id}: ${outcome.result}`, `- Criterion: ${oneLine(outcome.text)}`)
    if (outcome.command !== undefined) parts.push(`- Command: ${inlineCode(outcome.command)}`)
    if (outcome.exitCode !== undefined) parts.push(`- Exit: ${outcome.exitCode} (expected ${outcome.expectExit}) · ${outcome.ms ?? 0} ms`)
    if (outcome.reason !== undefined) parts.push(`- Unverified: ${outcome.reason}`)
    if (outcome.stdout !== undefined && outcome.stdout.trim() !== '') parts.push('- stdout (last 20 lines):', fenced(outcome.stdout))
    if (outcome.stderr !== undefined && outcome.stderr.trim() !== '') parts.push('- stderr (last 20 lines):', fenced(outcome.stderr))
  }

  return `${parts.join('\n')}\n`
}

// ── The verdict ──────────────────────────────────────────────

export type Verdict = {
  commit: string
  result: 'pass' | 'fail'
  model: string
  criteria: { id: string; result: CriterionResult; evidence: string }[]
  findings: { severity: 'high' | 'medium' | 'low'; file?: string | null; line?: number | null; issue: string; evidence: string }[]
  /** The repository paths the verifier opened and read. */
  reviewed_files: string[]
}

/**
 * The verdict's form, handed to `codex exec --output-schema` as it is: strict structured output
 * wants every property required and no others, so the optional `file` and `line` take null.
 */
export const VERDICT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'relay verdict',
  type: 'object',
  additionalProperties: false,
  required: ['commit', 'result', 'model', 'criteria', 'findings', 'reviewed_files'],
  properties: {
    commit: { type: 'string', description: 'Full SHA of the HEAD that was reviewed' },
    result: { type: 'string', enum: ['pass', 'fail'] },
    model: { type: 'string', description: 'The reviewing model' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'result', 'evidence'],
        properties: {
          id: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'unverified'] },
          evidence: { type: 'string', description: 'Command and exit code, a few output lines, or file:line' },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'line', 'issue', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: ['string', 'null'] },
          line: { type: ['integer', 'null'] },
          issue: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    reviewed_files: {
      type: 'array',
      items: { type: 'string' },
      description: "Repository paths of the files you opened and read with the package's git show commands; none you did not open",
    },
  },
} as const

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A verdict read from its file (a ```json fence around it is taken off), or why its form is wrong. */
export function parseVerdict(text: string): { verdict: Verdict } | { problems: string[] } {
  const bare = text.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1')
  let value: unknown
  try {
    value = JSON.parse(bare)
  } catch (error) {
    return { problems: [`JSON이 아님: ${String(error)}`] }
  }
  if (!isObject(value)) return { problems: ['최상위가 객체가 아님'] }
  const problems: string[] = []
  if (typeof value.commit !== 'string' || value.commit.trim() === '') problems.push('commit이 문자열이 아님')
  if (value.result !== 'pass' && value.result !== 'fail') problems.push("result가 'pass' 또는 'fail'이 아님")
  if (typeof value.model !== 'string') problems.push('model이 문자열이 아님')
  if (!Array.isArray(value.criteria)) problems.push('criteria가 배열이 아님')
  else
    value.criteria.forEach((item: unknown, at) => {
      if (!isObject(item) || typeof item.id !== 'string' || !['pass', 'fail', 'unverified'].includes(String(item.result)) || typeof item.evidence !== 'string') {
        problems.push(`criteria[${at}]: { id, result: pass|fail|unverified, evidence } 형식이 아님`)
      }
    })
  if (!Array.isArray(value.findings)) problems.push('findings가 배열이 아님')
  else
    value.findings.forEach((item: unknown, at) => {
      const isForm =
        isObject(item) &&
        ['high', 'medium', 'low'].includes(String(item.severity)) &&
        typeof item.issue === 'string' &&
        typeof item.evidence === 'string' &&
        (item.file === undefined || item.file === null || typeof item.file === 'string') &&
        (item.line === undefined || item.line === null || typeof item.line === 'number')
      if (!isForm) problems.push(`findings[${at}]: { severity: high|medium|low, file?, line?, issue, evidence } 형식이 아님`)
    })
  if (!Array.isArray(value.reviewed_files) || !value.reviewed_files.every((item: unknown) => typeof item === 'string')) problems.push('reviewed_files가 문자열 배열이 아님(열어 본 파일의 저장소 경로)')

  return problems.length > 0 ? { problems } : { verdict: value as unknown as Verdict }
}

/** Whether two SHAs name the same commit, one perhaps cut short (seven characters at least). */
export function sameCommit(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (left === '' || right === '') return false
  if (left.length < 7 || right.length < 7) return left === right

  return left.startsWith(right) || right.startsWith(left)
}

// ── The package ──────────────────────────────────────────────

/** One file a commit changed, as `git show --numstat` counts it (null: binary). */
export type FileChange = { sha: string; key: string; path: string; added: number | null; removed: number | null }

/** `git show --numstat --format=` lines: `added<TAB>removed<TAB>path`, `-` for a binary file. */
export function parseNumstat(text: string): { path: string; added: number | null; removed: number | null }[] {
  const found: { path: string; added: number | null; removed: number | null }[] = []
  for (const line of text.split('\n')) {
    const [added = '', removed = '', ...rest] = line.split('\t')
    const path = rest.join('\t').trim()
    if (path === '') continue
    found.push({ path, added: /^\d+$/.test(added) ? Number(added) : null, removed: /^\d+$/.test(removed) ? Number(removed) : null })
  }

  return found
}

const counted = (change: { added: number | null; removed: number | null }): string => (change.added === null ? 'binary' : `+${change.added} −${change.removed ?? 0}`)

/**
 * The package's list of files to review, in place of the diffs: each file with its commits, their
 * line counts and the command that shows it, run from the repository root.
 */
export function filesToReview(root: string, changes: readonly FileChange[]): string {
  const paths = [...new Set(changes.map(change => change.path))].sort()
  const lines = [
    '## Files to review',
    `diff는 담지 않는다. 각 파일을 아래 명령으로 저장소 루트(${root})에서 열어 본다.`,
  ]
  if (paths.length === 0) lines.push('- 없음(커밋 없음)')
  for (const path of paths) {
    const mine = changes.filter(change => change.path === path)
    const added = mine.reduce((sum, change) => sum + (change.added ?? 0), 0)
    const removed = mine.reduce((sum, change) => sum + (change.removed ?? 0), 0)
    const isBinary = mine.some(change => change.added === null)
    lines.push(`- ${path} — ${isBinary ? 'binary 포함, ' : ''}+${added} −${removed}, 커밋 ${mine.length}개`)
    for (const change of mine) lines.push(`  - ${inlineCode(`git show ${change.sha} -- ${path}`)} (${counted(change)}, ${change.key})`)
  }

  return lines.join('\n')
}

/** One commit's line in a revision's list: its subject, then its files with their counts. */
export function commitLines(subject: string, files: readonly { path: string; added: number | null; removed: number | null }[]): string[] {
  return [`- ${subject}`, ...files.map(file => `  - ${file.path} (${counted(file)})`)]
}

const normalReviewed = (path: string): string => path.trim().replace(/^\.\//, '')

/** The criteria ids a package asks to be judged, `<task>-r<n>:<criterion>`. */
export const requiredCriteria = (pack: RelayPackage): string[] => pack.tasks.flatMap(task => task.criteria.map(id => `${task.key}:${id}`))

/**
 * A verdict against its package: each criterion the package asked for exactly once (missing or
 * repeated ones refuse it), others kept. The recorded result is a pass only when the verdict says
 * pass and every asked criterion passed.
 */
export function judgeVerdict(verdict: Verdict, pack: RelayPackage): { problems: string[]; result: 'pass' | 'fail'; reasons: string[] } {
  const required = requiredCriteria(pack)
  const problems: string[] = []
  const reasons: string[] = []
  const missing = required.filter(id => !verdict.criteria.some(criterion => criterion.id === id))
  const repeated = required.filter(id => verdict.criteria.filter(criterion => criterion.id === id).length > 1)
  if (missing.length > 0) problems.push(`꾸러미 ${pack.id}가 묻는 기준이 판정에 없음: ${missing.join(', ')}`)
  if (repeated.length > 0) problems.push(`판정에 두 번 이상 나온 기준: ${repeated.join(', ')}`)
  const reviewed = new Set((verdict.reviewed_files ?? []).map(normalReviewed))
  const unread = (pack.files ?? []).filter(path => !reviewed.has(normalReviewed(path)))
  if (unread.length > 0) problems.push(`검토하지 않은 파일(reviewed_files에 없음): ${unread.join(', ')}`)
  for (const id of required) {
    const found = verdict.criteria.find(criterion => criterion.id === id)
    if (found !== undefined && found.result !== 'pass') reasons.push(`${id}: ${found.result}`)
  }
  if (verdict.result === 'fail') reasons.unshift('판정 자체가 fail')
  else if (reasons.length > 0) reasons.unshift('판정은 pass라고 했지만 통과하지 않은 기준이 있음')

  return { problems, result: reasons.length === 0 ? 'pass' : 'fail', reasons }
}

/**
 * Why a run may not finish yet, every reason at once: a task holding a worker or waiting, one never
 * launched, changes not committed, no verdict or one of another commit or a failed one, or a done
 * task its package did not hold (or done again after it).
 */
export function finishProblems(state: RelayState, head: string | undefined, tracked: readonly string[] | undefined): string[] {
  const reasons: string[] = []
  const open = state.tasks.filter(task => isBusy(task) || task.status === 'needs_context' || task.status === 'blocked')
  if (open.length > 0) reasons.push(`끝나지 않은 작업: ${open.map(task => `${taskKey(task)}(${statusLabel(task)})`).join(', ')}`)
  const unsent = state.tasks.filter(task => task.status === 'ready')
  if (unsent.length > 0) reasons.push(`띄우지 않은 작업: ${unsent.map(taskKey).join(', ')}. 띄우지 않을 것은 cancel로 정리하세요.`)
  if (tracked === undefined) reasons.push('git status를 읽지 못해 작업 트리를 확인하지 못했습니다.')
  else if (tracked.length > 0) reasons.push(`작업 트리에 커밋하지 않은 변경: ${tracked.join(', ')}`)
  const last = state.verdicts.at(-1)
  if (last === undefined) {
    reasons.push('판정이 없습니다: package → 다른 모델 검증 → verdict 뒤에 끝내세요.')

    return reasons
  }
  if (head === undefined || !sameCommit(last.commit, head)) reasons.push(`검증한 판과 지금 판이 다름: 다시 검증하세요(판정 ${last.id}는 ${last.commit.slice(0, 7)}, 지금 HEAD ${head?.slice(0, 7) ?? '미확인'}).`)
  if (last.result === 'fail') reasons.push(`마지막 판정 ${last.id}가 fail입니다${last.reasons === undefined || last.reasons.length === 0 ? '' : `(${last.reasons.join('; ')})`}.`)
  const pack = state.packages?.find(other => other.id === last.id)
  if (pack === undefined) {
    reasons.push(`판정 ${last.id}의 꾸러미 기록이 없습니다: 다시 package하세요.`)

    return reasons
  }
  if (head === undefined || !sameCommit(pack.head, head)) reasons.push(`꾸러미 ${pack.id}은 HEAD ${pack.head.slice(0, 7)}에서 만들었습니다: 지금 판으로 다시 package → 검증 → verdict 하세요.`)
  const uncovered = effectiveTasks(state.tasks)
    .filter(isDone)
    .filter(task => !pack.tasks.some(held => held.key === taskKey(task)) || (task.reportedAt ?? 0) > pack.at)
  if (uncovered.length > 0) reasons.push(`꾸러미 ${pack.id}에 없거나 그 뒤에 끝난 작업: ${uncovered.map(taskKey).join(', ')}. 다시 package → 검증 → verdict 하세요.`)

  return reasons
}

export function verifierInstructions(verdictPath: string, schemaPath: string, required: readonly { id: string; text: string }[] = []): string {
  return [
    '## Criteria to judge',
    '판정의 criteria에 아래 id를 그대로, 하나에 한 번씩 쓴다(빠지거나 겹치면 판정을 받지 않는다). 묶음의 Done when 같은 다른 항목은 다른 id로 더해도 된다.',
    ...required.map(criterion => `- ${criterion.id} — ${oneLine(criterion.text)}`),
    '',
    '## Instructions for the verifier',
    '- 반박하는 자세로 본다: 통과를 확인하려 하지 말고 결함을 찾아 근거를 댄다.',
    '- 위 기준마다 pass / fail / unverified를 매기고 증거를 단다: 돌린 명령과 종료 코드, 출력 몇 줄, 파일:줄. 하나라도 fail·unverified면 result는 fail이다.',
    '- 증거 없는 pass는 unverified다. 워커 보고의 pass는 증거가 아니다(relay 도구가 직접 돌린 Checks가 증거다).',
    '- 위 Files to review의 각 파일을 그 명령으로 열어 보고 reviewed_files에 적는다. 열지 않은 파일은 적지 않는다. 목록의 파일이 하나라도 빠지면 판정을 받지 않는다.',
    '- 취소는 코드를 되돌리지 않는다: 취소되거나 막힌 작업·판의 커밋도 HEAD에 남아 있으면 검토 대상이다(Other commits of this run 절 포함).',
    '- 스타일 지적은 빼고 동작·정확성·범위·테스트 약화만 본다.',
    '- 이 작업을 만든 워커와 같은 계열 모델이면 model 칸과 판정에 그렇게 적는다(교차 검증이 아님).',
    `- 판정은 ${schemaPath} 형식의 JSON으로 ${verdictPath}에 쓴다. 쓸 수 없으면 같은 JSON을 답으로 준다.`,
    '- commit 칸에는 본 HEAD의 전체 SHA를 적는다(위 HEAD 줄).',
  ].join('\n')
}
