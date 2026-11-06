/**
 * The likely replay experiment: the Bash decisions already logged asked again, the way they were
 * asked or a changed way, and the variants scored on the same commands and the same outcomes.
 *
 *   bun tools/likely-replay.ts run <variant> [--limit N] [--max-usd X] [--concurrency N]
 *   bun tools/likely-replay.ts report [variant ...]
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

type Variant = { model: string; flip: boolean; hint: boolean; thinking: boolean; note: string }

/** Stage 1 (2026-11-06): Haiku, thinking off, five calls as logged; only the way of asking changes. */
const VARIANTS: Record<string, Variant> = {
  'v0-current': { model: HAIKU, flip: true, hint: false, thinking: false, note: '현행 그대로(5회 중 2회 뒤집어 묻기)' },
  'v1-no-flip': { model: HAIKU, flip: false, hint: false, thinking: false, note: '뒤집어 묻기 없음' },
  'v2-hint': { model: HAIKU, flip: true, hint: true, thinking: false, note: '기저율 힌트' },
  'v3-no-flip-hint': { model: HAIKU, flip: false, hint: true, thinking: false, note: '뒤집기 없음 + 기저율 힌트' },
  /** Stage 2 (2026-11-06): stage 1's best-calibrated way of asking, with thinking (adaptive, effort low, as likely.ts asks it). */
  'v4-thinking': { model: HAIKU, flip: false, hint: true, thinking: true, note: 'v3 + thinking 켬' },
}

type Logged = { id: string; at: string; input: string; questions: Question[]; samples: number; thinking: boolean; p: number; failed: boolean }

type CallResult = { negated: boolean; p?: number; refused?: true; error?: string; latencyMs: number; tokens: Tokens }

type ResultLine = { variant: string; id: string; at: string; model: string; thinking: boolean; calls: CallResult[]; p: number | null; costUsd: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The logged Bash decisions with an outcome before the cutoff, oldest first. */
function loadDecisions(): Logged[] {
  const decisions = new Map<string, Record<string, unknown>>()
  const outcomes = new Map<string, unknown>()
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
      else if (row.type === 'outcome') outcomes.set(row.id, row.outcome)
    }
  }
  const kept: Logged[] = []
  for (const row of decisions.values()) {
    const failed = outcomes.get(row.id as string)
    if (row.task !== 'bash-fail' || typeof failed !== 'boolean' || row.methodVersion !== 1) continue
    if (typeof row.at !== 'string' || row.at >= CUTOFF || typeof row.input !== 'string' || !Array.isArray(row.questions)) continue
    const answer = Array.isArray(row.answers) ? row.answers[0] : undefined
    if (!isRecord(answer) || answer.type !== 'predicate' || typeof answer.probability !== 'number') continue
    kept.push({
      id: row.id as string,
      at: row.at,
      input: row.input,
      questions: row.questions as Question[],
      samples: typeof row.samples === 'number' ? row.samples : 5,
      thinking: row.thinking === true,
      p: answer.probability,
      failed,
    })
  }

  return kept.sort((a, b) => a.at.localeCompare(b.at))
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

/** Haiku 5.5's prices (cost.ts); another model has to have its prices added before it runs. */
function priceOf(model: string): (tokens: Tokens) => number {
  if (model.startsWith('claude-haiku-5-5')) return costOf
  throw new Error(`${model}의 가격이 아직 없습니다`)
}

/** A logged decision asked again as the variant asks it: the same layouts as logged (seeded by its id), changed as the variant says. */
async function replayOne(decision: Logged, name: string, variant: Variant, key: string, limit: ReturnType<typeof limiter>): Promise<ResultLine> {
  const questions: Question[] = variant.hint ? decision.questions.map(question => ({ ...question, instructions: `${question.instructions} ${BASE_RATE_HINT}` })) : decision.questions
  const random = seededRandom(seedOf(decision.id))
  const layouts: CallLayout[] = Array.from({ length: decision.samples }, (_, i) => {
    const layout = layoutCall(decision.questions, i, random)

    return variant.flip ? layout : { ...layout, questions: layout.questions.map(question => ({ ...question, negated: false })) }
  })
  const price = priceOf(variant.model)
  let model = variant.model
  const calls = await Promise.all(
    layouts.map(layout =>
      limit(async (): Promise<CallResult> => {
        const negated = layout.questions[0]?.negated === true
        const ran = await callApi(key, requestBody({ model: variant.model, input: decision.input, questions, layout, thinking: variant.thinking }))
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
  const all = loadDecisions()
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
        const line = await replayOne(decision, name, variant, key, limit)
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

function report(names: string[]): void {
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

  const reference = sets.find(set => set.name === 'v0-current')
  if (reference !== undefined) {
    console.log('')
    console.log('v0-current와 짝지어 비교 (같은 명령, 차이의 95% 구간; 0을 걸치면 차이 미판정)')
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
      console.log(`재현(live thinking 끔 ${ids.length}건 vs v0-current): 상관 ${r.toFixed(3)}, 평균 차 ${(mz - mx >= 0 ? '+' : '') + (mz - mx).toFixed(3)}, 평균 |차| ${mean(xs.map((x, i) => Math.abs(x - (zs[i] ?? 0)))).toFixed(3)}`)
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
else if (command === 'report') report(positional)
else if (command === 'variants') for (const [name, variant] of Object.entries(VARIANTS)) console.log(`${name}: ${variant.note} (${variant.model}, thinking ${variant.thinking ? '켬' : '끔'})`)
else console.log('사용법: bun tools/likely-replay.ts run <변형> [--limit N] [--max-usd X] [--concurrency N] | report [변형 ...] | variants')
