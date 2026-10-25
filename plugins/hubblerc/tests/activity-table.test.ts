import { expect, test } from 'claude-code/testing'

import { activityTable, formatDuration } from '../hooks/summary'
import { promptLabel } from '../hooks/activity'

test('the table numbers each answer with its time, the start of its prompt and its summary', () => {
  const lines = activityTable([
    {
      id: 't1',
      prompt: '<cross-session-message from="tester">시나리오 3: 실패하는 Bash 한 번입니다</cross-session-message>',
      startedAt: 0,
      durationMs: 7579,
      runs: [{ id: 'a', tool: 'Bash', ms: 5, isError: true }],
    },
    { id: 't2', prompt: '', startedAt: 0, durationMs: 8459, runs: [] },
    { id: 't3', prompt: 'next one', startedAt: 0, durationMs: null, runs: [] },
  ]).split('\n')

  expect(lines[0]).toBe('답변별 활동 (전체 3개 중 최근 3개)')
  expect(lines[1]).toBe('#1        8s  "시나리오 3: 실패하는 Bash 한 번입니다"  Bash 1 · 실패 1')
  expect(lines[2]).toBe('#2        8s  (이어진 답변)  도구 없음')
  expect(lines[3]).toBe('#3      진행 중  "next one"  도구 없음')
})

test('only the latest answers are listed, numbered as in the whole session', () => {
  const list = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    prompt: `prompt ${i + 1}`,
    startedAt: 0,
    durationMs: 1000,
    runs: [],
  }))
  const lines = activityTable(list, 2).split('\n')

  expect(lines[0]).toBe('답변별 활동 (전체 5개 중 최근 2개)')
  expect(lines[1]?.startsWith('#4 ')).toBe(true)
  expect(lines[2]?.startsWith('#5 ')).toBe(true)
})

test('an empty session says so, and durations read as the engine writes them', () => {
  expect(activityTable([])).toBe('아직 기록된 답변이 없습니다. 플러그인을 불러온 뒤의 답변부터 기록됩니다.')
  expect(formatDuration(7579)).toBe('8s')
  expect(formatDuration(87700)).toBe('1m 28s')
})

test('a prompt is labelled without the cross-session preamble and its wrapper tags', () => {
  expect(
    promptLabel(
      'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/x.sock" from-name="hubblerc-e2">\n시나리오 5 · 파일 두 개</cross-session-message>',
    ),
  ).toBe('시나리오 5 · 파일 두 개')
  expect(promptLabel('plain prompt')).toBe('plain prompt')
})
