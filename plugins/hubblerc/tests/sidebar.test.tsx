import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { TurnRecord } from '../types'
import { clipCells, fileLayout, fileRows, fileUrl, fitFileLayout, sessionFiles, shareRows, shortPath, tocEntries, tocPage, tocPageSize, tocRows } from '../hooks/sidebar-format'
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

test('a file in an untracked folder is untracked, one .gitignore keeps out is ignored; neither counts as committed', () => {
  const edit = (id: string, path: string) => ({ id, tool: 'Write', ms: 1, isError: false, path, added: 1, removed: 0 })
  const list = [turn('t1', [edit('1', '/repo/docs/drafts/plan.md'), edit('2', '/repo/dist/out.js'), edit('3', '/repo/a.ts')])]
  const git = { branch: 'main', isDirty: true, root: '/repo', changed: ['/repo/docs/drafts/'], untracked: ['/repo/docs/drafts/'], ignored: ['/repo/dist/'] }

  expect(sessionFiles(list, git).map(file => [file.name, file.isCommitted, file.isUntracked, file.isIgnored])).toEqual([
    ['a.ts', true, false, false],
    ['out.js', false, false, true],
    ['plan.md', false, true, false],
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

  expect(sessionFiles(list, git).map(file => [file.name, file.isCommitted, file.isOutside])).toEqual([
    ['c.ts', false, true],
    ['b.ts', false, false],
    ['a.ts', true, false],
  ])
  // With no repository known, nothing is committed and nothing is outside.
  expect(sessionFiles(list).every(file => !file.isCommitted && !file.isOutside)).toBe(true)
})

test("the repository's files come first, then those outside it by folder, each part saying how many it left out", () => {
  const edit = (id: string, path: string) => ({ id, tool: 'Edit', ms: 1, isError: false, path, added: 1, removed: 0 })
  const git = { branch: 'main', isDirty: true, root: '/repo', changed: [] }
  const limits = { total: 12, minInside: 6, folders: 3, perFolder: 2 }
  const names = (layout: ReturnType<typeof fileLayout>) => [
    layout.inside.map(file => file.name),
    layout.insideHidden,
    layout.outside.map(group => [group.folder, group.files.map(file => file.name), group.hidden]),
    layout.foldersHidden,
  ]

  const few = sessionFiles(
    [
      turn('t1', [edit('1', '/repo/a.ts'), edit('2', '/tmp/x/one.ts'), edit('3', '/home/me/.claude/memory/m.md')]),
      turn('t2', [edit('4', '/repo/b.ts'), edit('5', '/tmp/x/two.ts')]),
    ],
    git,
  )
  expect(names(fileLayout(few, limits))).toEqual([
    ['b.ts', 'a.ts'],
    0,
    [
      ['/tmp/x', ['two.ts', 'one.ts'], 0],
      ['/home/me/.claude/memory', ['m.md'], 0],
    ],
    0,
  ])

  // Many changes in the repository, made after the ones outside it, push nothing outside out of sight.
  const many = sessionFiles(
    [
      turn('t1', [edit('o1', '/tmp/x/one.ts'), edit('o2', '/tmp/x/two.ts'), edit('o3', '/tmp/x/three.ts'), edit('m', '/home/me/.claude/memory/m.md')]),
      turn('t2', Array.from({ length: 14 }, (_, i) => edit(`r${i}`, `/repo/f${i}.ts`))),
    ],
    git,
  )
  const crowded = fileLayout(many, limits)
  expect(crowded.inside).toHaveLength(9)
  expect(crowded.insideHidden).toBe(5)
  expect(crowded.outside.map(group => [group.folder, group.files.length, group.hidden])).toEqual([
    ['/home/me/.claude/memory', 1, 0],
    ['/tmp/x', 2, 1],
  ])

  // Past the folders shown, the rest are counted; the repository keeps its least.
  const tight = fileLayout(many, { total: 3, minInside: 2, folders: 1, perFolder: 1 })
  expect(names(tight)).toEqual([['f13.ts', 'f12.ts'], 12, [['/home/me/.claude/memory', ['m.md'], 0]], 1])
})

test("a folder's path is short: home as ~, macOS's /private/tmp as /tmp, its middle as …", () => {
  expect(shortPath('/Users/me/.claude/projects/-Users-me-vault-project/memory', 30)).toBe('~/.claude/…/memory')
  expect(shortPath('/Users/me/.claude/projects/x/memory', 40)).toBe('~/.claude/projects/x/memory')
  expect(shortPath('/private/tmp/claude-502/-Users-me/5cc8ff3a-965a/scratchpad', 31)).toBe('/tmp/…/5cc8ff3a-965a/scratchpad')
  expect(shortPath('/private/tmp/claude-502/-Users-me/5cc8ff3a-965a/scratchpad', 20)).toBe('/tmp/…/scratchpad')
  expect(shortPath('/a/very-long-folder-name-indeed', 12)).toBe('…/very-long…')
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

test('the files and the contents share the rows left: all when both fit, else the smaller its want, else half each', () => {
  expect(shareRows(30, 13, 11)).toEqual({ files: 13, toc: 11 })
  expect(shareRows(20, 5, 11)).toEqual({ files: 5, toc: 11 })
  expect(shareRows(18, 13, 6)).toEqual({ files: 12, toc: 6 })
  expect(shareRows(20, 13, 11)).toEqual({ files: 10, toc: 10 })
  // No files box: the contents take it all. Too few rows: each keeps three.
  expect(shareRows(20, 0, 11)).toEqual({ files: 0, toc: 11 })
  expect(shareRows(2, 13, 11)).toEqual({ files: 3, toc: 3 })
})

test('the contents put fewer answers on a page as rows run short, a row kept for the pager', () => {
  expect(tocRows(0, 10)).toBe(1)
  expect(tocRows(7, 10)).toBe(7)
  expect(tocRows(23, 10)).toBe(11)
  expect(tocPageSize(7, 7, 10)).toBe(10)
  expect(tocPageSize(23, 11, 10)).toBe(10)
  expect(tocPageSize(23, 6, 10)).toBe(5)
  expect(tocPageSize(7, 5, 10)).toBe(4)
  expect(tocPageSize(23, 1, 10)).toBe(1)
})

test('the files fit the rows they have, the folders outside and their files fewer with them', () => {
  const edit = (id: string, path: string) => ({ id, tool: 'Edit', ms: 1, isError: false, path, added: 1, removed: 0 })
  const git = { branch: 'main', isDirty: true, root: '/repo', changed: [] }
  const limits = { total: 12, minInside: 6, folders: 3, perFolder: 2 }
  const files = sessionFiles(
    [
      turn('t1', [edit('a', '/tmp/a/1.ts'), edit('b', '/tmp/a/2.ts'), edit('c', '/tmp/a/3.ts'), edit('d', '/tmp/b/1.ts'), edit('e', '/tmp/c/1.ts'), edit('f', '/tmp/d/1.ts')]),
      turn('t2', Array.from({ length: 14 }, (_, i) => edit(`r${i}`, `/repo/f${i}.ts`))),
    ],
    git,
  )

  // Room enough: as twelve lay out.
  expect(fitFileLayout(files, limits, 40)).toEqual(fileLayout(files, limits))
  for (const rows of [16, 10, 6]) {
    const fitted = fitFileLayout(files, limits, rows)
    expect(fileRows(fitted)).toBeLessThanOrEqual(rows)
    expect(fitted.inside.length).toBeGreaterThan(0)
    expect(fitted.outside.length).toBeGreaterThan(0)
  }
  expect(fitFileLayout(files, limits, 6).outside).toHaveLength(1)
  // Under its fewest (a file, "외 N개", a folder's rule and file, "다른 폴더 N개"), the fewest.
  expect(fileRows(fitFileLayout(files, limits, 4))).toBe(5)
})

test('a short pane shows fewer files and answers, so the contents are not cut off below', async ($, on) => {
  standInForEngine(on)
  await start($)
  for (let i = 1; i <= 12; i += 1) {
    await $.turn.start({ text: `질문 ${i}`, turnId: `t${i}` })
    await $.tool.call({ tool: 'Write', file_path: `/repo/hubblerc/f${i}.ts`, content: 'x\n' })
    await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: `t${i}`, durationMs: 1000 })
  }

  const tall = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 60 } } })
  expect((await tall.findAll({ type: 'Link' })).length).toBe(12)
  expect((await tall.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 #3~12 / 12')
  await tall.unmount()

  const short = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 36 } } })
  const links = (await short.findAll({ type: 'Link' })).length
  const title = (await short.find({ type: 'Text', text: /^목차/ }))?.text ?? ''
  const [, from, to] = /#(\d+)~(\d+)/.exec(title) ?? []
  const answers = Number(to) - Number(from) + 1
  expect(links).toBeLessThan(12)
  expect(answers).toBeLessThan(10)
  expect(await short.find({ key: 'inside-more' })).toBeDefined()
  expect(await short.find({ key: 'toc-older' })).toBeDefined()
  await short.unmount()

  // Folding the files gives their rows to the contents.
  const roomy = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 36 } } })
  await roomy.press({ key: 'fold-files' })
  expect((await roomy.find({ type: 'Text', text: /^목차/ }))?.text).toBe('목차 #3~12 / 12')
  await roomy.unmount()
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
    expect((await ui.find({ key: 'fold-files' }))?.text).toBe(' ▾ 파일 ')
    expect(await ui.find({ key: 'file-/repo/hubblerc/notes.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ✓' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: ' +2' }))?.text).toBe(' +2')
    expect((await ui.find({ key: 'turn-t2' }))?.text).toBe('#2 두 번째 질문')
    expect((await ui.find({ key: 'turn-t1' }))?.text).toBe('#1 첫 질문')
    // What each answer did is on its own closing line in the conversation, not here.
    expect(await ui.find({ type: 'Text', text: /테스트 실행/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('each part of the sidebar is a box, its title drawn over the top border after it', async ($, on) => {
  standInForEngine(on)
  await start($)
  await twoAnswers($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  for (const id of ['status', 'activity', 'files', 'contents']) {
    expect((await ui.find({ key: `box-${id}` }))?.props).toMatchObject({ borderStyle: 'round', borderDimColor: true })
  }
  // The title row comes after its box in the tree, so it is painted over the border, not under it.
  expect((await ui.find({ key: 'title-status' }))?.props).toMatchObject({ marginBottom: -1 })
  expect((await ui.find({ key: 'title-status' }))?.text).toBe('╭── ▾ 상태 ')
  expect((await ui.find({ key: 'fold-activity' }))?.text).toBe(' ▾ 작업 ')
  expect((await ui.find({ key: 'fold-files' }))?.text).toBe(' ▾ 파일 ')
  expect((await ui.find({ key: 'fold-contents' }))?.text).toBe(' ▾ 목차 2 ')
  await ui.unmount()
})

test('a press on a box title folds it to one line and back; the fold is kept for the next session', async ($, on) => {
  standInForEngine(on)
  // The plugin's store, kept where the test can see it.
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  await start($)
  await twoAnswers($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  await ui.press({ key: 'fold-files' })
  expect(await ui.find({ key: 'file-/repo/hubblerc/notes.md' })).toBeUndefined()
  expect((await ui.find({ key: 'fold-files' }))?.text).toBe(' ▸ 파일 ')
  expect((await ui.find({ key: 'box-files' }))?.props.borderStyle).toBeUndefined()
  expect(stored.sidebarFolded).toEqual(['files'])

  await ui.press({ key: 'fold-files' })
  expect(await ui.find({ key: 'file-/repo/hubblerc/notes.md' })).toBeDefined()
  expect(stored.sidebarFolded).toEqual([])
  await ui.unmount()
})

test('files outside the repository go dim under a rule naming their folder, after those in it', async ($, on) => {
  standInForEngine(on)
  await start($)
  await twoAnswers($)
  await $.turn.start({ text: '세 번째 질문', turnId: 't3' })
  await $.tool.call({ tool: 'Write', file_path: '/private/tmp/claude-502/session/scratchpad/draft.tsx', content: 'x\n' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't3', durationMs: 1000 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  // 56 columns less the box's frame: 52, the path then a rule to the end.
  const rule = await ui.find({ type: 'Text', text: /^┄┄/ })
  expect(rule?.text).toBe(`┄┄ /tmp/claude-502/session/scratchpad ${'┄'.repeat(52 - 4 - 34)}`)
  expect(rule?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'draft.tsx' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: ' +1' }))?.props).toMatchObject({ dimColor: true })
  // The repository's file stays above the rule, as it was.
  expect(await ui.find({ key: 'file-/repo/hubblerc/notes.md' })).toBeDefined()
  await ui.unmount()
})

test('a file name is a link to the file, as a path in the conversation is', async ($, on) => {
  standInForEngine(on)
  await start($)
  await twoAnswers($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('file:///repo/hubblerc/notes.md')
  // The kit's text of a Link carries its URL too; on screen only the name shows.
  expect(link?.children).toEqual(['notes.md'])
  await ui.unmount()

  // Each part of the path encoded: a space, Korean, `#` and `?` stay in it.
  expect(fileUrl('/a b/한글#1?.md')).toBe('file:///a%20b/%ED%95%9C%EA%B8%80%231%3F.md')
})

test('"외 N개 더 보기" shows every file; "줄이기", where it stood, goes back to twelve', async ($, on) => {
  standInForEngine(on)
  await start($)
  await $.turn.start({ text: '많이 고치기', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: '/private/tmp/x/out.ts', content: 'x\n' })
  for (let i = 0; i < 15; i += 1) await $.tool.call({ tool: 'Write', file_path: `/repo/hubblerc/f${i}.ts`, content: 'x\n' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const rows = async () => (await ui.findAll({ type: 'Link' })).length
  // The folder outside keeps its file; the repository has the other eleven.
  expect(await rows()).toBe(12)
  expect((await ui.find({ key: 'inside-more' }))?.text).toBe('외 4개 더 보기')
  expect(await ui.find({ key: 'files-collapse' })).toBeUndefined()

  await ui.press({ key: 'inside-more' })
  expect(await rows()).toBe(16)
  expect(await ui.find({ key: 'inside-more' })).toBeUndefined()
  // Where "외 N개" stood: after the repository's files, before the folder outside. The title is left alone.
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const shrink = texts.indexOf('줄이기')
  expect(shrink).toBeGreaterThan(texts.findIndex(text => text.endsWith('f0.ts')))
  expect(shrink).toBeLessThan(texts.findIndex(text => text.startsWith('┄┄ /tmp/x')))
  expect((await ui.find({ key: 'title-files' }))?.text).toBe('╭── ▾ 파일 ')

  await ui.press({ key: 'files-collapse' })
  expect(await rows()).toBe(12)
  await ui.unmount()
})

test('a box folded in an earlier session starts folded', async ($, on) => {
  standInForEngine(on)
  mock.store(on, { sidebarFolded: ['contents'] })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'fold-contents' }))?.text).toBe(' ▸ 목차 0 ')
  expect(await ui.find({ type: 'Text', text: /아직 기록된 답변/ })).toBeUndefined()
  expect((await ui.find({ key: 'box-status' }))?.props.borderStyle).toBe('round')
  await ui.unmount()
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
