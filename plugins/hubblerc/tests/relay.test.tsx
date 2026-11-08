import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checkTask, decisionRows, globsOverlap, isPending, isTestFile, parseReport, pathMatches, reportMismatches, withoutSections } from '../hooks/relay/relay-format'
import type { RelayState } from '../hooks/relay/relay-format'
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

type Commit = { task: string; subject: string; files: string[] }
type Sim = {
  files: Record<string, string>
  head: string
  commits: Record<string, Commit>
  /** What `/bin/sh -c <command>` exits with and prints, by the command. */
  commands: Record<string, { exitCode: number; stdout?: string }>
  ran: string[]
}

/** A small FNV hash: what shasum stands in for when the environment has no digest. */
function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0

  return hash.toString(16).padStart(8, '0')
}

/** Stands for the engine beneath the plugin: files in memory, a repository with a few commits, a shell that answers by the command. */
function standIn(on: On): Sim {
  const sim: Sim = { files: {}, head: HEAD_1, commits: {}, commands: {}, ran: [] }
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
  on('process.run', (_, e) => {
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = e.argv
    const last = argv.at(-1) ?? ''
    if (argv[0] === '/usr/bin/shasum') return out(`${fnv(e.init?.stdin ?? '')}  -\n`)
    if (argv[0] === '/bin/sh' && argv[1] === '-c') {
      sim.ran.push(argv[2] ?? '')
      const answer = sim.commands[argv[2] ?? ''] ?? { exitCode: 127, stdout: 'not found' }

      return out(answer.stdout ?? '', answer.exitCode)
    }
    if (argv[0] !== 'git') return out('', 1)
    const commit = sim.commits[last]
    if (argv.includes('--show-toplevel')) return out(`${ROOT}\n`)
    if (argv[1] === 'rev-parse' && last === 'HEAD') return out(`${sim.head}\n`)
    if (argv[1] === 'cat-file') return commit === undefined ? out('', 128) : out('commit\n')
    if (argv[1] === 'log' && argv.some(arg => arg.includes('trailers:key=Task'))) return out(`${commit?.task ?? ''}\n`)
    if (argv[1] === 'log' && argv.includes('--format=%s')) return out(`${commit?.subject ?? ''}\n`)
    if (argv[1] === 'show' && argv.includes('--name-only')) return out(`${(commit?.files ?? []).join('\n')}\n`)
    if (argv[1] === 'show' && argv.includes('--format=fuller')) return out(`commit ${last}\n\n    ${commit?.subject ?? ''}\n\ndiff --git a/x b/x\n`)

    return out('', 1)
  })

  return sim
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

test('checkTask refuses an overlap with a running task of another id, not with its own earlier revision', () => {
  const base: RelayState = { version: 1, run: RUN, goal: '', doneWhen: [], base: '', lead: '', status: 'active', createdAt: 0, tasks: [], verdicts: [] }
  const running = { id: 'A', rev: 1, title: '', runner: 'x', model: 'm', effort: 'e', editScope: ['a/**'], reads: ['r.md'], targets: ['server-1'], criteria: [], status: 'running' as const, specPath: `${DIR}/tasks/A-r1.md`, specHash: '', dispatchedAt: 0, reportedAt: null, tries: {} }
  const state = { ...base, tasks: [running] }
  const input = { id: 'B', model: 'm', effort: 'e', editScope: ['b/**'], reads: [], targets: [], readFirst: [], criteria: [{ id: 'C1', text: 't' }] }
  expect(checkTask(state, input).denials).toEqual([])
  expect(checkTask(state, { ...input, editScope: ['r.md'] }).denials[0]).toMatch(/그 reads/)
  expect(checkTask(state, { ...input, targets: ['server-1'] }).denials[0]).toMatch(/external target server-1/)
  expect(checkTask(state, { ...input, id: 'A', editScope: ['a/x.ts'] }).denials).toEqual([])
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
  expect(JSON.parse(sim.files[`${DIR}/reviews/verdict.schema.json`] ?? '{}').required).toEqual(['commit', 'result', 'model', 'criteria', 'findings'])

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
  expect(text).toContain(`commit ${SHA_A}`)
  expect(text).toContain('반박하는 자세')
  expect(text).toContain(`${DIR}/reviews/verdict.schema.json`)
})

test('finish refuses while the verdict saw another commit, and closes the run with the decisions once it matches', async ($, on) => {
  const sim = standIn(on)
  await doneA($, sim)
  expect((await relay($, { action: 'finish', run: RUN })).deny).toMatch(/판정이 없습니다/)

  await relay($, { action: 'package', run: RUN })
  const verdict = { commit: HEAD_1, result: 'pass', model: 'gpt-5.5-codex', criteria: [{ id: 'C1', result: 'pass', evidence: 'make test → 0' }], findings: [] }
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify(verdict)
  sim.head = HEAD_2
  expect((await relay($, { action: 'verdict', run: RUN, id: 'V1' })).result).toContain('검증한 판과 지금 판이 다름')
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('검증한 판과 지금 판이 다름: 다시 검증하세요')
  expect(state(sim).status).toBe('active')

  sim.files[`${DIR}/progress.md`] = (sim.files[`${DIR}/progress.md`] ?? '').replace(
    '|---|---|---|---|---|---|\n',
    '|---|---|---|---|---|---|\n| D1 | keep one file | simpler | low | lead | decided |\n| D2 | push | needs consent | high | user | asked |\n',
  )
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({ ...verdict, commit: HEAD_2 })
  await relay($, { action: 'verdict', run: RUN, id: 'V1' })
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
  await relay($, { ...TASK_A, id: 'B', edit_scope: ['docs/**'], reads: [] })
  await relay($, { action: 'dispatched', run: RUN, task: 'B', runner: 'subagent b' })
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({ commit: HEAD_1, result: 'fail', model: 'm', criteria: [], findings: [{ severity: 'high', file: 'a.ts', line: 3, issue: 'x', evidence: 'y' }] })
  await relay($, { action: 'verdict', run: RUN, id: 'V1' })
  const refused = await relay($, { action: 'finish', run: RUN })
  expect(refused.deny).toContain('끝나지 않은 작업: B-r1(running)')
  expect(refused.deny).toContain('마지막 판정 V1가 fail입니다')
})

test('a verdict of the wrong form is refused with what is wrong', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  sim.files[`${DIR}/reviews/V1-verdict.json`] = JSON.stringify({ commit: HEAD_1, result: 'ok', model: 'm', criteria: [{ id: 'C1' }], findings: [] })
  const refused = await relay($, { action: 'verdict', run: RUN, id: 'V1' })
  expect(refused.deny).toContain("result가 'pass' 또는 'fail'이 아님")
  expect(refused.deny).toContain('criteria[0]')
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

test('dispatched warns when the brief changed after it was written; the Tasks block gone is warned, not redrawn', async ($, on) => {
  const sim = standIn(on)
  await begin($, sim)
  await relay($, TASK_A)
  sim.files[`${DIR}/tasks/A-r1.md`] += '\nedited by hand\n'
  sim.files[`${DIR}/progress.md`] = '# Progress\n'
  const sent = await relay($, { action: 'dispatched', run: RUN, task: 'A', runner: 'subagent a' })
  expect(sent.result).toContain('지시서가 쓴 뒤에 바뀌었습니다')
  expect(sent.result).toContain('Tasks 표시')
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
