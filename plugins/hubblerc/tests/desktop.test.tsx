import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isIgnoredTool } from '../hooks/activity/activity'
import { isAppSurface } from '../hooks/shared/pane'
import { shortToolName, summarize } from '../hooks/activity/summary'
import type { TurnRecord } from '../types'
import { catPictures, NOW, standInForEngine, start } from './engine'

// The desktop app (2026-11-05): what draws broken there is drawn plainly, the terminal untouched.

const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const BAND = { plugin: 'hubblerc', component: 'AbovePrompt', requestId: 'band' } as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }

async function sidebar($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...PANE, surface, props: PANE_PROPS })
  const boxes = await ui.findAll({ type: 'Box' })
  const found = {
    hasCat: (await ui.find({ key: 'cat' })) !== undefined,
    borders: boxes.filter(box => box.props.borderStyle !== undefined).length,
    titles: boxes.map(box => box.key ?? '').filter(key => key.startsWith('title-')),
    rules: (await ui.findAll({ type: 'Text' })).filter(text => /^─+$/.test(text.text)).length,
    effortButton: (await ui.find({ key: 'effort' })) !== undefined,
    effortText: (await ui.find({ type: 'Text', text: 'xhigh' }))?.text,
    device: (await ui.find({ type: 'Text', text: /^Claude Code / }))?.text,
  }
  await ui.unmount()

  return found
}

test('the app surfaces: the desktop app, and VS Code assumed alike', () => {
  expect(['terminal', 'desktop', 'vscode', 'mobile'].map(isAppSurface)).toEqual([false, true, true, false])
})

test('in the desktop app the sidebar draws no cat and no borders: each box a title row and a rule; the effort is text', async ($, on) => {
  standInForEngine(on)
  catPictures(on)
  await start($)

  const app = await sidebar($, 'desktop')
  expect(app.hasCat).toBe(false)
  expect(app.borders).toBe(0)
  expect(app.titles).toEqual(['title-device', 'title-status', 'title-activity', 'title-contents'])
  expect(app.rules).toBe(4)
  expect(app.effortButton).toBe(false)
  expect(app.effortText).toBe('xhigh')
  expect(app.device).toBe('Claude Code 2.1.310')

  // The terminal as it was.
  const terminal = await sidebar($, 'terminal')
  expect(terminal.hasCat).toBe(true)
  expect(terminal.borders).toBe(4)
  expect(terminal.effortButton).toBe(true)
})

test('in the desktop app the band\'s effort is text, not a padded button', async ($, on) => {
  standInForEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ key: 'effort' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'xhigh' }))?.text).toBe('xhigh')
  await ui.unmount()
})

test('the desktop app\'s own tools are left out everywhere; another MCP tool is named by its own name', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  await $.turn.start({ text: '질문', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', plan: [] } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' } as never)
  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__search', query: 'x' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/hubblerc/a.ts' })
  await $.turn.complete({ answer: '', isAborted: false, reason: 'answer', turnId: 't1', durationMs: 1000 })
  await standIn.clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: BAND_PROPS })
  const line3 = (await ui.find({ type: 'Text', text: /^직전/ }))?.text ?? ''
  expect(line3).toContain('Read 1')
  expect(line3).toContain('search 1')
  expect(line3).not.toContain('ccd')
  expect(line3).not.toContain('mcp__')
  await ui.unmount()

  expect(['SubagentHandback', 'mcp__ccd_turn__wrap_up', 'mcp__ccd_session__x', 'mcp__hubblerc__user_todos', 'Read'].map(isIgnoredTool)).toEqual([true, true, true, false, false])
  expect(['mcp__claude_ai_Gmail__search', 'mcp__hubblerc__user_todos', 'Read'].map(shortToolName)).toEqual(['search', 'user_todos', 'Read'])
  const turn: TurnRecord = {
    id: 't',
    prompt: '',
    startedAt: NOW,
    durationMs: 10,
    runs: ['mcp__a__search', 'mcp__b__search', 'Bash'].map((tool, i) => ({ id: `r${i}`, tool, ms: 1, isError: false })),
  }
  expect(summarize(turn)).toBe('search 2 · Bash 1')
})
