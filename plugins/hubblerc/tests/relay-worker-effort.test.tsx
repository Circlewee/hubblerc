import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { RelayState } from '../hooks/relay/relay-format'

const ROOT = '/repo/work'
const TOOL = 'mcp__hubblerc__relay'
const HEAD = 'a'.repeat(40)
const NOON = new Date(2026, 10, 9, 12, 0).getTime()
const RUN = '2026-11-09-demo'
const DIR = `${ROOT}/.relay/runs/${RUN}`

type Sim = {
  files: Record<string, string>
  /** Each request as it reached the API: whose, at what effort. */
  requests: { agentId: string | undefined; effort: unknown }[]
  /** The commands the Bash tool received. */
  commands: string[]
  /** The finished subagents a SendMessage resumes, by address; what a SendMessage answers instead (no resume). */
  finished: Record<string, string>
  sendAnswer: Record<string, unknown> | undefined
  engine: Engine | undefined
  spawned: number
  /** Every read of a file, existence test, listing and process the plugin asked for. */
  reads: number
}

/** Stands for the engine beneath the plugin: files in memory, git, the API, subagents started and resumed. */
function standIn(on: On): Sim {
  const sim: Sim = { files: {}, requests: [], commands: [], finished: {}, sendAnswer: undefined, engine: undefined, spawned: 0, reads: 0 }
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

    return out('', 1)
  })
  on('turn.step', async function* (_, e) {
    sim.requests.push({ agentId: e.agentId, effort: e.effort })

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: e.model, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })
  on('tool.call', async (_, e) => {
    if (e.tool === 'Bash') {
      sim.commands.push(String((e as { command?: unknown }).command))

      return { result: { stdout: '', stderr: '' } as never, text: '' }
    }
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
    if (e.resume !== undefined) return { model: 'claude-sonnet-5-5', agentId: e.resume.agentId }
    sim.spawned += 1

    return { model: e.model ?? 'inherited-model', agentId: `ag-${sim.spawned}` }
  })
  on('turn.complete', () => ({ text: '' }))

  return sim
}

async function relay($: Engine, input: Record<string, unknown>): Promise<{ deny?: string }> {
  return (await $.tool.call({ tool: TOOL, ...input } as never)) as { deny?: string }
}

const state = (sim: Sim): RelayState => JSON.parse(sim.files[`${DIR}/state.json`] ?? '{}') as RelayState

function setState(sim: Sim, change: (state: RelayState) => void): void {
  const next = state(sim)
  change(next)
  sim.files[`${DIR}/state.json`] = JSON.stringify(next)
}

async function newRun($: Engine): Promise<void> {
  expect((await relay($, { action: 'start', name: 'demo', goal: 'Send the workers at their efforts.', done_when: ['tests pass'] })).deny).toBeUndefined()
}

/** A task's brief written by the tool, at the effort given; its path. */
async function newTask($: Engine, id: string, effort: string, rev = 1): Promise<string> {
  const made = await relay($, { action: 'task', run: RUN, id, title: `Task ${id}`, goal: 'Do it.', model: 'claude-sonnet-5-5', effort, edit_scope: [`area-${id}/**`], reads: [], done_when: [{ text: 'works', command: 'true' }], runner_kind: 'claude' })
  expect(made.deny).toBeUndefined()

  return `${DIR}/tasks/${id}-r${rev}.md`
}

async function spawn($: Engine, prompt: string): Promise<{ deny?: string; agentId?: string }> {
  const input = { tool_use_id: 'toolu_1', prompt, description: 'worker', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', model: 'sonnet' }

  return (await $.agent.spawn(input as never)) as { deny?: string; agentId?: string }
}

/** One request of a loop (a subagent's when `agentId` is given) as the engine sends it; the effort it reached the API with. */
async function request($: Engine, sim: Sim, agentId: string | undefined, effort: string | undefined): Promise<unknown> {
  const input = { turnId: `t-${sim.requests.length}`, index: 0, model: 'claude-sonnet-5-5', messageCount: 1, ...(effort === undefined ? {} : { effort }), ...(agentId === undefined ? {} : { agentId }) }
  for await (const chunk of $.turn.step(input as never)) void chunk

  return sim.requests.at(-1)?.effort
}

const sendMessage = async ($: Engine, to: string, message: string): Promise<{ deny?: string }> => (await $.tool.call({ tool: 'SendMessage', to, message } as never)) as { deny?: string }

test("a subagent started on a brief at high sends every request at high whatever the session's; another subagent and the main loop go as sent, with no file read", async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  const started = await spawn($, `Follow ${a}.`)
  expect(started.deny).toBeUndefined()
  expect(started.agentId).toBe('ag-1')
  expect(state(sim).tasks[0]?.runner).toBe('subagent ag-1')

  const before = sim.reads
  expect(await request($, sim, 'ag-1', 'medium')).toBe('high')
  expect(await request($, sim, 'ag-1', 'xhigh')).toBe('high')
  expect(await request($, sim, 'ag-1', 'high')).toBe('high')
  expect(await request($, sim, 'ag-elsewhere', 'medium')).toBe('medium')
  expect(await request($, sim, undefined, 'medium')).toBe('medium')
  // Sending looks up module memory only: no file, existence, listing or process.
  expect(sim.reads).toBe(before)
})

test("the commit trailer names the effort the subagent's request went out with", async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  await spawn($, `Follow ${a}.`)
  expect(await request($, sim, 'ag-1', 'medium')).toBe('high')

  await $.tool.call({ tool: 'Bash', command: 'git commit -m x', description: '커밋', agentId: 'ag-1' } as never)
  expect(sim.commands.at(-1)).toContain("--trailer 'Effort: high'")
  expect(sim.commands.at(-1)).not.toContain('medium')
})

test("a new revision sent by SendMessage at another effort: that agent's requests after it go at the new one, by its id or by the id the answer names", async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  await spawn($, `Follow ${a}.`)
  expect(await request($, sim, 'ag-1', 'medium')).toBe('high')
  setState(sim, next => {
    for (const task of next.tasks) task.status = 'done'
  })

  // A new revision of A at low, sent to the finished worker by its id: resumed with it.
  const second = await newTask($, 'A', 'low', 2)
  sim.engine = $
  sim.finished = { 'ag-1': 'ag-1' }
  expect((await sendMessage($, 'ag-1', `New revision: read ${second}.`)).deny).toBeUndefined()
  expect(state(sim).tasks.find(task => task.rev === 2)?.status).toBe('running')
  expect(await request($, sim, 'ag-1', 'medium')).toBe('low')

  // Sent by a name with no resume seen: the answer's resumedAgentId is the agent noted.
  const b = await newTask($, 'B', 'xhigh')
  sim.sendAnswer = { success: true, message: 'Resuming agent ag-7', resumedAgentId: 'ag-7' }
  expect((await sendMessage($, 'worker-b', `Read ${b}.`)).deny).toBeUndefined()
  expect(await request($, sim, 'ag-7', 'medium')).toBe('xhigh')
  expect(await request($, sim, 'worker-b', 'medium')).toBe('medium')
})

test('a brief effort that is no level, and a request that carries no effort, go as the engine sent them', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'ultra')
  const b = await newTask($, 'B', 'high')
  expect((await spawn($, `Follow ${a}.`)).agentId).toBe('ag-1')
  expect((await spawn($, `Follow ${b}.`)).agentId).toBe('ag-2')

  expect(await request($, sim, 'ag-1', 'medium')).toBe('medium')
  // A model that takes no effort: none is added.
  expect(await request($, sim, 'ag-2', undefined)).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x', description: '커밋', agentId: 'ag-2' } as never)
  expect(sim.commands.at(-1)).not.toContain('Effort:')
})

test('session start fills the efforts again from the active runs: subagent tasks still holding their worker, the latest per agent', async ($, on) => {
  const sim = standIn(on)
  await newRun($)
  const a = await newTask($, 'A', 'high')
  await newTask($, 'B', 'low')
  await newTask($, 'C', 'xhigh')
  await newTask($, 'D', 'max')
  await newTask($, 'E', 'low')
  // ag-1 started on A, its task then done: not refilled.
  await spawn($, `Follow ${a}.`)
  setState(sim, next => {
    const by = (id: string) => next.tasks.find(task => task.id === id)
    Object.assign(by('A') ?? {}, { status: 'done' })
    Object.assign(by('B') ?? {}, { status: 'running', runner: 'subagent ag-old', dispatchedAt: NOON - 2000 })
    Object.assign(by('C') ?? {}, { status: 'running', runner: 'subagent ag-old', dispatchedAt: NOON - 1000 })
    Object.assign(by('D') ?? {}, { status: 'blocked', workerLive: true, runner: 'subagent ag-live', dispatchedAt: NOON })
    Object.assign(by('E') ?? {}, { status: 'running', runner: 'orca dispatch:ctx_1', dispatchedAt: NOON })
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  expect(await request($, sim, 'ag-old', 'medium')).toBe('xhigh')
  expect(await request($, sim, 'ag-live', 'medium')).toBe('max')
  expect(await request($, sim, 'ag-1', 'medium')).toBe('medium')
  expect(await request($, sim, 'ctx_1', 'medium')).toBe('medium')
})
