import { expect, test } from 'claude-code/testing'

import { todoStoreKey } from '../hooks/todo/todo-format'
import type { UserTodo } from '../hooks/todo/todo-format'
import { cellWidth } from '../hooks/shared/text-width'
import { NOW, standInForEngine, start } from './engine'

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const COLUMNS = 40
const PANE_PROPS = {
  title: 'hubblerc',
  isFocused: false,
  bodyColumns: COLUMNS,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}
const KEY = todoStoreKey('/repo/hubblerc')

const item = (id: number, text: string): UserTodo => ({ id, text, status: 'pending', createdAt: NOW })

test('each to-do row shows its id dim between the status mark and the title, and a long title is clipped to fit', async ($, on) => {
  standInForEngine(on)
  const stored: Record<string, unknown> = {
    sidebarTab: 'todo',
    [KEY]: { items: [item(3, '짧은 제목'), item(21, '아주 길게 적어 둔 할 일의 제목이라서 줄 안에 다 들어가지 않습니다 정말로'), item(22, '다른 일')], nextId: 23 },
  }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })

  const row3 = await ui.find({ key: 'todo-3' })
  const row21 = await ui.find({ key: 'todo-21' })
  expect(row3?.text).toMatch(/^📌 3 짧은 제목/)
  expect(row21?.text).toMatch(/^📌 21 아주/)
  expect(cellWidth(row21?.text ?? '')).toBeLessThanOrEqual(COLUMNS)
  expect((await ui.find({ key: 'todo-text-21' }))?.text).toMatch(/^ 아주/)
  await ui.unmount()
})

test('a to-do with a detail keeps one mark: its title is cut flat, the ⋯ at the row end says there is more', async ($, on) => {
  standInForEngine(on)
  const long = '아주 길게 적어 둔 할 일의 제목이라서 줄 안에 다 들어가지 않습니다 정말로'
  const stored: Record<string, unknown> = {
    sidebarTab: 'todo',
    [KEY]: {
      items: [
        { ...item(4, long), detail: '세부' },
        { ...item(5, '짧게 남은 제목…'), detail: '긴 글 전체' },
        item(6, long),
      ],
      nextId: 7,
    },
  }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })

  const clipped = (await ui.find({ key: 'todo-text-4' }))?.text ?? ''
  expect(clipped).toMatch(/^ 아주/)
  expect(clipped).not.toContain('…')
  expect((await ui.find({ key: 'todo-4' }))?.text).toContain(' ⋯')
  expect((await ui.find({ key: 'todo-text-5' }))?.text).toBe(' 짧게 남은 제목')
  expect((await ui.find({ key: 'todo-text-6' }))?.text).toMatch(/…$/)
  expect(cellWidth((await ui.find({ key: 'todo-4' }))?.text ?? '')).toBeLessThanOrEqual(COLUMNS)
  await ui.unmount()
})
