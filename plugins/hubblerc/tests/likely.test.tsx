import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bashInput, bashOutcome, BASH_TASK, THINKING_EVERY } from '../hooks/likely/bash-fail'
import { addSpend, costOf, limitReached, localDay, periodStart, spendAt, statusLine } from '../hooks/likely/cost'
import { likelyOptions } from '../hooks/likely/likely'
import {
  answerLength,
  clip,
  combine,
  distributionsOf,
  invalidQuestions,
  layoutCall,
  METHOD_VERSION,
  OUTPUT_SCHEMA,
  readReply,
  requestBody,
  seededRandom,
  shuffledOrder,
  toDistribution,
} from '../hooks/likely/method'
import { spreadOf, spreadOfValues } from '../hooks/likely/method'
import type { Question } from '../hooks/likely/method'
import { calibrationOf, predicatePairs, readLog, robustnessLines, spreadBins, taskCounts, utf8Length, variantSummary } from '../hooks/likely/record'
import { maskSecrets, safeFileName } from '../hooks/shared/log-safety'
import { messageReply, NOW, standInForEngine, start } from './engine'
import type { StandIn } from './engine'

const KEY = 'sk-ant-api03-test-key-0000'
const WITH_KEY = { options: { anthropicApiKey: KEY, likelyBashFail: true } }
const HOME = '/home/me'
const ICLOUD = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`
const LOG = `${HOME}/.claude/hubblerc/likely/Test-Mac.jsonl`
const COMMAND = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
const PANE = { plugin: 'hubblerc', component: 'Pane', requestId: 'hubblerc' } as const
const PANE_PROPS = { title: 'hubblerc', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

const FRUIT: Question = {
  type: 'choice',
  name: 'fruit',
  instructions: 'Which fruit is it?',
  choices: [{ value: 'apple', description: 'red' }, { value: 'banana' }, { value: 'cherry' }],
}
const SIZE: Question = { type: 'score', name: 'size', instructions: 'How big?', levels: [{ label: 'small' }, { label: 'medium' }, { label: 'large' }] }
const RIPE: Question = { type: 'predicate', name: 'ripe', instructions: 'Is it ripe?' }

/** The machine a decision runs on: home, the plugin's store (seeded), and the log folder's listing. */
function machine(on: On, standIn: StandIn, stored: Record<string, unknown> = {}): Record<string, unknown> {
  mock.env(on, { HOME })
  const store: Record<string, unknown> = { ...stored }
  on('store.get', (_, e) => ({ value: store[e.key] as never }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('fs.list', (_, e) => ({
    value: Object.keys(standIn.files)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: standIn.files[path]?.length ?? 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.log', () => ({ value: undefined }))

  return store
}

/**
 * A model that knows the answers: a predicate's chance of yes, a choice's and a score's chances by
 * option. It reads each call's prompt as shown (the options' order, a predicate asked as "no") and
 * answers in that order, as a consistent model would.
 */
function knowingModel(truth: { predicate?: number; options?: Record<string, number> }) {
  return (body: Record<string, unknown>) => {
    const messages = body.messages as { content: string }[]
    const prompt = messages[0]?.content ?? ''
    const answers = prompt
      .split(/\n\nQuestion \d+ of \d+ /)
      .slice(1)
      .map(block => {
        if (block.startsWith('(yes or no)')) {
          const yes = truth.predicate ?? 0.5

          return { probabilities: [block.includes('answer is NO') ? 1 - yes : yes] }
        }
        const shown = [...block.matchAll(/^\S+\. (\S+)/gm)].map(match => match[1] ?? '')

        return { probabilities: shown.map(name => truth.options?.[name] ?? 0) }
      })

    return messageReply(JSON.stringify({ answers }))
  }
}

/** A number to `digits` decimals: what two computations of one figure agree on. */
const near = (value: number | undefined, digits: number) => Math.round((value ?? Number.NaN) * 10 ** digits) / 10 ** digits

/** The decisions line of the sidebar's status box, or undefined when it has none. */
async function likelyLineShown($: Engine): Promise<string | undefined> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const found = (await pane.find({ type: 'Text', text: /^likely 오늘/ }))?.text
  await pane.unmount()

  return found
}

const lines = (standIn: StandIn, path = LOG) =>
  (standIn.files[path] ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)

async function bash($: Engine, command: string, extra: Record<string, unknown> = {}) {
  return $.tool.call({ tool: 'Bash', command, description: '테스트 실행', ...extra } as never)
}

async function likelyCommand($: Engine, args: string): Promise<string> {
  return (await $.command.run({ command: 'likely', args, ...COMMAND })).text ?? ''
}

// ── The method, pure ──────────────────────────────────────────────

test('a shuffle is a permutation; the same seed shuffles the same way', () => {
  const order = shuffledOrder(8, seededRandom(42))
  expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(shuffledOrder(8, seededRandom(42))).toEqual(order)
})

test('odd calls ask a predicate as "no" and list a score highest first; a choice is shuffled', () => {
  const questions = [RIPE, FRUIT, SIZE]
  const even = layoutCall(questions, 0, seededRandom(1))
  const odd = layoutCall(questions, 1, seededRandom(1))
  expect(even.questions[0]).toEqual({ order: [0], negated: false })
  expect(odd.questions[0]).toEqual({ order: [0], negated: true })
  expect(even.questions[2]?.order).toEqual([0, 1, 2])
  expect(odd.questions[2]?.order).toEqual([2, 1, 0])
  expect([...(even.questions[1]?.order ?? [])].sort()).toEqual([0, 1, 2])
  expect(['A', 'a', '1']).toContain(even.symbols)
})

test('a call\'s numbers go back to the options\' own order, a "no" turned into yes, scaled and held to 0.02-0.98', () => {
  expect(toDistribution([0.3], RIPE, { order: [0], negated: true })).toEqual([0.7])
  expect(toDistribution([1], RIPE, { order: [0], negated: false })).toEqual([0.98])
  expect(toDistribution([1], RIPE, { order: [0], negated: true })).toEqual([0.02])
  // Shown cherry, apple, banana; numbers that add up to 2 are scaled to 1.
  const back = toDistribution([1, 0.6, 0.4], FRUIT, { order: [2, 0, 1], negated: false }) ?? []
  expect(back.map(value => Math.round(value * 100) / 100)).toEqual([0.3, 0.2, 0.5])
  // A certain answer is held off the edges, and the rest still adds up to 1.
  const held = toDistribution([1, 0, 0], FRUIT, { order: [0, 1, 2], negated: false }) ?? []
  expect(Math.round(held.reduce((a, b) => a + b, 0) * 1e9) / 1e9).toBe(1)
  expect(held[0]).toBeLessThan(0.98)
  expect(held[1]).toBeGreaterThan(0.018)
  expect(clip(0.5)).toBe(0.5)
})

test('numbers out of range, of the wrong count or all zero cannot be read', () => {
  expect(toDistribution([1.2], RIPE, { order: [0], negated: false })).toBeNull()
  expect(toDistribution([-0.1, 0.6, 0.5], FRUIT, { order: [0, 1, 2], negated: false })).toBeNull()
  expect(toDistribution([0.5, 0.5], FRUIT, { order: [0, 1, 2], negated: false })).toBeNull()
  expect(toDistribution([0, 0, 0], FRUIT, { order: [0, 1, 2], negated: false })).toBeNull()
  expect(distributionsOf([[0.5]], [RIPE, FRUIT], { symbols: 'A', questions: [] })).toContain('1 answers for 2 questions')
  expect(answerLength(SIZE)).toBe(3)
})

test('the calls are averaged: a predicate\'s chance, a choice\'s likeliest option, a score\'s expected level', () => {
  const answers = combine(
    [RIPE, FRUIT, SIZE],
    [
      [[0.6], [0.2, 0.3, 0.5], [0.1, 0.3, 0.6]],
      [[0.8], [0.2, 0.5, 0.3], [0.1, 0.5, 0.4]],
    ],
  )
  expect(answers[0]).toEqual({ type: 'predicate', name: 'ripe', probability: 0.7, value: true })
  expect(answers[1]).toEqual({ type: 'choice', name: 'fruit', choice: 'banana', confidence: 0.4, probabilities: { apple: 0.2, banana: 0.4, cherry: 0.4 } })
  expect(answers[2]).toEqual({
    type: 'score',
    name: 'size',
    score: 1.4,
    label: 'large',
    confidence: 0.5,
    probabilities: [
      { label: 'small', probability: 0.1, value: 0 },
      { label: 'medium', probability: 0.4, value: 1 },
      { label: 'large', probability: 0.5, value: 2 },
    ],
  })
  expect(combine([RIPE], [])).toEqual([{ type: 'refusal', name: 'ripe' }])
})

test('a reply reads as numbers, a refusal, or why it cannot be used', () => {
  expect(readReply(messageReply('{"answers":[{"probabilities":[0.4]}]}').body)).toEqual({ kind: 'answered', values: [[0.4]] })
  expect(readReply({ stop_reason: 'refusal', content: [] })).toEqual({ kind: 'refused' })
  expect(readReply({ stop_reason: 'max_tokens', content: [] })).toEqual({ kind: 'invalid', reason: 'max_tokens' })
  expect(readReply(messageReply('not json').body)).toEqual({ kind: 'invalid', reason: 'reply is not JSON' })
  expect(readReply(messageReply('{"answers":[{"probabilities":["x"]}]}').body)).toEqual({ kind: 'invalid', reason: 'probabilities are not numbers' })
  // Thinking blocks come before the text and are skipped.
  expect(readReply({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"answers":[]}' }] })).toEqual({ kind: 'answered', values: [] })
})

test('questions need unique names, instructions and two to twenty options', () => {
  expect(invalidQuestions([RIPE, FRUIT, SIZE])).toBeUndefined()
  expect(invalidQuestions([])).toBe('no questions')
  expect(invalidQuestions([RIPE, RIPE])).toContain('unique')
  expect(invalidQuestions([{ ...FRUIT, choices: [{ value: 'a' }] }])).toContain('2 to 20')
  expect(invalidQuestions([{ ...FRUIT, choices: [{ value: 'a' }, { value: 'a' }] }])).toContain('repeat')
})

// ── Cost, limits and the log, pure ────────────────────────────────

test('a call costs its tokens at Haiku 5.5 prices; past 100K prompt tokens, the long rates', () => {
  expect(near(costOf({ input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 10)).toBe(near(0.01, 10))
  expect(near(costOf({ input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 10)).toBe(near(0.5, 10))
  expect(near(costOf({ input: 0, output: 0, cacheRead: 40_000, cacheWrite: 40_000 }), 12)).toBe(near((40_000 * 0.01 + 40_000 * 0.125) / 1e6, 12))
  // Past 100K prompt tokens (input and cache together), every token at the long rates.
  expect(near(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 10)).toBe(near(0.5 + 2.5, 10))
  expect(near(costOf({ input: 60_000, output: 0, cacheRead: 60_000, cacheWrite: 0 }), 12)).toBe(near((60_000 * 0.5 + 60_000 * 0.05) / 1e6, 12))
  expect(near(costOf({ input: 50_000, output: 0, cacheRead: 40_000, cacheWrite: 0 }), 12)).toBe(near((50_000 * 0.1 + 40_000 * 0.01) / 1e6, 12))
  expect(near(costOf({ input: 300, output: 20, cacheRead: 0, cacheWrite: 0 }), 10)).toBe(near(0.00004, 10))
})

test('a budget period starts on its day, or a short month\'s last; a new day and a new period start from zero', () => {
  const at = (text: string) => new Date(text).getTime()
  expect(periodStart(at('2026-11-04T12:00:00'), 1)).toBe('2026-11-01')
  expect(periodStart(at('2026-11-04T12:00:00'), 15)).toBe('2026-10-15')
  expect(periodStart(at('2026-03-01T12:00:00'), 31)).toBe('2026-02-28')
  expect(periodStart(at('2026-02-28T12:00:00'), 31)).toBe('2026-02-28')
  expect(periodStart(at('2026-01-10T12:00:00'), 20)).toBe('2025-12-20')
  const now = at('2026-11-04T12:00:00')
  const kept = spendAt({ day: '2026-11-04', dayUsd: 1, dayCount: 3, period: '2026-11-01', periodUsd: 4, periodCount: 9 }, now, 1)
  expect(kept).toEqual({ day: '2026-11-04', dayUsd: 1, dayCount: 3, period: '2026-11-01', periodUsd: 4, periodCount: 9 })
  const nextDay = spendAt(kept, at('2026-11-05T12:00:00'), 1)
  expect([nextDay.dayUsd, nextDay.dayCount, nextDay.periodUsd]).toEqual([0, 0, 4])
  const nextPeriod = spendAt(kept, at('2026-12-01T12:00:00'), 1)
  expect([nextPeriod.periodUsd, nextPeriod.periodCount]).toEqual([0, 0])
  expect(addSpend(kept, 0.5, false)).toMatchObject({ dayUsd: 1.5, dayCount: 3, periodUsd: 4.5 })
  expect(limitReached(kept, { dailyCapUsd: 1, budgetUsd: 100, periodStartDay: 1 })).toBe('daily-cap')
  expect(limitReached(kept, { dailyCapUsd: 5, budgetUsd: 4, periodStartDay: 1 })).toBe('budget')
  expect(limitReached(kept, { dailyCapUsd: 5, budgetUsd: 100, periodStartDay: 1 })).toBeNull()
  expect(localDay(now)).toBe('2026-11-04')
  expect(statusLine({ todayCount: 12, periodUsd: 0.4238, budgetUsd: 100 })).toBe('likely 오늘 12건 · 이번 달 $0.42 / $100')
})

test('the options: no key, the default caps, a start day held to 1-31', () => {
  expect(likelyOptions({})).toEqual({ apiKey: '', model: 'claude-haiku-5-5', dailyCapUsd: 5, budgetUsd: 100, periodStartDay: 1, logDir: '', bashFail: false, todos: true })
  expect(likelyOptions({ anthropicApiKey: ' k ', likelyPeriodStartDay: 40, likelyDailyCapUsd: -1, likelyModel: '' })).toMatchObject({ apiKey: 'k', periodStartDay: 31, dailyCapUsd: 5, model: 'claude-haiku-5-5' })
})

test('what looks like a secret is masked; paths, short hashes and words stay', () => {
  expect(maskSecrets('curl -H "x-api-key: sk-ant-api03-abcdefghijklmnop" https://api.anthropic.com')).toBe('curl -H "x-api-key: ***" https://api.anthropic.com')
  expect(maskSecrets('ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijkl claude -p hi')).toBe('ANTHROPIC_API_KEY=*** claude -p hi')
  expect(maskSecrets('echo sk-proj-abcdefghijkl')).toBe('echo sk-***')
  expect(maskSecrets('GITHUB_TOKEN="ghp abc" gh pr list')).toBe('GITHUB_TOKEN=*** gh pr list')
  expect(maskSecrets('{"password": "hunter2"}')).toBe('{"password": ***}')
  expect(maskSecrets('mysql --password=hunter2 -u root')).toBe('mysql --password=*** -u root')
  expect(maskSecrets('curl -H "Authorization: Bearer abcdefgh12345678"')).toBe('curl -H "Authorization: Bearer ***"')
  expect(maskSecrets('git show 0123456789abcdef0123456789abcdef01234567')).toBe('git show ***')
  expect(maskSecrets('token is eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc')).toBe('token is ***.abc')
  const kept = 'cd /Users/circlewee/vault/project/hubblerc/plugins/hubblerc && git show 8c4da4f && bun run plugin-authoring-skill-test'
  expect(maskSecrets(kept)).toBe(kept)
})

test('a machine\'s name makes a safe file name; text counts its UTF-8 bytes', () => {
  expect(safeFileName('Circlewee의 MacBook Pro')).toBe('Circlewee의-MacBook-Pro')
  expect(safeFileName('../a/b:c')).toBe('a-b-c')
  expect(safeFileName('  ')).toBe('mac')
  expect(utf8Length('a한😀')).toBe(1 + 3 + 4)
})

test('Brier, ECE over ten bins and accuracy; each bin\'s prediction against what came true', () => {
  const calibration = calibrationOf([
    { probability: 0.9, actual: true },
    { probability: 0.9, actual: false },
    { probability: 0.1, actual: false },
    { probability: 0.1, actual: false },
  ])
  expect(calibration?.count).toBe(4)
  expect(near(calibration?.brier, 10)).toBe(near((0.01 + 0.81 + 0.01 + 0.01) / 4, 10))
  // Bin 0.9: predicted 0.9, half true (0.4 off); bin 0.1: predicted 0.1, none true (0.1 off).
  expect(near(calibration?.ece, 10)).toBe(near(0.5 * 0.4 + 0.5 * 0.1, 10))
  expect(calibration?.accuracy).toBe(0.75)
  expect(calibration?.baseRate).toBe(0.25)
  expect(calibration?.bins.filter(bin => bin.count > 0).map(bin => [bin.from, bin.count, bin.actual])).toEqual([
    [0.1, 2, 0],
    [0.9, 2, 0.5],
  ])
  expect(calibrationOf([])).toBeNull()
})

test('the log reads into decisions with their outcomes, an outcome line before its decision included', () => {
  const text = [
    JSON.stringify({ type: 'outcome', id: 'd2', outcome: false }),
    JSON.stringify({ type: 'decision', id: 'd1', task: 'bash-fail', methodVersion: 1, thinking: false, costUsd: 0.001, answers: [{ type: 'predicate', name: 'fails', probability: 0.8, value: true }] }),
    'not json',
    JSON.stringify({ type: 'decision', id: 'd2', task: 'bash-fail', methodVersion: 1, thinking: true, costUsd: 0.002, answers: [{ type: 'predicate', name: 'fails', probability: 0.2, value: false }] }),
    JSON.stringify({ type: 'outcome', id: 'd1', outcome: true }),
    JSON.stringify({ type: 'decision', id: 'd3', task: 'test', methodVersion: 1, thinking: false, costUsd: 0, answers: [] }),
    JSON.stringify({ type: 'outcome', id: 'd3', outcome: null, note: 'denied' }),
  ].join('\n')
  const decisions = readLog(text)
  expect(decisions.get('d1')).toMatchObject({ probability: 0.8, outcome: true })
  expect(decisions.get('d2')).toMatchObject({ probability: 0.2, outcome: false, thinking: true })
  expect(taskCounts(decisions.values())).toEqual([
    { task: 'bash-fail', count: 2, withOutcome: 2 },
    { task: 'test', count: 1, withOutcome: 0 },
  ])
  expect(predicatePairs(decisions.values(), 'bash-fail')).toEqual([
    { probability: 0.8, actual: true },
    { probability: 0.2, actual: false },
  ])
})

// ── A decision through the engine ─────────────────────────────────

test('five calls shown five ways come back to one answer: options unshuffled, a "no" turned into yes, averaged', () => {
  const questions = [RIPE, FRUIT, SIZE]
  const model = knowingModel({ predicate: 0.7, options: { apple: 0.2, banana: 0.5, cherry: 0.3, small: 0.1, medium: 0.3, large: 0.6 } })
  const random = seededRandom(7)
  const samples = Array.from({ length: 5 }, (_, i) => {
    const layout = layoutCall(questions, i, random)
    const reply = readReply(model(requestBody({ model: 'claude-haiku-5-5', input: 'a red fruit', questions, layout, thinking: false })).body)
    const distributions = reply.kind === 'answered' ? distributionsOf(reply.values, questions, layout) : 'no reply'
    if (typeof distributions === 'string') throw new Error(distributions)

    return distributions
  })
  const answers = combine(questions, samples)
  expect(answers[0]).toEqual({ type: 'predicate', name: 'ripe', probability: 0.7, value: true })
  expect(answers[1]).toMatchObject({ choice: 'banana', probabilities: { apple: 0.2, banana: 0.5, cherry: 0.3 } })
  expect(answers[2]).toMatchObject({ label: 'large', score: 1.5, probabilities: [{ probability: 0.1 }, { probability: 0.3 }, { probability: 0.6 }] })
})

test('a decision: five calls at once with the key, no sampling, thinking off, one fixed schema; logged and counted', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.7 })
  await start($)
  const shown = await likelyCommand($, '사과는 빨갛다')

  expect(standIn.anthropicCalls.length).toBe(5)
  for (const call of standIn.anthropicCalls) {
    expect(call.headers['x-api-key']).toBe(KEY)
    expect(call.headers['anthropic-version']).toBe('2026-10-21')
    expect(call.body.model).toBe('claude-haiku-5-5')
    expect(call.body.thinking).toEqual({ type: 'disabled' })
    expect(call.body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } })
    expect(call.body.max_tokens).toBe(400)
    expect('temperature' in call.body || 'top_p' in call.body || 'top_k' in call.body).toBe(false)
  }
  // Two of the five ask the predicate as "no"; the answer is the same.
  const prompts = standIn.anthropicCalls.map(call => (call.body.messages as { content: string }[])[0]?.content ?? '')
  expect(prompts.filter(prompt => prompt.includes('answer is NO')).length).toBe(2)
  expect(shown).toContain('likely: 예일 확률 0.70 (예) · 호출 5/5')
  expect(shown).toContain(`비용 $${(5 * costOf({ input: 300, output: 20, cacheRead: 0, cacheWrite: 0 })).toFixed(5)}`)
  expect(shown).toContain('토큰: 입력 1500 · 출력 100')

  // One line in this machine's log (no iCloud Drive here), the spend in the store.
  const [line] = lines(standIn)
  expect(line).toMatchObject({ type: 'decision', task: 'ask', methodVersion: METHOD_VERSION, model: 'claude-haiku-5-5', samples: 5, thinking: false, effort: 'low', input: '사과는 빨갛다', outcome: null })
  expect(line?.answers).toEqual([{ type: 'predicate', name: 'yes', probability: 0.7, value: true }])
  expect((line?.calls as { distributions: number[][] }[]).map(call => call.distributions)).toEqual(new Array(5).fill([[0.7]]))
  expect(store.likelySpend).toMatchObject({ dayCount: 1, periodCount: 1 })
})

test('with iCloud Drive on, the log goes to its hubblerc/likely folder', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.existing.push(ICLOUD)
  standIn.anthropic = knowingModel({ predicate: 0.3 })
  await start($)
  await bash($, 'ls')
  await standIn.clock.settle()
  expect(lines(standIn, `${ICLOUD}/hubblerc/likely/Test-Mac.jsonl`).map(line => line.type)).toEqual(['decision', 'outcome'])
})

test('some calls failing, the rest decide; all failing is an error; all refusing answers a refusal', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn)
  await start($)

  let n = 0
  standIn.anthropic = body => {
    n += 1
    if (n <= 2) return { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }

    return knowingModel({ predicate: 0.6 })(body)
  }
  const partly = await likelyCommand($, '하나')
  expect(partly).toContain('예일 확률 0.60 (예) · 호출 3/5')
  expect(partly).toContain('실패(HTTP 529 overloaded_error: Overloaded) · 실패(HTTP 529 overloaded_error: Overloaded) · 0.60 · 0.60 · 0.60')

  standIn.anthropic = () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } })
  expect(await likelyCommand($, '둘')).toContain('판정 호출 5개가 모두 실패했습니다: HTTP 401 authentication_error: invalid x-api-key')

  standIn.anthropic = () => messageReply('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } })
  const refused = await likelyCommand($, '셋')
  expect(refused).toContain('모든 호출이 거절했습니다 · 호출 0/5')
  expect(refused).toContain('거절 · 거절 · 거절 · 거절 · 거절')
  // A failed decision is not counted, but what its calls cost is (the refusals' tokens here).
  expect(store.likelySpend).toMatchObject({ dayCount: 2 })
  expect(lines(standIn).map(line => line.input)).toEqual(['하나', '셋'])
})

test('with no key in the options or the keychain nothing is decided: no call, no log, no line; /likely says how to add one', async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  await start($)
  expect(standIn.keychainReads).toBe(1)
  await bash($, 'ls')
  await bash($, 'pwd')
  await standIn.clock.settle()
  // A Bash call never asks the keychain again.
  expect(standIn.keychainReads).toBe(1)
  expect(standIn.anthropicCalls.length).toBe(0)
  expect(standIn.files).toEqual({})
  expect(await likelyLineShown($)).toBeUndefined()
  const said = await likelyCommand($, '하늘은 파랗다')
  expect(said).toContain('API 키가 없어 판정하지 않습니다')
  expect(said).toContain('키 넣기·바꾸기: 터미널에서 `hubblerc-key set` · 지우기: `hubblerc-key delete`')
  // Before /setup the shell has no hubblerc-key: /setup first.
  expect(said).toContain('`hubblerc-key`가 아직 없습니다: `/setup`을 실행한 뒤 새 터미널에서 쓰세요.')
  expect(said).toContain('/plugin configure hubblerc@hubblerc')
})

test('a key in the keychain is read once as the session starts and used; it is kept nowhere but the module', { options: { likelyBashFail: true } }, async ($, on) => {
  const standIn = standInForEngine(on)
  const store = machine(on, standIn)
  const secret = 'sk-ant-api03-from-keychain-9999'
  standIn.keychain = secret
  standIn.anthropic = knowingModel({ predicate: 0.4 })
  await start($)
  await bash($, 'ls')
  await bash($, 'pwd')
  await standIn.clock.settle()

  expect(standIn.keychainReads).toBe(1)
  expect(standIn.anthropicCalls.length).toBe(10)
  expect(standIn.anthropicCalls.every(call => call.headers['x-api-key'] === secret)).toBe(true)
  expect(JSON.stringify(store)).not.toContain(secret)
  expect(Object.values(standIn.files).join('')).not.toContain(secret)
  expect(await likelyLineShown($)).toBe('likely 오늘 2건 · 이번 달 $0.00 / $100')
  const usage = await likelyCommand($, '')
  expect(usage).toContain('API 키: 키체인에 있음')
  expect(usage).not.toContain(secret)
})

test('the options\' key comes first: the keychain is not asked', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.keychain = 'sk-ant-api03-from-keychain-9999'
  standIn.anthropic = knowingModel({ predicate: 0.4 })
  await start($)
  await bash($, 'ls')
  await standIn.clock.settle()
  expect(standIn.keychainReads).toBe(0)
  expect(standIn.anthropicCalls.every(call => call.headers['x-api-key'] === KEY)).toBe(true)
  expect(await likelyCommand($, '')).toContain('API 키: 설정 비밀 항목에 있음')
})

test('a key added to the keychain mid-session works from the next /likely, no reload', { options: { likelyBashFail: true } }, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.8 })
  await start($)
  expect(await likelyCommand($, '하나')).toContain('API 키가 없어')
  standIn.keychain = 'sk-ant-api03-added-later-0000'
  expect(await likelyCommand($, '둘')).toContain('likely: 예일 확률 0.80 (예)')
  expect(standIn.anthropicCalls[0]?.headers['x-api-key']).toBe('sk-ant-api03-added-later-0000')
  // From then on a Bash call is predicted too.
  await bash($, 'ls')
  await standIn.clock.settle()
  expect(standIn.anthropicCalls.length).toBe(10)
  expect(standIn.keychainReads).toBe(3)
})

// ── Bash failure prediction ───────────────────────────────────────

test('a Bash call is predicted in the background; the command does not wait, and its outcome pairs with the decision however late', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.2 })
  standIn.anthropicDelayMs = 5000
  await start($)

  await bash($, 'false', { tool_use_id: 'toolu_slow' })
  // The command ended; the decision has not come back.
  expect(standIn.anthropicCalls.length).toBe(5)
  expect(lines(standIn)).toEqual([])

  await standIn.clock.advance(5000)
  const [decision, outcome] = lines(standIn)
  expect(decision).toMatchObject({ type: 'decision', task: BASH_TASK, meta: { toolUseId: 'toolu_slow', sessionId: 'session-1' }, answers: [{ type: 'predicate', name: 'fails', probability: 0.2 }] })
  expect(outcome).toMatchObject({ type: 'outcome', id: decision?.id, outcome: true, note: 'exit 1' })
  expect(String(decision?.input)).toContain('Command:\nfalse')
  expect(String(decision?.input)).toContain('What it is for: 테스트 실행')
  expect(String(decision?.input)).toContain('Working folder: /repo/hubblerc')
  expect(await likelyLineShown($)).toMatch(/^likely 오늘 1건 · 이번 달 \$0\.00 \/ \$100$/)
})

test('with the option off, as it is unless set, a Bash call is not predicted: no call, no log', { options: { anthropicApiKey: KEY } }, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.2 })
  await start($)

  await bash($, 'false', { tool_use_id: 'toolu_off' })
  await standIn.clock.advance(5000)
  expect(standIn.anthropicCalls.length).toBe(0)
  expect(lines(standIn)).toEqual([])
})

test('a command that answered is not failed; one refused, or run in the background, has no outcome to learn', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.1 })
  await start($)

  await bash($, 'ls -la')
  await bash($, 'rm -rf /nope')
  await bash($, 'sleep 100', { run_in_background: true })
  await standIn.clock.settle()

  const outcomes = lines(standIn).filter(line => line.type === 'outcome')
  expect(outcomes.map(line => [line.outcome, line.note ?? null])).toEqual([
    [false, null],
    [null, 'denied'],
  ])
  // The background command was not predicted: two decisions of five calls.
  expect(standIn.anthropicCalls.length).toBe(10)

  expect(bashOutcome({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } } as never)).toEqual({ failed: null, note: 'background' })
  expect(bashOutcome({ result: { stdout: '', stderr: '', interrupted: true } } as never)).toEqual({ failed: null, note: 'interrupted' })
  expect(bashOutcome({ isError: true, result: 'Exit code 2', text: 'Exit code 2' })).toEqual({ failed: true, note: 'exit 2' })
  expect(bashOutcome({ isError: true, result: 'boom', text: 'boom' } as never)).toEqual({ failed: true })
  expect(bashInput('ls', '', '')).toBe('A command Claude Code is about to run with its Bash tool (zsh on macOS).\n\nCommand:\nls')
})

test('a subagent\'s Bash is predicted too; one decision in ten thinks', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.1 })
  await start($)

  await bash($, 'ls', { agentId: 'ag-7' })
  for (let i = 1; i < THINKING_EVERY; i += 1) await bash($, `echo ${i}`)
  await standIn.clock.settle()

  const decisions = lines(standIn).filter(line => line.type === 'decision')
  expect(decisions.length).toBe(THINKING_EVERY)
  expect(decisions[0]?.meta).toMatchObject({ agentId: 'ag-7' })
  expect(decisions.map(line => line.thinking)).toEqual([...new Array<boolean>(THINKING_EVERY - 1).fill(false), true])
  const thinking = standIn.anthropicCalls.filter(call => (call.body.thinking as { type: string }).type === 'adaptive')
  expect(thinking.length).toBe(5)
  expect(thinking[0]?.body.max_tokens).toBe(3000)
  expect(thinking[0]?.body.output_config).toMatchObject({ effort: 'low' })
})

test('a secret in a command is masked before it is sent and logged', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.1 })
  await start($)
  await bash($, 'OPENAI_API_KEY=sk-proj-abcdefghijklmnop node run.js')
  await standIn.clock.settle()
  const sent = (standIn.anthropicCalls[0]?.body.messages as { content: string }[])[0]?.content ?? ''
  expect(sent).toContain('OPENAI_API_KEY=*** node run.js')
  expect(standIn.files[LOG]).not.toContain('sk-proj-abcdefghijklmnop')
})

// ── Limits ────────────────────────────────────────────────────────

test('at the runaway cap nothing is decided for the day, and a toast says so once', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  const today = localDay(NOW)
  const store = machine(on, standIn, { likelySpend: { day: today, dayUsd: 5, dayCount: 4000, period: periodStart(NOW, 1), periodUsd: 12, periodCount: 9000 } })
  await start($)
  await bash($, 'ls')
  await bash($, 'pwd')
  await standIn.clock.settle()
  expect(standIn.anthropicCalls.length).toBe(0)
  const toasts = standIn.toasts.map(toast => JSON.stringify(toast)).filter(text => text.includes('폭주 방지 상한'))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('하루 $5')
  expect(store.likelySpend).toMatchObject({ warnedDay: today })
  expect(await likelyCommand($, '하늘은 파랗다')).toContain('폭주 방지 상한')
})

test('past the period\'s budget nothing is decided till the next period, with one toast', { options: { anthropicApiKey: KEY, likelyBashFail: true, likelyMonthlyBudgetUsd: 10, likelyPeriodStartDay: 15 } }, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn, { likelySpend: { day: localDay(NOW), dayUsd: 0.5, dayCount: 1, period: periodStart(NOW, 15), periodUsd: 10, periodCount: 9 } })
  await start($)
  await bash($, 'ls')
  await bash($, 'ls')
  await standIn.clock.settle()
  expect(standIn.anthropicCalls.length).toBe(0)
  const toasts = standIn.toasts.map(toast => JSON.stringify(toast)).filter(text => text.includes('예산'))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('$10')
  expect(toasts[0]).toContain('매달 15일')
})

// ── /likely and the sidebar ──────────────────────────────────────

test('/likely alone tells how to use it; any other text is one question, decided and shown call by call', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.9 })
  await start($)
  expect(standIn.commands.find(command => command.name === 'likely')).toMatchObject({ immediate: true, argumentHint: '<질문> | stats [task] | export' })

  const usage = await likelyCommand($, '')
  expect(usage).toContain('/likely <질문이나 글>')
  expect(usage).toContain('/likely stats [task]')
  expect(usage).toContain('/likely export')
  expect(usage).toContain('API 키: 설정 비밀 항목에 있음')
  expect(usage).not.toContain(KEY)
  expect(usage).toContain('`hubblerc-key set`')
  expect(standIn.anthropicCalls.length).toBe(0)

  const shown = await likelyCommand($, '이 명령은 실패할까: ls /없는경로')
  expect(shown).toContain('likely: 예일 확률 0.90 (예)')
  expect(shown).toContain('호출 5/5')
  expect(shown).toContain('호출별 예일 확률: 0.90 · 0.90 · 0.90 · 0.90 · 0.90')
  expect(shown).toContain(`기록: ${LOG}`)
  expect(lines(standIn)[0]).toMatchObject({ task: 'ask', input: '이 명령은 실패할까: ls /없는경로', questions: [{ type: 'predicate', name: 'yes' }] })
  const prompt = (standIn.anthropicCalls[0]?.body.messages as { content: string }[])[0]?.content ?? ''
  expect(prompt).toContain('<input>\n이 명령은 실패할까: ls /없는경로\n</input>')
})

test('/likely stats counts by task, tells the spend, and scores bash-fail\'s calibration, thinking apart', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.8 })
  await start($)
  await bash($, 'false')
  await bash($, 'ls')
  await standIn.clock.settle()
  // Another machine's log in the same folder counts too.
  standIn.files[`${HOME}/.claude/hubblerc/likely/Studio.jsonl`] = `${JSON.stringify({ type: 'decision', id: 'x1', task: BASH_TASK, methodVersion: METHOD_VERSION, thinking: true, costUsd: 0, answers: [{ type: 'predicate', name: 'fails', probability: 0.15, value: false }] })}\n${JSON.stringify({ type: 'outcome', id: 'x1', outcome: false })}\n`

  const stats = await likelyCommand($, 'stats')
  expect(stats).toContain('파일 2개')
  expect(stats).toMatch(/bash-fail\s+3건 \(3\)/)
  expect(stats).toContain('비용(이 기기): 오늘 2건')
  expect(stats).toContain('/ 폭주 방지 상한 $5')
  expect(stats).toContain('/ 예산 $100')
  // 0.8 failed, 0.8 did not, 0.15 did not: Brier (0.04 + 0.64 + 0.0225) / 3.
  expect(stats).toContain('전체: 3건 · Brier 0.234')
  expect(stats).toContain('0.8~0.9       2   0.80    0.50')
  expect(stats).toContain('thinking 끔: 2건')
  expect(stats).toContain('thinking low: 1건')
  expect(await likelyCommand($, 'stats test')).toContain('test 판정이 없습니다')
})

test('/likely export zips the log folder into Downloads', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.existing.push(`${HOME}/Downloads`)
  standIn.anthropic = knowingModel({ predicate: 0.5 })
  await start($)
  expect(await likelyCommand($, 'export')).toContain('판정 기록이 아직 없습니다')
  await bash($, 'ls')
  await standIn.clock.settle()
  const said = await likelyCommand($, 'export')
  expect(said).toMatch(/^판정 기록을 묶었습니다: \/home\/me\/Downloads\/hubblerc-likely-\d{8}-\d{6}\.zip$/)
  const zip = standIn.ran.find(argv => argv[0] === '/usr/bin/zip')
  expect(zip?.slice(1, 4)).toEqual(['-r', '-q', '-X'])
  expect(zip?.slice(5)).toEqual(['likely', `cwd=${HOME}/.claude/hubblerc`])
})

test('with a key, the sidebar\'s status box ends with today\'s decisions and the month\'s spend against the budget', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn, { likelySpend: { day: localDay(NOW), dayUsd: 0.01, dayCount: 7, period: periodStart(NOW, 1), periodUsd: 3.456, periodCount: 70 } })
  await start($)
  expect(await likelyLineShown($)).toBe('likely 오늘 7건 · 이번 달 $3.46 / $100')
})

test('a log past the 3 MiB a read takes at once is read in pieces of whole lines, a Korean character cut at the edge included', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  await start($)
  // 700 decisions of about 6 KB each (Korean is three bytes a character): about 4 MB in all.
  const big = Array.from({ length: 700 }, (_, i) => {
    const decision = { type: 'decision', id: `b${i}`, task: BASH_TASK, methodVersion: METHOD_VERSION, thinking: false, costUsd: 0, input: '가'.repeat(2000 + (i % 7)), answers: [{ type: 'predicate', name: 'fails', probability: 0.3, value: false }] }

    return `${JSON.stringify(decision)}\n${JSON.stringify({ type: 'outcome', id: `b${i}`, outcome: i % 3 === 0 })}\n`
  }).join('')
  standIn.files[`${HOME}/.claude/hubblerc/likely/Mini.jsonl`] = big
  const stats = await likelyCommand($, 'stats')
  expect(stats).toMatch(/bash-fail\s+700건 \(700\)/)
  expect(stats).toContain('전체: 700건')
  const pieces = standIn.ran.filter(argv => argv[0] === '/bin/sh' && argv[2]?.includes('| head -c'))
  expect(pieces.length).toBe(2)
})

// ── Robustness: how far the calls part ───────────────────────────

test('a decision\'s spread: its calls\' largest less smallest value and their deviation, a choice\'s on the option it chose', () => {
  expect(spreadOfValues([0.2, 0.4, 0.3, 0.3, 0.3])).toEqual({ range: 0.2, sd: 0.0632 })
  expect(spreadOfValues([0.5])).toEqual({ range: 0, sd: 0 })
  expect(spreadOfValues([])).toEqual({ range: 0, sd: 0 })
  const spread = spreadOf(
    [RIPE, FRUIT],
    [
      [[0.6], [0.2, 0.5, 0.3]],
      [[0.8], [0.2, 0.3, 0.5]],
      [[0.7], [0.2, 0.6, 0.2]],
    ],
  )
  // Banana is the likeliest on average (0.467): its chances 0.5, 0.3, 0.6.
  expect(spread).toEqual([
    { name: 'ripe', range: 0.2, sd: 0.0816 },
    { name: 'fruit', range: 0.3, sd: 0.1247 },
  ])
})

test('/likely shows the spread of its calls; the log keeps it', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  const truths = [0.2, 0.4, 0.3, 0.3, 0.3]
  let n = 0
  standIn.anthropic = body => {
    n += 1

    return knowingModel({ predicate: truths[n - 1] ?? 0.3 })(body)
  }
  await start($)
  const shown = await likelyCommand($, '이 명령은 실패할까: ls /없는경로')
  expect(shown).toContain('퍼짐(호출 5개): 최대−최소 0.20 · 표준편차 0.06')
  expect(lines(standIn)[0]?.spread).toEqual([{ name: 'yes', range: 0.2, sd: 0.0632 }])
})

/** A decision line as the log keeps it, its calls showing the predicate as given (negated on odd calls). */
function loggedDecision(id: string, values: number[], symbols: string[], extra: Record<string, unknown> = {}): string {
  const calls = values.map((p, i) => ({ layout: { symbols: symbols[i] ?? 'A', questions: [{ order: [0], negated: i % 2 === 1 }] }, distributions: [[p]], latencyMs: 0, tokens: {} }))
  const probability = values.reduce((total, value) => total + value, 0) / values.length

  return JSON.stringify({ type: 'decision', id, task: BASH_TASK, methodVersion: METHOD_VERSION, thinking: false, costUsd: 0, answers: [{ type: 'predicate', name: 'fails', probability, value: probability >= 0.5 }], calls, ...extra })
}

test('the stats split decisions by spread, and show how the way a call asks moves its answer', () => {
  const text = [
    loggedDecision('d1', [0.1, 0.1, 0.1, 0.1, 0.1], ['A', 'a', '1', 'A', 'a']),
    JSON.stringify({ type: 'outcome', id: 'd1', outcome: false }),
    loggedDecision('d2', [0.6, 0.8, 0.6, 0.8, 0.6], ['A', 'A', 'A', 'A', 'A']),
    JSON.stringify({ type: 'outcome', id: 'd2', outcome: true }),
    loggedDecision('d3', [0.2, 0.8, 0.2, 0.8, 0.2], ['1', '1', '1', '1', '1']),
    JSON.stringify({ type: 'outcome', id: 'd3', outcome: true }),
    // No outcome: counted in the variants, not in the bins.
    loggedDecision('d4', [0.5, 0.5, 0.5], ['a', 'a', 'a']),
  ].join('\n')
  const decisions = readLog(text)
  expect(decisions.get('d2')).toMatchObject({ spread: 0.2, calls: [{ negated: false, symbols: 'A', p: 0.6 }, { negated: true, symbols: 'A', p: 0.8 }, expect.anything(), expect.anything(), expect.anything()] })

  const bins = spreadBins(decisions.values(), BASH_TASK)
  expect(bins.map(bin => [bin.label, bin.count])).toEqual([
    ['<0.1', 1],
    ['0.1~0.3', 1],
    ['≥0.3', 1],
  ])
  // d3 averaged 0.44 (wrong at 0.5), d1 and d2 right.
  expect(bins.map(bin => bin.accuracy)).toEqual([1, 1, 0])

  const variants = variantSummary(decisions.values(), BASH_TASK)
  // Asked as "no" less asked as "yes": d1 0, d2 +0.2, d3 +0.6, d4 0.
  expect(variants.negated.count).toBe(4)
  expect(near(variants.negated.signed, 6)).toBe(near(0.8 / 4, 6))
  expect(Object.keys(variants.symbols).sort()).toEqual(['1', 'A', 'a'])
  expect(variants.symbols.a?.count).toBe(5)

  const shown = robustnessLines(bins, variants).join('\n')
  expect(shown).toContain('퍼짐(호출 값의 최대−최소)별, 정답 붙은 판정')
  expect(shown).toContain('  ≥0.3          1     0.0%   ')
  expect(shown).toContain('뒤집어 물은 호출 − 그대로 물은 호출: 평균 +0.200, 절댓값 평균 0.200 (판정 4건)')
  expect(shown).toContain('기호별(그 호출 값 − 판정 평균):')
})

test('/likely stats ends with the robustness figures of bash-fail', WITH_KEY, async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  standIn.anthropic = knowingModel({ predicate: 0.8 })
  await start($)
  await bash($, 'false')
  await standIn.clock.settle()
  const stats = await likelyCommand($, 'stats')
  expect(stats).toContain('퍼짐(호출 값의 최대−최소)별, 정답 붙은 판정')
  expect(stats).toMatch(/  <0\.1 +1 +100\.0%/)
  expect(stats).toContain('뒤집어 물은 호출 − 그대로 물은 호출: 평균 +0.000')
})

test('with the shell function in place (after /setup), /likely names hubblerc-key and no /setup', async ($, on) => {
  const standIn = standInForEngine(on)
  machine(on, standIn)
  on('fs.read', (_, e) => {
    if (e.path === `${HOME}/.claude/hubblerc/relaunch.zsh`) return { value: '# hubblerc-shell-version: 2\nhubblerc-key() {\n}\n' as never }
    if (e.path === `${HOME}/.zshrc`) return { value: 'source ~/.claude/hubblerc/relaunch.zsh\n' as never }
    if (e.path.endsWith('/shell/relaunch.zsh')) return { value: '# hubblerc-shell-version: 2\n' as never }

    return { deny: `no file ${e.path}` }
  })
  await start($)
  const said = await likelyCommand($, '')
  expect(said).toContain('API 키: 없음')
  expect(said).toContain('키 넣기·바꾸기: 터미널에서 `hubblerc-key set`')
  expect(said).not.toContain('/setup')
})
