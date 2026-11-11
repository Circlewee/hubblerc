import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { RelayState } from '../hooks/relay/relay-format'

// A relay worker's effort is fixed when it starts: the gate starts a brief's subagent as the worker
// type of the brief's effort (`hubblerc:relay-worker-<level>`, registered at session start). There is
// no table and nothing on each request.

const ROOT = '/repo/work'
const TOOL = 'mcp__hubblerc__relay'
const HEAD = 'a'.repeat(40)
const NOON = new Date(2026, 10, 9, 12, 0).getTime()
const RUN = '2026-11-09-demo'
const DIR = `${ROOT}/.relay/runs/${RUN}`

type Spawned = { subagentType: string; model: string | undefined; resume?: string }
type Sim = {
  files: Record<string, string>
  /** Each request as it reached the API: whose, at what effort. */
  requests: { agentId: string | undefined; effort: unknown }[]
  /** Every subagent the engine started or resumed, as it reached the engine (after the plugin's hooks). */
  spawns: Spawned[]
  /** The agent types the plugin registered; `registerFails` makes each register refuse. */
  registered: Record<string, unknown>[]
  registerFails: boolean
  /** The finished subagents a SendMessage resumes, by address; what a SendMessage answers instead (no resume). */
  finished: Record<string, string>
  sendAnswer: Record<string, unknown> | undefined
  engine: Engine | undefined
  /** Every read of a file, existence test, listing and process the plugin asked for. */
  reads: number
}

/** Stands for the engine beneath the plugin: files in memory, git, the API, agent types, subagents started and resumed. */
function standIn(on: On): Sim {
  const sim: Sim = { files: {}, requests: [], spawns: [], registered: [], registerFails: false, finished: {}, sendAnswer: undefined, engine: undefined, reads: 0 }
  const isDir = (path: string) => Object.keys(sim.files).some(file => file.startsWith(`${path}/`))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'lead-session-1234' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: NOON }))
  on('fs.exists', (_, e) => {
    sim.reads += 1

    return { value: sim.files[e.path] !== undefined || isDir(e.path) }
  })
  on('fs.read', (_, e) => {
    sim.reads += 1

    return sim.files[e.path] === undefined ? { deny: 'ENOENT' } : { value: sim.files[e.path] as never }
  })
  on('fs.write', (_, e) => {
    sim.files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    sim.reads += 1
    const names = new Map<string, 'file' | 'dir'>()
    for (const file of Object.keys(sim.files)) {
      if (!file.startsWith(`${e.path}/`)) continue
      const [name = '', ...rest] = file.slice(e.path.length + 1).split('/')
      names.set(name, rest.length > 0 ? 'dir' : 'file')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_, e) => {
    sim.reads += 1
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] !== 'git') return out('', 1)
    if (e.argv.includes('--show-toplevel')) return out(`${ROOT}\n`)
    if (e.argv[1] === 'rev-parse' && e.argv.at(-1) === 'HEAD') return out(`${HEAD}\n`)
    if (e.argv[1] === 'status') return out('')

    return out('', 1)
  })
  on('agent.register', (_, e) => {
    sim.registered.push({ ...e })

    return sim.registerFails ? { deny: 'session not bound' } : { value: { agent: `hubblerc:${String(e.name)}` } }
  })
  on('turn.step', async function* (_, e) {
    sim.requests.push({ agentId: e.agentId, effort: e.effort })

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: e.model, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })
  on('tool.call', async (_, e) => {
    if (e.tool === 'SendMessage') {
      const to = String(e.to)
      if (sim.sendAnswer !== undefined) return { result: sim.sendAnswer as never, text: JSON.stringify(sim.sendAnswer) }
      const agentId = sim.finished[to]
      if (agentId === undefined || sim.engine === undefined) return { result: {} as never }
      const resume = { tool_use_id: 'toolu_first_start', prompt: String(e.message), description: 'worker', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, model: 'claude-sonnet-5-5', parentModel: 'claude-opus-5-5', resume: { agentId } }
      const resumed = (await sim.engine.agent.spawn(resume as never)) as { deny?: string }
      const record = resumed.deny === undefined ? { success: true, message: `Resuming agent ${agentId}`, resumedAgentId: agentId } : { success: false, message: resumed.deny }

      return { result: record as never, text: JSON.stringify(record) }
    }

    return { result: {} as never }
  })
  on('agent.spawn', (_, e) => {
    sim.spawns.push({ subagentType: e.subagentType, model: e.model, ...(e.resume === undefined ? {} : { resume: e.resume.agentId }) })
    if (e.resume !== undefined) return { model: 'claude-sonnet-5-5', agentId: e.resume.agentId }

    return { model: e.model ?? 'inherited-model', agentId: `ag-${sim.spawns.filter(spawn => spawn.resume === undefined).length}` }
  })
  on('turn.complete', () => ({ text: '' }))

  return sim
}

async function relay($: Engine, input: Record<string, unknown>): Promise<{ deny?: string; result?: unknown }> {
  return (await $.tool.call({ tool: TOOL, ...input } as never)) as { deny?: string; result?: unknown }
}

const state = (sim: Sim): RelayState => JSON.parse(sim.files[`${DIR}/state.json`] ?? '{}') as RelayState

async function newRun($: Engine): Promise<void> {
  expect((await relay($, { action: 'start', name: 'demo', goal: 'Start the workers at their efforts.', done_when: ['tests pass'] })).deny).toBeUndefined()
}

/** A task's brief written by the tool, at the effort given, on Sonnet; its path. */
async function newTask($: Engine, id: string, effort: string, rev = 1): Promise<string> {
  const made = await relay($, { action: 'task', run: RUN, id, title: `Task ${id}`, goal: 'Do it.', model: 'claude-sonnet-5-5', effort, edit_scope: [`area-${id}/**`], reads: [], done_when: [{ text: 'works', command: 'true' }], runner_kind: 'claude' })
  expect(made.deny).toBeUndefined()

  return `${DIR}/tasks/${id}-r${rev}.md`
}

/** An Agent call's start, as the lead makes it: the type it names (general-purpose unless given), the model alias. */
async function spawn($: Engine, prompt: string, subagentType = 'general-purpose'): Promise<{ deny?: string; agentId?: string }> {
  const input = { tool_use_id: 'toolu_1', prompt, description: 'worker', subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', model: 'sonnet' }

  return (await $.agent.spawn(input as never)) as { deny?: string; agentId?: string }
}

/** One request of a loop (a subagent's when `agentId` is given) as the engine sends it; the effort it reached the API with. */
async function request($: Engine, sim: Sim, agentId: string | undefined, effort: string | undefined): Promise<unknown> {
  const input = { turnId: `t-${sim.requests.length}`, index: 0, model: 'claude-sonnet-5-5', messageCount: 1, ...(effort === undefined ? {} : { effort }), ...(agentId === undefined ? {} : { agentId }) }
  for await (const chunk of $.turn.step(input as never)) void chunk

  return sim.requests.at(-1)?.effort
}

const sendMessage = async ($: Engine, to: string, message: string): Promise<{ deny?: string }> => (await $.tool.call({ tool: 'SendMessage', to, message } as never)) as { deny?: string }

/** A DONE report of a task's one criterion, with nothing committed. */
const doneReport = (key: string): string =>
  [`# Report ${key}`, '- Status: DONE', '- Change: no_change', '- Commits: none', '- Model / effort: claude-sonnet-5-5 / high', '- Found at start: none', '## Criteria', '- C1: pass · tries 0 · ok', '## Test changes', 'none'].join('\n')

async function report($: Engine, sim: Sim, key: string): Promise<void> {
  sim.files[`${DIR}/tasks/${key}-report.md`] = doneReport(key)
  expect((await relay($, { action: 'report', run: RUN, task: key })).deny).toBeUndefined()
}

// ── The worker types ──────────────────────────────────────────────

test('session start registers the five worker types: each its level as effort, no model, no tools', async ($, on) => {
  const sim = standIn(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(sim.registered.map(spec => [spec.name, spec.effort, 'model' in spec, 'tools' in spec])).toEqual([
    ['relay-worker-low', 'low', false, false],
    ['relay-worker-medium', 'medium', false, false],
    ['relay-worker-high', 'high', false, false],
    ['relay-worker-xhigh', 'xhigh', false, false],
    ['relay-worker-max', 'max', false, false],
  ])
  for (const spec of sim.registered) {
    expect(String(spec.description)).toContain('relay')
    expect(String(spec.prompt)).toContain('Read the whole brief first')
  }
})

test('a register that is refused does not stop the session start: the others are tried and the rest of the start goes on', async ($, on) => {
  const sim = standIn(on)
  sim.registerFails = true
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(sim.registered).toHaveLength(5)
  // The relay tool, registered at the same start, still answers.
  await newRun($)
})

// ── The start: the type of the brief's effort ──────────────────────────────────────────────

test('a subagent started on a brief goes as the worker type of the brief’s effort, on the model the call gave; its requests go as the engine sends them, with no file read', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  expect((await spawn($, `Follow ${a}.`)).agentId).toBe('ag-1')
  expect(sim.spawns).toEqual([{ subagentType: 'hubblerc:relay-worker-high', model: 'sonnet' }])
  expect(state(sim).tasks[0]).toMatchObject({ status: 'running', runner: 'subagent ag-1' })

  // Nothing on each request: the type carries the effort, the plugin leaves the request alone.
  const before = sim.reads
  expect(await request($, sim, 'ag-1', 'high')).toBe('high')
  expect(await request($, sim, 'ag-1', 'medium')).toBe('medium')
  expect(sim.reads).toBe(before)
})

test('a worker type of another level named by the lead is put right; one of the same level stays', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  const b = await newTask($, 'B', 'low')
  await spawn($, `Follow ${a}.`, 'hubblerc:relay-worker-low')
  await spawn($, `Follow ${b}.`, 'hubblerc:relay-worker-low')
  expect(sim.spawns.map(spawn => spawn.subagentType)).toEqual(['hubblerc:relay-worker-high', 'hubblerc:relay-worker-low'])
})

test('a brief whose effort is no level, and a start that names no brief, keep the type called', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'ultra')
  await spawn($, `Follow ${a}.`)
  await spawn($, 'Search the repository for the word relay.', 'Explore')
  expect(sim.spawns.map(spawn => [spawn.subagentType, spawn.model])).toEqual([
    ['general-purpose', 'sonnet'],
    ['Explore', 'sonnet'],
  ])
  expect(state(sim).tasks[0]).toMatchObject({ status: 'running', runner: 'subagent ag-1' })
})

// ── A new brief to a finished worker: its effort was fixed when it started ──────────────────────────

test('a finished worker takes a new brief of its effort; one of another effort is refused before any claim; a recipient no runner names passes', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  await spawn($, `Follow ${a}.`)
  await report($, sim, 'A-r1')
  sim.engine = $
  sim.finished = { 'ag-1': 'ag-1', 'worker-new': 'ag-9' }

  // The same effort: sent, resumed with its type as it was, recorded under the agent.
  const second = await newTask($, 'A', 'high', 2)
  expect((await sendMessage($, 'ag-1', `New revision: read ${second}.`)).deny).toBeUndefined()
  expect(state(sim).tasks.find(task => task.rev === 2)).toMatchObject({ status: 'running', runner: 'subagent ag-1' })
  expect(sim.spawns.at(-1)).toEqual({ subagentType: 'general-purpose', model: 'claude-sonnet-5-5', resume: 'ag-1' })
  await report($, sim, 'A-r2')

  // Another effort: refused before anything is claimed or resumed.
  const b = await newTask($, 'B', 'xhigh')
  const before = sim.files[`${DIR}/state.json`]
  const spawned = sim.spawns.length
  const refused = await sendMessage($, 'ag-1', `Read ${b}.`)
  expect(refused.deny).toBe('서브에이전트 ag-1는 effort high로 띄워졌고(A-r1) 새 지시서 B-r1는 effort xhigh입니다. 서브에이전트의 effort는 띄울 때 정해져 바꿀 수 없으니 이 지시서는 새 서브에이전트로 띄우세요.')
  expect(sim.files[`${DIR}/state.json`]).toBe(before)
  expect(state(sim).tasks.find(task => task.id === 'B')?.status).toBe('ready')
  expect(sim.spawns).toHaveLength(spawned)

  // A recipient no task names as its runner is not known: the brief goes, as before.
  expect((await sendMessage($, 'worker-new', `Read ${b}.`)).deny).toBeUndefined()
  expect(state(sim).tasks.find(task => task.id === 'B')).toMatchObject({ status: 'running', runner: 'subagent ag-9' })
})

test('a brief sent by a name whose answer names the agent: the runner is that agentId, so a later brief to it is checked against its effort', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const b = await newTask($, 'B', 'xhigh')
  sim.sendAnswer = { success: true, message: 'Resuming agent ag-7', resumedAgentId: 'ag-7' }
  expect((await sendMessage($, 'worker-b', `Read ${b}.`)).deny).toBeUndefined()
  expect(state(sim).tasks[0]).toMatchObject({ status: 'running', runner: 'subagent ag-7' })
  await report($, sim, 'B-r1')

  const c = await newTask($, 'C', 'low')
  expect((await sendMessage($, 'ag-7', `Read ${c}.`)).deny).toContain('서브에이전트 ag-7는 effort xhigh로 띄워졌고(B-r1)')

  // An answer that names no agent: the address, as before.
  sim.sendAnswer = { success: true, message: 'Sent' }
  expect((await sendMessage($, 'worker-c', `Read ${c}.`)).deny).toBeUndefined()
  expect(state(sim).tasks.find(task => task.id === 'C')?.runner).toBe('subagent worker-c')
})
