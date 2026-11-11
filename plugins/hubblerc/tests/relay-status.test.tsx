import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { localDate } from '../hooks/relay/relay-format'
import type { RelayState, RelayTask, TaskStatus } from '../hooks/relay/relay-format'
import { findTaskLine, relayLines, runStatus, statusText, taskName, withRun } from '../hooks/relay/relay-status'
import { THEME_COLORS } from '../hooks/shared/style'
import { cellWidth } from '../hooks/shared/text-width'
import { NOW, standInForEngine, start } from './engine'
import type { StandIn } from './engine'

// The engine stand-in's git answers every rev-parse with this folder: the top folder, and HEAD too.
const ROOT = '/repo/hubblerc'
const RUNS = `${ROOT}/.relay/runs`
const RUN = '2026-11-09-demo'
const DIR = `${RUNS}/${RUN}`
const TOOL = 'mcp__hubblerc__relay'
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const COMMAND = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
// 14:05 local, whatever the machine's zone.
const AT = new Date(2026, 10, 9, 14, 5).getTime()

const hhmm = (at: number): string => {
  const d = new Date(at)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function task(fields: Partial<RelayTask> & { id: string; rev: number; status: TaskStatus }): RelayTask {
  return { title: 't', runner: null, model: 'claude-opus-5-5', effort: 'high', editScope: [], reads: [], targets: [], criteria: [], specPath: `${DIR}/tasks/${fields.id}-r${fields.rev}.md`, specHash: '', dispatchedAt: null, reportedAt: null, tries: {}, ...fields }
}

/** A run under way: an earlier revision cancelled, one done, one blocked after its launch, one not launched, one cancelled outright. */
const STATE: RelayState = {
  version: 1,
  run: RUN,
  goal: 'Ship relay.',
  doneWhen: ['all checks pass'],
  base: 'a'.repeat(40),
  lead: 'lead-session',
  status: 'active',
  createdAt: AT,
  tasks: [
    task({ id: 'A', rev: 1, title: 'Add the tool', status: 'cancelled', cancelReason: '새 판 A-r2가 이어받음' }),
    task({ id: 'A', rev: 2, title: 'Add the tool', status: 'done', runner: 'orca dispatch:ctx_1', model: 'claude-sonnet-5-5', effort: 'medium', dispatchedAt: AT }),
    task({ id: 'B', rev: 1, title: 'Wire the box', status: 'blocked', workerLive: true, runner: 'subagent ag-1', dispatchedAt: AT }),
    task({ id: 'C', rev: 1, title: 'Write docs', status: 'ready' }),
    task({ id: 'D', rev: 1, title: '', status: 'cancelled', cancelReason: 'not needed' }),
  ],
  verdicts: [{ id: 'V1', at: AT, commit: 'c'.repeat(40), path: `${DIR}/reviews/V1-verdict.json`, result: 'fail' }],
}

/** progress.md with one decision decided and one asked of the person. */
const PROGRESS = [
  `# Progress: ${RUN}`,
  '',
  '## Decisions (append; only Status changes)',
  '| ID | Decision | Why | Cost if wrong | By | Status |',
  '|---|---|---|---|---|---|',
  '| D1 | use a | fast | small | lead | decided |',
  '| D2 | push now | the person decides | high | user | asked |',
  '',
  '## Tasks (redrawn by relay — do not edit by hand)',
  '<!-- relay:tasks:start -->',
  '<!-- relay:tasks:end -->',
  '',
].join('\n')

const texts = (lines: ReturnType<typeof relayLines>): string[] => lines.map(line => line.map(segment => segment.text).join(''))

// ── In small ──────────────────────────────────────────────

test('a run in small: each task’s latest revision with its status first, then its title, brief number, model/effort, runner and launch time; the decisions waiting; the last verdict', () => {
  const status = runStatus(STATE, PROGRESS, 'c'.repeat(40))
  expect(status.tasks.map(line => line.key)).toEqual(['A-r2', 'B-r1', 'C-r1', 'D-r1'])
  // The revision left out of the lines is kept by name, for a call that named it.
  expect(status.earlier).toEqual([{ key: 'A-r1', id: 'A', rev: 1, title: 'Add the tool' }])
  expect(status.pending).toBe(1)

  // As `/relay-status` writes it: nothing cut, the model whole, the runner said; the statuses in one column.
  const lines = relayLines({ runs: [status] }, THEME_COLORS)
  expect(texts(lines)).toEqual([
    RUN,
    `끝            Add the tool · 2판 · sonnet-5-5/medium · orca · ${hhmm(AT)}`,
    `띄운 뒤 막힘  Wire the box · opus-5-5/high · subagent · ${hhmm(AT)}`,
    '띄우기 전     Write docs · opus-5-5/high',
    '취소          D-r1 · opus-5-5/high',
    '사용자 답을 기다리는 결정 1개',
    '판정 V1 fail · ccccccc = HEAD',
  ])
  // Done green, blocked red, a cancelled task dim; a failed verdict red.
  expect(lines[1]?.[0]).toMatchObject({ color: THEME_COLORS.ok })
  expect(lines[2]?.[0]).toMatchObject({ color: THEME_COLORS.alert })
  expect(lines[4]?.[2]).toMatchObject({ text: 'D-r1', dim: true })
  expect(lines[6]?.[1]).toMatchObject({ text: 'fail', color: THEME_COLORS.alert })
})

test('in the box a task’s line fits the width: the tail at the right edge, the title cut to what is left, the tail giving way when narrow', () => {
  const tasks = [
    task({ id: 'A', rev: 4, title: 'relay 한 줄 그리기 다듬기: 약어 대신 이름, 줄 사이 빈 줄', status: 'running', runner: 'subagent ag-1', model: 'claude-sonnet-5-5', dispatchedAt: AT }),
    task({ id: 'B', rev: 3, title: '사이드바 relay 상자와 /relay 명령', status: 'done_with_concerns', runner: 'subagent ag-2', dispatchedAt: AT, actualEffort: 'xhigh' }),
    task({ id: 'C', rev: 1, title: 'Write docs', status: 'done', runner: 'orca dispatch:x', dispatchedAt: AT, actualEffort: 'high' }),
  ]
  const status = { runs: [runStatus({ ...STATE, tasks, verdicts: [] }, PROGRESS, undefined)] }
  const at = (width?: number): string[] => texts(relayLines(status, THEME_COLORS, width)).slice(1, 4)
  // The statuses pad to one column (the long one said short), the tails end at the same cell.
  expect(at(76)).toEqual([
    `도는 중   relay 한 줄 그리기 다듬기: 약어 대신 …  4판 · sonnet/high · ${hhmm(AT)}`,
    `끝(걱정)  사이드바 relay 상자와 /relay 명령   3판 · opus/high→xhigh · ${hhmm(AT)}`,
    `끝        Write docs                                      opus/high · ${hhmm(AT)}`,
  ])
  // A cell stays free at the right edge.
  expect(at(76).map(cellWidth)).toEqual([75, 75, 75])
  // An effort that ran other than the brief's is coloured; one that ran as the brief said is not marked.
  const wide = relayLines(status, THEME_COLORS, 76)
  expect(wide[2]?.find(segment => segment.text === '→xhigh')).toMatchObject({ color: THEME_COLORS.warn })
  expect(at(76)[2]).not.toContain('→')

  // Narrower, a title under twenty cells takes the tail's room: the launch time first, then the model, then the brief's number.
  expect(at(52)).toEqual(['도는 중   relay 한 줄 그리기 다…  4판 · sonnet/high', '끝(걱정)  사이드바 relay 상자와 /relay 명령     3판', `끝        Write docs              opus/high · ${hhmm(AT)}`])
  // A short title needs no more than its own cells, so its tail stays.
  expect(at(40)).toEqual(['도는 중   relay 한 줄 그리기 다듬…  4판', '끝(걱정)  사이드바 relay 상자와 /…  3판', `끝        Write docs  opus/high · ${hhmm(AT)}`])
  expect(at(30)).toEqual(['도는 중   relay 한 줄 그리기…', '끝(걱정)  사이드바 relay 상…', '끝        Write docs'])
  // `/relay-status` cuts nothing, says the status in full, the model with its version and the runner.
  expect(at()).toEqual([
    `도는 중         relay 한 줄 그리기 다듬기: 약어 대신 이름, 줄 사이 빈 줄 · 4판 · sonnet-5-5/high · subagent · ${hhmm(AT)}`,
    `걱정과 함께 끝  사이드바 relay 상자와 /relay 명령 · 3판 · opus-5-5/high→xhigh · subagent · ${hhmm(AT)}`,
    `끝              Write docs · opus-5-5/high · orca · ${hhmm(AT)}`,
  ])
})

test('a task is named by its title, "n번째 지시서" from the second brief, its key where the title is not known', () => {
  const status = runStatus(STATE, PROGRESS, undefined)
  const [a, , , d] = status.tasks
  expect(taskName(a!, 40)).toBe('Add the tool (2번째 지시서)')
  expect(taskName({ key: 'B-r1', rev: 1, title: 'Wire the box' }, 40)).toBe('Wire the box')
  expect(taskName(d!, 40)).toBe('D-r1')
  // Cut to the width given, the suffix after it; whitespace folded.
  expect(taskName({ key: 'A-r3', rev: 3, title: 'A very long\ntitle that goes on' }, 10)).toBe('A very lon… (3번째 지시서)')
  // The state holds the title cut short.
  const long = runStatus({ ...STATE, tasks: [task({ id: 'L', rev: 1, status: 'ready', title: 'x'.repeat(100) })] }, PROGRESS, undefined)
  expect(long.tasks[0]?.title).toBe(`${'x'.repeat(40)}…`)

  // A call names its task by key, or by id for the latest revision; a task the summary lacks is not found.
  const runs = { runs: [status] }
  expect(findTaskLine(runs, RUN, 'A-r2')?.title).toBe('Add the tool')
  expect(findTaskLine(runs, RUN, 'A')?.rev).toBe(2)
  expect(findTaskLine(runs, '', 'B')?.key).toBe('B-r1')
  expect(findTaskLine(runs, '2026-11-01-other', 'B')).toBeUndefined()
  // An earlier revision is found by its key, whatever came after it.
  expect(findTaskLine(runs, RUN, 'A-r1')).toEqual({ key: 'A-r1', id: 'A', rev: 1, title: 'Add the tool' })
  expect(findTaskLine(runs, RUN, 'A-r9')).toBeUndefined()
  expect(findTaskLine(null, RUN, 'A')).toBeUndefined()
})

test('a verdict of another commit than HEAD, HEAD not read, no verdict, no decisions, progress.md unread, no task yet: each says so', () => {
  const other = texts(relayLines({ runs: [runStatus(STATE, PROGRESS, 'd'.repeat(40))] }, THEME_COLORS))
  expect(other.at(-1)).toBe('판정 V1 fail · ccccccc ≠ HEAD ddddddd')
  expect(texts(relayLines({ runs: [runStatus(STATE, PROGRESS, undefined)] }, THEME_COLORS)).at(-1)).toBe('판정 V1 fail · ccccccc · HEAD 미확인')

  const bare = texts(relayLines({ runs: [runStatus({ ...STATE, tasks: [], verdicts: [] }, PROGRESS.replace('| asked |', '| decided |'), undefined)] }, THEME_COLORS))
  expect(bare).toEqual([RUN, '작업 없음', '사용자 답을 기다리는 결정 없음', '판정 없음'])
  expect(texts(relayLines({ runs: [runStatus(STATE, undefined, undefined)] }, THEME_COLORS)).at(-2)).toBe('기다리는 결정: progress.md를 읽지 못함')
  // Nothing to show: no lines, so no box.
  expect(relayLines(null, THEME_COLORS)).toEqual([])
  expect(relayLines({ runs: [] }, THEME_COLORS)).toEqual([])
})

test('a run is put in the list by name, replaced on its next save, and taken out once finished', () => {
  const one = runStatus(STATE, PROGRESS, undefined)
  const other = { ...one, run: '2026-11-01-early' }
  const both = withRun(withRun(null, one.run, one), other.run, other)
  expect(both.runs.map(run => run.run)).toEqual(['2026-11-01-early', RUN])
  const replaced = withRun(both, one.run, { ...one, pending: 0 })
  expect(replaced.runs.map(run => [run.run, run.pending])).toEqual([
    ['2026-11-01-early', 1],
    [RUN, 0],
  ])
  expect(withRun(replaced, RUN, undefined).runs.map(run => run.run)).toEqual(['2026-11-01-early'])
})

test('/relay-status’s text with no run under way names the run finished last, or says there is none', () => {
  expect(statusText({ runs: [] }, THEME_COLORS, '2026-11-08-old')).toBe('진행 중인 relay 묶음이 없습니다. 가장 최근에 끝난 묶음: 2026-11-08-old')
  expect(statusText({ runs: [] }, THEME_COLORS)).toBe('진행 중인 relay 묶음이 없습니다. 이 저장소에 끝난 묶음도 없습니다.')
})

// ── In the session ──────────────────────────────────────────────

/** Files in memory over the engine stand-in's (whose fs.exists finds them): every read and listing noted. */
type Disk = { reads: string[]; lists: string[] }

function disk(on: On, standIn: StandIn): Disk {
  const seen: Disk = { reads: [], lists: [] }
  on('fs.read', (_, e) => {
    seen.reads.push(e.path)
    const text = standIn.files[e.path]

    return text === undefined ? { deny: 'ENOENT' } : { value: text as never }
  })
  on('fs.write', (_, e) => {
    standIn.files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    seen.lists.push(e.path)
    const names = new Map<string, 'file' | 'dir'>()
    for (const file of Object.keys(standIn.files)) {
      if (!file.startsWith(`${e.path}/`)) continue
      const [name = '', ...rest] = file.slice(e.path.length + 1).split('/')
      names.set(name, rest.length > 0 ? 'dir' : 'file')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })

  return seen
}

const putRun = (standIn: StandIn, state: RelayState, progress = PROGRESS) => {
  standIn.files[`${RUNS}/${state.run}/state.json`] = `${JSON.stringify(state, null, 2)}\n`
  standIn.files[`${RUNS}/${state.run}/progress.md`] = progress
}

async function relay($: Engine, input: Record<string, unknown>): Promise<{ result?: string; deny?: string }> {
  const answer = (await $.tool.call({ tool: TOOL, ...input } as never)) as { result?: unknown; deny?: string }

  return { result: typeof answer.result === 'string' ? answer.result : undefined, deny: answer.deny }
}

const relayStatus = async ($: Engine): Promise<string> => ((await $.command.run({ ...COMMAND, command: 'relay-status' })) as { text?: string }).text ?? ''

/** The relay box's lines as drawn, or undefined when there is no box. */
async function boxLines(ui: { find: (query: { key: string }) => Promise<{ text: string } | undefined> }): Promise<string[] | undefined> {
  if ((await ui.find({ key: 'box-relay' })) === undefined) return undefined
  const lines: string[] = []
  for (let i = 0; ; i += 1) {
    const line = await ui.find({ key: `relay-${i}` })
    if (line === undefined) return lines
    lines.push(line.text)
  }
}

test('with no run under way there is no relay box, and /relay-status says so, naming the run finished last', async ($, on) => {
  const standIn = standInForEngine(on)
  disk(on, standIn)
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await boxLines(ui)).toBeUndefined()
  expect(await ui.find({ key: 'fold-relay' })).toBeUndefined()
  await ui.unmount()
  expect(await relayStatus($)).toBe('진행 중인 relay 묶음이 없습니다. 이 저장소에 끝난 묶음도 없습니다.')

  // Two finished runs: the one whose last verdict came later is named, whatever the names' order.
  putRun(standIn, { ...STATE, run: '2026-11-07-later', status: 'finished', verdicts: [{ ...STATE.verdicts[0]!, at: AT + 60_000, result: 'pass' }] })
  putRun(standIn, { ...STATE, run: '2026-11-08-sooner', status: 'finished', verdicts: [{ ...STATE.verdicts[0]!, at: AT, result: 'pass' }] })
  expect(await relayStatus($)).toBe('진행 중인 relay 묶음이 없습니다. 가장 최근에 끝난 묶음: 2026-11-07-later')
  const again = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await boxLines(again)).toBeUndefined()
  await again.unmount()
})

test('a run under way at session start: its box is drawn from state, with no file read and nothing run as it draws', async ($, on) => {
  const standIn = standInForEngine(on)
  const seen = disk(on, standIn)
  putRun(standIn, STATE)
  await start($)

  seen.reads.length = 0
  seen.lists.length = 0
  const ran = standIn.ran.length
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const lines = await boxLines(ui)
  // The pane is 56 cells wide, a line 52: the launch time gives way where the title would not fit whole.
  expect(lines?.slice(0, -1)).toEqual([
    RUN,
    '끝            Add the tool      2판 · sonnet/medium',
    `띄운 뒤 막힘  Wire the box        opus/high · ${hhmm(AT)}`,
    '띄우기 전     Write docs                  opus/high',
    '취소          D-r1                        opus/high',
    '사용자 답을 기다리는 결정 1개',
  ])
  // The stand-in's HEAD is its folder: another commit than the verdict's.
  expect(lines?.at(-1)).toMatch(/^판정 V1 fail · ccccccc ≠ HEAD /)
  expect((await ui.find({ key: 'fold-relay' }))?.text).toBe(' ▾ relay ')
  expect(seen.reads).toEqual([])
  expect(seen.lists).toEqual([])
  expect(standIn.ran.slice(ran)).toEqual([])

  // Folded, the box is its title alone.
  await ui.press({ key: 'fold-relay' })
  expect(await ui.find({ key: 'relay-0' })).toBeUndefined()
  expect(await ui.find({ key: 'fold-relay' })).toBeDefined()
  await ui.unmount()
})

test('the relay tool’s changes show at the next drawing: the run started, a task written, then launched; /relay-status says the same', async ($, on) => {
  const standIn = standInForEngine(on)
  disk(on, standIn)
  await start($)
  const run = `${localDate(NOW)}-demo`

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await boxLines(ui)).toBeUndefined()

  expect((await relay($, { action: 'start', name: 'demo', goal: 'Ship relay.', done_when: ['all checks pass'] })).deny).toBeUndefined()
  expect(await boxLines(ui)).toEqual([run, '작업 없음', '사용자 답을 기다리는 결정 없음', '판정 없음'])

  const written = await relay($, {
    action: 'task',
    run,
    id: 'A',
    title: 'Add the box',
    goal: 'Draw the runs.',
    model: 'claude-opus-5-5',
    effort: 'high',
    edit_scope: ['hooks/sidebar/**'],
    done_when: [{ text: 'tests pass', command: 'make test' }],
    runner_kind: 'claude',
  })
  expect(written.deny).toBeUndefined()
  expect((await boxLines(ui))?.[1]).toBe('띄우기 전  Add the box                    opus/high')

  expect((await relay($, { action: 'dispatched', run, task: 'A', runner: 'subagent worker-a' })).deny).toBeUndefined()
  const shown = await boxLines(ui)
  expect(shown?.[1]).toBe(`도는 중  Add the box              opus/high · ${hhmm(NOW)}`)
  await ui.unmount()

  // The same run as text: the line whole, with the model's version and the runner.
  expect(await relayStatus($)).toBe(
    ['진행 중인 relay 묶음 1개:', [run, `도는 중  Add the box · opus-5-5/high · subagent · ${hhmm(NOW)}`, '사용자 답을 기다리는 결정 없음', '판정 없음'].join('\n')].join('\n\n'),
  )
})

test('a relay call in the conversation names its task by the title held in state, drawn with no file read; a blank line above it', async ($, on) => {
  const standIn = standInForEngine(on)
  const seen = disk(on, standIn)
  putRun(standIn, STATE)
  await start($)

  seen.reads.length = 0
  seen.lists.length = 0
  const use = (requestId: string, input: unknown) => ({
    plugin: 'hubblerc',
    component: 'ToolUse' as const,
    surface: 'terminal' as const,
    requestId,
    props: { tool_use_id: requestId, tool: TOOL, input, isRunning: false, isErrored: false, isInterrupted: false },
  })
  const cancel = await $.ui.mount(use('toolu_1', { action: 'cancel', run: RUN, task: 'A-r2', reason: 'x' }))
  expect((await cancel.find({ type: 'Text', text: /relay 취소/ }))?.text).toBe('relay 취소 Add the tool (2번째 지시서) · x')
  expect(JSON.stringify(await cancel.drawn())).toContain('"marginTop":1')
  await cancel.unmount()

  // The id alone says the same; a task with no title in state is said by its key.
  const byId = await $.ui.mount(use('toolu_2', { action: 'report', run: RUN, task: 'B' }))
  expect((await byId.find({ type: 'Text', text: /relay 보고/ }))?.text).toBe('relay 보고 확인 Wire the box')
  await byId.unmount()
  const bare = await $.ui.mount(use('toolu_3', { action: 'check', run: RUN, task: 'D' }))
  expect((await bare.find({ type: 'Text', text: /relay 완료/ }))?.text).toBe('relay 완료 검사 D-r1')
  await bare.unmount()
  // A run the summary does not hold: the key as said.
  const gone = await $.ui.mount(use('toolu_4', { action: 'check', run: '2026-11-01-old', task: 'A-r2' }))
  expect((await gone.find({ type: 'Text', text: /relay 완료/ }))?.text).toBe('relay 완료 검사 A-r2')
  await gone.unmount()
  expect(seen.reads).toEqual([])
  expect(seen.lists).toEqual([])
})

test('/relay-status reads the runs again and puts the box to them: a run another session finished leaves it', async ($, on) => {
  const standIn = standInForEngine(on)
  disk(on, standIn)
  putRun(standIn, STATE)
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await boxLines(ui))?.[0]).toBe(RUN)
  putRun(standIn, { ...STATE, status: 'finished' })
  expect(await relayStatus($)).toBe(`진행 중인 relay 묶음이 없습니다. 가장 최근에 끝난 묶음: ${RUN}`)
  expect(await boxLines(ui)).toBeUndefined()
  await ui.unmount()
})

test('an abandoned run is not under way: no box at session start, gone from the box once abandoned, and never the run "finished last"', async ($, on) => {
  const standIn = standInForEngine(on)
  disk(on, standIn)
  // Abandoned later than the finished one: the finished one is still named.
  putRun(standIn, { ...STATE, run: '2026-11-07-done', status: 'finished', verdicts: [{ ...STATE.verdicts[0]!, at: AT, result: 'pass' }] })
  putRun(standIn, { ...STATE, run: '2026-11-08-dropped', status: 'abandoned', abandonedAt: AT + 60_000, abandonReason: 'trial', verdicts: [{ ...STATE.verdicts[0]!, at: AT + 60_000 }] })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await boxLines(ui)).toBeUndefined()
  expect(await relayStatus($)).toBe('진행 중인 relay 묶음이 없습니다. 가장 최근에 끝난 묶음: 2026-11-07-done')

  // Through the tool: the run is in the box, then abandoned and out of it at the next drawing.
  const run = `${localDate(NOW)}-demo`
  expect((await relay($, { action: 'start', name: 'demo', goal: 'Try relay.', done_when: ['nothing'] })).deny).toBeUndefined()
  expect((await boxLines(ui))?.[0]).toBe(run)
  expect((await relay($, { action: 'abandon', run, reason: 'trial run' })).result).toMatch(/^묶음을 버렸습니다: /)
  expect(await boxLines(ui)).toBeUndefined()
  await ui.unmount()
  expect(await relayStatus($)).toBe('진행 중인 relay 묶음이 없습니다. 가장 최근에 끝난 묶음: 2026-11-07-done')
})

test('idle with a run under way, nothing under .relay is read: the box waits for a save, not a timer', async ($, on) => {
  const standIn = standInForEngine(on)
  const seen = disk(on, standIn)
  putRun(standIn, STATE)
  standIn.panes.push({ id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true })
  await start($)

  seen.reads.length = 0
  seen.lists.length = 0
  await standIn.clock.advance(180_000)
  expect(seen.reads.filter(path => path.includes('.relay'))).toEqual([])
  expect(seen.lists.filter(path => path.includes('.relay'))).toEqual([])
})
