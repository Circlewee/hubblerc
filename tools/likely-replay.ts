/**
 * The likely replay experiment: the Bash decisions already logged asked again, the way they were
 * asked or a changed way, and the variants scored on the same commands and the same outcomes.
 *
 *   bun tools/likely-replay.ts run <variant> [--limit N] [--max-usd X] [--concurrency N]
 *   bun tools/likely-replay.ts report [variant ...]
 *   bun tools/likely-replay.ts compare
 *   bun tools/likely-replay.ts variants
 *
 * Reads the decision logs (iCloud Drive's hubblerc/likely, read only) and writes one JSONL a variant
 * to hubblerc/likely-replay beside them: ids and numbers only, never a command. The API key is read
 * from the keychain item `hubblerc-likely` into this process alone: never printed, never written.
 * A run picks up where it stopped: decisions already in its file are skipped.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { costOf, NO_TOKENS, tokensOf } from '../plugins/hubblerc/hooks/likely/cost'
import type { Tokens } from '../plugins/hubblerc/hooks/likely/cost'
import { distributionsOf, layoutCall, readReply, requestBody, seededRandom, seedOf } from '../plugins/hubblerc/hooks/likely/method'
import type { CallLayout, Question } from '../plugins/hubblerc/hooks/likely/method'

/** Kept equal to likely.ts, which needs the engine and so is not imported here. */
const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2026-10-21'
const HAIKU = 'claude-haiku-5-5'

const ICLOUD = join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/hubblerc')
const LOG_DIR = join(ICLOUD, 'likely')
const OUT_DIR = join(ICLOUD, 'likely-replay')

/** The decisions replayed: Bash decisions with an outcome, logged before the experiment began (2026-11-06 09:50 KST). */
const CUTOFF = '2026-11-06T00:50:00.000Z'

/**
 * Fixed before any variant ran (2026-11-06). The rate is the logs' own (20 of 525 failed, 3.8%), so a
 * hinted variant's calibration is to be checked again on decisions logged later.
 */
const BASE_RATE_HINT = 'For reference: most commands Claude Code runs here succeed; about 1 in 25 fails.'

/**
 * How a variant asks. `samples`: calls a decision (the logged count when not given). `effort`: in
 * place of likely's `low`. `request`: fields put over the request likely.ts would send (another
 * model's thinking setting, a larger `max_tokens`).
 */
type Variant = { model: string; flip: boolean; hint: boolean; thinking: boolean; note: string; samples?: number; effort?: 'low' | 'medium' | 'high'; request?: Record<string, unknown>; set?: 'second'; history?: true }

const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'

/** Stage 1 (2026-11-06): Haiku, thinking off, five calls as logged; only the way of asking changes. */
const VARIANTS: Record<string, Variant> = {
  'v0-current': { model: HAIKU, flip: true, hint: false, thinking: false, note: '현행 그대로(5회 중 2회 뒤집어 묻기)' },
  'v1-no-flip': { model: HAIKU, flip: false, hint: false, thinking: false, note: '뒤집어 묻기 없음' },
  'v2-hint': { model: HAIKU, flip: true, hint: true, thinking: false, note: '기저율 힌트' },
  'v3-no-flip-hint': { model: HAIKU, flip: false, hint: true, thinking: false, note: '뒤집기 없음 + 기저율 힌트' },
  /** Stage 2 (2026-11-06): stage 1's best-calibrated way of asking, with thinking (adaptive, effort low, as likely.ts asks it). */
  'v4-thinking': { model: HAIKU, flip: false, hint: true, thinking: true, note: 'v3 + thinking 켬' },
  /**
   * Stage 3 (2026-11-06): the ceiling, v3's way of asking with a larger model, one call a decision
   * (repeats did not change Haiku's ranking). Sonnet 5.5 turns thinking off with `between_tools`
   * (`disabled` is a 400); Opus 5.5 cannot turn it off (`disabled` is a 400), so effort alone sets how
   * much it thinks. No refusal fallback: a fallback model would answer for Opus unseen.
   */
  's1-sonnet-off': { model: SONNET, flip: false, hint: true, thinking: false, note: 'Sonnet 5.5, thinking 끔, 1회', samples: 1, request: { thinking: { type: 'between_tools' } } },
  'o1-opus-low': { model: OPUS, flip: false, hint: true, thinking: true, note: 'Opus 5.5, effort low, 1회', samples: 1, request: { max_tokens: 8000 } },
  'o1-opus-high': { model: OPUS, flip: false, hint: true, thinking: true, note: 'Opus 5.5, effort high, 1회', samples: 1, effort: 'high', request: { max_tokens: 16000 } },
  /**
   * The second comparison (fixed 2026-11-06, spec F10): the decisions logged since the session id,
   * asked once each. (b) is v3 as it was; (c) is v3 shown the three Bash commands before this one in
   * its session and how each ended, as far as that was known when the decision was made.
   */
  'b-v3-once': { model: HAIKU, flip: false, hint: true, thinking: false, note: '(b) v3, 1회, 2차 평가 집합', samples: 1, set: 'second' },
  'c-v3-history': { model: HAIKU, flip: false, hint: true, thinking: false, note: '(c) v3 + 같은 세션 직전 Bash 3개와 결과, 1회, 2차 평가 집합', samples: 1, set: 'second', history: true },
}

/**
 * The second comparison's decisions: from the first one logged with a session id (2026-11-06 11:06
 * KST) to the moment the comparison was started (2026-11-11 15:00 KST), so a rerun scores the same set.
 */
const SECOND_FROM = '2026-11-06T02:06:00.000Z'
const SECOND_TO = '2026-11-11T06:00:00.000Z'

type Logged = { id: string; at: string; input: string; questions: Question[]; samples: number; thinking: boolean; p: number; failed: boolean }

/** A logged Bash decision whatever became of it: `failed` null when its end was not seen (or not yet logged). */
type Row = Omit<Logged, 'failed'> & { failed: boolean | null; outcomeAt?: string; note?: string; sessionId?: string; agentId?: string }

type CallResult = { negated: boolean; p?: number; refused?: true; error?: string; latencyMs: number; tokens: Tokens }

type ResultLine = { variant: string; id: string; at: string; model: string; thinking: boolean; calls: CallResult[]; p: number | null; costUsd: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Every logged Bash decision of the live method, oldest first. */
function loadRows(): Row[] {
  const decisions = new Map<string, Record<string, unknown>>()
  const outcomes = new Map<string, Record<string, unknown>>()
  for (const file of readdirSync(LOG_DIR).filter(name => name.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(LOG_DIR, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(row) || typeof row.id !== 'string') continue
      if (row.type === 'decision') decisions.set(row.id, row)
      else if (row.type === 'outcome') outcomes.set(row.id, row)
    }
  }
  const kept: Row[] = []
  for (const row of decisions.values()) {
    if (row.task !== 'bash-fail' || row.methodVersion !== 1) continue
    if (typeof row.at !== 'string' || typeof row.input !== 'string' || !Array.isArray(row.questions)) continue
    const answer = Array.isArray(row.answers) ? row.answers[0] : undefined
    if (!isRecord(answer) || answer.type !== 'predicate' || typeof answer.probability !== 'number') continue
    const outcome = outcomes.get(row.id as string)
    const meta = isRecord(row.meta) ? row.meta : {}
    kept.push({
      id: row.id as string,
      at: row.at,
      input: row.input,
      questions: row.questions as Question[],
      samples: typeof row.samples === 'number' ? row.samples : 5,
      thinking: row.thinking === true,
      p: answer.probability,
      failed: typeof outcome?.outcome === 'boolean' ? outcome.outcome : null,
      ...(typeof outcome?.at === 'string' ? { outcomeAt: outcome.at } : {}),
      ...(typeof outcome?.note === 'string' ? { note: outcome.note } : {}),
      ...(typeof meta.sessionId === 'string' ? { sessionId: meta.sessionId } : {}),
      ...(typeof meta.agentId === 'string' ? { agentId: meta.agentId } : {}),
    })
  }

  return kept.sort((a, b) => a.at.localeCompare(b.at))
}

const hasOutcome = (row: Row): row is Row & { failed: boolean } => row.failed !== null

/** The first experiment's decisions: those with an outcome before the cutoff, oldest first. */
function loadDecisions(): Logged[] {
  return loadRows().filter(hasOutcome).filter(row => row.at < CUTOFF)
}

type Scored = Row & { failed: boolean; sessionId: string }

/** The second comparison's decisions: an outcome and a session id, inside its window. */
function secondSet(rows: readonly Row[]): Scored[] {
  return rows.filter((row): row is Scored => hasOutcome(row) && row.sessionId !== undefined && row.at >= SECOND_FROM && row.at < SECOND_TO)
}

/** The command inside a decision's input (bash-fail.ts's `bashInput`). */
function commandOf(input: string): string {
  const start = input.indexOf('\n\nCommand:\n')
  let text = start < 0 ? input : input.slice(start + '\n\nCommand:\n'.length)
  for (const marker of ['\n\nWorking folder: ', '\n\nWhat it is for: ']) {
    const end = text.lastIndexOf(marker)
    if (end >= 0) text = text.slice(0, end)
  }

  return text
}

/** The same session and the same agent (the main loop, or one subagent): whose commands follow one another. */
const threadOf = (row: Row) => `${row.sessionId ?? ''}\u0000${row.agentId ?? ''}`

/** The decisions before each one in its thread, oldest first; a decision without a session id has none. */
function threadsBefore(rows: readonly Row[]): (row: Row, count: number) => Row[] {
  const threads = new Map<string, Row[]>()
  for (const row of rows) {
    if (row.sessionId === undefined) continue
    const thread = threads.get(threadOf(row)) ?? []
    thread.push(row)
    threads.set(threadOf(row), thread)
  }
  const place = new Map<string, number>()
  for (const thread of threads.values()) thread.forEach((row, i) => place.set(row.id, i))

  return (row, count) => {
    const at = place.get(row.id)
    if (at === undefined) return []

    return (threads.get(threadOf(row)) ?? []).slice(Math.max(0, at - count), at)
  }
}

type Ended = 'failed' | 'succeeded' | 'unfinished' | 'unknown'

/** How an earlier command had ended as far as was logged when `row`'s decision was made. */
function endedBy(earlier: Row, row: Row): Ended {
  if (earlier.outcomeAt === undefined || earlier.outcomeAt >= row.at) return 'unknown'

  return earlier.failed === null ? 'unfinished' : earlier.failed ? 'failed' : 'succeeded'
}

const HISTORY_COMMANDS = 3
const HISTORY_COMMAND_CHARS = 300

/** (c)'s input: the logged input, then the thread's last three commands and how each ended. */
function inputWithHistory(row: Row, before: readonly Row[]): string {
  if (before.length === 0) return `${row.input}\n\nNo Bash command was run before this one in the session.`
  const lines = before.map((earlier, i) => {
    const command = commandOf(earlier.input)
    const shown = command.length > HISTORY_COMMAND_CHARS ? `${command.slice(0, HISTORY_COMMAND_CHARS)}…` : command
    const ended = endedBy(earlier, row)
    const result = ended === 'failed' ? `failed${earlier.note === undefined ? '' : ` (${earlier.note})`}` : ended === 'succeeded' ? 'succeeded' : ended === 'unfinished' ? 'did not finish' : 'result not known yet'

    return `${i + 1}. ${shown}\n   Result: ${result}`
  })

  return `${row.input}\n\nThe Bash commands run just before this one in the same session, oldest first, and how each ended:\n${lines.join('\n')}`
}

function readResults(name: string): ResultLine[] {
  const file = join(OUT_DIR, `${name}.jsonl`)
  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        return [JSON.parse(line) as ResultLine]
      } catch {
        return []
      }
    })
}

/** The key from the keychain, or a stop: never printed. */
function keychainKey(): string {
  const ran = Bun.spawnSync(['/usr/bin/security', 'find-generic-password', '-s', 'hubblerc-likely', '-w'], { stdout: 'pipe', stderr: 'ignore' })
  const key = ran.exitCode === 0 ? ran.stdout.toString().trim() : ''
  if (key === '') throw new Error('키체인 항목 hubblerc-likely에서 키를 읽지 못했습니다')

  return key
}

/** At most `n` tasks at once. */
function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []

  return async task => {
    if (active >= n) await new Promise<void>(resolve => waiting.push(resolve))
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      waiting.shift()?.()
    }
  }
}

class Fatal extends Error {}

function httpError(status: number, body: unknown): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {}

  return `HTTP ${status}${typeof error.type === 'string' ? ` ${error.type}` : ''}${typeof error.message === 'string' ? `: ${error.message}` : ''}`.slice(0, 300)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** One call, retried on overload, rate limits and network errors; a request the API rejects stops the run. */
async function callApi(key: string, body: Record<string, unknown>): Promise<{ body?: unknown; error?: string; latencyMs: number }> {
  for (let attempt = 0; ; attempt += 1) {
    const started = performance.now()
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
      const text = await response.text()
      const latencyMs = Math.round(performance.now() - started)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      if (response.ok) return { body: parsed, latencyMs }
      if ([400, 401, 403, 404].includes(response.status)) throw new Fatal(httpError(response.status, parsed))
      if (attempt < 6) {
        const after = Number(response.headers.get('retry-after'))
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt)
        continue
      }

      return { error: httpError(response.status, parsed), latencyMs }
    } catch (error) {
      if (error instanceof Fatal) throw error
      if (attempt < 6) {
        await sleep(1000 * 2 ** attempt)
        continue
      }

      return { error: `요청 실패: ${String(error)}`.slice(0, 300), latencyMs: Math.round(performance.now() - started) }
    }
  }
}

/**
 * Dollars per million tokens, from the claude-api skill's model table (cached 2026-10-06); prompts
 * here are far below any long-prompt rate. A cache read counted at 0.1x and a write at 1.25x the
 * input price, as cost.ts does (these requests set no cache).
 */
const PRICES: Record<string, { input: number; output: number }> = {
  [SONNET]: { input: 2, output: 10 },
  [OPUS]: { input: 4, output: 20 },
}

/** Haiku 5.5's prices (cost.ts), or the table's; a model without prices stops the run before it starts. */
function priceOf(model: string): (tokens: Tokens) => number {
  if (model.startsWith('claude-haiku-5-5')) return costOf
  const price = PRICES[model]
  if (price === undefined) throw new Error(`${model}의 가격이 아직 없습니다`)

  return tokens => (tokens.input * price.input + tokens.cacheRead * price.input * 0.1 + tokens.cacheWrite * price.input * 1.25 + tokens.output * price.output) / 1_000_000
}

/** A logged decision asked again as the variant asks it: the same layouts as logged (seeded by its id), changed as the variant says. */
async function replayOne(decision: Logged, name: string, variant: Variant, key: string, limit: ReturnType<typeof limiter>, input = decision.input): Promise<ResultLine> {
  const questions: Question[] = variant.hint ? decision.questions.map(question => ({ ...question, instructions: `${question.instructions} ${BASE_RATE_HINT}` })) : decision.questions
  const random = seededRandom(seedOf(decision.id))
  const layouts: CallLayout[] = Array.from({ length: variant.samples ?? decision.samples }, (_, i) => {
    const layout = layoutCall(decision.questions, i, random)

    return variant.flip ? layout : { ...layout, questions: layout.questions.map(question => ({ ...question, negated: false })) }
  })
  const price = priceOf(variant.model)
  let model = variant.model
  const calls = await Promise.all(
    layouts.map(layout =>
      limit(async (): Promise<CallResult> => {
        const negated = layout.questions[0]?.negated === true
        const base = requestBody({ model: variant.model, input, questions, layout, thinking: variant.thinking })
        const body: Record<string, unknown> = { ...base, ...variant.request }
        if (variant.effort !== undefined) body.output_config = { ...(base.output_config as Record<string, unknown>), effort: variant.effort }
        const ran = await callApi(key, body)
        const tokens = ran.body === undefined ? NO_TOKENS : tokensOf(ran.body)
        if (isRecord(ran.body) && typeof ran.body.model === 'string') model = ran.body.model
        if (ran.error !== undefined) return { negated, error: ran.error, latencyMs: ran.latencyMs, tokens }
        const reply = readReply(ran.body)
        if (reply.kind === 'refused') return { negated, refused: true, latencyMs: ran.latencyMs, tokens }
        if (reply.kind === 'invalid') return { negated, error: reply.reason, latencyMs: ran.latencyMs, tokens }
        const distributions = distributionsOf(reply.values, questions, layout)
        if (typeof distributions === 'string') return { negated, error: distributions, latencyMs: ran.latencyMs, tokens }

        return { negated, p: distributions[0]?.[0], latencyMs: ran.latencyMs, tokens }
      }),
    ),
  )
  const answered = calls.flatMap(call => (typeof call.p === 'number' ? [call.p] : []))

  return {
    variant: name,
    id: decision.id,
    at: new Date().toISOString(),
    model,
    thinking: variant.thinking,
    calls,
    p: answered.length === 0 ? null : round(answered.reduce((total, value) => total + value, 0) / answered.length),
    costUsd: calls.reduce((total, call) => total + price(call.tokens), 0),
  }
}

async function run(name: string, flags: Record<string, string>): Promise<void> {
  const variant = VARIANTS[name]
  if (variant === undefined) throw new Error(`변형 없음: ${name} (variants로 목록)`)
  const maxUsd = Number(flags['max-usd'] ?? '0.6')
  const concurrency = Number(flags.concurrency ?? '20')
  const rows = loadRows()
  const before = threadsBefore(rows)
  const all: Logged[] = variant.set === 'second' ? secondSet(rows) : loadDecisions()
  const inputOf = (decision: Logged) => (variant.history === true ? inputWithHistory(decision, before(decision, HISTORY_COMMANDS)) : decision.input)
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${name}.jsonl`)
  const done = new Set(readResults(name).map(line => line.id))
  const todo = all.filter(decision => !done.has(decision.id)).slice(0, flags.limit === undefined ? undefined : Number(flags.limit))
  const key = keychainKey()
  const limit = limiter(concurrency)
  console.log(`${name} (${variant.note}): 대상 ${all.length}건, 이미 ${done.size}건, 이번 ${todo.length}건, 상한 $${maxUsd}`)

  let spent = 0
  let finished = 0
  let stop: string | undefined
  const started = performance.now()
  const queue = [...todo]
  const workers = Array.from({ length: Math.ceil(concurrency / 5) + 1 }, async () => {
    while (stop === undefined) {
      if (spent >= maxUsd) {
        stop = `상한 $${maxUsd} 도달`
        break
      }
      const decision = queue.shift()
      if (decision === undefined) break
      try {
        const line = await replayOne(decision, name, variant, key, limit, inputOf(decision))
        spent += line.costUsd
        appendFileSync(file, `${JSON.stringify(line)}\n`)
        finished += 1
        if (finished % 50 === 0) console.log(`  ${finished}/${todo.length} · $${spent.toFixed(3)} · ${Math.round((performance.now() - started) / 1000)}초`)
      } catch (error) {
        stop = error instanceof Fatal ? `API가 요청을 거부: ${error.message}` : String(error).slice(0, 300)
      }
    }
  })
  await Promise.all(workers)
  const lines = readResults(name)
  const failedCalls = lines.reduce((total, line) => total + line.calls.filter(call => call.p === undefined).length, 0)
  console.log(`${name}: 이번 ${finished}건 $${spent.toFixed(4)} · ${Math.round((performance.now() - started) / 1000)}초 · 파일 ${lines.length}건, 답 없는 호출 ${failedCalls}개${stop === undefined ? '' : ` · 멈춤: ${stop}`}`)
}

// ---- report ----

type Pair = { id: string; p: number; y: boolean }

function brier(pairs: readonly Pair[]): number {
  return pairs.reduce((total, { p, y }) => total + (p - (y ? 1 : 0)) ** 2, 0) / pairs.length
}

function logLoss(pairs: readonly Pair[]): number {
  return -pairs.reduce((total, { p, y }) => total + Math.log(Math.max(1e-6, y ? p : 1 - p)), 0) / pairs.length
}

/** The chance a failed command was given a higher number than a command that succeeded (ties half). */
function auc(pairs: readonly Pair[]): number {
  const positives = pairs.filter(pair => pair.y).map(pair => pair.p)
  const negatives = pairs.filter(pair => !pair.y).map(pair => pair.p)
  let wins = 0
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0

  return wins / (positives.length * negatives.length)
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function percentile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))] ?? Number.NaN
}

/**
 * A figure's 95% interval by a bootstrap that keeps the failures and the successes apart (each
 * resampled within itself), so every resample has the 20-odd failures the AUC needs.
 */
function bootstrap(ids: readonly string[], ys: ReadonlyMap<string, boolean>, figure: (sample: readonly string[]) => number, times = 2000): [number, number] {
  const random = seededRandom(7)
  const positives = ids.filter(id => ys.get(id) === true)
  const negatives = ids.filter(id => ys.get(id) !== true)
  const values: number[] = []
  for (let t = 0; t < times; t += 1) {
    const sample = [...positives.map(() => positives[Math.floor(random() * positives.length)] ?? ''), ...negatives.map(() => negatives[Math.floor(random() * negatives.length)] ?? '')]
    values.push(figure(sample))
  }
  values.sort((a, b) => a - b)

  return [percentile(values, 0.025), percentile(values, 0.975)]
}

const logit = (p: number) => Math.log(Math.max(1e-4, Math.min(1 - 1e-4, p)) / (1 - Math.max(1e-4, Math.min(1 - 1e-4, p))))
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

/** A logistic fit of the outcome on logit(p) (Newton, a little ridge): what a recalibration would make of the numbers. */
function fitRecalibration(pairs: readonly Pair[]): (p: number) => number {
  let a = 0
  let b = 1
  const ridge = 1e-3
  for (let step = 0; step < 50; step += 1) {
    let ga = ridge * a
    let gb = ridge * (b - 1)
    let haa = ridge
    let hab = 0
    let hbb = ridge
    for (const { p, y } of pairs) {
      const x = logit(p)
      const q = sigmoid(a + b * x)
      const r = q - (y ? 1 : 0)
      const w = q * (1 - q)
      ga += r
      gb += r * x
      haa += w
      hab += w * x
      hbb += w * x * x
    }
    const det = haa * hbb - hab * hab
    if (Math.abs(det) < 1e-12) break
    a -= (hbb * ga - hab * gb) / det
    b -= (haa * gb - hab * ga) / det
  }

  return p => sigmoid(a + b * logit(p))
}

/**
 * The Brier skill after a recalibration fitted on the other folds (5 folds, failures spread over
 * them, ten shuffles averaged), against the other folds' failure rate as a constant: whether the
 * numbers beat the base rate once their level is set right.
 */
function recalibratedSkill(pairs: readonly Pair[]): number {
  const random = seededRandom(11)
  const skills: number[] = []
  for (let repeat = 0; repeat < 10; repeat += 1) {
    const shuffle = <T>(items: T[]) => {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1))
        ;[items[i], items[j]] = [items[j] as T, items[i] as T]
      }

      return items
    }
    const ordered = [...shuffle(pairs.filter(pair => pair.y)), ...shuffle(pairs.filter(pair => !pair.y))]
    const fold = new Map(ordered.map((pair, i) => [pair.id, i % 5]))
    let model = 0
    let constant = 0
    for (let k = 0; k < 5; k += 1) {
      const train = pairs.filter(pair => fold.get(pair.id) !== k)
      const test = pairs.filter(pair => fold.get(pair.id) === k)
      const recalibrate = fitRecalibration(train)
      const rate = train.filter(pair => pair.y).length / train.length
      for (const { p, y } of test) {
        model += (recalibrate(p) - (y ? 1 : 0)) ** 2
        constant += (rate - (y ? 1 : 0)) ** 2
      }
    }
    skills.push(1 - model / constant)
  }

  return mean(skills)
}

/**
 * The spec's rule for calibration (F10, 2026-11-05): fitted on the oldest 70% of the decisions,
 * judged on the newest 30% alone, against the older part's failure rate as a constant. `pairs` in
 * time order.
 */
function timeSplitSkill(pairs: readonly Pair[]): { skill: number; testFails: number } {
  const cut = Math.floor(pairs.length * 0.7)
  const train = pairs.slice(0, cut)
  const test = pairs.slice(cut)
  const recalibrate = fitRecalibration(train)
  const rate = train.filter(pair => pair.y).length / train.length
  const model = test.reduce((total, { p, y }) => total + (recalibrate(p) - (y ? 1 : 0)) ** 2, 0)
  const constant = test.reduce((total, { y }) => total + (rate - (y ? 1 : 0)) ** 2, 0)

  return { skill: 1 - model / constant, testFails: test.filter(pair => pair.y).length }
}

function report(names: string[], referenceName = 'v0-current'): void {
  const all = loadDecisions()
  const ys = new Map(all.map(decision => [decision.id, decision.failed]))
  const chosen = names.length > 0 ? names : Object.keys(VARIANTS).filter(name => existsSync(join(OUT_DIR, `${name}.jsonl`)))
  const sets: { name: string; note: string; ps: Map<string, number>; lines?: ResultLine[] }[] = [{ name: 'live', note: '기록된 실제 판정', ps: new Map(all.map(decision => [decision.id, decision.p])) }]
  for (const name of chosen) {
    const lines = readResults(name)
    sets.push({ name, note: VARIANTS[name]?.note ?? '', ps: new Map(lines.flatMap(line => (line.p === null ? [] : [[line.id, line.p] as [string, number]]))), lines })
  }
  const common = all.map(decision => decision.id).filter(id => sets.every(set => set.ps.has(id)))
  const fails = common.filter(id => ys.get(id) === true).length
  const base = fails / common.length
  const pairsOf = (set: (typeof sets)[number], ids: readonly string[]) => ids.map(id => ({ id, p: set.ps.get(id) ?? 0, y: ys.get(id) === true }))
  const constantBrier = base * (1 - base)
  console.log(`공통 판정 ${common.length}건 (대상 ${all.length}건), 실패 ${fails}건 (${(base * 100).toFixed(1)}%). 상수 기저율의 Brier ${constantBrier.toFixed(4)}`)
  console.log('')
  const split = timeSplitSkill(pairsOf(sets[0] ?? { name: '', note: '', ps: new Map() }, common))
  console.log(`보정후BSS: 시간분리 = 앞 70%로 맞추고 뒤 30%(실패 ${split.testFails}건)로 잼(spec 규칙) · 5겹 = 무작위 5겹 교차검증(참고)`)
  console.log('세트                평균p   Brier   BSS     logloss  AUC [95%]              상위10 상위25  보정후BSS 시간분리  5겹   비용')
  for (const set of sets) {
    const pairs = pairsOf(set, common)
    const [lo, hi] = bootstrap(common, ys, sample => auc(pairsOf(set, sample)))
    const ranked = [...pairs].sort((a, b) => b.p - a.p)
    const hits = (k: number) => ranked.slice(0, k).filter(pair => pair.y).length
    const cost = set.lines === undefined ? '' : `$${set.lines.reduce((total, line) => total + line.costUsd, 0).toFixed(3)}`
    console.log(
      `${set.name.padEnd(18)}  ${mean(pairs.map(pair => pair.p)).toFixed(3)}   ${brier(pairs).toFixed(4)}  ${(1 - brier(pairs) / constantBrier).toFixed(2).padStart(6)}  ${logLoss(pairs).toFixed(3)}    ${auc(pairs).toFixed(3)} [${lo.toFixed(2)}~${hi.toFixed(2)}]      ${String(hits(10)).padStart(3)}    ${String(hits(25)).padStart(3)}             ${timeSplitSkill(pairs).skill.toFixed(3).padStart(7)}  ${recalibratedSkill(pairs).toFixed(3).padStart(7)}  ${cost}`,
    )
  }
  console.log(`(상위k 기대값: 상위10 ${(10 * base).toFixed(1)}, 상위25 ${(25 * base).toFixed(1)}. BSS = 1 − Brier/상수 기저율 Brier, 0 이하는 상수보다 못함)`)

  const reference = sets.find(set => set.name === referenceName)
  if (reference !== undefined) {
    console.log('')
    console.log(`${referenceName}와 짝지어 비교 (같은 명령, 차이의 95% 구간; 0을 걸치면 차이 미판정)`)
    for (const set of sets) {
      if (set === reference) continue
      const dAuc = auc(pairsOf(set, common)) - auc(pairsOf(reference, common))
      const [aLo, aHi] = bootstrap(common, ys, sample => auc(pairsOf(set, sample)) - auc(pairsOf(reference, sample)))
      const dBrier = brier(pairsOf(set, common)) - brier(pairsOf(reference, common))
      const [bLo, bHi] = bootstrap(common, ys, sample => brier(pairsOf(set, sample)) - brier(pairsOf(reference, sample)))
      console.log(`  ${set.name.padEnd(18)} ΔAUC ${dAuc >= 0 ? '+' : ''}${dAuc.toFixed(3)} [${aLo.toFixed(3)}~${aHi.toFixed(3)}]  ΔBrier ${dBrier >= 0 ? '+' : ''}${dBrier.toFixed(4)} [${bLo.toFixed(4)}~${bHi.toFixed(4)}]`)
    }
    const live = sets[0]
    if (live !== undefined) {
      const ids = common.filter(id => all.find(decision => decision.id === id)?.thinking !== true)
      const xs = ids.map(id => live.ps.get(id) ?? 0)
      const zs = ids.map(id => reference.ps.get(id) ?? 0)
      const mx = mean(xs)
      const mz = mean(zs)
      const cov = mean(xs.map((x, i) => (x - mx) * ((zs[i] ?? 0) - mz)))
      const r = cov / Math.sqrt(mean(xs.map(x => (x - mx) ** 2)) * mean(zs.map(z => (z - mz) ** 2)))
      console.log('')
      console.log(`재현(live thinking 끔 ${ids.length}건 vs ${referenceName}): 상관 ${r.toFixed(3)}, 평균 차 ${(mz - mx >= 0 ? '+' : '') + (mz - mx).toFixed(3)}, 평균 |차| ${mean(xs.map((x, i) => Math.abs(x - (zs[i] ?? 0)))).toFixed(3)}`)
    }
  }

  console.log('')
  console.log('호출별: 그대로 물은 호출 평균 / 뒤집어 물은 호출 평균, 답 없는 호출')
  for (const set of sets) {
    if (set.lines === undefined) continue
    const calls = set.lines.filter(line => common.includes(line.id)).flatMap(line => line.calls)
    const straight = calls.filter(call => !call.negated && typeof call.p === 'number').map(call => call.p ?? 0)
    const flipped = calls.filter(call => call.negated && typeof call.p === 'number').map(call => call.p ?? 0)
    console.log(`  ${set.name.padEnd(18)} ${straight.length === 0 ? '-' : mean(straight).toFixed(3)} (${straight.length}) / ${flipped.length === 0 ? '-' : mean(flipped).toFixed(3)} (${flipped.length}), 답 없음 ${calls.filter(call => call.p === undefined).length}`)
  }
  for (const set of sets) {
    if (set.lines === undefined || !set.lines.some(line => line.thinking)) continue
    // Without thinking a reply is about 22 tokens: past 50, the call thought.
    const lines = set.lines.filter(line => common.includes(line.id))
    const calls = lines.flatMap(line => line.calls)
    const thought = calls.filter(call => call.tokens.output > 50)
    const outputs = calls.map(call => call.tokens.output).sort((a, b) => a - b)
    const byThinking = (did: boolean) => lines.filter(line => line.calls.some(call => call.tokens.output > 50) === did && line.p !== null).map(line => ({ id: line.id, p: line.p ?? 0, y: ys.get(line.id) === true }))
    const some = byThinking(true)
    const none = byThinking(false)
    console.log(`  ${set.name}: 생각한 호출 ${thought.length}/${calls.length} (${((thought.length / calls.length) * 100).toFixed(0)}%), 출력 토큰 중앙값 ${outputs[Math.floor(outputs.length / 2)]}`)
    console.log(`    한 호출이라도 생각한 판정 ${some.length}건(실패 ${some.filter(pair => pair.y).length}) · 아무도 안 생각한 판정 ${none.length}건(실패 ${none.filter(pair => pair.y).length})`)
  }
}

// ---- the second comparison (spec F10, fixed 2026-11-06; the details below fixed 2026-11-11 before any result was read) ----

/** The weight of the prior in a program's shrunk failure rate, (k + m·π) / (n + m). */
const SHRINK_M = 20
/** Sessions are split into this many folds; a decision is scored by coefficients fitted on the other folds' sessions. */
const FOLDS = 5

/** The first program of a command: leading comments, `VAR=value`, sudo, time and `cd … &&` set aside; a path's last part. */
function programOf(command: string): string {
  let rest = command
  for (;;) {
    rest = rest.replace(/^(?:\s|#[^\n]*\n)+/, '')
    const stripped = rest
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|]*)\s+/, '')
      .replace(/^(?:sudo|time|command|exec|noglob)\s+/, '')
      .replace(/^cd\s+[^;&|\n]*(?:&&|;|\n)/, '')
    if (stripped === rest) break
    rest = stripped
  }
  const word = /^[^\s;|&()<>]+/.exec(rest)?.[0] ?? ''
  const name = word.replace(/["']/g, '').split('/').pop() ?? ''

  return name === '' ? '?' : name
}

/** The command with its quoted strings emptied: what is left of `|`, `&&`, `;` is the shell's own. */
const unquoted = (command: string) => command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')

/** Whether a pipe is in the command: with pipefail off, a failure before the pipe is logged as a success. */
const hasPipe = (command: string) => /(?:^|[^|])\|(?!\|)/.test(unquoted(command))

/** The program of the command's last step, the one whose exit code the tool sees. */
function lastProgramOf(command: string): string {
  const steps = unquoted(command).split(/\|\||&&|[|;\n]/).filter(step => step.trim() !== '')

  return programOf(steps[steps.length - 1] ?? '')
}

type Previous = Ended | 'none'
type Features = { rate: number; previous: Previous; program: string }

/**
 * (d)'s two facts for each scored decision, from what was logged before it was made: its program's
 * shrunk failure rate (every decision with an outcome counts, the ones before the session id too),
 * and how the command before it in its thread ended.
 */
function featuresOf(rows: readonly Row[], scored: readonly Scored[]): { features: Map<string, Features>; prior: number } {
  const earlier = rows.filter(hasOutcome).filter(row => row.at < SECOND_FROM)
  const prior = earlier.filter(row => row.failed).length / earlier.length
  const ended = rows.filter(hasOutcome).filter(row => row.outcomeAt !== undefined).sort((a, b) => (a.outcomeAt ?? '').localeCompare(b.outcomeAt ?? ''))
  const counts = new Map<string, { n: number; k: number }>()
  const before = threadsBefore(rows)
  const features = new Map<string, Features>()
  let next = 0
  for (const row of scored) {
    for (; next < ended.length && (ended[next]?.outcomeAt ?? '') < row.at; next += 1) {
      const done = ended[next]
      if (done === undefined) continue
      const program = programOf(commandOf(done.input))
      const count = counts.get(program) ?? { n: 0, k: 0 }
      counts.set(program, { n: count.n + 1, k: count.k + (done.failed ? 1 : 0) })
    }
    const program = programOf(commandOf(row.input))
    const count = counts.get(program) ?? { n: 0, k: 0 }
    const last = before(row, 1)[0]
    features.set(row.id, { rate: (count.k + SHRINK_M * prior) / (count.n + SHRINK_M), previous: last === undefined ? 'none' : endedBy(last, row), program })
  }

  return { features, prior }
}

/** Solves A·x = b (Gauss-Jordan, small systems). */
function solve(matrix: readonly number[][], vector: readonly number[]): number[] {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i] ?? 0])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = row
    ;[a[col], a[pivot]] = [a[pivot] as number[], a[col] as number[]]
    const lead = a[col]?.[col] ?? 0
    if (Math.abs(lead) < 1e-12) continue
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = (a[row]?.[col] ?? 0) / lead
      for (let k = col; k <= n; k += 1) (a[row] as number[])[k] = (a[row]?.[k] ?? 0) - factor * (a[col]?.[k] ?? 0)
    }
  }

  return a.map((row, i) => (row[n] ?? 0) / (row[i] || 1))
}

type Fit = { beta: number[]; se: number[]; logLik: number }

/** A logistic regression (Newton; the first column is the intercept, the rest held by a faint ridge). */
function fitLogistic(xs: readonly number[][], ys: readonly boolean[]): Fit {
  const k = xs[0]?.length ?? 0
  const ridge = 1e-4
  let beta = Array.from({ length: k }, () => 0)
  let hessian: number[][] = []
  for (let step = 0; step < 60; step += 1) {
    const gradient = beta.map((value, j) => (j === 0 ? 0 : ridge * value))
    hessian = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j && i > 0 ? ridge : 0)))
    xs.forEach((x, row) => {
      const q = sigmoid(x.reduce((total, value, j) => total + value * (beta[j] ?? 0), 0))
      const r = q - (ys[row] === true ? 1 : 0)
      const w = Math.max(1e-9, q * (1 - q))
      for (let i = 0; i < k; i += 1) {
        gradient[i] = (gradient[i] ?? 0) + r * (x[i] ?? 0)
        for (let j = 0; j < k; j += 1) (hessian[i] as number[])[j] = (hessian[i]?.[j] ?? 0) + w * (x[i] ?? 0) * (x[j] ?? 0)
      }
    })
    const delta = solve(hessian, gradient)
    beta = beta.map((value, j) => value - (delta[j] ?? 0))
    if (Math.max(...delta.map(Math.abs)) < 1e-9) break
  }
  const se = beta.map((_, j) => Math.sqrt(Math.max(0, solve(hessian, beta.map((_, i) => (i === j ? 1 : 0)))[j] ?? 0)))
  const logLik = xs.reduce((total, x, row) => {
    const q = sigmoid(x.reduce((sum, value, j) => sum + value * (beta[j] ?? 0), 0))

    return total + Math.log(Math.max(1e-12, ys[row] === true ? q : 1 - q))
  }, 0)

  return { beta, se, logLik }
}

const predict = (fit: Fit, x: readonly number[]) => sigmoid(x.reduce((total, value, j) => total + value * (fit.beta[j] ?? 0), 0))

/** The normal distribution's upper tail (Abramowitz & Stegun 7.1.26). */
function upperTail(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x)

  return z >= 0 ? erfc / 2 : 1 - erfc / 2
}

/** AUC by ranks (ties share a rank): the same figure as `auc`, fast enough to bootstrap. */
function aucOf(ps: readonly number[], ys: readonly boolean[]): number {
  const order = ps.map((_, i) => i).sort((a, b) => (ps[a] ?? 0) - (ps[b] ?? 0))
  let rankSum = 0
  let positives = 0
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j < order.length && ps[order[j] ?? 0] === ps[order[i] ?? 0]) j += 1
    const rank = (i + j + 1) / 2
    for (let k = i; k < j; k += 1) {
      if (ys[order[k] ?? 0] === true) {
        rankSum += rank
        positives += 1
      }
    }
    i = j
  }
  const negatives = ys.length - positives

  return positives === 0 || negatives === 0 ? Number.NaN : (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives)
}

/** The area under precision-recall, one step a distinct score (chance is the failure rate, not 0.5). */
function averagePrecision(ps: readonly number[], ys: readonly boolean[]): number {
  const order = ps.map((_, i) => i).sort((a, b) => (ps[b] ?? 0) - (ps[a] ?? 0))
  const positives = ys.filter(Boolean).length
  let seen = 0
  let hits = 0
  let area = 0
  for (let i = 0; i < order.length; ) {
    let j = i
    let found = 0
    while (j < order.length && ps[order[j] ?? 0] === ps[order[i] ?? 0]) {
      if (ys[order[j] ?? 0] === true) found += 1
      j += 1
    }
    seen = j
    hits += found
    area += (found / positives) * (hits / seen)
    i = j
  }

  return area
}

/** DeLong's test for two AUCs on the same decisions: the difference, its standard error, and how the two estimates move together. */
function delong(a: readonly number[], b: readonly number[], ys: readonly boolean[]): { aucA: number; aucB: number; seA: number; seB: number; diff: number; se: number; p: number; r: number } {
  const positives = ys.flatMap((y, i) => (y ? [i] : []))
  const negatives = ys.flatMap((y, i) => (y ? [] : [i]))
  const psi = (x: number, y: number) => (x > y ? 1 : x === y ? 0.5 : 0)
  const placements = (scores: readonly number[]) => ({
    v10: positives.map(i => mean(negatives.map(j => psi(scores[i] ?? 0, scores[j] ?? 0)))),
    v01: negatives.map(j => mean(positives.map(i => psi(scores[i] ?? 0, scores[j] ?? 0)))),
  })
  const pa = placements(a)
  const pb = placements(b)
  const cov = (x: readonly number[], y: readonly number[]) => {
    const mx = mean(x)
    const my = mean(y)

    return x.reduce((total, value, i) => total + (value - mx) * ((y[i] ?? 0) - my), 0) / (x.length - 1)
  }
  const m = positives.length
  const n = negatives.length
  const varA = cov(pa.v10, pa.v10) / m + cov(pa.v01, pa.v01) / n
  const varB = cov(pb.v10, pb.v10) / m + cov(pb.v01, pb.v01) / n
  const covAB = cov(pa.v10, pb.v10) / m + cov(pa.v01, pb.v01) / n
  const diff = mean(pa.v10) - mean(pb.v10)
  const se = Math.sqrt(Math.max(1e-12, varA + varB - 2 * covAB))

  return { aucA: mean(pa.v10), aucB: mean(pb.v10), seA: Math.sqrt(varA), seB: Math.sqrt(varB), diff, se, p: 2 * upperTail(Math.abs(diff / se)), r: covAB / Math.sqrt(varA * varB) }
}

/** The shift on the logit scale that makes a set's mean prediction its failure rate: a level correction and nothing else. */
function interceptShift(ps: readonly number[], ys: readonly boolean[]): number {
  const target = ys.filter(Boolean).length
  let lo = -10
  let hi = 10
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2
    if (ps.reduce((total, p) => total + sigmoid(logit(p) + mid), 0) > target) hi = mid
    else lo = mid
  }

  return (lo + hi) / 2
}

function compare(): void {
  const rows = loadRows()
  const scoredAll = secondSet(rows)
  const { features, prior } = featuresOf(rows, scoredAll)
  const read = (name: string) => new Map(readResults(name).flatMap(line => (line.p === null ? [] : [[line.id, line.p] as [string, number]])))
  const pb = read('b-v3-once')
  const pc = read('c-v3-history')
  const scored = scoredAll.filter(row => pb.has(row.id) && pc.has(row.id))
  const ys = scored.map(row => row.failed)
  const fails = ys.filter(Boolean).length
  const base = fails / scored.length
  const sessions = [...new Set(scored.map(row => row.sessionId))].sort()
  const windowed = rows.filter(row => row.at >= SECOND_FROM && row.at < SECOND_TO)
  console.log(`2차 평가 집합 ${SECOND_FROM} ~ ${SECOND_TO}: 판정 ${windowed.length}건 중 정답·세션 id 있는 ${scoredAll.length}건, 그중 (b)·(c)가 모두 답한 ${scored.length}건`)
  console.log(`  실패 ${fails}건 (${(base * 100).toFixed(2)}%), 세션 ${sessions.length}개. 제외: 정답 없음 ${windowed.filter(row => !hasOutcome(row)).length}건, 세션 id 없음 ${windowed.filter(row => hasOutcome(row) && row.sessionId === undefined).length}건, (b)나 (c) 답 없음 ${scoredAll.length - scored.length}건`)
  const bySession = sessions.map(session => scored.filter(row => row.sessionId === session && row.failed).length).sort((a, b) => b - a)
  console.log(`  실패의 세션 쏠림: 실패가 있는 세션 ${bySession.filter(count => count > 0).length}개, 많은 순 ${bySession.slice(0, 6).join('·')} (상위 3개 세션이 ${((bySession.slice(0, 3).reduce((a, b) => a + b, 0) / fails) * 100).toFixed(0)}%)`)
  const days = new Map<string, { n: number; k: number }>()
  for (const row of scored) {
    const day = new Date(Date.parse(row.at) + 9 * 3_600_000).toISOString().slice(5, 10)
    const count = days.get(day) ?? { n: 0, k: 0 }
    days.set(day, { n: count.n + 1, k: count.k + (row.failed ? 1 : 0) })
  }
  console.log(`  날짜별(KST) 판정/실패: ${[...days].map(([day, count]) => `${day} ${count.n}/${count.k}`).join(' · ')}`)
  console.log(`  (d)의 사전 실패율 π = ${(prior * 100).toFixed(2)}% (세션 id 이전의 정답 있는 기록), 수축 m = ${SHRINK_M}`)

  // (d): coefficients fitted on the other folds' sessions.
  const random = seededRandom(13)
  const shuffled = [...sessions]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string]
  }
  const foldOf = new Map(shuffled.map((session, i) => [session, i % FOLDS]))
  const feature = (row: Scored) => features.get(row.id) ?? { rate: prior, previous: 'none' as Previous, program: '?' }
  const xd = scored.map(row => {
    const f = feature(row)

    return [1, logit(f.rate), f.previous === 'failed' ? 1 : 0, f.previous === 'succeeded' || f.previous === 'failed' ? 0 : 1]
  })
  const xdb = scored.map((row, i) => [...(xd[i] ?? []), logit(pb.get(row.id) ?? 0.5)])
  const outOfFold = (xs: readonly number[][]) => {
    const out = xs.map(() => 0)
    for (let fold = 0; fold < FOLDS; fold += 1) {
      const train = scored.flatMap((row, i) => (foldOf.get(row.sessionId) === fold ? [] : [i]))
      const fit = fitLogistic(train.map(i => xs[i] ?? []), train.map(i => ys[i] === true))
      scored.forEach((row, i) => {
        if (foldOf.get(row.sessionId) === fold) out[i] = predict(fit, xs[i] ?? [])
      })
    }

    return out
  }
  const pd = outOfFold(xd)
  const pdb = outOfFold(xdb)
  const fitD = fitLogistic(xd, ys)
  const fitDb = fitLogistic(xdb, ys)

  // Level corrections fitted outside the scored set.
  const earlier = rows.filter(hasOutcome).filter(row => row.at < SECOND_FROM)
  const shiftA = interceptShift(earlier.map(row => row.p), earlier.map(row => row.failed))
  const first = loadDecisions()
  const firstY = new Map(first.map(row => [row.id, row.failed]))
  const v3 = readResults('v3-no-flip-hint').flatMap(line => (typeof line.calls[0]?.p === 'number' && firstY.has(line.id) ? [{ p: line.calls[0].p, y: firstY.get(line.id) === true }] : []))
  const shiftB = interceptShift(v3.map(pair => pair.p), v3.map(pair => pair.y))
  const shifted = (ps: readonly number[], shift: number) => ps.map(p => sigmoid(logit(p) + shift))

  const a = scored.map(row => row.p)
  const b = scored.map(row => pb.get(row.id) ?? 0)
  const c = scored.map(row => pc.get(row.id) ?? 0)
  const rate = scored.map(row => feature(row).rate)
  const parrot = scored.map(row => (feature(row).previous === 'failed' ? 1 : 0))
  const constant = scored.map(() => prior)
  type Method = { name: string; ps: number[]; level?: number[]; note?: string }
  const methods: Method[] = [
    { name: '(a) 실시간 기록값', ps: a, level: shifted(a, shiftA) },
    { name: '(b) v3 1회', ps: b, level: shifted(b, shiftB) },
    { name: '(c) v3+직전3개', ps: c, level: shifted(c, shiftB), note: '수준 보정은 (b)의 절편을 빌림' },
    { name: '(d) 단순 통계', ps: pd, note: '다른 세션 묶음으로 맞춘 계수' },
    { name: '(d)+logit p(b)', ps: pdb, note: '다른 세션 묶음으로 맞춘 계수' },
    { name: '프로그램 실패율만', ps: rate, note: '계수 없음, 판정 전 기록만' },
    { name: '직전 실패면 실패', ps: parrot },
    { name: `상수 ${(prior * 100).toFixed(1)}%`, ps: constant },
  ]

  /** A figure's 95% interval, sessions drawn again whole. */
  const clusterBootstrap = (figure: (index: readonly number[]) => number, times = 2000): [number, number] => {
    const rng = seededRandom(17)
    const members = new Map<string, number[]>()
    scored.forEach((row, i) => members.set(row.sessionId, [...(members.get(row.sessionId) ?? []), i]))
    const values: number[] = []
    for (let t = 0; t < times; t += 1) {
      const index = sessions.flatMap(() => members.get(sessions[Math.floor(rng() * sessions.length)] ?? '') ?? [])
      const value = figure(index)
      if (Number.isFinite(value)) values.push(value)
    }
    values.sort((x, y) => x - y)

    return [percentile(values, 0.025), percentile(values, 0.975)]
  }
  const pick = <T,>(values: readonly T[], index: readonly number[]) => index.map(i => values[i] as T)
  const pairs = (ps: readonly number[]) => ps.map((p, i) => ({ id: String(i), p: Math.min(1 - 1e-6, Math.max(1e-6, p)), y: ys[i] === true }))
  const top = (ps: readonly number[], k: number) =>
    ps
      .map((p, i) => ({ p, y: ys[i] === true }))
      .sort((x, y) => y.p - x.p)
      .slice(0, k)
      .filter(item => item.y).length
  const fivePercent = Math.ceil(scored.length * 0.05)

  console.log('')
  console.log(`방법                 평균p   관측/예측  AUC [세션 묶음 95%]     PR-AUC  상위${fivePercent}(5%)·10·25   보정절편/기울기   logloss  Brier   | 절편만 보정 뒤 logloss  Brier`)
  for (const method of methods) {
    const value = aucOf(method.ps, ys)
    const [lo, hi] = clusterBootstrap(index => aucOf(pick(method.ps, index), pick(ys, index)))
    const varied = new Set(method.ps).size > 2
    const calibration = varied ? fitLogistic(method.ps.map(p => [1, logit(p)]), ys) : undefined
    const level = method.level === undefined ? '' : `${logLoss(pairs(method.level)).toFixed(4)}   ${brier(pairs(method.level)).toFixed(4)}`
    console.log(
      `${method.name.padEnd(18)}  ${mean(method.ps).toFixed(3)}   ${(fails / method.ps.reduce((x, y) => x + y, 0)).toFixed(2).padStart(6)}    ${value.toFixed(3)} [${lo.toFixed(2)}~${hi.toFixed(2)}]      ${averagePrecision(method.ps, ys).toFixed(3)}   ${String(top(method.ps, fivePercent)).padStart(3)} · ${String(top(method.ps, 10)).padStart(2)} · ${String(top(method.ps, 25)).padStart(2)}        ${calibration === undefined ? '      -      ' : `${(calibration.beta[0] ?? 0).toFixed(2).padStart(6)} / ${(calibration.beta[1] ?? 0).toFixed(2)}`}     ${logLoss(pairs(method.ps)).toFixed(4)}   ${brier(pairs(method.ps)).toFixed(4)}  | ${level}${method.note === undefined ? '' : `  (${method.note})`}`,
    )
  }
  console.log(`(우연 기준: AUC 0.5, PR-AUC ${base.toFixed(3)}, 상위 k건 적중 기대 ${(fivePercent * base).toFixed(1)}·${(10 * base).toFixed(1)}·${(25 * base).toFixed(1)}. 상수 기저율 ${(base * 100).toFixed(1)}%의 logloss ${logLoss(pairs(scored.map(() => base))).toFixed(4)}, Brier ${(base * (1 - base)).toFixed(4)})`)
  console.log(`(절편 이동: (a) ${shiftA.toFixed(2)} [11-06 이전 실시간 ${earlier.length}건], (b) ${shiftB.toFixed(2)} [v3 재실행 첫 호출 ${v3.length}건])`)

  const versus = (label: string, x: readonly number[], y: readonly number[]) => {
    const test = delong(x, y, ys)
    const [lo, hi] = clusterBootstrap(index => aucOf(pick(x, index), pick(ys, index)) - aucOf(pick(y, index), pick(ys, index)))
    console.log(`  ${label.padEnd(30)} ΔAUC ${test.diff >= 0 ? '+' : ''}${test.diff.toFixed(3)} · DeLong 95% [${(test.diff - 1.96 * test.se).toFixed(3)}~${(test.diff + 1.96 * test.se).toFixed(3)}] p=${test.p.toFixed(3)} · 세션 묶음 95% [${lo.toFixed(3)}~${hi.toFixed(3)}] · 두 AUC의 상관 ${test.r.toFixed(2)} · 가려낼 수 있는 최소 차이(검정력 80%) ${(2.8 * test.se).toFixed(3)}`)
  }
  console.log('')
  console.log('주 비교 ① (b) 대 (d)의 AUC')
  versus('(b) − (d)', b, pd)
  console.log('')
  console.log('주 비교 ② (d)에 logit p(b)를 더하면 나아지는가')
  const lr = 2 * (fitDb.logLik - fitD.logLik)
  const names = ['절편', 'logit 프로그램 실패율', '직전 실패', '직전 없음·모름', 'logit p(b)']
  console.log(`  (d) 계수(전체로 맞춤): ${fitD.beta.map((value, i) => `${names[i]} ${value.toFixed(2)}±${(fitD.se[i] ?? 0).toFixed(2)}`).join(' · ')}`)
  console.log(`  (d)+p(b) 계수:        ${fitDb.beta.map((value, i) => `${names[i]} ${value.toFixed(2)}±${(fitDb.se[i] ?? 0).toFixed(2)}`).join(' · ')}`)
  console.log(`  우도비 ${lr.toFixed(2)} (자유도 1) p=${(2 * upperTail(Math.sqrt(Math.max(0, lr)))).toFixed(4)} — 판정끼리 독립이라고 본 값이라 세션 쏠림만큼 낙관적`)
  const lossOf = (ps: readonly number[]) => ps.map((p, i) => -Math.log(Math.max(1e-6, ys[i] === true ? p : 1 - p)))
  const lossD = lossOf(pd)
  const lossDb = lossOf(pdb)
  const gap = lossD.map((value, i) => (lossDb[i] ?? 0) - value)
  const [gapLo, gapHi] = clusterBootstrap(index => mean(pick(gap, index)))
  console.log(`  밖 표본 logloss(세션 묶음 ${FOLDS}겹): (d) ${mean(lossD).toFixed(4)} → (d)+p(b) ${mean(lossDb).toFixed(4)}, 차 ${mean(gap) >= 0 ? '+' : ''}${mean(gap).toFixed(4)} · 세션 묶음 95% [${gapLo.toFixed(4)}~${gapHi.toFixed(4)}] (음수면 p(b)가 보탬)`)

  console.log('')
  console.log('탐색(결론으로 읽지 않음)')
  versus('(c) − (b)', c, b)
  versus('(c) − (d)', c, pd)
  versus('(b) − (a)', b, a)
  versus('(d)+p(b) − (d)', pdb, pd)
  versus('(d) − 프로그램 실패율만', pd, rate)
  versus('(d) − 직전 실패면 실패', pd, parrot)

  console.log('')
  console.log('층별: 건수 / 실패 / 실패율 · AUC (a) (b) (c) (d)  (실패나 성공이 5건 미만이면 AUC 없음)')
  const stratum = (label: string, keep: (row: Scored) => boolean) => {
    const index = scored.flatMap((row, i) => (keep(row) ? [i] : []))
    const y = pick(ys, index)
    const k = y.filter(Boolean).length
    const figures = k < 5 || index.length - k < 5 ? '' : ` · ${[a, b, c, pd].map(ps => aucOf(pick(ps, index), y).toFixed(2)).join(' ')}`
    console.log(`  ${label.padEnd(16)} ${String(index.length).padStart(5)} / ${String(k).padStart(3)} / ${index.length === 0 ? '-' : `${((k / index.length) * 100).toFixed(1)}%`}${figures}`)
  }
  stratum('직전 성공', row => feature(row).previous === 'succeeded')
  stratum('직전 실패', row => feature(row).previous === 'failed')
  stratum('직전 없음', row => feature(row).previous === 'none')
  stratum('직전 결과 모름', row => feature(row).previous === 'unknown' || feature(row).previous === 'unfinished')
  stratum('메인', row => row.agentId === undefined)
  stratum('서브에이전트', row => row.agentId !== undefined)
  stratum('파이프 있음', row => hasPipe(commandOf(row.input)))
  stratum('파이프 없음', row => !hasPipe(commandOf(row.input)))
  stratum('thinking 끔(a)', row => !row.thinking)
  stratum('thinking 켬(a)', row => row.thinking)

  const failed = scored.filter(row => row.failed)
  const codes = { 'exit 1': 0, 'exit 2~125': 0, 'exit 126·127': 0, 'exit 128 이상': 0, '코드 없음': 0 }
  for (const row of failed) {
    const code = Number(/^exit (\d+)$/.exec(row.note ?? '')?.[1] ?? Number.NaN)
    codes[Number.isNaN(code) ? '코드 없음' : code === 1 ? 'exit 1' : code === 126 || code === 127 ? 'exit 126·127' : code >= 128 ? 'exit 128 이상' : 'exit 2~125'] += 1
  }
  const searchers = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'diff', 'cmp', 'test', '[', '[['])
  const exitOne = failed.filter(row => row.note === 'exit 1')
  console.log('')
  console.log(`종료 코드(실패 ${failed.length}건): ${Object.entries(codes).map(([label, count]) => `${label} ${count}`).join(' · ')}`)
  console.log(`  exit 1 실패 ${exitOne.length}건 중 마지막 단계가 검색·비교 명령(grep·rg·diff·test 류)인 것 ${exitOne.filter(row => searchers.has(lastProgramOf(commandOf(row.input)))).length}건`)
  const programs = new Set(scored.map(row => feature(row).program))
  const unseen = scored.filter(row => Math.abs(feature(row).rate - prior) < 1e-12)
  console.log(`프로그램 키 ${programs.size}종, 판정 때 처음 보는 프로그램이던 판정 ${unseen.length}건(실패 ${unseen.filter(row => row.failed).length})`)
  const cost = (name: string) => readResults(name).reduce((total, line) => total + line.costUsd, 0)
  console.log(`비용: (b) $${cost('b-v3-once').toFixed(3)} · (c) $${cost('c-v3-history').toFixed(3)}`)
}

function parseFlags(args: readonly string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = args[i + 1] ?? ''
      i += 1
    } else positional.push(arg)
  }

  return { positional, flags }
}

const [command, ...rest] = process.argv.slice(2)
const { positional, flags } = parseFlags(rest)
if (command === 'run' && positional[0] !== undefined) await run(positional[0], flags)
else if (command === 'report') report(positional, flags.ref)
else if (command === 'compare') compare()
else if (command === 'variants') for (const [name, variant] of Object.entries(VARIANTS)) console.log(`${name}: ${variant.note} (${variant.model}, thinking ${variant.thinking ? '켬' : '끔'})`)
else console.log('사용법: bun tools/likely-replay.ts run <변형> [--limit N] [--max-usd X] [--concurrency N] | report [변형 ...] | compare | variants')
