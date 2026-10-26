import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { TurnRecord } from '../types'
import { clipCells, sessionFiles, tocEntries, tocPage } from '../hooks/sidebar-format'
import { NOW, standInForEngine, start } from './engine'

const BAND = { plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band' } as const
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = {
  title: 'hubblerc',
  isFocused: false,
  bodyColumns: 56,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const FULLSCREEN = { columns: 200, rows: 50, isFullscreen: true }
const MAIN_SCREEN = { columns: 200, rows: 50, isFullscreen: false }

/** The engine's own band beneath the plugin: nothing while no survey holds it. */
function drawNothingBeneath(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

const turn = (id: string, runs: TurnRecord['runs'], extra: Partial<TurnRecord> = {}): TurnRecord => ({
  id,
  prompt: id,
  startedAt: NOW - 60_000,
  durationMs: 5000,
  runs,
  ...extra,
})

test('the files the session changed add up across answers, the one changed last first', () => {
  const list = [
    turn('t1', [
      { id: '1', tool: 'Edit', ms: 1, isError: false, path: '/r/src/auth.ts', added: 3, removed: 1 },
      { id: '2', tool: 'Write', ms: 1, isError: false, path: '/r/src/index.ts', added: 5, removed: 0 },
    ]),
    turn('t2', [{ id: '3', tool: 'Read', ms: 1, isError: false, path: '/r/README.md' }]),
    turn('t3', [
      { id: '4', tool: 'Edit', ms: 1, isError: false, path: '/r/src/auth.ts', added: 2, removed: 2 },
      { id: '5', tool: 'Edit', ms: 1, isError: false, path: '/r/test/index.ts', added: 1, removed: 0, agentId: 'ag-1' },
    ]),
  ]

  expect(sessionFiles(list).map(file => [file.name, file.added, file.removed, file.turns])).toEqual([
    ['test/index.ts', 1, 0, [3]],
    ['auth.ts', 5, 3, [1, 3]],
    ['src/index.ts', 5, 0, [1]],
  ])
})

test('a file in the repository with nothing left to commit counts as committed; one outside never does', () => {
  const list = [
    turn('t1', [
      { id: '1', tool: 'Edit', ms: 1, isError: false, path: '/repo/a.ts', added: 1, removed: 0 },
      { id: '2', tool: 'Edit', ms: 1, isError: false, path: '/repo/b.ts', added: 1, removed: 0 },
      { id: '3', tool: 'Write', ms: 1, isError: false, path: '/tmp/c.ts', added: 1, removed: 0 },
    ]),
  ]
  const git = { branch: 'main', isDirty: true, root: '/repo', changed: ['/repo/b.ts'] }

  expect(sessionFiles(list, git).map(file => [file.name, file.isCommitted])).toEqual([
    ['c.ts', false],
    ['b.ts', false],
    ['a.ts', true],
  ])
  expect(sessionFiles(list).every(file => !file.isCommitted)).toBe(true)
})

test('the contents list answers newest first, each with the row a press scrolls to', () => {
  const list = [
    turn('t1', [], { prompt: '첫 질문', promptRowId: 'row-q1', lineId: 'row-end1' }),
    turn('t2', [{ id: 'r', tool: 'Bash', ms: 1, isError: true }], { prompt: '', durationMs: 12_000, lineId: 'row-end2' }),
    turn('t3', [], { prompt: '복원된 질문', durationMs: 0, restored: true }),
    turn('t4', [], { prompt: '세 번째', startedAt: NOW - 8000, durationMs: null, promptRowId: 'row-q4' }),
  ]

  expect(tocEntries(list, NOW).map(entry => [entry.number, entry.title, entry.time, entry.failed, entry.target])).toEqual([
    [4, '세 번째', '진행 중 8s', 0, { requestId: 'row-q4', block: 'start' }],
    [3, '복원된 질문', '', 0, undefined],
    [2, '(이어진 답변)', '12s', 1, { requestId: 'row-end2', block: 'end' }],
    [1, '첫 질문', '5s', 0, { requestId: 'row-q1', block: 'start' }],
  ])
  expect(tocEntries(list, NOW, 2).map(entry => entry.number)).toEqual([4, 3])
})

test('the contents go ten answers to a page, the newest first', () => {
  const list = Array.from({ length: 23 }, (_, i) => turn(`t${i + 1}`, []))
  const all = tocEntries(list, NOW)

  expect(tocPage(all, 0, 10).entries.map(entry => entry.number)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14])
  expect(tocPage(all, 2, 10)).toMatchObject({ page: 2, pages: 3 })
  expect(tocPage(all, 2, 10).entries.map(entry => entry.number)).toEqual([3, 2, 1])
  expect(tocPage(all, 9, 10).page).toBe(2)
})

test('the sidebar pages through the contents', async ($, on) => {
  standInForEngine(on)
  await start($)
  for (let i = 1; i <= 12; i += 1) {
    await $.turn.start({ text: `질문 ${i}`, turnId: `t${i}` })
    await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: `t${i}`, durationMs: 1000 })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 #3~12 / 12')
  expect(await ui.find({ key: 'turn-t1' })).toBeUndefined()
  await ui.press({ key: 'toc-older' })
  expect((await ui.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 #1~2 / 12')
  expect((await ui.find({ key: 'turn-t1' }))?.text).toBe('#1 질문 1')
  await ui.press({ key: 'toc-page-0' })
  expect((await ui.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 #3~12 / 12')
  await ui.unmount()
})

test('a title is cut to the cells it has, Korean taking two', () => {
  expect(clipCells('abcdef', 4)).toBe('abc…')
  expect(clipCells('인증 버그 수정', 7)).toBe('인증 …')
  expect(clipCells('짧음', 10)).toBe('짧음')
})

const promptRow = (uuid: string, text: string) =>
  ({
    door: 'prompt' as const,
    origin: { kind: 'composer' as const },
    uuid,
    message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'text' as const, text }] },
  })

/** Two answers: the first's question row lands before its turn starts, the second's after. */
async function twoAnswers($: Engine): Promise<void> {
  await $.session.append(promptRow('row-q1', '첫 질문'))
  await $.turn.start({ text: '첫 질문', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/hubblerc/notes.md', content: 'a\nb\n' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 5000 })
  await $.turn.start({ text: '두 번째 질문', turnId: 't2' })
  await $.session.append(promptRow('row-q2', '두 번째 질문'))
  await $.tool.call({ tool: 'Bash', command: 'bun test', description: '테스트 실행' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't2', durationMs: 12_000 })
}

test('the sidebar shows the status, the files changed and the contents', async ($, on) => {
  standInForEngine(on)
  await start($)
  await twoAnswers($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: PANE_PROPS })

    expect((await ui.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
    expect((await ui.find({ key: 'effort' }))?.text).toBe('xhigh')
    expect(await ui.find({ type: 'Text', text: '45%' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /대기 중/ }))?.text).toBe('· 대기 중')
    // The stand-in's git has notes.md in the repository and nothing of it left to commit.
    expect((await ui.find({ type: 'Text', text: /^변경 파일/ }))?.text).toBe('변경 파일 1 · 커밋 안 됨 0')
    expect((await ui.find({ type: 'Text', text: 'notes.md' }))?.text).toBe('notes.md')
    expect(await ui.find({ type: 'Text', text: ' ✓' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: ' +2' }))?.text).toBe(' +2')
    expect((await ui.find({ key: 'turn-t2' }))?.text).toBe('#2 두 번째 질문')
    expect((await ui.find({ key: 'turn-t1' }))?.text).toBe('#1 첫 질문')
    // What each answer did is on its own closing line in the conversation, not here.
    expect(await ui.find({ type: 'Text', text: /테스트 실행/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('an answer with a row to scroll to is a button in the contents; its question row ties to it either way round', async ($, on) => {
  standInForEngine(on)
  await start($)
  await twoAnswers($)

  // The kit draws no conversation, so the scroll itself is checked on screen; which row it targets
  // is checked on the entries above. Here no closing line was appended, so an answer is a button
  // only if its question's row tied to it: the first's landed before its turn, the second's after.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'turn-t1' }))?.type).toBe('Button')
  expect((await ui.find({ key: 'turn-t2' }))?.type).toBe('Button')
  await ui.unmount()
})

test('auto: under the fullscreen layout the band opens the sidebar and stands aside while it shows', async ($, on) => {
  const standIn = standInForEngine(on)
  drawNothingBeneath(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: FULLSCREEN })
  expect(standIn.opened).toEqual([expect.objectContaining({ id: 'hubblerc', title: 'hubblerc' })])

  // Docking narrows the band's column, which draws it again.
  await band.redraw({ ...BAND_PROPS, bodyColumns: 140 })
  expect(await band.find({ type: 'Text', text: /^Opus/ })).toBeUndefined()
  expect(standIn.opened).toHaveLength(1)

  // The effort control lives in the sidebar then; the slider still opens in the band, where digits pick.
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await pane.press({ key: 'effort' })
  expect(await band.find({ key: 'effort-high' })).toBeDefined()
  await band.press({ key: 'effort-high' })
  expect((await pane.find({ key: 'effort' }))?.text).toBe('high')
  expect(await band.find({ key: 'effort-high' })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})

test('auto: under 144 columns the sidebar waits undrawn and the band stays', async ($, on) => {
  const standIn = standInForEngine(on, { placeOnOpen: false })
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: { ...FULLSCREEN, columns: 120 } })
  await band.redraw(BAND_PROPS)
  expect(standIn.opened).toHaveLength(1)
  expect((await band.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
  await band.unmount()
})

test('auto: too narrow to dock, no sidebar opens', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: { ...FULLSCREEN, columns: 100 } })
  expect(standIn.opened).toHaveLength(0)
  expect((await band.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
  await band.unmount()
})

test('auto: a sidebar pushed above the prompt by a narrower terminal closes, and comes back on a widening', async ($, on) => {
  const standIn = standInForEngine(on)
  drawNothingBeneath(on)
  await start($)

  const wide = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: FULLSCREEN })
  await wide.unmount()
  expect(standIn.panes.map(pane => pane.id)).toEqual(['hubblerc'])

  const inline = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, placement: 'inline' }, viewport: { ...FULLSCREEN, columns: 100 } })
  expect(standIn.panes).toHaveLength(0)
  await inline.unmount()

  const narrow = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: { ...FULLSCREEN, columns: 100 } })
  expect((await narrow.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
  expect(standIn.opened).toHaveLength(1)
  await narrow.unmount()

  const widened = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: FULLSCREEN })
  expect(standIn.opened).toHaveLength(2)
  await widened.unmount()
})

test('auto: the main screen keeps the band and opens no sidebar', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: MAIN_SCREEN })
  expect(standIn.opened).toHaveLength(0)
  expect((await band.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
  await band.unmount()
})

test('sidebar: the main screen opens it too', { options: { layout: 'sidebar' } }, async ($, on) => {
  const standIn = standInForEngine(on)
  drawNothingBeneath(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: MAIN_SCREEN })
  expect(standIn.opened).toHaveLength(1)
  await band.redraw(BAND_PROPS)
  expect(await band.find({ type: 'Text', text: /^Opus/ })).toBeUndefined()
  await band.unmount()
})

test('band: the band stays and no sidebar opens by itself, and one left open closes', { options: { layout: 'band' } }, async ($, on) => {
  const standIn = standInForEngine(on)
  standIn.panes.push({ id: 'hubblerc', title: 'hubblerc', isShown: true, isFocused: false, isPlaced: true })
  await start($)
  expect(standIn.panes).toHaveLength(0)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: FULLSCREEN })
  expect(standIn.opened).toHaveLength(0)
  expect((await band.find({ type: 'Text', text: /^Opus/ }))?.text).toBe('Opus 5.5')
  await band.unmount()
})

test('/panel opens the sidebar, and closes it when it shows', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  const run = async () =>
    (
      await $.command.run({
        command: 'panel',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 200 },
      })
    ).text

  // Quiet when it did what was asked: the sidebar coming or going says so.
  expect(await run()).toBeUndefined()
  expect(standIn.panes.map(pane => pane.id)).toEqual(['hubblerc'])
  expect(await run()).toBeUndefined()
  expect(standIn.panes).toHaveLength(0)

  // Closed by the command (or by the person's close, which the kit cannot raise), it stays closed
  // while the terminal stays wide; a narrow terminal ends that, and the next widening opens it.
  const wide = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: FULLSCREEN })
  expect(standIn.opened).toHaveLength(1)
  await wide.unmount()
  const narrow = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: { ...FULLSCREEN, columns: 100 } })
  await narrow.unmount()
  const widened = await $.ui.mount({ ...BAND, surface: 'terminal', props: BAND_PROPS, viewport: FULLSCREEN })
  expect(standIn.opened).toHaveLength(2)
  await widened.unmount()
})

test('/panel on a narrow terminal opens it above the prompt, where auto leaves it', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)

  const text = (
    await $.command.run({ command: 'panel', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  ).text
  expect(text).toBeUndefined()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, placement: 'inline' }, viewport: { ...FULLSCREEN, columns: 100 } })
  expect(standIn.panes.map(open => open.id)).toEqual(['hubblerc'])
  await pane.unmount()
})
