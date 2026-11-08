import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { briefsIn, commandWords, dispatchIdIn, readWorkerStart, sameModel } from '../hooks/relay/gate'
import type { RelayState } from '../hooks/relay/relay-format'

const ROOT = '/repo/work'
const TOOL = 'mcp__hubblerc__relay'
const HEAD_1 = 'a'.repeat(40)
const HEAD_2 = 'b'.repeat(40)
// 2026-11-09 at noon, local: the run's date does not depend on the machine's zone.
const NOON = new Date(2026, 10, 9, 12, 0).getTime()
const RUN = '2026-11-09-demo'
const DIR = `${ROOT}/.relay/runs/${RUN}`
const RECEIPT = 'worker started\ndispatchId=ctx_abc123\nstatus=ready\n'

type Sim = {
  files: Record<string, string>
  head: string
  /** The commands the Bash tool below the plugin received, the prompts and models the subagents were started with. */
  commands: string[]
  spawned: { prompt: string; model: string | undefined }[]
  /** What the worker-start receipt says; whether the launch failed. */
  receipt: string
  isLaunchFailed: boolean
  /** What the gate costs: reads of anything under .relay, and git asked for the top folder. */
  relayReads: string[]
  relayExists: string[]
  relayLists: string[]
  toplevelAsks: number
  headAsks: number
  /** Git asked for the repository's top folder with no folder named: how the gate asks, where the plugin's other hooks name theirs. */
  ownGit: string[][]
}

/** Stands for the engine beneath the plugin: files in memory, a repository, a Bash tool that prints a receipt, a subagent start. */
function standIn(on: On): Sim {
  const sim: Sim = { files: {}, head: HEAD_1, commands: [], spawned: [], receipt: RECEIPT, isLaunchFailed: false, relayReads: [], relayExists: [], relayLists: [], toplevelAsks: 0, headAsks: 0, ownGit: [] }
  const isDir = (path: string) => Object.keys(sim.files).some(file => file.startsWith(`${path}/`))
  on('session.id', () => ({ value: 'lead-session-1234' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: NOON }))
  on('fs.exists', (_, e) => {
    if (e.path.includes('.relay')) sim.relayExists.push(e.path)

    return { value: sim.files[e.path] !== undefined || isDir(e.path) }
  })
  on('fs.read', (_, e) => {
    if (e.path.includes('.relay')) sim.relayReads.push(e.path)

    return sim.files[e.path] === undefined ? { deny: 'ENOENT' } : { value: sim.files[e.path] as never }
  })
  on('fs.write', (_, e) => {
    sim.files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    if (e.path.includes('.relay')) sim.relayLists.push(e.path)
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
    if (argv[0] !== 'git') return out('', 1)
    if (argv.includes('--show-toplevel')) {
      sim.toplevelAsks += 1
      if (e.init?.cwd === undefined) sim.ownGit.push([...argv])

      return out(`${ROOT}\n`)
    }
    if (argv[1] === 'rev-parse' && argv.at(-1) === 'HEAD') {
      sim.headAsks += 1

      return out(`${sim.head}\n`)
    }

    return out('', 1)
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') {
      sim.commands.push(String((e as { command?: unknown }).command))
      if (sim.isLaunchFailed) return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }

      return { result: { stdout: sim.receipt, stderr: '' } as never, text: sim.receipt }
    }

    return { result: {} as never }
  })
  on('agent.spawn', (_, e) => {
    sim.spawned.push({ prompt: e.prompt, model: e.model })

    return { model: e.model ?? 'inherited-model', agentId: 'ag-1' }
  })
  on('turn.complete', () => ({ text: '' }))

  return sim
}

async function relay($: Engine, input: Record<string, unknown>): Promise<{ result?: string; deny?: string }> {
  const answer = (await $.tool.call({ tool: TOOL, ...input } as never)) as { result?: unknown; deny?: string }

  return { result: typeof answer.result === 'string' ? answer.result : undefined, deny: answer.deny }
}

const state = (sim: Sim): RelayState => JSON.parse(sim.files[`${DIR}/state.json`] ?? '{}') as RelayState

async function newRun($: Engine): Promise<void> {
  const started = await relay($, { action: 'start', name: 'demo', goal: 'Gate the launches.', done_when: ['tests pass'] })
  expect(started.deny).toBeUndefined()
}

/** A task's brief written by the tool; its path. */
async function newTask($: Engine, id: string, extra: Record<string, unknown> = {}): Promise<string> {
  const made = await relay($, {
    action: 'task',
    run: RUN,
    id,
    title: `Task ${id}`,
    goal: 'Do it.',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    edit_scope: [`area-${id}/**`],
    reads: [],
    done_when: [{ text: 'works', command: 'true' }],
    runner_kind: 'claude',
    ...extra,
  })
  expect(made.deny).toBeUndefined()

  return `${DIR}/tasks/${id}-r1.md`
}

async function bash($: Engine, command: string): Promise<{ deny?: string }> {
  return (await $.tool.call({ tool: 'Bash', command, description: '워커 띄우기' } as never)) as { deny?: string }
}

/** A subagent start as the Agent tool makes it: the prompt, the description and the model it gave (none: left to the agent's own). */
async function spawn($: Engine, prompt: string, description: string, model?: string): Promise<{ deny?: string; agentId?: string }> {
  const input = { tool_use_id: 'toolu_1', prompt, description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', ...(model === undefined ? {} : { model }) }

  return (await $.agent.spawn(input as never)) as { deny?: string; agentId?: string }
}

const launch = (spec: string, rest = '--model claude-sonnet-5-5 --effort high') => `orca orchestration worker-start --spec-file ${spec} --worktree current --agent claude ${rest} --task-title "A: x"`

// ── Reading a command, pure ──────────────────────────────────────────────

test('worker-start is found in an orca, orca-dev or orca-ide command with its options, and nowhere else', () => {
  const start = readWorkerStart('cd /x && ORCA_HOME=/y /usr/local/bin/orca-dev orchestration worker-start --spec-file /s.md --model=opus --json --effort high --comment "no-relay: other"')
  expect(start?.options.get('--spec-file')).toBe('/s.md')
  expect(start?.options.get('--model')).toBe('opus')
  expect(start?.options.get('--json')).toBe(true)
  expect(start?.options.get('--effort')).toBe('high')
  expect(start?.options.get('--comment')).toBe('no-relay: other')
  expect(readWorkerStart('orca-ide orchestration worker-start --spec-file x')).toBeDefined()
  expect(readWorkerStart('orca orchestration worker-list')).toBeUndefined()
  expect(readWorkerStart('echo "orca orchestration worker-start --spec-file x"')).toBeUndefined()
  expect(readWorkerStart('git log --grep worker-start')).toBeUndefined()
  expect(commandWords("a 'b c' \"d\\\"e\" f\\ g; h | i")).toEqual([['a', 'b c', 'd"e', 'f g'], ['h'], ['i']])
})

test('a model alias and an ID that holds it are the same; another model is not', () => {
  expect(sameModel('sonnet', 'claude-sonnet-5-5')).toBe(true)
  expect(sameModel('claude-sonnet-5-5', 'sonnet')).toBe(true)
  expect(sameModel('claude-sonnet-5-5', 'claude-sonnet-5-5')).toBe(true)
  expect(sameModel('opus', 'claude-sonnet-5-5')).toBe(false)
  expect(sameModel('claude-opus-5-5', 'claude-sonnet-5-5')).toBe(false)
  expect(sameModel('fable', 'claude-fable-5-1')).toBe(true)
  expect(sameModel('', 'sonnet')).toBe(false)
})

test('a brief is told from a report or a checks file by its path; the dispatch id is read from a receipt either way', () => {
  const prompt = `Read ${DIR}/tasks/A-r1.md and ${DIR}/tasks/A-r1-report.md, ${DIR}/tasks/A-r1-checks.md, also .relay/runs/${RUN}/tasks/B2-r12.md.`
  expect(briefsIn(prompt)).toEqual([{ run: RUN, id: 'A', rev: 1 }, { run: RUN, id: 'B2', rev: 12 }])
  expect(briefsIn('no path here')).toEqual([])
  expect(dispatchIdIn('x\ndispatchId=ctx_abc.1\n')).toBe('ctx_abc.1')
  expect(dispatchIdIn('{"dispatchId": "ctx_json"}')).toBe('ctx_json')
  expect(dispatchIdIn('started, no id')).toBeUndefined()
})

// ── Gate 1, Orca ──────────────────────────────────────────────

test('a repository with no run lets every launch through and reads no run file', async ($, on) => {
  const sim = standIn(on)
  const denied = await bash($, launch('/anywhere/spec.md', ''))

  expect(denied.deny).toBeUndefined()
  expect(sim.commands).toHaveLength(1)
  expect(sim.relayReads).toEqual([])
  expect(sim.relayLists).toEqual([])
})

test('a call that is no worker start or names no brief costs the gate no file or git read', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  sim.ownGit.length = 0
  sim.relayReads.length = 0
  sim.relayExists.length = 0
  sim.relayLists.length = 0

  // Unrelated calls arrive unchanged; the gate asks for no run file and no git top folder.
  await bash($, 'git log --grep worker-start && echo orca')
  await bash($, 'echo "orca orchestration worker-start --spec-file x"')
  await bash($, 'ls -la')
  const plain = await spawn($, 'Search the repository for the word relay.', '검색', 'haiku')
  const report = await spawn($, `Read ${DIR}/tasks/A-r1-report.md and say what it holds.`, '읽기')
  expect(plain.deny !== undefined || report.deny !== undefined).toBe(false)

  expect(sim.commands).toEqual(['git log --grep worker-start && echo orca', 'echo "orca orchestration worker-start --spec-file x"', 'ls -la'])
  expect(sim.spawned).toHaveLength(2)
  expect(sim.relayReads).toEqual([])
  expect(sim.relayLists).toEqual([])
  expect(sim.relayExists).toEqual([])
  expect(sim.ownGit).toEqual([])
})

test('with no run folder a launch asks one existence only, and git for the top folder once across calls', async ($, on) => {
  const sim = standIn(on)
  const first = await bash($, launch('/x.md'))
  const second = await bash($, launch('/y.md'))
  const third = await spawn($, `Follow ${DIR}/tasks/A-r1.md`, 'A', 'sonnet')

  expect(first.deny).toBeUndefined()
  expect(second.deny).toBeUndefined()
  expect(third.deny).toBeUndefined()
  expect(sim.commands).toHaveLength(2)
  expect(sim.spawned).toHaveLength(1)
  expect(sim.ownGit).toHaveLength(1)
  expect(sim.relayReads).toEqual([])
  expect(sim.relayLists).toEqual([])
  expect(sim.relayExists.every(path => path === `${ROOT}/.relay/runs`)).toBe(true)
})

test('inside a run too, the top folder is asked of git once for many launches', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const b = await newTask($, 'B')
  sim.ownGit.length = 0

  await bash($, launch('/other.md'))
  await bash($, launch(a))
  await bash($, launch(b))
  await spawn($, `Look at ${DIR}/tasks/A-r1.md`, 'A', 'sonnet')

  expect(sim.ownGit).toHaveLength(1)
})

test('inside a run, a launch with no brief file is refused unless it says no-relay', async ($, on) => {
  const sim = standIn(on)
  await newRun($)

  const none = await bash($, 'orca orchestration worker-start --spec "do it" --worktree current --agent claude')
  expect(none.deny).toContain(`relay 묶음 ${RUN}이 진행 중입니다.`)
  expect(none.deny).toContain('--spec-file')
  expect(none.deny).toContain('--comment no-relay')
  expect(sim.commands).toEqual([])

  const stdin = await bash($, 'orca orchestration worker-start --spec-file - --agent claude')
  expect(stdin.deny).toContain('--spec-file')

  const other = await bash($, 'orca orchestration worker-start --spec "something else" --agent claude --comment no-relay')
  expect(other.deny).toBeUndefined()
  expect(sim.commands).toHaveLength(1)
})

test('a spec file that is none of the run\'s briefs is other work and passes', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  await newTask($, 'A')

  expect((await bash($, launch('/tmp/other-spec.md', ''))).deny).toBeUndefined()
  expect((await bash($, launch(`${DIR}/tasks/A-r1-report.md`, ''))).deny).toBeUndefined()
  expect(sim.commands).toHaveLength(2)
})

test("the run's own brief, unchanged, on its model and effort, goes out; the receipt marks the task running", async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')

  const sent = await bash($, launch(spec))
  expect(sent.deny).toBeUndefined()
  expect(sim.commands).toEqual([launch(spec)])
  const task = state(sim).tasks[0]
  expect(task?.status).toBe('running')
  expect(task?.runner).toBe('orca dispatch:ctx_abc123')
})

test('a receipt with no dispatch id, or a launch that failed, marks nothing', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')

  sim.receipt = 'started, nothing else printed'
  expect((await bash($, launch(spec))).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('ready')

  sim.receipt = RECEIPT
  sim.isLaunchFailed = true
  await bash($, launch(spec))
  expect(state(sim).tasks[0]?.status).toBe('ready')
})

test('a relative brief path and orca-dev are read the same', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  await newTask($, 'A')

  const sent = await bash($, 'orca-dev orchestration worker-start --spec-file .relay/runs/2026-11-09-demo/tasks/A-r1.md --agent claude --model claude-sonnet-5-5 --effort high')
  expect(sent.deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
})

test('a launch that overlaps a running task is refused, and says which', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['hooks/relay/**'] })
  const b = await newTask($, 'B', { edit_scope: ['hooks/relay/gate.ts'] })
  const c = await newTask($, 'C', { edit_scope: ['elsewhere/**'] })
  expect((await bash($, launch(a))).deny).toBeUndefined()

  const clash = await bash($, launch(b))
  expect(clash.deny).toContain('B-r1')
  expect(clash.deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect((await bash($, launch(c))).deny).toBeUndefined()
  expect(sim.commands).toHaveLength(2)
  expect(state(sim).tasks.map(task => task.status)).toEqual(['running', 'ready', 'running'])
})

test('a brief edited after it was written is refused: a new revision is made instead', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')
  sim.files[spec] = `${sim.files[spec]}\n- one more rule`

  const edited = await bash($, launch(spec))
  expect(edited.deny).toContain('보낸 뒤 고친 지시서')
  expect(edited.deny).toContain('relay task로 새 판을 만드세요')
  expect(sim.commands).toEqual([])
})

test('a model or effort other than the brief names, or none, is refused', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')

  expect((await bash($, launch(spec, '--model claude-opus-5-5 --effort high'))).deny).toContain('--model claude-opus-5-5이 지시서의 모델 claude-sonnet-5-5과 다릅니다')
  expect((await bash($, launch(spec, '--effort high'))).deny).toContain('--model이 없습니다')
  expect((await bash($, launch(spec, '--model claude-sonnet-5-5 --effort xhigh'))).deny).toContain('--effort xhigh가 지시서의 effort high와 다릅니다')
  expect((await bash($, launch(spec, '--model claude-sonnet-5-5'))).deny).toContain('--effort가 없습니다')
  expect(sim.commands).toEqual([])
  expect(state(sim).tasks[0]?.status).toBe('ready')
})

test('a superseded revision cannot be launched', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const first = await newTask($, 'A')
  await newTask($, 'A')

  const old = await bash($, launch(first))
  expect(old.deny).toContain('취소된 판')
  expect(sim.commands).toEqual([])
  expect((await bash($, launch(`${DIR}/tasks/A-r2.md`))).deny).toBeUndefined()
})

// ── Gate 1, subagents ──────────────────────────────────────────────

test('a subagent whose prompt names no brief of the run starts untouched', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  await newTask($, 'A')

  const started = await spawn($, `Look at ${DIR}/tasks/A-r1-report.md and tell me what it says.`, '읽기')
  expect(started.deny).toBeUndefined()
  expect(sim.spawned).toHaveLength(1)
  expect(sim.spawned[0]?.model).toBeUndefined()
})

test("a subagent given the run's brief on an alias or an ID of its model starts, and the task is marked with its agent", async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const b = await newTask($, 'B')

  const byAlias = await spawn($, `Follow ${a}.`, 'A', 'sonnet')
  expect(byAlias.deny).toBeUndefined()
  const byId = await spawn($, `Follow ${b}.`, 'B', 'claude-sonnet-5-5')
  expect(byId.deny).toBeUndefined()

  const [taskA, taskB] = state(sim).tasks
  expect(taskA?.status).toBe('running')
  expect(taskA?.runner).toBe('subagent ag-1')
  expect(taskB?.runner).toBe('subagent ag-1')
  expect(sim.spawned).toHaveLength(2)
})

test('a subagent with the brief and no model, or another one, is refused', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')

  const none = await spawn($, `Follow ${a}.`, 'A')
  expect((none.deny ?? '')).toContain('모델이 지정되지 않았습니다')
  const other = await spawn($, `Follow ${a}.`, 'A', 'opus')
  expect((other.deny ?? '')).toContain('model opus이 지시서의 모델 claude-sonnet-5-5과 다릅니다')
  expect(sim.spawned).toEqual([])
  expect(state(sim).tasks[0]?.status).toBe('ready')
})

test('a subagent on a brief that overlaps a running task, or was edited, is refused', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['hooks/**'] })
  const b = await newTask($, 'B', { edit_scope: ['hooks/relay/gate.ts'] })
  const c = await newTask($, 'C')
  expect((await spawn($, `Follow ${a}.`, 'A', 'sonnet')).deny).toBeUndefined()

  const clash = await spawn($, `Follow ${b}.`, 'B', 'sonnet')
  expect((clash.deny ?? '')).toContain('돌고 있는 A-r1와 겹칩니다')
  sim.files[c] = `${sim.files[c]}\nchanged`
  const edited = await spawn($, `Follow ${c}.`, 'C', 'sonnet')
  expect((edited.deny ?? '')).toContain('보낸 뒤 고친 지시서')
  expect(sim.spawned).toHaveLength(1)
})

test('a brief of a run that is finished is no gate', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const finished = state(sim)
  finished.status = 'finished'
  sim.files[`${DIR}/state.json`] = JSON.stringify(finished)

  expect((await spawn($, `Follow ${a}.`, 'A')).deny).toBeUndefined()
  expect((await bash($, 'orca orchestration worker-start --spec "x" --agent claude')).deny).toBeUndefined()
  expect(sim.spawned).toHaveLength(1)
  expect(sim.commands).toHaveLength(1)
})

// ── Gate 2, the answer's end ──────────────────────────────────────────────

/** Sets the tasks' statuses and the verdicts straight in the state. */
function setState(sim: Sim, change: (state: RelayState) => void): void {
  const next = state(sim)
  change(next)
  sim.files[`${DIR}/state.json`] = JSON.stringify(next)
}

async function answer($: Engine): Promise<string> {
  return (await $.turn.complete({ answer: '끝났습니다.', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })).text
}

test('an answer that ends with finished work and no verdict at HEAD gets the warning line', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  await newTask($, 'A')
  setState(sim, s => {
    s.tasks[0]!.status = 'done'
  })

  expect(await answer($)).toBe(`⚠ relay ${RUN}: 검증되지 않은 판입니다(HEAD ${HEAD_1.slice(0, 7)}, 마지막 판정 없음). 끝내기 전에 package → 다른 모델 검증 → finish.`)

  setState(sim, s => {
    s.verdicts = [{ id: 'V1', at: NOON, commit: HEAD_2, path: `${DIR}/reviews/V1-verdict.json`, result: 'pass' }]
  })
  expect(await answer($)).toBe(`⚠ relay ${RUN}: 검증되지 않은 판입니다(HEAD ${HEAD_1.slice(0, 7)}, 마지막 판정 ${HEAD_2.slice(0, 7)}). 끝내기 전에 package → 다른 모델 검증 → finish.`)
})

test('no warning while a task runs, is blocked or waits for context; none when the last verdict is of HEAD; none without finished work', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  await newTask($, 'A')
  await newTask($, 'B')
  expect(await answer($)).toBe('')

  for (const open of ['running', 'needs_context', 'blocked'] as const) {
    setState(sim, s => {
      s.tasks[0]!.status = 'done_with_concerns'
      s.tasks[1]!.status = open
    })
    expect(await answer($)).toBe('')
  }

  setState(sim, s => {
    s.tasks[1]!.status = 'done'
    s.verdicts = [{ id: 'V1', at: NOON, commit: HEAD_1.slice(0, 12), path: `${DIR}/reviews/V1-verdict.json`, result: 'pass' }]
  })
  expect(await answer($)).toBe('')
})

test('a subagent\'s end, an interrupted answer and a repository with no run folder get no line and no run file read', async ($, on) => {
  const sim = standIn(on)
  expect(await answer($)).toBe('')
  expect(sim.relayReads).toEqual([])
  expect(sim.relayLists).toEqual([])

  await newRun($)
  await newTask($, 'A')
  setState(sim, s => {
    s.tasks[0]!.status = 'done'
  })
  expect((await $.turn.complete({ answer: '', isAborted: true, reason: 'aborted', turnId: 't2', durationMs: 10 })).text).toBe('')
  expect((await $.turn.complete({ answer: 'x', isAborted: false, reason: 'answer', turnId: 't3', durationMs: 10, agentId: 'ag-9' })).text).toBe('')
})
