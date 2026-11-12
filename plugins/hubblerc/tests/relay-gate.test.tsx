import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { dispatchIdIn, mayLaunch, readOrcaCalls, resolvePath, runPathsIn, sameModel } from '../hooks/relay/gate'
import { taskKey } from '../hooks/relay/relay-format'
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
  /** A launch waits here (when set) before it answers: how two launches are in flight at once. */
  hold: Promise<void> | undefined
  /** The launch throws. */
  isLaunchThrowing: boolean
  /** Runs while a launch is out (inside the tool below the plugin): how a brief is changed during the launch. */
  whileLaunching: (() => void) | undefined
  /** What the gate costs: reads of anything under .relay, and git asked for the top folder. */
  relayReads: string[]
  relayExists: string[]
  relayLists: string[]
  toplevelAsks: number
  headAsks: number
  /** Git asked for the repository's top folder with no folder named: how the gate asks, where the plugin's other hooks name theirs. */
  ownGit: string[][]
  /**
   * The finished subagents a SendMessage resumes, by the address it is sent to: the engine raises
   * `agent.spawn` with `resume` and the message as the prompt, through every hook, and answers the
   * call `{ success: false, message }` when that resume was refused (as seen 2026-11-11).
   */
  finished: Record<string, string>
  /** The test's engine, which raises the resume through the plugin (a stand-in hook's own `$` may not spawn: host rule). */
  engine: Engine | undefined
  /** The resumes that reached the engine (none refused above it), and a refusal beneath for them (another plugin declining). */
  resumed: { prompt: string; agentId: string }[]
  resumeDeny: string | undefined
  /** What a SendMessage answers instead of its usual record (a failure's shape), and a subagent start refused beneath. */
  sendAnswer: Record<string, unknown> | undefined
  spawnDeny: string | undefined
  /** Every state.json the tool wrote, in order: how a task's statuses went. */
  stateWrites: string[]
}

/** Stands for the engine beneath the plugin: files in memory, a repository, a Bash tool that prints a receipt, a subagent start. */
function standIn(on: On): Sim {
  const sim: Sim = { files: {}, head: HEAD_1, commands: [], spawned: [], receipt: RECEIPT, isLaunchFailed: false, hold: undefined, isLaunchThrowing: false, whileLaunching: undefined, relayReads: [], relayExists: [], relayLists: [], toplevelAsks: 0, headAsks: 0, ownGit: [], finished: {}, engine: undefined, resumed: [], resumeDeny: undefined, sendAnswer: undefined, spawnDeny: undefined, stateWrites: [] }
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
    if (e.path === `${DIR}/state.json`) sim.stateWrites.push(e.text)

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
  on('tool.call', async (_, e) => {
    if (e.tool === 'Agent') {
      // A start refused beneath errors the Agent call, its reason as the text.
      if (sim.spawnDeny !== undefined) return { isError: true as const, result: sim.spawnDeny, text: sim.spawnDeny }

      return { result: { status: 'async_launched', agentId: 'ag-1' } as never }
    }
    if (e.tool === 'SendMessage') {
      const to = String(e.to)
      sim.commands.push(`SendMessage ${to}: ${String(e.message)}`)
      sim.whileLaunching?.()
      if (sim.sendAnswer !== undefined) return sim.sendAnswer as never
      const agentId = sim.finished[to]
      if (agentId === undefined || sim.engine === undefined) return { result: {} as never }
      // A finished subagent: resumed inside the call, on the model it started on, the call answered once the resume is decided.
      const resume = { tool_use_id: 'toolu_first_start', prompt: String(e.message), description: 'worker', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, model: 'claude-sonnet-5-5', parentModel: 'claude-opus-5-5', resume: { agentId } }
      const resumed = (await sim.engine.agent.spawn(resume as never)) as { deny?: string }
      const record = resumed.deny === undefined ? { success: true, message: `Agent "${to}" was stopped; resumed it in the background with your message.` } : { success: false, message: `a plugin declined the resume: ${resumed.deny}` }

      return { result: record as never, text: JSON.stringify(record) }
    }
    if (e.tool === 'Bash') {
      sim.commands.push(String((e as { command?: unknown }).command))
      await sim.hold
      sim.whileLaunching?.()
      if (sim.isLaunchThrowing) throw new Error('the Bash tool broke')
      if (sim.isLaunchFailed) return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }

      return { result: { stdout: sim.receipt, stderr: '' } as never, text: sim.receipt }
    }

    return { result: {} as never }
  })
  on('agent.spawn', async (_, e) => {
    if (e.resume !== undefined) {
      if (sim.resumeDeny !== undefined) return { deny: sim.resumeDeny }
      sim.resumed.push({ prompt: e.prompt, agentId: e.resume.agentId })

      return { model: 'claude-sonnet-5-5', agentId: e.resume.agentId }
    }
    if (sim.spawnDeny !== undefined) return { deny: sim.spawnDeny }
    sim.spawned.push({ prompt: e.prompt, model: e.model })
    await sim.hold
    sim.whileLaunching?.()

    return { model: e.model ?? 'inherited-model', agentId: `ag-${sim.spawned.length}` }
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
async function spawn($: Engine, prompt: string, description: string, model?: string, toolUseId = 'toolu_1'): Promise<{ deny?: string; agentId?: string }> {
  const input = { tool_use_id: toolUseId, prompt, description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', ...(model === undefined ? {} : { model }) }

  return (await $.agent.spawn(input as never)) as { deny?: string; agentId?: string }
}

const launch = (spec: string, rest = '--model claude-sonnet-5-5 --effort high') => `orca orchestration worker-start --spec-file ${spec} --worktree current --agent claude ${rest} --task-title "A: x"`

// ── Reading a command, pure ──────────────────────────────────────────────

test('worker-start and send are found in an orca, orca-dev or orca-ide command with their options, and nowhere else', () => {
  const [start] = readOrcaCalls('cd /x && ORCA_HOME=/y /usr/local/bin/orca-dev orchestration worker-start --spec-file /s.md --model=opus --json --effort high --comment "no-relay: other" 2>&1') ?? []
  expect(start?.sub).toBe('worker-start')
  expect(start?.options.get('--spec-file')).toBe('/s.md')
  expect(start?.options.get('--model')).toBe('opus')
  expect(start?.options.get('--json')).toBe(true)
  expect(start?.options.get('--effort')).toBe('high')
  expect(start?.options.get('--comment')).toBe('no-relay: other')
  expect(start?.shifts).toBe(true)
  const [send] = readOrcaCalls('orca orchestration send --to dispatch:ctx_1 --body "Read and follow: /a b/c.md"') ?? []
  expect(send?.sub).toBe('send')
  expect(send?.shifts).toBe(false)
  expect(send?.options.get('--to')).toBe('dispatch:ctx_1')
  expect(send?.words).toContain('Read and follow: /a b/c.md')
  expect(readOrcaCalls('orca-ide orchestration worker-start --spec-file x')).toHaveLength(1)
  expect(readOrcaCalls('orca orchestration worker-list')).toEqual([])
  expect(readOrcaCalls('echo "orca orchestration worker-start --spec-file x"')).toEqual([])
  expect(readOrcaCalls('git log --grep worker-start')).toEqual([])
  expect(readOrcaCalls('echo "unclosed')).toBeUndefined()
})

test('V1-10: a here-document, a comment, a quoted word and $( ) hold no command; a launch after them is found', () => {
  const doc = "cat <<'EOF'\norca orchestration worker-start --spec example\nEOF"
  expect(readOrcaCalls(doc)).toEqual([])
  expect(readOrcaCalls('# orca orchestration worker-start --spec x\nls')).toEqual([])
  expect(readOrcaCalls('echo orca orchestration worker-start')).toEqual([])
  expect(readOrcaCalls("grep 'orca orchestration worker-start' notes.md")).toEqual([])
  expect(readOrcaCalls("cat <<EOF\nx\nEOF\norca orchestration worker-start --spec-file a.md")).toHaveLength(1)
  expect(readOrcaCalls('echo hi; (orca orchestration worker-start --spec-file a.md)')).toHaveLength(1)
  expect(readOrcaCalls('x=$(orca orchestration worker-start --spec-file a.md)')).toHaveLength(1)
  expect(readOrcaCalls('orca orchestration send --to d --body "$(cat <<EOF\nRead x\nEOF\n)"')).toHaveLength(1)
  // The text test lets only a call that names a launch (or a send of a brief) go on to be read.
  expect(mayLaunch('ls -la')).toBe(false)
  expect(mayLaunch('orca orchestration send --to d --body hi')).toBe(false)
  expect(mayLaunch('orca orchestration send --to d --body ".relay/runs/x"')).toBe(true)
  expect(mayLaunch(doc)).toBe(true)
})

test('V1-09: a path is made absolute against the working folder, with . .. and // taken out', () => {
  expect(resolvePath('/a/b/../c//./d.md', '/cwd')).toBe('/a/c/d.md')
  expect(resolvePath('tasks/../tasks/A-r1.md', '/repo/work/.relay')).toBe('/repo/work/.relay/tasks/A-r1.md')
  expect(resolvePath('../x', '/repo/work')).toBe('/repo/x')
  expect(runPathsIn(`Read ${DIR}/tasks/../tasks/A-r1.md. Then .relay/runs/${RUN}/tasks/B-r1.md: go, "(${DIR}/tasks/C-r1.md)"`)).toEqual([`${DIR}/tasks/../tasks/A-r1.md`, `.relay/runs/${RUN}/tasks/B-r1.md`, `${DIR}/tasks/C-r1.md`])
  expect(runPathsIn('no path here')).toEqual([])
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

test('the dispatch id is read from a receipt either way', () => {
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
  expect(none.deny).toContain(`relay run ${RUN}이 진행 중입니다.`)
  expect(none.deny).toContain('--spec-file')
  expect(none.deny).toContain('--comment no-relay')
  expect(sim.commands).toEqual([])

  const stdin = await bash($, 'orca orchestration worker-start --spec-file - --agent claude')
  expect(stdin.deny).toContain('--spec-file')

  const other = await bash($, 'orca orchestration worker-start --spec "something else" --agent claude --comment no-relay')
  expect(other.deny).toBeUndefined()
  expect(sim.commands).toHaveLength(1)
})

test('inside a run, a worker-start or send asking for --help or -h passes with no check and no claim; -h as a value is no help', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')
  const writes = sim.stateWrites.length

  const asks = [
    'orca orchestration worker-start --help',
    'orca orchestration worker-start -h',
    `orca orchestration worker-start --spec-file ${spec} --help`,
    `orca orchestration send --to dispatch:ctx_1 --body "Read and follow: ${spec}" -h`,
    `orca orchestration send --help --to dispatch:ctx_1 --body "Read and follow: ${spec}"`,
  ]
  for (const command of asks) expect((await bash($, command)).deny).toBeUndefined()
  expect(sim.commands).toEqual(asks)
  expect(sim.stateWrites).toHaveLength(writes)
  expect(state(sim).tasks[0]?.status).toBe('ready')
  expect(state(sim).tasks[0]?.runner).toBeNull()
  expect(readOrcaCalls('orca orchestration worker-start --help --json')?.[0]?.isHelp).toBe(true)
  expect(readOrcaCalls('orca orchestration worker-start --spec-file x.md')?.[0]?.isHelp).toBe(false)

  // An option's value that reads -h, and a worker-start with no brief and no help, are refused as before.
  const valued = await bash($, 'orca orchestration worker-start --spec -h --agent claude')
  expect(valued.deny).toContain(`relay run ${RUN}이 진행 중입니다.`)
  const none = await bash($, 'orca orchestration worker-start --spec "do it" --agent claude')
  expect(none.deny).toContain(`relay run ${RUN}이 진행 중입니다.`)
  expect(sim.commands).toEqual(asks)
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

test('V1-07: a receipt with no dispatch id still marks the task running, as unconfirmed; a launch that failed or threw leaves it ready', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')

  sim.isLaunchFailed = true
  await bash($, launch(spec))
  expect(state(sim).tasks[0]?.status).toBe('ready')
  expect(state(sim).tasks[0]?.runner).toBeNull()

  sim.isLaunchFailed = false
  sim.receipt = 'started, nothing else printed'
  expect((await bash($, launch(spec))).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect(state(sim).tasks[0]?.runner).toBe('orca (dispatch id 미확인)')
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
  expect(edited.deny).toContain('보낸 뒤 고친 brief')
  expect(edited.deny).toContain('relay task로 새 revision을 만드세요')
  expect(sim.commands).toEqual([])
})

test('a model or effort other than the brief names, or none, is refused', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const spec = await newTask($, 'A')

  expect((await bash($, launch(spec, '--model claude-opus-5-5 --effort high'))).deny).toContain('--model claude-opus-5-5이 brief의 모델 claude-sonnet-5-5과 다릅니다')
  expect((await bash($, launch(spec, '--effort high'))).deny).toContain('--model이 없습니다')
  expect((await bash($, launch(spec, '--model claude-sonnet-5-5 --effort xhigh'))).deny).toContain('--effort xhigh가 brief의 effort high와 다릅니다')
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
  expect(old.deny).toContain('cancelled 상태')
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
  expect(taskB?.runner).toBe('subagent ag-2')
  expect(sim.spawned).toHaveLength(2)
})

test('a subagent with the brief and no model, or another one, is refused', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')

  const none = await spawn($, `Follow ${a}.`, 'A')
  expect((none.deny ?? '')).toContain('모델이 지정되지 않았습니다')
  const other = await spawn($, `Follow ${a}.`, 'A', 'opus')
  expect((other.deny ?? '')).toContain('model opus이 brief의 모델 claude-sonnet-5-5과 다릅니다')
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
  expect((edited.deny ?? '')).toContain('보낸 뒤 고친 brief')
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

// ── V1-07 to V1-11, the review's findings ──────────────────────────────────────────────

/** Lets the calls in flight run on (real time; the test's own stand-in has no clock to move). */
const pause = (): Promise<void> => new Promise(resolve => (globalThis as unknown as { setTimeout: (done: () => void, ms: number) => void }).setTimeout(resolve, 50))

/** A start that waits, to be let go by `release()`: how launches are kept in flight at the same time. */
function holdLaunches(sim: Sim): () => void {
  let release: () => void = () => undefined
  sim.hold = new Promise<void>(resolve => {
    release = resolve
  })

  return release
}

test('V1-07: two subagents started at once on overlapping files: one starts, the other is refused, and the state keeps both claims', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['src/**'] })
  const b = await newTask($, 'B', { edit_scope: ['src/**'] })
  const release = holdLaunches(sim)

  const both = Promise.all([spawn($, `Follow ${a}.`, 'A', 'sonnet'), spawn($, `Follow ${b}.`, 'B', 'sonnet')])
  // The first is in flight (claimed, waiting); the second must have been refused by now.
  await pause()
  expect(state(sim).tasks.map(task => task.status).sort()).toEqual(['launching', 'ready'])
  release()
  const [first, second] = await both

  const denied = [first, second].filter(result => result.deny !== undefined)
  expect(denied).toHaveLength(1)
  expect(denied[0]?.deny).toContain('돌고 있는')
  expect(sim.spawned).toHaveLength(1)
  const tasks = state(sim).tasks
  expect(tasks.filter(task => task.status === 'running')).toHaveLength(1)
  expect(tasks.filter(task => task.status === 'ready')).toHaveLength(1)
  expect(tasks.find(task => task.status === 'running')?.runner).toBe('subagent ag-1')
})

test('V1-07: two Orca launches at once on overlapping files: one goes out, the other is refused', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['src/**'] })
  const b = await newTask($, 'B', { edit_scope: ['src/b.ts'] })
  const release = holdLaunches(sim)

  const both = Promise.all([bash($, launch(a)), bash($, launch(b))])
  await pause()
  release()
  const results = await both

  expect(results.filter(result => result.deny !== undefined)).toHaveLength(1)
  expect(sim.commands).toHaveLength(1)
  const tasks = state(sim).tasks
  expect(tasks.filter(task => task.status === 'running').map(task => task.runner)).toEqual(['orca dispatch:ctx_abc123'])
  expect(tasks.filter(task => task.status === 'ready')).toHaveLength(1)
})

test('V1-07: a launch that throws leaves its task ready, and a launch the gate refused never claims it', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  sim.isLaunchThrowing = true
  await bash($, launch(a)).catch(() => undefined)
  expect(state(sim).tasks[0]?.status).toBe('ready')

  sim.isLaunchThrowing = false
  expect((await bash($, launch(a, '--model claude-opus-5-5 --effort high'))).deny).toContain('--model')
  expect(state(sim).tasks[0]?.status).toBe('ready')
  expect((await bash($, launch(a))).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  // The same brief again is a duplicate: the task is running, not ready.
  expect((await bash($, launch(a))).deny).toContain('running 상태')
  expect(sim.commands.filter(command => command.startsWith('orca'))).toHaveLength(2)
})

test('V1-08: two worker-starts in one command are refused, the second one hidden behind a good first included', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  await newTask($, 'B')

  const two = await bash($, `${launch(a)}; ${launch(a, '--model wrong --effort high')}`)
  expect(two.deny).toContain('한 번에 하나씩 띄우세요')
  expect((await bash($, `${launch(a)} && ${launch(`${DIR}/tasks/B-r1.md`)}`)).deny).toContain('한 번에 하나씩')
  expect(sim.commands).toEqual([])
  expect(state(sim).tasks.map(task => task.status)).toEqual(['ready', 'ready'])

  // A start beside a no-relay one is one start; two no-relay ones are other work.
  const other = 'orca orchestration worker-start --spec "x" --agent claude --comment no-relay'
  expect((await bash($, `${other}; ${launch(a)}`)).deny).toBeUndefined()
  expect((await bash($, `${other}; ${other}`)).deny).toBeUndefined()
})

test('V1-09: the brief by a .. path or a // one is still the run\'s brief, so its model and effort are checked', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const dotdot = `${DIR}/tasks/../tasks/A-r1.md`

  expect((await bash($, `orca orchestration worker-start --spec-file ${dotdot}`)).deny).toContain('--model이 없습니다')
  expect((await bash($, `orca orchestration worker-start --spec-file ${DIR}//tasks/./A-r1.md`)).deny).toContain('--model이 없습니다')
  expect((await bash($, `orca orchestration worker-start --spec-file .relay/runs/${RUN}/../${RUN}/tasks/A-r1.md --model x --effort high`)).deny).toContain('--model x')
  expect((await spawn($, `Follow ${DIR}/tasks/../tasks/A-r1.md.`, 'A', 'opus')).deny).toContain('model opus')
  expect((await spawn($, `Follow .relay/runs/${RUN}/../${RUN}/tasks/A-r1.md.`, 'A')).deny).toContain('모델이 지정되지 않았습니다')
  expect(sim.commands).toEqual([])
  expect(sim.spawned).toEqual([])

  expect((await bash($, launch(dotdot))).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect(a).toContain('A-r1.md')
})

test('V1-09b: where the command may have moved the working folder (a subshell\'s cd, cd, pushd, $( )), a relative path to a brief is refused; an absolute one is checked as always', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const relative = `.relay/runs/${RUN}/tasks/A-r1.md`
  const flags = '--model claude-sonnet-5-5 --effort high'
  const start = (spec: string) => `orca orchestration worker-start --spec-file ${spec} ${flags}`

  for (const command of [`(cd /tmp); ${start(relative)}`, `cd /tmp && ${start(relative)}`, `pushd /tmp >/dev/null; ${start(relative)}`, `cd ${DIR}/tasks && ${start('A-r1.md')}`, start(`$(pwd)/${relative}`), `(cd /tmp && true); ${start(relative)}`, `${start(relative)}; cd /tmp`]) {
    const refused = await bash($, command)
    expect(refused.deny).toContain('brief는 절대 경로로 주세요')
  }
  expect(sim.commands).toEqual([])
  expect(state(sim).tasks[0]?.status).toBe('ready')

  // The same brief by its absolute path is the run's brief wherever the command stands: its checks apply.
  expect((await bash($, `(cd /tmp); orca orchestration worker-start --spec-file ${a}`)).deny).toContain('--model이 없습니다')
  expect((await bash($, `cd /tmp && ${start(a)}`)).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')

  // Without such syntax a relative path is read against the session's folder, as before.
  const b = await newTask($, 'B', { edit_scope: ['other/**'] })
  expect(b).toContain('B-r1.md')
  expect((await bash($, start(`.relay/runs/${RUN}/tasks/B-r1.md`))).deny).toBeUndefined()
  expect(state(sim).tasks[1]?.status).toBe('running')
})

test('V1-09b: a relative brief in an orca send beside a cd or a subshell is refused; a report path or an absolute brief is not', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const send = (body: string) => `orca orchestration send --to dispatch:ctx_1 --body "${body}"`

  expect((await bash($, `(cd /tmp); ${send(`Read .relay/runs/${RUN}/tasks/A-r1.md`)}`)).deny).toContain('brief는 절대 경로로 주세요')
  expect((await bash($, `cd /tmp && ${send(`Read .relay/runs/${RUN}/tasks/A-r1.md`)}`)).deny).toContain('brief는 절대 경로로 주세요')
  expect(sim.commands).toEqual([])
  expect((await bash($, `cd /tmp && ${send(`See .relay/runs/${RUN}/tasks/A-r1-report.md`)}`)).deny).toBeUndefined()
  expect((await bash($, `(cd /tmp); ${send(`Read ${a}`)}`)).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
})

test('V1-07b: a brief changed while the worker was being started leaves the task blocked, and the lead reads why after the tool result', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  sim.whileLaunching = () => {
    sim.files[a] = `${sim.files[a]}\nWEAKENED criterion`
  }

  const ran = (await $.tool.call({ tool: 'Bash', command: launch(a), description: '워커' } as never)) as { deny?: string; context?: string[]; text?: string }
  expect(ran.deny).toBeUndefined()
  expect(ran.text).toContain('dispatchId=ctx_abc123')
  expect(ran.context).toHaveLength(1)
  expect(ran.context?.[0]).toContain('⚠ relay: A-r1를 blocked로 두었습니다')
  expect(ran.context?.[0]).toContain('띄우는 동안 brief가 바뀌었습니다')
  expect(ran.context?.[0]).toContain('orca dispatch:ctx_abc123')
  const task = state(sim).tasks[0]
  expect(task?.status).toBe('blocked')
  expect(task?.runner).toBe('orca dispatch:ctx_abc123')
})

test('V1-07b: the same note follows a SendMessage and an Agent call; a launch that recorded cleanly adds none', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['area-a/**'] })
  const b = await newTask($, 'B', { edit_scope: ['area-b/**'] })
  const c = await newTask($, 'C', { edit_scope: ['area-c/**'] })
  const message = (to: string, text: string) => $.tool.call({ tool: 'SendMessage', to, message: text } as never) as Promise<{ deny?: string; context?: string[] }>
  // The engine starts the subagent inside the Agent call; the test starts it, then lets the call answer.
  const agent = async (prompt: string, toolUseId: string) => {
    const spawned = await spawn($, prompt, 'B', 'sonnet', toolUseId)
    const answered = (await $.tool.call({ tool: 'Agent', tool_use_id: toolUseId, prompt, description: 'B', model: 'sonnet' } as never)) as { deny?: string; context?: string[]; result?: { agentId?: string } }

    return { ...answered, deny: spawned.deny ?? answered.deny, spawnedId: spawned.agentId }
  }

  const clean = await message('worker-1', `Read ${c}.`)
  expect(clean.deny).toBeUndefined()
  expect(clean.context).toBeUndefined()
  expect(state(sim).tasks[2]?.status).toBe('running')

  sim.whileLaunching = () => {
    sim.files[a] = `${sim.files[a]}\nchanged`
  }
  const sent = await message('worker-1', `Read ${a}.`)
  expect(sent.context?.[0]).toContain('⚠ relay: A-r1를 blocked로 두었습니다')
  expect(sent.context?.[0]).toContain('subagent worker-1')

  sim.whileLaunching = () => {
    sim.files[b] = `${sim.files[b]}\nchanged`
  }
  const started = await agent(`Follow ${b}.`, 'toolu_b')
  expect(started.deny).toBeUndefined()
  expect(started.spawnedId).toBe('ag-1')
  expect(started.context?.[0]).toContain('⚠ relay: B-r1를 blocked로 두었습니다')
  expect(started.context?.[0]).toContain('subagent ag-1')
  expect(state(sim).tasks.map(task => task.status)).toEqual(['blocked', 'blocked', 'running'])

  // The note is for that call alone.
  sim.whileLaunching = undefined
  const plain = await agent('Search the repository for the word relay.', 'toolu_plain')
  expect(plain.context).toBeUndefined()
})

test('V1-10: a here-document or a message that holds the words of a launch is no launch; a real launch beside them is checked', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')

  const doc = "cat <<'EOF'\norca orchestration worker-start --spec example\nEOF"
  expect((await bash($, doc)).deny).toBeUndefined()
  expect((await bash($, "echo 'orca orchestration worker-start --spec x'")).deny).toBeUndefined()
  expect((await bash($, `git commit -m "Gate orca orchestration send of ${DIR}/tasks/A-r1.md"`)).deny).toBeUndefined()
  expect((await bash($, `# orca orchestration worker-start\nls`)).deny).toBeUndefined()
  expect(sim.commands).toHaveLength(4)
  expect(state(sim).tasks[0]?.status).toBe('ready')

  expect((await bash($, `${doc}\norca orchestration worker-start --spec "x" --agent claude`)).deny).toContain('--spec-file')
  expect((await bash($, `${doc}\n${launch(a)}`)).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
})

test('V1-11: a brief sent to a worker already out with orca send is checked and noted: ready, clear of the others, unchanged', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['src/**'] })
  const b = await newTask($, 'B', { edit_scope: ['src/b.ts'] })
  const c = await newTask($, 'C', { edit_scope: ['elsewhere/**'] })
  const send = (spec: string, to = 'dispatch:ctx_old') => `orca orchestration send --to ${to} --subject "x" --body "Read and follow: ${spec}"`
  sim.receipt = 'sent'

  expect((await bash($, send(a))).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect(state(sim).tasks[0]?.runner).toBe('orca dispatch:ctx_old')

  const clash = await bash($, send(b))
  expect(clash.deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect((await bash($, send(a))).deny).toContain('running 상태')

  sim.receipt = 'sent\ndispatchId=ctx_new\n'
  expect((await bash($, send(c, 'term_9'))).deny).toBeUndefined()
  expect(state(sim).tasks[2]?.runner).toBe('orca dispatch:ctx_new')
  expect(sim.commands.filter(command => command.includes('orchestration send'))).toHaveLength(2)

  sim.files[b] = `${sim.files[b]}\nedited`
  expect((await bash($, send(b))).deny).toContain('보낸 뒤 고친 brief')
})

test('V1-11: an orca send that names no brief of the run, or only a report, goes out untouched', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  await newTask($, 'A')
  sim.ownGit.length = 0
  sim.relayReads.length = 0

  expect((await bash($, 'orca orchestration send --to dispatch:ctx_1 --subject hi --body "How is it going?"')).deny).toBeUndefined()
  expect((await bash($, `orca orchestration send --to dispatch:ctx_1 --body "See ${DIR}/tasks/A-r1-report.md"`)).deny).toBeUndefined()
  expect(sim.relayReads).toEqual([])
  // A brief of another repository's run is not this run's: read the state to know, and pass.
  expect((await bash($, `orca orchestration send --to dispatch:ctx_1 --body "See /elsewhere/.relay/runs/${RUN}/tasks/A-r1.md"`)).deny).toBeUndefined()
  expect(sim.commands).toHaveLength(3)
  expect(state(sim).tasks[0]?.status).toBe('ready')
})

test('V1-11: a SendMessage to a subagent carrying a brief of the run is checked and noted with the subagent it went to', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', { edit_scope: ['src/**'] })
  const b = await newTask($, 'B', { edit_scope: ['src/b.ts'] })
  const message = (to: string, text: string) => $.tool.call({ tool: 'SendMessage', to, message: text } as never) as Promise<{ deny?: string }>

  expect((await message('worker-1', 'How is it going?')).deny).toBeUndefined()
  expect((await message('worker-1', `Read ${DIR}/tasks/A-r1-report.md`)).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('ready')

  expect((await message('worker-1', `New revision: read ${a}.`)).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect(state(sim).tasks[0]?.runner).toBe('subagent worker-1')
  expect((await message('worker-2', `Read ${b}.`)).deny).toContain('돌고 있는 A-r1와 겹칩니다')
  expect((await message('worker-1', `Again ${a}.`)).deny).toContain('running 상태')
  expect(sim.commands.filter(command => command.startsWith('SendMessage'))).toHaveLength(3)
})

test('V1-11: a prompt naming two ready briefs is refused: one at a time; a done brief named beside a ready one is only context', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  const b = await newTask($, 'B')
  const c = await newTask($, 'C')
  setState(sim, s => {
    s.tasks[2]!.status = 'done'
  })

  expect((await spawn($, `Follow ${a} and ${b}.`, 'both', 'sonnet')).deny).toContain('한 번에 하나씩')
  expect(sim.spawned).toEqual([])
  expect((await spawn($, `Follow ${a}; it builds on ${c}.`, 'A', 'sonnet')).deny).toBeUndefined()
  expect(state(sim).tasks.map(task => task.status)).toEqual(['running', 'ready', 'done'])
})

// ── A new revision sent to a finished subagent (task D, 2026-11-11) ──────────────────────────────────────────────

type Sent = { deny?: string; context?: string[]; isError?: boolean; result?: { success?: boolean } }

const sendMessage = ($: Engine, to: string, text: string): Promise<Sent> => $.tool.call({ tool: 'SendMessage', to, message: text } as never) as Promise<Sent>

/** The statuses a task went through as the state was written, repeats dropped. */
function statusesOf(sim: Sim, key: string): string[] {
  const seen: string[] = []
  for (const text of sim.stateWrites) {
    const status = (JSON.parse(text) as RelayState).tasks.find(task => taskKey(task) === key)?.status
    if (status !== undefined && seen.at(-1) !== status) seen.push(status)
  }

  return seen
}

test('D: a new revision sent to a finished subagent is checked once; the resume the send causes passes and the task is running as subagent <the agent resumed>', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const first = await newTask($, 'A', { edit_scope: ['area-a/**'] })
  await newTask($, 'A', { edit_scope: ['area-a/**'] })
  const second = `${DIR}/tasks/A-r2.md`
  const b = await newTask($, 'B', { edit_scope: ['area-b/**'] })
  sim.engine = $
  sim.finished = { 'ag-worker-a': 'ag-worker-a', 'worker-b': 'ag-worker-b' }

  // As A-r2 went out: the new brief beside the cancelled one, to the worker by its id (once refused: "ready인 brief가 없습니다(A-r2 launching, A-r1 cancelled)").
  const a = await sendMessage($, 'ag-worker-a', `New revision: read ${second}. It replaces ${first}.`)
  expect(a.deny).toBeUndefined()
  expect(a.result?.success).toBe(true)
  expect(a.context).toBeUndefined()
  // As B-r2 went out: the brief alone, to the worker by a name (once refused: "B-r2는 launching 상태라 띄우지 않습니다").
  const sentB = await sendMessage($, 'worker-b', `Read ${b}.`)
  expect(sentB.deny).toBeUndefined()
  expect(sentB.result?.success).toBe(true)
  expect(sentB.context).toBeUndefined()

  // Each resume reached the engine with the message; no fresh subagent was started.
  expect(sim.resumed).toEqual([
    { prompt: `New revision: read ${second}. It replaces ${first}.`, agentId: 'ag-worker-a' },
    { prompt: `Read ${b}.`, agentId: 'ag-worker-b' },
  ])
  expect(sim.spawned).toEqual([])
  // Claimed once and recorded running once each.
  expect(statusesOf(sim, 'A-r2')).toEqual(['ready', 'launching', 'running'])
  expect(statusesOf(sim, 'B-r1')).toEqual(['ready', 'launching', 'running'])
  const tasks = state(sim).tasks
  expect(tasks.find(task => taskKey(task) === 'A-r2')?.runner).toBe('subagent ag-worker-a')
  // Sent by a name: the runner is the agentId the resume reached, which the refill at session start can find.
  expect(tasks.find(task => taskKey(task) === 'B-r1')?.runner).toBe('subagent ag-worker-b')
  expect(tasks.find(task => taskKey(task) === 'A-r1')?.status).toBe('cancelled')
})

test('D: a send whose resume is refused, or that answers success: false, an error or a refusal, leaves the revision ready and tells the lead', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')
  sim.engine = $
  sim.finished = { 'ag-worker': 'ag-worker' }

  // The resume refused beneath (another plugin declining): the call answers success: false.
  sim.resumeDeny = 'another plugin said no'
  const declined = await sendMessage($, 'ag-worker', `Read ${a}.`)
  expect(declined.deny).toBeUndefined()
  expect(declined.result?.success).toBe(false)
  expect(declined.context).toHaveLength(1)
  expect(declined.context?.[0]).toContain('⚠ relay: A-r1 보내기가 실패해 ready로 되돌렸습니다(a plugin declined the resume: another plugin said no)')
  expect(declined.context?.[0]).toContain('dispatched는 부르지 말고')
  expect(state(sim).tasks[0]?.status).toBe('ready')
  expect(state(sim).tasks[0]?.runner).toBeNull()
  expect(statusesOf(sim, 'A-r1')).toEqual(['ready', 'launching', 'ready'])
  expect(sim.resumed).toEqual([])
  sim.resumeDeny = undefined

  // Nobody by that name (success: false), an error core reported: the same.
  const shapes: [Record<string, unknown>, string][] = [
    [{ result: { success: false, message: 'No agent named "gone" is running.' } }, 'No agent named "gone" is running.'],
    [{ isError: true, result: 'boom', text: 'SendMessage broke' }, 'SendMessage broke'],
  ]
  for (const [answer, why] of shapes) {
    sim.sendAnswer = answer
    const failed = await sendMessage($, 'gone', `Read ${a}.`)
    expect(failed.context).toHaveLength(1)
    expect(failed.context?.[0]).toContain(`⚠ relay: A-r1 보내기가 실패해 ready로 되돌렸습니다(${why})`)
    expect(state(sim).tasks[0]?.status).toBe('ready')
  }

  // A refusal beneath carries no context: the line goes on its text.
  sim.sendAnswer = { deny: 'a rule refused the send' }
  const refused = await sendMessage($, 'gone', `Read ${a}.`)
  expect(refused.deny).toContain('a rule refused the send')
  expect(refused.deny).toContain('⚠ relay: A-r1 보내기가 실패해 ready로 되돌렸습니다')
  expect(state(sim).tasks[0]?.status).toBe('ready')

  // Sent again once the cause is gone: running, once.
  sim.sendAnswer = undefined
  const sent = await sendMessage($, 'ag-worker', `Read ${a}.`)
  expect(sent.result?.success).toBe(true)
  expect(sent.context).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect(state(sim).tasks[0]?.runner).toBe('subagent ag-worker')
  expect(sim.resumed).toHaveLength(1)
})

test("D: a subagent start refused beneath leaves the task ready, and the Agent call's errored result carries the ⚠ relay: line", async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const b = await newTask($, 'B')
  sim.spawnDeny = 'the host refused the start'

  const spawned = await spawn($, `Follow ${b}.`, 'B', 'sonnet', 'toolu_refused')
  expect(spawned.deny).toBe('the host refused the start')
  const answered = (await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_refused', prompt: `Follow ${b}.`, description: 'B', model: 'sonnet' } as never)) as Sent
  expect(answered.isError).toBe(true)
  expect(answered.context).toHaveLength(1)
  expect(answered.context?.[0]).toContain('⚠ relay: B-r1 띄우기가 실패해 ready로 되돌렸습니다(the host refused the start)')
  expect(state(sim).tasks[0]?.status).toBe('ready')
  expect(statusesOf(sim, 'B-r1')).toEqual(['ready', 'launching', 'ready'])

  sim.spawnDeny = undefined
  expect((await spawn($, `Follow ${b}.`, 'B', 'sonnet')).deny).toBeUndefined()
  expect(state(sim).tasks[0]?.status).toBe('running')
  expect(state(sim).tasks[0]?.runner).toBe('subagent ag-1')
})

test('D: a resume no send of the run caused is checked as a start, as before; a message naming no brief resumes untouched', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A')

  const resume = { tool_use_id: 'toolu_r', prompt: `Follow ${a}.`, description: 'A', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', resume: { agentId: 'ag-old' } }
  const alone = (await $.agent.spawn(resume as never)) as { deny?: string }
  expect(alone.deny).toContain('모델이 지정되지 않았습니다')
  expect(sim.resumed).toEqual([])
  expect(state(sim).tasks[0]?.status).toBe('ready')

  sim.engine = $
  sim.finished = { 'ag-old': 'ag-old' }
  const chat = await sendMessage($, 'ag-old', 'How is it going?')
  expect(chat.result?.success).toBe(true)
  expect(sim.resumed).toEqual([{ prompt: 'How is it going?', agentId: 'ag-old' }])
  expect(state(sim).tasks[0]?.status).toBe('ready')
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

  expect(await answer($)).toBe(`⚠ relay ${RUN}: 검증되지 않은 커밋입니다(HEAD ${HEAD_1.slice(0, 7)}, 마지막 verdict 없음). 끝내기 전에 package → 다른 모델 검증 → finish.`)

  setState(sim, s => {
    s.verdicts = [{ id: 'V1', at: NOON, commit: HEAD_2, path: `${DIR}/reviews/V1-verdict.json`, result: 'pass' }]
  })
  expect(await answer($)).toBe(`⚠ relay ${RUN}: 검증되지 않은 커밋입니다(HEAD ${HEAD_1.slice(0, 7)}, 마지막 verdict ${HEAD_2.slice(0, 7)}). 끝내기 전에 package → 다른 모델 검증 → finish.`)
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

// Moved here on 2026-11-11 (D-r6) from the deleted subagent effort tests: the runner part of their named-send test.
test('D: a brief sent by a name whose answer names the agent is recorded under that agentId; an answer that names none keeps the address', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const b = await newTask($, 'B', { edit_scope: ['area-b/**'] })
  const c = await newTask($, 'C', { edit_scope: ['area-c/**'] })
  const named = { success: true, message: 'Resuming agent ag-7', resumedAgentId: 'ag-7' }
  sim.sendAnswer = { result: named, text: JSON.stringify(named) }
  expect((await sendMessage($, 'worker-b', `Read ${b}.`)).deny).toBeUndefined()
  expect(state(sim).tasks.find(task => taskKey(task) === 'B-r1')).toMatchObject({ status: 'running', runner: 'subagent ag-7' })

  const plain = { success: true, message: 'Sent' }
  sim.sendAnswer = { result: plain, text: JSON.stringify(plain) }
  expect((await sendMessage($, 'worker-c', `Read ${c}.`)).deny).toBeUndefined()
  expect(state(sim).tasks.find(task => taskKey(task) === 'C-r1')).toMatchObject({ status: 'running', runner: 'subagent worker-c' })
})
