import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checkTask, decisionRows, globsOverlap, isPending, isTestFile, parseReport, pathMatches, reportMismatches, withoutSections } from '../hooks/relay/relay-format'
import type { RelayState } from '../hooks/relay/relay-format'
import { registerRelayTool, reserveDispatch } from '../hooks/relay/relay'
import { callLine, resultView } from '../hooks/relay/relay-view'
import { standInForEngine, start } from './engine'

const ROOT = '/repo/work'
const TOOL = 'mcp__hubblerc__relay'
const HEAD_1 = 'a'.repeat(40)
const HEAD_2 = 'b'.repeat(40)
const SHA_A = '1'.repeat(40)
const SHA_B = '2'.repeat(40)
// 2026-11-09 at noon, local: the run's date does not depend on the machine's zone.
const NOON = new Date(2026, 10, 9, 12, 0).getTime()
const RUN = '2026-11-09-demo'
const DIR = `${ROOT}/.relay/runs/${RUN}`

/** A commit: its Task trailer, subject, files; its Run trailer (the demo run when absent); whether it descends from the base. */
type Commit = { task: string; subject: string; files: string[]; run?: string; offBase?: boolean; numstat?: 'fail' | string[] }
type Sim = {
  files: Record<string, string>
  head: string
  commits: Record<string, Commit>
  /** What `/bin/sh -c <command>` exits with and prints, by the command, and what running it changes. */
  commands: Record<string, { exitCode: number; stdout?: string; effect?: () => void }>
  ran: string[]
  /** What `git status --porcelain` prints ('' a clean tree; null: git status fails). */
  status: string | null
  /** Whether the run's `git log` of signed commits fails. */
  logFails?: boolean
}

/** A small FNV hash: what shasum stands in for when the environment has no digest. */
function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0

  return hash.toString(16).padStart(8, '0')
}

/** Stands for the engine beneath the plugin: files in memory, a repository with a few commits, a shell that answers by the command. */
function standIn(on: On): Sim {
  const sim: Sim = { files: {}, head: HEAD_1, commits: {}, commands: {}, ran: [], status: '' }
  const isDir = (path: string) => Object.keys(sim.files).some(file => file.startsWith(`${path}/`))
  on('session.id', () => ({ value: 'lead-session-1234' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: NOON }))
  on('fs.exists', (_, e) => ({ value: sim.files[e.path] !== undefined || isDir(e.path) }))
  on('fs.read', (_, e) => (sim.files[e.path] === undefined ? { deny: 'ENOENT' } : { value: sim.files[e.path] as never }))
  on('fs.write', (_, e) => {
    sim.files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const file of Object.keys(sim.files)) {
      if (!file.startsWith(`${e.path}/`)) continue
      const [name = '', ...rest] = file.slice(e.path.length + 1).split('/')
      names.set(name, rest.length > 0 ? 'dir' : 'file')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_, e) => ({ value: runIn(sim, e.argv, e.init?.stdin) }))

  return sim
}

/** What a command answers in the stand-in's shell and repository. */
function runIn(sim: Sim, argv: readonly string[], stdin = '') {
  const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  const last = argv.at(-1) ?? ''
  if (argv[0] === '/usr/bin/shasum') return out(`${fnv(stdin)}  -\n`)
  if (argv[0] === '/bin/sh' && argv[1] === '-c') {
    sim.ran.push(argv[2] ?? '')
    const answer = sim.commands[argv[2] ?? ''] ?? { exitCode: 127, stdout: 'not found' }
    answer.effect?.()

    return out(answer.stdout ?? '', answer.exitCode)
  }
  if (argv[0] !== 'git') return out('', 1)
  const commit = sim.commits[last]
  if (argv.includes('--show-toplevel')) return out(`${ROOT}\n`)
  if (argv[1] === 'rev-parse' && last === 'HEAD') return out(`${sim.head}\n`)
  if (argv[1] === 'cat-file') return commit === undefined ? out('', 128) : out('commit\n')
  if (argv[1] === 'status') return sim.status === null ? out('', 128) : out(sim.status)
  if (argv[1] === 'merge-base') return out('', commit?.offBase === true ? 1 : 0)
  // The run's signed commits since its base: sha, Task and Run trailers.
  if (argv[1] === 'log' && argv.some(arg => arg.includes('%x1f'))) {
    if (sim.logFails === true) return out('', 128)
    return out(Object.entries(sim.commits).map(([sha, found]) => `${sha}\x1f${found.task}\x1f${found.run ?? RUN}\n`).join(''))
  }
  if (argv[1] === 'log' && argv.some(arg => arg.includes('trailers:key=Task'))) return out(`${commit?.task ?? ''}\n`)
  if (argv[1] === 'log' && argv.includes('--format=%s')) return out(`${commit?.subject ?? ''}\n`)
  // Three lines added and one removed in each file the commit changed.
  if (argv[1] === 'show' && argv.includes('--numstat')) {
    if (commit?.numstat === 'fail') return out('', 128)

    return out((commit?.numstat ?? commit?.files ?? []).map(file => `3\t1\t${file}\n`).join(''))
  }
  if (argv[1] === 'show' && argv.includes('--name-only')) return out(`${(commit?.files ?? []).join('\n')}\n`)
  // A whole diff: the package must not carry it.
  if (argv[1] === 'show') return out(`commit ${last}\n\ndiff --git a/x b/x\n+DIFF-BODY\n`)

  return out('', 1)
}

/**
 * The engine as a hooks module sees it, over the same stand-in: for a function the plugin exports
 * to its other hooks (the test's own `$` reaches no files).
 */
function engineOver(sim: Sim) {
  const isDir = (path: string) => Object.keys(sim.files).some(file => file.startsWith(`${path}/`))

  return {
    clock: { now: async () => NOON },
    session: { id: async () => 'lead-session-1234' },
    fs: {
      exists: async (path: string) => sim.files[path] !== undefined || isDir(path),
      read: async (path: string) => {
        const found = sim.files[path]
        if (found === undefined) throw new Error('ENOENT')

        return found
      },
      write: async (path: string, text: string) => {
        sim.files[path] = text
      },
      list: async () => [],
    },
    process: { run: async (argv: readonly string[], init?: { stdin?: string }) => runIn(sim, argv, init?.stdin) },
  } as never
}

async function relay($: Engine, input: Record<string, unknown>): Promise<{ result?: string; deny?: string }> {
  const answer = (await $.tool.call({ tool: TOOL, ...input } as never)) as { result?: unknown; deny?: string }

  return { result: typeof answer.result === 'string' ? answer.result : undefined, deny: answer.deny }
}

const state = (sim: Sim): RelayState => JSON.parse(sim.files[`${DIR}/state.json`] ?? '{}') as RelayState

const TASK_A = {
  action: 'task',
  run: RUN,
  id: 'A',
  title: 'Add the tool',
  goal: 'Register the tool.',
  model: 'claude-opus-5-5',
  effort: 'high',
  edit_scope: ['hooks/relay/**', 'tests/relay.test.tsx'],
  reads: ['docs/spec.md'],
  done_when: [{ text: 'tests pass', command: 'make test' }, { text: 'reads well' }],
  runner_kind: 'claude',
}

function report(fields: { status?: string; commits?: string; criteria?: string[]; concerns?: string; extra?: string } = {}): string {
  return [
    '# Report A-r1',
    `- Status: ${fields.status ?? 'DONE'}`,
    `- Change: ${fields.commits === 'none' ? 'no_change' : 'committed'}`,
    `- Commits: ${fields.commits ?? SHA_A}`,
    '- Model / effort: claude-opus-5-5 / high',
    '- Found at start: none',
    '## Criteria',
    ...(fields.criteria ?? ['- C1: pass · tries 1 · make test exit 0', '- C2: pass · tries 0 · read it']),
    ...(fields.concerns === undefined ? [] : ['## Concerns', fields.concerns]),
    '## Test changes',
    'none',
    '## For whoever picks up',
    '- Tools: SECRET-HANDOVER-NOTE',
    '- Tried and dropped: none',
    fields.extra ?? '',
  ].join('\n')
}

/** A verdict's criteria passing task A-r1's two. */
const PASSED = [
  { id: 'A-r1:C1', result: 'pass', evidence: 'make test → 0' },
  { id: 'A-r1:C2', result: 'pass', evidence: 'read relay.ts:10' },
]

async function begin($: Engine, sim: Sim): Promise<void> {
  const started = await relay($, { action: 'start', name: 'demo', goal: 'Ship relay.', done_when: ['all checks pass'] })
  expect(started.deny).toBeUndefined()
  void sim
}

/** Task A written, dispatched, reported DONE with its one commit. */
async function doneA($: Engine, sim: Sim, files = ['hooks/relay/relay.ts']): Promise<void> {
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent worker-a' })
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Add the relay tool', files }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report()
  expect((await relay($, { action: 'report', run: RUN, task: 'A' })).deny).toBeUndefined()
}

// ── Pure ──────────────────────────────────────────────

test('globs overlap when one fixed part is a prefix of the other', () => {
  expect(globsOverlap('a/**', 'a/b.ts')).toBe(true)
  expect(globsOverlap('a/**', 'b/**')).toBe(false)
  expect(globsOverlap('a/b.ts', 'a/b.ts')).toBe(true)
  expect(globsOverlap('a/b.ts', 'a/c.ts')).toBe(false)
  expect(globsOverlap('./a/x/**', 'a/x/y/z.ts')).toBe(true)
  expect(globsOverlap('**', 'anything.ts')).toBe(true)
  // Coarse on purpose (one * never crosses a folder): a wider overlap orders two tasks, a missed one lets them write the same file.
  expect(globsOverlap('a/*.ts', 'a/b/c.ts')).toBe(true)
})

test('a path falls under a glob or under a plain folder', () => {
  expect(pathMatches('hooks/relay/relay.ts', 'hooks/relay/**')).toBe(true)
  expect(pathMatches('hooks/relay/deep/x.ts', 'hooks/relay/**')).toBe(true)
  expect(pathMatches('hooks/other.ts', 'hooks/relay/**')).toBe(false)
  expect(pathMatches('hooks/relay/x.ts', 'hooks/relay')).toBe(true)
  expect(pathMatches('hooks/a.ts', 'hooks/*.ts')).toBe(true)
  expect(pathMatches('hooks/sub/a.ts', 'hooks/*.ts')).toBe(false)
  expect(pathMatches('docs/a.md', 'docs/{a,b}.md')).toBe(true)
})

test('test and check files are told apart', () => {
  expect(isTestFile('plugins/x/tests/a.ts')).toBe(true)
  expect(isTestFile('src/__tests__/a.ts')).toBe(true)
  expect(isTestFile('src/a.test.tsx')).toBe(true)
  expect(isTestFile('src/a.spec.ts')).toBe(true)
  expect(isTestFile('src/latest.ts')).toBe(false)
})

test('V1-06 checkTask refuses an overlap with a running or launching task, another revision of the same task included; the entry itself is left out', () => {
  const base: RelayState = { version: 1, run: RUN, goal: '', doneWhen: [], base: '', lead: '', status: 'active', createdAt: 0, tasks: [], verdicts: [] }
  const running = { id: 'A', rev: 1, title: '', runner: 'x', model: 'm', effort: 'e', editScope: ['a/**'], reads: ['r.md'], targets: ['server-1'], criteria: [], status: 'running' as const, specPath: `${DIR}/tasks/A-r1.md`, specHash: '', dispatchedAt: 0, reportedAt: null, tries: {} }
  const state = { ...base, tasks: [running] }
  const input = { id: 'B', model: 'm', effort: 'e', editScope: ['b/**'], reads: [], targets: [], readFirst: [], criteria: [{ id: 'C1', text: 't' }] }
  expect(checkTask(state, input).denials).toEqual([])
  expect(checkTask(state, { ...input, editScope: ['r.md'] }).denials[0]).toMatch(/그 reads/)
  expect(checkTask(state, { ...input, targets: ['server-1'] }).denials[0]).toMatch(/external target server-1/)
  // A new revision of a running task overlaps it; the running entry checked against itself does not.
  expect(checkTask(state, { ...input, id: 'A', editScope: ['a/x.ts'] }).denials[0]).toMatch(/돌고 있는 A-r1와 겹칩니다/)
  expect(checkTask(state, { ...input, id: 'A', rev: 1, editScope: ['a/x.ts'] }).denials).toEqual([])
  const launching = { ...state, tasks: [{ ...running, status: 'launching' as const }] }
  expect(checkTask(launching, { ...input, editScope: ['a/y.ts'] }).denials[0]).toMatch(/돌고 있는 A-r1/)
})

test('a report is read leniently and checked against its brief', () => {
  const parsed = parseReport(report({ status: 'DONE_WITH_CONCERNS', criteria: ['- C1: pass · tries 2 · ok', '- C1: fail · tries 2 · again'] }))
  expect(parsed.status).toBe('DONE_WITH_CONCERNS')
  expect(parsed.commits).toEqual([SHA_A])
  expect(reportMismatches(parsed, [{ id: 'C1', text: '' }, { id: 'C2', text: '' }])).toEqual([
    'Criteria에 없는 기준: C2',
    'Criteria에 두 번 이상 나온 기준: C1',
    'DONE_WITH_CONCERNS인데 통과하지 않은 기준: C1(fail)',
    'DONE_WITH_CONCERNS인데 Concerns가 비었음',
  ])
})

test('sections inside a fence are not cut', () => {
  const text = '# T\n## Goal\ng\n## Report format\n```markdown\n## Criteria\n- C1\n```\n## After\nkept'
  expect(withoutSections(text, ['Report format'])).toBe('# T\n## Goal\ng\n## After\nkept')
})

test('the decisions table is read leniently: blank lines and the rule row skipped, escaped pipes kept', () => {
  const progress = [
    '## Decisions (append; only Status changes)',
    '| ID | Decision | Why | Cost if wrong | By | Status |',
    '|---|---|---|---|---|---|',
    '| D1 | use a \\| b | fast | small | lead | decided |',
    '',
    '| D2 | push now | asked by user | high | user | asked |',
    '|D3|wait|unclear|medium|lead|On hold|',
    '## Tasks',
    '| T1 | x | y | asked |',
  ].join('\n')
  const rows = decisionRows(progress)
  expect(rows.map(row => row.id)).toEqual(['D1', 'D2', 'D3'])
  expect(rows[0]?.decision).toBe('use a | b')
  expect(rows.filter(isPending).map(row => row.id)).toEqual(['D2', 'D3'])
})

// ── The tool ──────────────────────────────────────────────

test('the tool is registered at session start', async ($, on) => {
  const engine = standInForEngine(on)
  await start($)
  const tool = engine.tools.find(found => found.name === 'relay')
  expect(tool?.description).toMatch(/hubblerc:relay/)
  expect((tool?.description.length ?? 0) < 400).toBe(true)
})

test('start makes the folder, its .gitignore, progress, state and the verdict schema; the same run twice is refused', async ($, on) => {
  const sim = standIn(on)
  const started = await relay($, { action: 'start', name: 'demo', goal: 'Ship relay.', done_when: ['all checks pass', 'docs updated'] })
  expect(started.result).toContain(`묶음을 시작했습니다: ${RUN}`)
  expect(started.result).toContain(`폴더: ${DIR}`)
  expect(sim.files[`${DIR}/.gitignore`]).toBe('*\n')
  expect(sim.files[`${DIR}/progress.md`]).toContain('# Progress: 2026-11-09-demo')
  expect(sim.files[`${DIR}/progress.md`]).toContain('- Done when: all checks pass; docs updated')
  expect(sim.files[`${DIR}/progress.md`]).toContain('- Base: aaaaaaa')
  expect(sim.files[`${DIR}/progress.md`]).toContain('<!-- relay:tasks:start -->')
  expect(state(sim)).toMatchObject({ version: 1, run: RUN, base: HEAD_1, lead: 'lead-session-1234', status: 'active', tasks: [], verdicts: [] })
  expect(JSON.parse(sim.files[`${DIR}/reviews/verdict.schema.json`] ?? '{}').required).toEqual(['commit', 'result', 'model', 'criteria', 'findings', 'reviewed_files'])

  expect((await relay($, { action: 'start', name: 'demo', goal: 'Again', done_when: ['x'] })).deny).toMatch(/같은 묶음이 이미 있습니다/)
  expect((await relay($, { action: 'start', name: 'Bad Name', goal: 'x', done_when: ['x'] })).deny).toMatch(/소문자/)
  expect((await relay($, { action: 'list' })).result).toContain(`- ${RUN} · 목표: Ship relay. · 작업 0개`)
})

test('task writes the brief with its head lines, criteria, rules and trailers, and registers it ready', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  sim.head = HEAD_2
  const written = await relay($, TASK_A)
  expect(written.result).toContain(`지시서: ${DIR}/tasks/A-r1.md`)
  expect(written.result).toContain('--spec-file')
  const brief = sim.files[`${DIR}/tasks/A-r1.md`] ?? ''
  expect(brief).toContain('# Task A-r1: Add the tool')
  // The base of a brief is HEAD now, after the earlier tasks' commits.
  expect(brief).toContain(`- Base: ${HEAD_2}`)
  expect(brief).toContain('- Model / effort: claude-opus-5-5 / high')
  expect(brief).toContain(`- Report to: ${DIR}/tasks/A-r1-report.md`)
  expect(brief).toContain('- C1: tests pass · `make test` → exit 0')
  expect(brief).toContain('- C2: reads well')
  expect(brief).toContain("--trailer 'Task: A-r1' --trailer 'Run: 2026-11-09-demo'")
  expect(brief).not.toContain('Agent: codex')
  expect(brief).toContain('9. 보고서 형식은')
  expect(brief).toContain('- C1: pass|fail|unverified · tries N')
  expect(state(sim).tasks[0]).toMatchObject({ id: 'A', rev: 1, status: 'ready', runner: null, editScope: ['hooks/relay/**', 'tests/relay.test.tsx'] })
  expect(sim.files[`${DIR}/progress.md`]).toContain('| A-r1 | Add the tool | - | ready |')

  await relay($, { ...TASK_A, id: 'K', edit_scope: ['other/**'], runner_kind: 'codex' })
  expect(sim.files[`${DIR}/tasks/K-r1.md`]).toContain(
    "--trailer 'Agent: codex' --trailer 'Session: lead-session-1234' --trailer 'Model: claude-opus-5-5' --trailer 'Effort: high' --trailer 'Task: K-r1' --trailer 'Run: 2026-11-09-demo'",
  )
})

test('task refuses an empty model, a repeated criterion id, and files a running task edits', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  expect((await relay($, { ...TASK_A, model: '' })).deny).toMatch(/model이 비었습니다/)
  expect((await relay($, { ...TASK_A, done_when: [] })).deny).toMatch(/done_when이 비었습니다/)
  expect((await relay($, { ...TASK_A, done_when: [{ id: 'C1', text: 'a' }, { id: 'C1', text: 'b' }] })).deny).toMatch(/기준 ID가 겹칩니다: C1/)

  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'orca dispatch:ctx_1' })
  expect(state(sim).tasks[0]).toMatchObject({ status: 'running', runner: 'orca dispatch:ctx_1', dispatchedAt: NOON })

  const sameFiles = await relay($, { ...TASK_A, id: 'B', edit_scope: ['hooks/relay/relay.ts'], reads: [] })
  expect(sameFiles.deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect(sameFiles.deny).toContain('순서대로 돌리세요: 앞 작업 A-r1가 끝난 뒤 그 커밋을 Base로')
  const readsTheirs = await relay($, { ...TASK_A, id: 'B', edit_scope: ['docs/other.md'], reads: ['hooks/relay/relay-format.ts'] })
  expect(readsTheirs.deny).toMatch(/내 reads ↔ 그 edit_scope/)
  const editsTheirReads = await relay($, { ...TASK_A, id: 'B', edit_scope: ['docs/spec.md'], reads: [] })
  expect(editsTheirReads.deny).toMatch(/내 edit_scope ↔ 그 reads/)
  expect((await relay($, { ...TASK_A, id: 'B', edit_scope: ['docs/other.md'], reads: [] })).deny).toBeUndefined()
})

test('the same id again is a new revision: an r2 file, the tries carried on, the r1 brief left as sent', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent worker-a' })
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Try', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ status: 'BLOCKED', criteria: ['- C1: fail · tries 3 · still red', '- C2: unverified · tries 1 · -'] })
  expect((await relay($, { action: 'report', run: RUN, task: 'A' })).result).toContain('보고 BLOCKED → 상태 blocked')
  const r1 = sim.files[`${DIR}/tasks/A-r1.md`]

  const again = await relay($, { ...TASK_A, title: 'Add the tool, second try' })
  expect(again.result).toContain(`지시서: ${DIR}/tasks/A-r2.md`)
  expect(again.result).toContain('앞 판을 취소로 바꿨습니다: A-r1')
  expect(sim.files[`${DIR}/tasks/A-r1.md`]).toBe(r1)
  expect(sim.files[`${DIR}/tasks/A-r2.md`]).toContain('# Task A-r2: Add the tool, second try')
  const [first, second] = state(sim).tasks
  expect(first).toMatchObject({ rev: 1, status: 'cancelled' })
  expect(second).toMatchObject({ rev: 2, status: 'ready', tries: { C1: 3, C2: 1 } })

  // A report that counts its tries down is warned about.
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent worker-a' })
  sim.commits[SHA_B] = { task: 'A-r2', subject: 'Fix', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r2-report.md`] = report({ commits: SHA_B, criteria: ['- C1: pass · tries 1 · ok', '- C2: pass · tries 1 · ok'] })
  expect((await relay($, { action: 'report', run: RUN, task: 'A-r2' })).result).toContain('C1의 tries가 3에서 1로 줄었습니다')
})

test('an earlier done task on the same files warns until its report is read first', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  const follow = { ...TASK_A, id: 'B', edit_scope: ['hooks/relay/relay.ts'], reads: [] }
  expect((await relay($, follow)).result).toContain(`후임 지시서의 read_first에 앞 보고서 ${DIR}/tasks/A-r1-report.md를 넣으세요`)
  const withReport = await relay($, { ...follow, id: 'C', read_first: [`${DIR}/tasks/A-r1-report.md`] })
  expect(withReport.result).not.toContain('read_first에 앞 보고서')
})

test('a DONE report with a failed criterion is a mismatch, and the task is blocked', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Add', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ criteria: ['- C1: fail · tries 1 · red', '- C2: pass · tries 0 · ok'] })
  const checked = await relay($, { action: 'report', run: RUN, task: 'A' })
  expect(checked.result).toContain('보고 DONE → 상태 blocked')
  expect(checked.result).toContain('보고서 불일치')
  expect(checked.result).toContain('DONE인데 통과하지 않은 기준: C1(fail)')
  expect(state(sim).tasks[0]?.status).toBe('blocked')
  expect((await relay($, { action: 'report', run: RUN, task: 'Z' })).deny).toBe('작업이 없습니다: Z')
})

test('a report lists the files its own commits changed outside the edit scope, the test files, and an unsigned commit', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Add', files: ['hooks/relay/relay.ts', 'hooks/register.tsx', 'tests/relay.test.tsx'] }
  sim.commits[SHA_B] = { task: '', subject: 'Other', files: ['hooks/relay/relay-format.ts'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ commits: `${SHA_A}, ${SHA_B}` })
  const checked = await relay($, { action: 'report', run: RUN, task: 'A' })
  expect(checked.result).toContain('보고 DONE → 상태 done')
  expect(checked.result).toContain('범위 밖 파일: hooks/register.tsx')
  expect(checked.result).toContain('테스트·검사 파일 변경: tests/relay.test.tsx')
  expect(checked.result).toContain(`꼬리말 Task: A-r1가 없는 커밋: ${SHA_B}`)

  // A commit that is not there is a mismatch.
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ commits: '3'.repeat(40) })
  expect((await relay($, { action: 'report', run: RUN, task: 'A' })).result).toContain(`없는 커밋: ${'3'.repeat(40)}`)
})

test('check runs each command itself and judges by its exit code; a criterion with none is unverified', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, { ...TASK_A, done_when: [{ text: 'tests pass', command: 'make test' }, { text: 'lint', command: 'make lint', expect_exit: 0 }, { text: 'looks right' }] })
  sim.commands['make test'] = { exitCode: 0, stdout: 'ok\n' }
  sim.commands['make lint'] = { exitCode: 2, stdout: `${Array.from({ length: 30 }, (_, at) => `line ${at + 1}`).join('\n')}\n` }
  const checked = await relay($, { action: 'check', run: RUN, task: 'A' })
  expect(sim.ran).toEqual(['make test', 'make lint'])
  expect(checked.result).toContain(`${DIR}/tasks/A-r1-checks.md`)
  expect(checked.result).toContain('- C1: pass · exit 0(기대 0)')
  expect(checked.result).toContain('- C2: fail · exit 2(기대 0)')
  expect(checked.result).toContain('- C3: unverified · 명령 없음: 검증자·사용자 확인')
  const file = sim.files[`${DIR}/tasks/A-r1-checks.md`] ?? ''
  expect(file).toContain('- Summary: pass 1 · fail 1 · unverified 1')
  // The output's last 20 lines only.
  expect(file).toContain('line 30')
  expect(file).toContain('line 11')
  expect(file).not.toContain('line 10\n')
})

test('package leaves out the rules and the hand-over notes, and carries the checks and the diffs', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  sim.commands['make test'] = { exitCode: 0 }
  await relay($, { action: 'check', run: RUN, task: 'A' })
  const packed = await relay($, { action: 'package', run: RUN })
  expect(packed.result).toContain(`검증 꾸러미 V1: ${DIR}/reviews/V1-package.md`)
  expect(packed.result).toContain(`판정 파일: ${DIR}/reviews/V1-verdict.json`)
  const text = sim.files[`${DIR}/reviews/V1-package.md`] ?? ''
  expect(text).toContain(`- HEAD: ${HEAD_1}`)
  expect(text).toContain('## Task A-r1: Add the tool')
  expect(text).toContain('- C1: tests pass')
  expect(text).not.toContain('SECRET-HANDOVER-NOTE')
  expect(text).not.toContain('For whoever picks up')
  expect(text).not.toContain('## Rules')
  expect(text).not.toContain('## Report format')
  expect(text).not.toContain('Status: DONE | DONE_WITH_CONCERNS')
  expect(text).toContain('Summary: pass 1')
  expect(text).toContain(`- ${SHA_A} Add the relay tool`)
  expect(text).toContain('## Files to review')
  expect(text).toContain('반박하는 자세')
  expect(text).toContain(`${DIR}/reviews/verdict.schema.json`)
})

test('finish refuses while the verdict saw another commit, and closes the run with the decisions once it matches', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  expect((await relay($, { action: 'finish', run: RUN })).deny).toMatch(/판정이 없습니다/)

  await relay($, { action: 'package', run: RUN })
  const verdict = { commit: HEAD_1, result: 'pass', model: 'gpt-5.5-codex', criteria: PASSED, findings: [], reviewed_files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify(verdict)
  sim.head = HEAD_2
  expect((await relay($, { action: 'verdict', run: RUN, id: 'V1' })).result).toContain('검증한 판과 지금 판이 다름')
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('검증한 판과 지금 판이 다름: 다시 검증하세요')
  expect(state(sim).status).toBe('active')

  // A verdict claiming the new HEAD on a package made at the old one does not close the run either.
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({ ...verdict, commit: HEAD_2 })
  expect((await relay($, { action: 'verdict', run: RUN, id: 'V1' })).result).toContain('꾸러미 V1의 HEAD')
  expect((await relay($, { action: 'finish', run: RUN })).deny).toContain('꾸러미 V1은 HEAD aaaaaaa에서 만들었습니다')
  expect((await relay($, { action: 'package', run: RUN })).result).toContain('검증 꾸러미 V2')

  sim.files[`${DIR}/progress.md`] = (sim.files[`${DIR}/progress.md`] ?? '').replace(
    '|---|---|---|---|---|---|\n',
    '|---|---|---|---|---|---|\n| D1 | keep one file | simpler | low | lead | decided |\n| D2 | push | needs consent | high | user | asked |\n',
  )
  sim.files[`${DIR}/reviews/V2-verdict.json`] = JSON.stringify({ ...verdict, commit: HEAD_2 })
  await relay($, { action: 'verdict', run: RUN, id: 'V2' })
  const finished = await relay($, { action: 'finish', run: RUN })
  expect(finished.deny).toBeUndefined()
  expect(finished.result).toContain('묶음을 끝냈습니다')
  expect(finished.result).toContain('- D2 · push · user · asked')
  expect(finished.result).toContain('- D1 · keep one file — simpler — 틀렸을 때: low')
  expect(state(sim).status).toBe('finished')
  expect((await relay($, { action: 'list' })).result).toContain('진행 중인 묶음이 없습니다')
})

test('finish refuses a running task and a failed verdict, all reasons at once', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  await relay($, { action: 'package', run: RUN })
  await relay($, { ...TASK_A, id: 'B', edit_scope: ['docs/**'], reads: [] })
  await relay($, { action: 'dispatched', run: RUN, task: 'B', runner: 'subagent b' })
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({ commit: HEAD_1, result: 'fail', model: 'm', criteria: PASSED, findings: [{ severity: 'high', file: 'a.ts', line: 3, issue: 'x', evidence: 'y' }], reviewed_files: ['hooks/relay/relay.ts'] })
  await relay($, { action: 'verdict', run: RUN, id: 'V1' })
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('끝나지 않은 작업: B-r1(running)')
  expect(refused.deny).toContain('마지막 판정 V1가 fail입니다')
})

test('a verdict of the wrong form is refused with what is wrong', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  await relay($, { action: 'package', run: RUN })
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({ commit: HEAD_1, result: 'ok', model: 'm', criteria: [{ id: 'C1' }], findings: [] })
  const refused = await relay($, { action: 'verdict', run: RUN, id: 'V1' })
  expect(refused.deny).toContain("result가 'pass' 또는 'fail'이 아님")
  expect(refused.deny).toContain('criteria[0]')
  expect(refused.deny).toContain('reviewed_files가 문자열 배열이 아님')
})

test('pending lists the decisions asked or on hold', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  expect((await relay($, { action: 'pending', run: RUN })).result).toContain('기다리는 결정(asked·on hold)이 없습니다')
  sim.files[`${DIR}/progress.md`] = (sim.files[`${DIR}/progress.md`] ?? '').replace(
    '|---|---|---|---|---|---|\n',
    '|---|---|---|---|---|---|\n| D1 | a | b | c | lead | decided |\n| D2 | deploy | d | e | user | asked |\n| D3 | rename | f | g | lead | on hold |\n',
  )
  const pending = await relay($, { action: 'pending', run: RUN })
  expect(pending.result).toContain('기다리는 결정 2개')
  expect(pending.result).toContain('- D2 · deploy · user · asked')
  expect(pending.result).toContain('- D3 · rename · lead · on hold')
  expect(pending.result).not.toContain('D1')
})

test('V1-05b dispatched by hand on a brief changed after task wrote it leaves the task blocked, with why; the Tasks block gone is warned, not redrawn', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { ...TASK_A, id: 'B', edit_scope: ['other/**'], reads: [] })
  sim.files[`${DIR}/tasks/A-r1.md`] += '\nedited by hand\n'
  const sent = await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent a' })
  expect(sent.deny).toContain('A-r1를 blocked로 두었습니다(띄운 뒤 막힘: 지시서가 바뀜 — 워커를 멈추고 cancel(confirmed_stopped)): A-r1의 지시서가 task로 쓴 뒤에 바뀌었습니다')
  expect(state(sim).tasks[0]).toMatchObject({ status: 'blocked', runner: 'subagent a' })
  expect(state(sim).tasks[0]?.blockReason).toContain('task로 쓴 뒤에 바뀌었습니다')
  expect(sim.files[`${DIR}/tasks/A-r1.dispatched.md`]).toBeUndefined()

  sim.files[`${DIR}/progress.md`] = '# Progress\n'
  expect((await relay($, { action: 'dispatched', run: RUN, task: 'B', runner: 'subagent b' })).result).toContain('Tasks 표시')
  expect(sim.files[`${DIR}/progress.md`]).toBe('# Progress\n')
})

test('spec_text answers a light brief and writes no file', async ($, on) => {
  const sim = standIn(on)
  const { action: _, run: __, ...fields } = TASK_A
  const light = await relay($, { action: 'spec_text', ...fields })
  expect(light.result).toContain('# Task A: Add the tool')
  expect(light.result).not.toContain('Report to')
  expect(light.result).not.toContain('Task: A')
  expect(light.result).toContain('보고는 답으로 한다: 15줄 안팎')
  expect(Object.keys(sim.files)).toEqual([])
})

// ── Verdict V1's findings, each reproduced ──────────────────────────────────────────────

/** Writes V<n>'s verdict file, having read every file its package lists unless told otherwise, and records it. */
async function verdictOf($: Engine, sim: Sim, id: string, criteria: unknown[], result = 'pass', commit = HEAD_1, reviewed?: string[]) {
  const listed = state(sim).packages?.find(pack => pack.id === id)?.files ?? []
  sim.files[`${DIR}/reviews/${id}-verdict.json`] = JSON.stringify({ commit, result, model: 'gpt-5.5-codex', criteria, findings: [], reviewed_files: reviewed ?? listed })

  return relay($, { action: 'verdict', run: RUN, id })
}

test('V1-01 a verdict is taken only for a package, and must judge each criterion it asked for exactly once', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  expect((await verdictOf($, sim, 'V1', PASSED)).deny).toContain('꾸러미 V1의 기록이 없습니다')

  await relay($, { action: 'package', run: RUN })
  const text = sim.files[`${DIR}/reviews/V1-package.md`] ?? ''
  expect(text).toContain('- A-r1:C1 — tests pass')
  expect(text).toContain('- A-r1:C2 — reads well')
  expect(state(sim).packages).toEqual([{ id: 'V1', at: NOON, head: HEAD_1, tasks: [{ key: 'A-r1', criteria: ['C1', 'C2'] }], files: ['hooks/relay/relay.ts'] }])

  expect((await verdictOf($, sim, 'V1', [])).deny).toContain('꾸러미 V1가 묻는 기준이 판정에 없음: A-r1:C1, A-r1:C2')
  expect((await verdictOf($, sim, 'V1', [...PASSED, PASSED[0]])).deny).toContain('판정에 두 번 이상 나온 기준: A-r1:C1')
  expect(state(sim).verdicts).toEqual([])
})

test('V1-01 a criterion failed or unverified records the verdict as fail whatever its own result, and finish refuses it', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  await relay($, { action: 'package', run: RUN })
  for (const result of ['fail', 'unverified']) {
    const judged = await verdictOf($, sim, 'V1', [{ id: 'A-r1:C1', result, evidence: 'exit 1' }, PASSED[1], { id: 'run:1', result: 'pass', evidence: 'extra' }])
    expect(judged.result).toContain('판정 V1: 기록 fail (판정 파일의 result pass)')
    expect(judged.result).toContain(`A-r1:C1: ${result}`)
    expect(state(sim).verdicts[0]).toMatchObject({ id: 'V1', result: 'fail' })
    const refused = await relay($, { action: 'finish', run: RUN })
    expect(refused.deny).toContain('마지막 판정 V1가 fail입니다')
    expect(state(sim).status).toBe('active')
  }
  // Every asked criterion passing, an extra one kept: a pass.
  expect((await verdictOf($, sim, 'V1', [...PASSED, { id: 'run:1', result: 'unverified', evidence: '-' }])).result).toContain('기록 pass')
  expect((await relay($, { action: 'finish', run: RUN })).result).toContain('묶음을 끝냈습니다')
})

test('V1-02 finish refuses a revision never launched; cancel clears it, with its reason kept', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  await relay($, { action: 'package', run: RUN })
  await verdictOf($, sim, 'V1', PASSED)
  await relay($, { ...TASK_A, done_when: [{ text: 'a new requirement' }] })
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('띄우지 않은 작업: A-r2')
  expect(state(sim).status).toBe('active')

  expect((await relay($, { action: 'cancel', run: RUN, task: 'A-r2' })).deny).toMatch(/reason이 비었습니다/)
  expect((await relay($, { action: 'cancel', run: RUN, task: 'A-r1', reason: 'x' })).deny).toMatch(/끝난 작업/)
  expect((await relay($, { action: 'cancel', run: RUN, task: 'A-r2', reason: '요구가 바뀜' })).result).toContain('A-r2: ready → cancelled · 요구가 바뀜')
  expect(state(sim).tasks[1]).toMatchObject({ status: 'cancelled', cancelReason: '요구가 바뀜' })
  expect((await relay($, { action: 'finish', run: RUN })).result).toContain('묶음을 끝냈습니다')
})

test('V1-02 a running task is cancelled only once its worker is confirmed stopped', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent a' })
  expect((await relay($, { action: 'cancel', run: RUN, task: 'A', reason: 'stuck' })).deny).toContain('confirmed_stopped: true')
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect((await relay($, { action: 'cancel', run: RUN, task: 'A', reason: 'stuck', confirmed_stopped: true })).result).toContain('running → cancelled')
  expect(state(sim).tasks[0]?.cancelReason).toBe('stuck (워커 멈춤 확인됨)')
})

test('V1-02 finish refuses a done task its last package did not hold, or one done again after it', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  await relay($, { ...TASK_A, id: 'B', edit_scope: ['other/**'], reads: [] })
  await relay($, { action: 'package', run: RUN, tasks: ['A'] })
  await verdictOf($, sim, 'V1', PASSED)
  await relay($, { action: 'dispatched', run: RUN, task: 'B', runner: 'subagent b' })
  sim.commits[SHA_B] = { task: 'B-r1', subject: 'B', files: ['other/b.ts'] }
  sim.files[`${DIR}/tasks/B-r1-report.md`] = report({ commits: SHA_B }).replace('# Report A-r1', '# Report B-r1')
  await relay($, { action: 'report', run: RUN, task: 'B' })
  expect((await relay($, { action: 'finish', run: RUN })).deny).toContain('꾸러미 V1에 없거나 그 뒤에 끝난 작업: B-r1')

  // By default a package holds every done task.
  expect((await relay($, { action: 'package', run: RUN })).result).toContain('담은 작업: A-r1, B-r1')
})

test('V1-03 DONE with uncommitted work is a mismatch, and the task is blocked', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ commits: 'none' }).replace('- Change: no_change', '- Change: uncommitted')
  const checked = await relay($, { action: 'report', run: RUN, task: 'A' })
  expect(checked.result).toContain('보고 DONE → 상태 blocked')
  expect(checked.result).toContain('DONE인데 Change가 uncommitted')
})

test('V1-03 check marks a criterion unverified on a tree with tracked changes, or when HEAD moves while it runs', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, { ...TASK_A, done_when: [{ text: 'tests', command: 'make test' }, { text: 'lint', command: 'make lint' }] })
  sim.commands['make test'] = { exitCode: 0 }
  sim.commands['make lint'] = { exitCode: 0 }
  sim.status = ' M hooks/relay/relay.ts\n?? notes.txt\n'
  const dirty = await relay($, { action: 'check', run: RUN, task: 'A' })
  expect(dirty.result).toContain('작업 트리: 커밋하지 않은 변경·git이 모르는 파일 hooks/relay/relay.ts, notes.txt (git이 모름)')
  expect(dirty.result).toContain('- C1: unverified · exit 0(기대 0) · 0 ms · 실행 전 커밋하지 않은 변경·git이 모르는 파일: hooks/relay/relay.ts')
  expect(sim.files[`${DIR}/tasks/A-r1-checks.md`]).toContain('Summary: pass 0 · fail 0 · unverified 2')

  // A clean tree: a pass. HEAD moved by the first command spoils both.
  sim.status = ''
  expect((await relay($, { action: 'check', run: RUN, task: 'A' })).result).toContain('- C1: pass')
  sim.commands['make test'] = { exitCode: 0, effect: () => (sim.head = HEAD_2) }
  const moved = await relay($, { action: 'check', run: RUN, task: 'A' })
  expect(moved.result).toContain('- C1: unverified · exit 0(기대 0) · 0 ms · 실행 중 HEAD가 바뀜(aaaaaaa → bbbbbbb)')
  expect(moved.result).toContain('- C2: unverified')
})

test('V1-03 package and finish refuse a tree with tracked changes not committed', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  await relay($, { action: 'package', run: RUN })
  await verdictOf($, sim, 'V1', PASSED)
  sim.status = ' M src/worker.ts\n'
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain('작업 트리에 커밋하지 않은 변경·git이 모르는 파일이 있습니다: src/worker.ts')
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('작업 트리에 커밋하지 않은 변경: src/worker.ts')
  sim.status = null
  expect((await relay($, { action: 'finish', run: RUN })).deny).toContain('git status를 읽지 못해')
  sim.status = ''
  expect((await relay($, { action: 'finish', run: RUN })).result).toContain('묶음을 끝냈습니다')
})

test('V1-04 the package carries the commits of every revision, their scope and test changes, the unreported ones and those off the base', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  const old = '4'.repeat(40)
  const newer = '5'.repeat(40)
  const silent = '6'.repeat(40)
  const stray = '7'.repeat(40)
  sim.commits[old] = { task: 'A-r1', subject: 'Weaken a test', files: ['tests/weakened.test.ts'] }
  sim.commits[newer] = { task: 'A-r2', subject: 'Fix', files: ['hooks/relay/fix.ts'], offBase: true }
  sim.commits[silent] = { task: 'A-r2', subject: 'Unreported', files: ['hooks/relay/quiet.ts'] }
  sim.commits[stray] = { task: 'A-r2', subject: 'Another run', files: ['x.ts'], run: '2026-11-09-other' }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ status: 'BLOCKED', commits: old, criteria: ['- C1: fail · tries 1 · red', '- C2: unverified · tries 0 · -'] })
  await relay($, { action: 'report', run: RUN, task: 'A' })
  await relay($, TASK_A)
  sim.files[`${DIR}/tasks/A-r2-report.md`] = report({ commits: newer, criteria: ['- C1: pass · tries 2 · ok', '- C2: pass · tries 0 · ok'] }).replace('# Report A-r1', '# Report A-r2')
  await relay($, { action: 'report', run: RUN, task: 'A' })

  expect((await relay($, { action: 'package', run: RUN })).result).toContain('담은 작업: A-r2')
  const text = sim.files[`${DIR}/reviews/V1-package.md`] ?? ''
  expect(text).toContain('### Commits of every revision of A')
  expect(text).toContain('#### A-r1 (cancelled: 새 판 A-r2가 이어받음)')
  expect(text).toContain(`- ${old} Weaken a test`)
  expect(text).toContain('### Files outside the edit scope (every revision of A): tests/weakened.test.ts (A-r1)')
  expect(text).toContain('### Test file changes (every revision of A): tests/weakened.test.ts (A-r1)')
  expect(text).toContain(`- 보고에 없고 꼬리말(Task: A-r2, Run: ${RUN})로 찾은 커밋: ${silent}`)
  expect(text).not.toContain(stray)
  expect(text).toContain(`- Base(aaaaaaa)의 자손이 아닌 커밋: ${newer}`)
  expect(text).toContain(`git show ${old} -- tests/weakened.test.ts`)
  expect(state(sim).packages?.[0]?.tasks).toEqual([{ key: 'A-r2', criteria: ['C1', 'C2'] }])
})

test('V1-05 dispatched copies the brief as sent; a brief edited after it keeps the package from being made', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  const brief = `${DIR}/tasks/A-r1.md`
  const copy = `${DIR}/tasks/A-r1.dispatched.md`
  expect(sim.files[copy]).toBe(sim.files[brief])
  expect(state(sim).tasks[0]?.dispatchedHash).toBe(state(sim).tasks[0]?.specHash)

  const sent = sim.files[brief] ?? ''
  sim.files[brief] = sent.replace('tests pass', 'WEAKENED criterion')
  const refused = await relay($, { action: 'package', run: RUN })
  expect(refused.deny).toContain('A-r1: 지시서가 보낸 뒤에 바뀌었습니다(dispatched 때와 해시가 다름)')
  expect(sim.files[`${DIR}/reviews/V1-package.md`]).toBeUndefined()

  // The copy edited instead: refused too. Both as sent: the package shows the copy.
  sim.files[brief] = sent
  sim.files[copy] = sent.replace('tests pass', 'WEAKENED criterion')
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain('보낸 지시서 사본이 없거나 바뀌었습니다')
  sim.files[copy] = sent
  await relay($, { action: 'package', run: RUN })
  expect(sim.files[`${DIR}/reviews/V1-package.md`]).toContain('- C1: tests pass')
  expect(sim.files[`${DIR}/reviews/V1-package.md`]).not.toContain('WEAKENED')
})

test('V1-06 a running task holds its files: no new revision, no second dispatch, until it reports or is cancelled stopped', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'old-worker' })
  expect((await relay($, TASK_A)).deny).toContain('같은 작업의 A-r1(running · old-worker)가 돌고 있습니다')
  expect((await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'new-worker' })).deny).toContain('A-r1는 running 상태라 running으로 바꾸지 않습니다')
  expect((await relay($, { ...TASK_A, id: 'B' })).deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect(state(sim).tasks.map(task => [taskKeyOf(task), task.status, task.runner])).toEqual([['A-r1', 'running', 'old-worker']])

  await relay($, { action: 'cancel', run: RUN, task: 'A', reason: 'replaced', confirmed_stopped: true })
  expect((await relay($, TASK_A)).result).toContain(`지시서: ${DIR}/tasks/A-r2.md`)
  // Done is not sent again either.
  sim.files[`${DIR}/tasks/A-r2-report.md`] = report().replace('# Report A-r1', '# Report A-r2')
  sim.commits[SHA_A] = { task: 'A-r2', subject: 'x', files: ['hooks/relay/relay.ts'] }
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'w' })
  await relay($, { action: 'report', run: RUN, task: 'A' })
  expect((await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'w2' })).deny).toContain('A-r2는 done 상태라')
})

const taskKeyOf = (task: { id: string; rev: number }) => `${task.id}-r${task.rev}`

test('V1-07 calls made at once each keep their change to the state', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  for (const id of ['A', 'B', 'C']) await relay($, { ...TASK_A, id, edit_scope: [`${id.toLowerCase()}/**`], reads: [] })
  await Promise.all(['A', 'B', 'C'].map(id => relay($, { action: 'dispatched', run: RUN, task: id, runner: `subagent ${id}` })))
  expect(state(sim).tasks.map(task => [task.id, task.status, task.runner])).toEqual([
    ['A', 'running', 'subagent A'],
    ['B', 'running', 'subagent B'],
    ['C', 'running', 'subagent C'],
  ])
})

test('V1-07 reserveDispatch lets one of two overlapping launches through; launching holds like running; commit or release', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { ...TASK_A, id: 'B', reads: [] })
  const engine = engineOver(sim)
  const [first, second] = await Promise.all([reserveDispatch(engine, ROOT, RUN, 'A'), reserveDispatch(engine, ROOT, RUN, 'B')])
  expect('commit' in first).toBe(true)
  expect('deny' in second && second.deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect(state(sim).tasks.map(task => task.status)).toEqual(['launching', 'ready'])
  expect((await relay($, TASK_A)).deny).toContain('같은 작업의 A-r1(launching)가 돌고 있습니다')
  expect((await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'x' })).deny).toContain('launching 상태라')

  if (!('commit' in first)) return
  await first.release()
  expect(state(sim).tasks[0]?.status).toBe('ready')
  const again = await reserveDispatch(engine, ROOT, RUN, 'A')
  if (!('commit' in again)) throw new Error(again.deny)
  const committed = await again.commit('subagent ag-1')
  expect('result' in committed && committed.result).toContain('A-r1: running · subagent ag-1')
  expect(state(sim).tasks[0]).toMatchObject({ status: 'running', runner: 'subagent ag-1', dispatchedAt: NOON })
  expect(sim.files[`${DIR}/tasks/A-r1.dispatched.md`]).toBe(sim.files[`${DIR}/tasks/A-r1.md`])
})

// ── D7: the package lists files to open, the verdict names those it read ──────────────────────────────────────────────

test('D7 the package carries no diff: each commit with its files and line counts, and the git show command for each file', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim, ['hooks/relay/relay.ts', 'hooks/relay/relay-format.ts'])
  const packed = await relay($, { action: 'package', run: RUN })
  expect(packed.result).toContain('검토할 파일 2개')
  const text = sim.files[`${DIR}/reviews/V1-package.md`] ?? ''
  expect(text).not.toContain('DIFF-BODY')
  expect(text).not.toContain('diff --git')
  expect(text).not.toContain('## Diffs')
  expect(text).toContain(`- ${SHA_A} Add the relay tool\n  - hooks/relay/relay.ts (+3 −1)\n  - hooks/relay/relay-format.ts (+3 −1)`)
  expect(text).toContain(`diff는 담지 않는다. 각 파일을 아래 명령으로 저장소 루트(${ROOT})에서 열어 본다.`)
  expect(text).toContain('- hooks/relay/relay.ts — +3 −1, 커밋 1개')
  expect(text).toContain(`  - \`git show ${SHA_A} -- hooks/relay/relay.ts\` (+3 −1, A-r1)`)
  expect(text).toContain('열지 않은 파일은 적지 않는다')
  expect(state(sim).packages?.[0]?.files).toEqual(['hooks/relay/relay-format.ts', 'hooks/relay/relay.ts'])
})

test('D7 a verdict that leaves out a file to review is refused, naming it; one listing them all is taken', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim, ['hooks/relay/relay.ts', 'hooks/relay/relay-format.ts'])
  await relay($, { action: 'package', run: RUN })
  const partial = await verdictOf($, sim, 'V1', PASSED, 'pass', HEAD_1, ['hooks/relay/relay.ts'])
  expect(partial.deny).toContain('검토하지 않은 파일(reviewed_files에 없음): hooks/relay/relay-format.ts')
  expect(state(sim).verdicts).toEqual([])
  const all = await verdictOf($, sim, 'V1', PASSED, 'pass', HEAD_1, ['./hooks/relay/relay-format.ts', 'hooks/relay/relay.ts', 'docs/extra.md'])
  expect(all.result).toContain('판정 V1: 기록 pass')
})

test('D7 package writes the current verdict schema into a run started before it changed', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  sim.files[`${DIR}/reviews/verdict.schema.json`] = '{"required":["commit"]}'
  await relay($, { action: 'package', run: RUN })
  expect(JSON.parse(sim.files[`${DIR}/reviews/verdict.schema.json`] ?? '{}').required).toContain('reviewed_files')
})

test('task says the hubblerc gate records a launch, dispatched only when it could not', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  const written = await relay($, TASK_A)
  expect(written.result).toContain('Orca worker-start·send, 서브에이전트 생성·SendMessage로 띄우면 hubblerc 관문이 검사·기록합니다. 관문이 기록하지 못했다고 하면 dispatched를 부르세요.')
  expect(written.result).not.toContain('띄운 뒤 dispatched로')
})

// ── Verdict V2's findings, each reproduced ──────────────────────────────────────────────

test('V1-03b a file git does not know spoils check results, and package and finish refuse it', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  sim.commands['make test'] = { exitCode: 0 }
  sim.status = '?? src/new-module.ts\n'
  const checked = await relay($, { action: 'check', run: RUN, task: 'A' })
  expect(checked.result).toContain('- C1: unverified · exit 0(기대 0) · 0 ms · 실행 전 커밋하지 않은 변경·git이 모르는 파일: src/new-module.ts (git이 모름)')
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain('git이 모르는 파일이 있습니다: src/new-module.ts (git이 모름)')
  expect(state(sim).packages ?? []).toEqual([])

  // A file a command leaves behind spoils its result too.
  sim.status = ''
  sim.commands['make test'] = { exitCode: 0, effect: () => (sim.status = '?? build/out.js\n') }
  expect((await relay($, { action: 'check', run: RUN, task: 'A' })).result).toContain('실행 중 생기거나 바뀐 파일: build/out.js (git이 모름)')

  sim.status = ''
  await relay($, { action: 'package', run: RUN })
  await verdictOf($, sim, 'V1', PASSED)
  sim.status = '?? src/new-module.ts\n'
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('작업 트리에 커밋하지 않은 변경: src/new-module.ts (git이 모름)')
  expect(state(sim).status).toBe('active')
})

test('V1-04b the package shows the commits of tasks outside it, cancelled ones included, and every commit signed for the run', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim, ['hooks/relay/fix.ts'])
  await relay($, { ...TASK_A, id: 'B', edit_scope: ['other/**'], reads: [] })
  await relay($, { action: 'dispatched', run: RUN, task: 'B', runner: 'subagent b' })
  sim.commits[SHA_B] = { task: 'B-r1', subject: 'Weaken a test', files: ['tests/weakened.test.ts'] }
  sim.files[`${DIR}/tasks/B-r1-report.md`] = report({ status: 'BLOCKED', commits: SHA_B, criteria: ['- C1: fail · tries 1 · red', '- C2: unverified · tries 0 · -'] })
  await relay($, { action: 'report', run: RUN, task: 'B' })
  await relay($, { action: 'cancel', run: RUN, task: 'B', reason: 'abandoned' })
  const loose = '8'.repeat(40)
  sim.commits[loose] = { task: '', subject: 'Lead fixup', files: ['docs/notes.md'] }

  expect((await relay($, { action: 'package', run: RUN })).result).toContain('담은 작업: A-r1')
  const text = sim.files[`${DIR}/reviews/V1-package.md`] ?? ''
  expect(text).toContain('## Other commits of this run')
  expect(text).toContain('### Task B (not in this package)')
  expect(text).toContain('#### B-r1 (cancelled: abandoned)')
  expect(text).toContain(`- ${SHA_B} Weaken a test`)
  expect(text).toContain('### Test file changes (every revision of B): tests/weakened.test.ts (B-r1)')
  expect(text).toContain(`### Commits signed Run: ${RUN} with no known task`)
  expect(text).toContain(`- ${loose} Lead fixup (Task 꼬리말 없음)`)
  expect(text).toContain('취소는 코드를 되돌리지 않는다')
  expect(state(sim).packages?.[0]?.files).toEqual(['docs/notes.md', 'hooks/relay/fix.ts', 'tests/weakened.test.ts'])
  expect(state(sim).packages?.[0]?.tasks).toEqual([{ key: 'A-r1', criteria: ['C1', 'C2'] }])

  // A verdict that did not open the cancelled task's file is refused.
  expect((await verdictOf($, sim, 'V1', PASSED, 'pass', HEAD_1, ['hooks/relay/fix.ts', 'docs/notes.md'])).deny).toContain('검토하지 않은 파일(reviewed_files에 없음): tests/weakened.test.ts')

  sim.logFails = true
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain('git log가 실패해 이 묶음(Run: 2026-11-09-demo)의 커밋을 모으지 못했습니다')
})

test('V1-05b the brief is fixed when a launch is reserved; one changed during the launch leaves the task blocked, with why', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  const engine = engineOver(sim)
  const brief = `${DIR}/tasks/A-r1.md`
  const sent = sim.files[brief] ?? ''
  const held = await reserveDispatch(engine, ROOT, RUN, 'A')
  if (!('commit' in held)) throw new Error(held.deny)
  // The copy is written at the reservation, from the bytes then.
  expect(sim.files[`${DIR}/tasks/A-r1.dispatched.md`]).toBe(sent)
  expect(state(sim).tasks[0]).toMatchObject({ status: 'launching', dispatchedHash: state(sim).tasks[0]?.specHash })

  sim.files[brief] = sent.replace('tests pass', 'WEAKENED criterion')
  const committed = await held.commit('orca dispatch:ctx_1')
  expect('deny' in committed && committed.deny).toContain('A-r1를 blocked로 두었습니다(띄운 뒤 막힘: 지시서가 바뀜 — 워커를 멈추고 cancel(confirmed_stopped)): 띄우는 동안 지시서가 바뀌었습니다')
  expect(state(sim).tasks[0]).toMatchObject({ status: 'blocked', runner: 'orca dispatch:ctx_1' })
  expect(sim.files[`${DIR}/tasks/A-r1.dispatched.md`]).toBe(sent)

  // A brief changed before the launch is not reserved at all.
  await relay($, { ...TASK_A, id: 'B', edit_scope: ['other/**'], reads: [] })
  sim.files[`${DIR}/tasks/B-r1.md`] += '\nedited\n'
  const refused = await reserveDispatch(engine, ROOT, RUN, 'B')
  expect('deny' in refused && refused.deny).toContain('B-r1의 지시서가 task로 쓴 뒤에 바뀌었습니다')
  expect(state(sim).tasks[1]?.status).toBe('ready')
})

test('V1-05b a sent copy that is not the brief task wrote keeps the package from being made', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  // As a state written before this rule: the copy's hash recorded, the written brief's another.
  const written = state(sim)
  written.tasks[0]!.specHash = '0'.repeat(64)
  sim.files[`${DIR}/state.json`] = JSON.stringify(written)
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain('A-r1: 보낸 지시서 사본이 task로 쓴 원본과 다릅니다')
})

test('V2-01 a commit whose file list cannot be read for sure keeps the package from being made', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  sim.commits[SHA_A] = { ...sim.commits[SHA_A]!, numstat: 'fail' }
  const failed = await relay($, { action: 'package', run: RUN })
  expect(failed.deny).toContain('커밋이 바꾼 파일 목록을 확실히 읽지 못해 꾸러미를 만들지 않았습니다')
  expect(failed.deny).toContain(`${SHA_A}: git show --numstat 실패(종료 코드 128)`)
  sim.commits[SHA_A] = { ...sim.commits[SHA_A]!, numstat: [] }
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain(`${SHA_A}: 바뀐 파일 목록이 서로 다름(numstat: 없음 / name-only: hooks/relay/relay.ts)`)
  sim.commits[SHA_A] = { ...sim.commits[SHA_A]!, numstat: ['hooks/relay/other.ts'] }
  expect((await relay($, { action: 'package', run: RUN })).deny).toContain('numstat: hooks/relay/other.ts / name-only: hooks/relay/relay.ts')
  expect(state(sim).packages ?? []).toEqual([])
  expect(sim.files[`${DIR}/reviews/V1-package.md`]).toBeUndefined()

  delete sim.commits[SHA_A]!.numstat
  expect((await relay($, { action: 'package', run: RUN })).result).toContain('검토할 파일 1개')
})

test('tries carry over to a new revision only for a criterion asked the same; a changed or new one starts at 0', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent a' })
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Try', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ status: 'BLOCKED', criteria: ['- C1: fail · tries 2 · red', '- C2: fail · tries 3 · unclear'] })
  await relay($, { action: 'report', run: RUN, task: 'A' })

  const again = await relay($, { ...TASK_A, done_when: [{ text: 'tests pass', command: 'make test' }, { text: 'reads well, now with docs' }, { id: 'C3', text: 'new one' }] })
  expect(again.result).toContain('tries 이어 받음: C1(2) · 0부터 셈: C2(기준 글이 바뀜), C3(새 기준)')
  expect(state(sim).tasks[1]?.tries).toEqual({ C1: 2 })

  // Fewer tries than carried is warned only for the criterion carried.
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent a' })
  sim.commits[SHA_B] = { task: 'A-r2', subject: 'Fix', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r2-report.md`] = report({ commits: SHA_B, criteria: ['- C1: pass · tries 1 · ok', '- C2: pass · tries 1 · ok', '- C3: pass · tries 0 · ok'] })
  const reported = await relay($, { action: 'report', run: RUN, task: 'A' })
  expect(reported.result).toContain('C1의 tries가 2에서 1로 줄었습니다')
  expect(reported.result).not.toContain('C2의 tries가')

  // The same command with another expected exit is another criterion.
  const third = await relay($, { ...TASK_A, done_when: [{ text: 'tests pass', command: 'make test', expect_exit: 1 }] })
  expect(third.result).toContain('0부터 셈: C1(기준 글이 바뀜)')
})

// ── Verdict V3: a task blocked after its launch still holds its files ──────────────────────────────────────────────

/** Task A launched and blocked by the tool on commit (its brief changed while it was launched); B written on the same files. */
async function liveBlockedA($: Engine, sim: Sim, withB = true) {
  await begin($, sim)
  await relay($, TASK_A)
  if (withB) await relay($, { ...TASK_A, id: 'B', reads: [] })
  const engine = engineOver(sim)
  const held = await reserveDispatch(engine, ROOT, RUN, 'A')
  if (!('commit' in held)) throw new Error(held.deny)
  sim.files[`${DIR}/tasks/A-r1.md`] += '\nchanged while launching\n'

  return { engine, held }
}

test('V3-01 a launch blocked after it went out keeps its files: an overlapping launch at the same time is refused', async ($, on) => {
  const sim = standIn(on)
  const { engine, held } = await liveBlockedA($, sim)
  // Both starts issued at once: A's commit (blocked) and B's claim; the lock orders them, A first.
  const [committed, second] = await Promise.all([held.commit('orca dispatch:ctx_live_A'), reserveDispatch(engine, ROOT, RUN, 'B')])
  expect('deny' in committed && committed.deny).toContain('워커(orca dispatch:ctx_live_A)는 떠 있을 수 있어 이 작업이 파일을 계속 점유합니다')
  expect('deny' in second && second.deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect(state(sim).tasks.map(task => [task.id, task.status, task.runner, task.workerLive])).toEqual([
    ['A', 'blocked', 'orca dispatch:ctx_live_A', true],
    ['B', 'ready', null, undefined],
  ])
  // Later too, and through the tool's own overlap check; the Tasks table says what to do.
  expect('deny' in (await reserveDispatch(engine, ROOT, RUN, 'B'))).toBe(true)
  expect((await relay($, { ...TASK_A, id: 'C', reads: [] })).deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect(sim.files[`${DIR}/progress.md`]).toContain('| A-r1 | Add the tool | orca dispatch:ctx_live_A | blocked (띄운 뒤 막힘: 지시서가 바뀜 — 워커를 멈추고 cancel(confirmed_stopped)) |')
  expect((await relay($, { action: 'finish', run: RUN })).deny).toContain('A-r1(blocked (띄운 뒤 막힘')
})

test('V3-01 a task blocked after its launch takes no new revision until its worker is confirmed stopped and cancelled', async ($, on) => {
  const sim = standIn(on)
  const { held } = await liveBlockedA($, sim, false)
  await held.commit('orca dispatch:ctx_still_alive')
  const revision = await relay($, TASK_A)
  expect(revision.deny).toContain('같은 작업의 A-r1(blocked (띄운 뒤 막힘: 지시서가 바뀜 — 워커를 멈추고 cancel(confirmed_stopped)) · orca dispatch:ctx_still_alive)가 돌고 있습니다')
  expect(state(sim).tasks.map(task => [taskKeyOf(task), task.status])).toEqual([['A-r1', 'blocked']])

  await relay($, { action: 'cancel', run: RUN, task: 'A', reason: 'replace worker', confirmed_stopped: true })
  expect((await relay($, TASK_A)).result).toContain(`지시서: ${DIR}/tasks/A-r2.md`)
})

test('V3-01 a task blocked after its launch is cancelled only with confirmed_stopped; a report from its worker is taken as usual', async ($, on) => {
  const sim = standIn(on)
  const { held } = await liveBlockedA($, sim, false)
  await held.commit('orca dispatch:ctx_still_alive')
  const refused = await relay($, { action: 'cancel', run: RUN, task: 'A', reason: 'replace worker' })
  expect(refused.deny).toContain('A-r1는 blocked (띄운 뒤 막힘: 지시서가 바뀜 — 워커를 멈추고 cancel(confirmed_stopped)) 상태입니다(orca dispatch:ctx_still_alive): 워커가 멈춘 것을 확인한 뒤 confirmed_stopped: true를 주세요')
  expect(state(sim).tasks[0]?.status).toBe('blocked')

  // The worker reports after all: its report is checked as any other, and the task holds nothing more.
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Add', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report()
  const reported = await relay($, { action: 'report', run: RUN, task: 'A' })
  expect(reported.result).toContain('A-r1: 보고 DONE → 상태 done')
  expect(reported.result).toContain('띄운 뒤 막혀 있던 작업의 워커가 보고했습니다')
  expect(state(sim).tasks[0]?.workerLive).toBeUndefined()
  // A worker's own BLOCKED report frees its files: that worker stopped.
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report({ status: 'BLOCKED', criteria: ['- C1: fail · tries 1 · red', '- C2: unverified · tries 0 · -'] })
  await relay($, { action: 'report', run: RUN, task: 'A' })
  expect((await relay($, { action: 'cancel', run: RUN, task: 'A', reason: 'gave up' })).result).toContain('A-r1: blocked → cancelled · gave up')
})

// ── The conversation's lines: relay's calls and results, one line each ──────────────────────────────

/** A call run through the real tool, then said as the conversation says it. */
async function said($: Engine, input: Record<string, unknown>): Promise<{ call: string; result: string; problem: boolean }> {
  const answer = await relay($, input)
  const body = answer.result ?? answer.deny ?? ''
  const view = resultView(body, answer.deny !== undefined)

  return { call: callLine(input, body), result: view?.line ?? '(unread)', problem: view?.isProblem ?? false }
}

test('all twelve actions are said as the table says, read from the real tool’s words', async ($, on) => {
  const sim = standIn(on)
  const lines: string[][] = []
  const note = async (input: Record<string, unknown>) => {
    const out = await said($, input)
    lines.push([out.call, out.result])

    return out
  }

  await note({ action: 'list' })
  await note({ action: 'start', name: 'demo', goal: 'Ship relay, the lead-and-workers tool that is long enough to be cut', done_when: ['all checks pass'] })
  await note({ action: 'list', run: RUN })
  await note({ action: 'pending', run: RUN })
  const { action: _, run: __, ...fields } = TASK_A
  const preview = await relay($, { action: 'spec_text', ...fields })
  await note({ action: 'spec_text', ...fields })
  await note(TASK_A)
  await note({ action: 'dispatched', run: RUN, task: 'A', runner: 'subagent worker-a-with-a-long-name-here' })
  await note({ ...TASK_A, id: 'B', edit_scope: ['plugins/other/**'], reads: [], title: 'Docs' })
  await note({ action: 'cancel', run: RUN, task: 'B', reason: 'not needed after all, the docs are fine as they stand today' })
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Add the relay tool', files: ['hooks/relay/relay.ts'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report()
  await note({ action: 'report', run: RUN, task: 'A' })
  sim.commands['make test'] = { exitCode: 0, stdout: 'ok' }
  await note({ action: 'check', run: RUN, task: 'A' })
  await note({ ...TASK_A, id: 'C', title: 'Next' })
  await note({ action: 'cancel', run: RUN, task: 'C', reason: 'later' })
  await note({ action: 'package', run: RUN })
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({
    commit: HEAD_1,
    result: 'pass',
    model: 'gpt-5.5-codex',
    criteria: PASSED,
    findings: [{ severity: 'medium', file: 'a.ts', line: 3, issue: 'x', evidence: 'y' }],
    reviewed_files: ['hooks/relay/relay.ts'],
  })
  await note({ action: 'verdict', run: RUN, id: 'V1' })
  sim.files[`${DIR}/progress.md`] = (sim.files[`${DIR}/progress.md`] ?? '').replace(
    '|---|---|---|---|---|---|\n',
    '|---|---|---|---|---|---|\n| D2 | deploy | d | e | user | asked |\n| D3 | rename | f | g | lead | on hold |\n',
  )
  await note({ action: 'pending', run: RUN })
  await note({ action: 'finish', run: RUN })

  const previewLines = preview.result?.trimEnd().split('\n').length ?? 0
  expect(lines).toEqual([
    ['relay 묶음 목록', '진행 중 0'],
    ['relay 시작 · demo · Ship relay, the lead-and-worke…', '폴더 만듦'],
    ['relay 묶음 목록', '진행 중 1'],
    ['relay 기다리는 결정', '없음'],
    ['relay 지시서 미리보기 A', `미리보기 ${previewLines}줄`],
    ['relay 지시서 Add the tool · opus-5-5/high · 기준 2', '씀'],
    ['relay 띄움 기록 A → subagent worker-a-with-a…', '도는 중'],
    ['relay 지시서 Docs · opus-5-5/high · 기준 2', '씀'],
    ['relay 취소 B · not needed after all, the docs…', '띄우기 전 → 취소'],
    ['relay 보고 확인 A', 'DONE · 범위 밖 0 · 테스트 변경 0 · 경고 0'],
    ['relay 완료 검사 A', 'pass 1 · fail 0 · 미확인 1 · 0 ms · 트리 깨끗함'],
    ['relay 지시서 Next · opus-5-5/high · 기준 2', expect.stringMatching(/^씀 · 경고 1: 같은 범위를 고친 A-r1가 끝났습니다/)],
    ['relay 취소 C · later', '띄우기 전 → 취소'],
    ['relay 검증 꾸러미 · 전체', 'V1 · 검토 파일 1'],
    ['relay 판정 V1', 'pass · 기준 2/2 · 지적 high 0, medium 1 · 커밋 aaaaaaa'],
    ['relay 기다리는 결정', '2개: D2, D3'],
    ['relay 묶음 끝내기', '끝냄 · 판정 V1 · 보류 결정 2'],
  ])
})

test('a package names its tasks; a report with scope or test trouble and a dirty tree say so; no size is shown', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent a' })
  sim.commits[SHA_A] = { task: 'A-r1', subject: 'Add', files: ['hooks/relay/relay.ts', 'elsewhere/x.ts', 'tests/relay.test.tsx'] }
  sim.files[`${DIR}/tasks/A-r1-report.md`] = report()
  const reported = await said($, { action: 'report', run: RUN, task: 'A' })
  expect(reported.result).toMatch(/^DONE · 범위 밖 1 · 테스트 변경 1 · 경고 \d+$/)

  sim.status = ' M hooks/relay/relay.ts\n?? new.ts'
  sim.commands['make test'] = { exitCode: 1, stdout: 'red' }
  const checked = await said($, { action: 'check', run: RUN, task: 'A' })
  expect(checked.result).toBe('pass 0 · fail 0 · 미확인 2 · 0 ms · 트리 변경 2개')

  sim.status = ''
  const packed = await said($, { action: 'package', run: RUN, tasks: ['A', 'A-r1'] })
  expect(packed.call).toBe('relay 검증 꾸러미 · A, A-r1')
  expect(packed.result).toMatch(/^V1 · 검토 파일 \d+$/)
})

test('a refusal says its first reason, a failure of the tool says so, and a text no reading fits is its first line cut', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  const refused = await said($, { action: 'finish', run: RUN })
  expect(refused.problem).toBe(true)
  expect(refused.result).toMatch(/^거절: 판정이 없습니다/)
  const bad = await said($, { action: 'cancel', run: RUN, task: 'Z', reason: 'x' })
  expect(bad.result).toBe('거절: 작업이 없습니다: Z')
  const noRun = await said($, { action: 'task', run: 'nope' })
  expect(noRun.result).toMatch(/^거절: run은 start가 돌려준/)

  expect(resultView('relay 도구가 실패했습니다: Error: boom', true)).toMatchObject({ line: 'relay 실패: Error: boom', isProblem: true })
  const odd = resultView(`something new\n${'x'.repeat(200)}`, false)
  expect(odd).toMatchObject({ line: 'something new', isProblem: false })
  expect(resultView(`${'y'.repeat(200)}\nmore`, false)?.line).toBe(`${'y'.repeat(120)}…`)
  expect(resultView({ content: [{ type: 'text', text: '진행 중인 묶음 2개:\n- a' }] }, false)?.line).toBe('진행 중 2')
  expect(resultView(undefined, false)).toBeUndefined()
})

test('a gate warning in a result is kept whole as a notice', () => {
  const view = resultView('A-r1: running · subagent x\n⚠ relay: A-r1 기록에 경고가 있습니다 — 겹침', false)
  expect(view).toEqual({ line: '도는 중', isProblem: false, notices: ['⚠ relay: A-r1 기록에 경고가 있습니다 — 겹침'] })
})

// ── Registered in the list only while a run is not finished ──────────────────────────────────────

/** The engine over the stand-in, with a listing of the files in memory and a tool.register that notes its specs. */
function engineRecording(sim: Sim, registered: Record<string, unknown>[]) {
  const base = engineOver(sim) as unknown as { fs: Record<string, unknown> }
  const names = (path: string) => {
    const found = new Map<string, 'file' | 'dir'>()
    for (const file of Object.keys(sim.files)) {
      if (!file.startsWith(`${path}/`)) continue
      const [name = '', ...rest] = file.slice(path.length + 1).split('/')
      found.set(name, rest.length > 0 ? 'dir' : 'file')
    }

    return [...found].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false }))
  }

  return {
    ...base,
    fs: { ...base.fs, list: async (path: string) => names(path) },
    tool: {
      register: async (spec: Record<string, unknown>) => {
        registered.push(spec)
      },
    },
  } as never
}

test('the tool is listed outright while a run is not finished, and stays behind the search otherwise', async ($, on) => {
  const sim = standIn(on)
  const registered: Record<string, unknown>[] = []
  const engine = engineRecording(sim, registered)

  await registerRelayTool(engine)
  expect(registered).toHaveLength(1)
  expect(registered[0]?.name).toBe('relay')
  expect('isDeferred' in (registered[0] ?? {})).toBe(false)

  await begin($, sim)
  await registerRelayTool(engine)
  expect(registered[1]?.isDeferred).toBe(false)

  state(sim).status = 'finished'
  sim.files[`${DIR}/state.json`] = JSON.stringify({ ...state(sim), status: 'finished' })
  await registerRelayTool(engine)
  expect('isDeferred' in (registered[2] ?? {})).toBe(false)

  // Outside a git folder, or with the read failing, it is registered as before.
  const outside = { ...(engine as unknown as Record<string, unknown>), process: { run: async () => ({ exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) } } as never
  await registerRelayTool(outside)
  expect('isDeferred' in (registered[3] ?? {})).toBe(false)
})
