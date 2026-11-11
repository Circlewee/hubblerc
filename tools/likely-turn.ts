/**
 * A second task for likely, tried on records before anything is wired into a session: from the
 * message a user sent, will the answer have a failed tool call? The auto effort log already holds
 * the message (its first 500 characters, secrets hidden) and, as the answer ended, its count of
 * failed tool calls.
 *
 *   bun tools/likely-turn.ts run [--limit N] [--max-usd X]
 *   bun tools/likely-turn.ts report
 *
 * Reads the auto effort logs (iCloud Drive's hubblerc/auto-effort, read only) and writes ids and
 * numbers to hubblerc/likely-replay/turn-fail-v1.jsonl: never a message. The key as in likely-replay.ts.
 *
 * Fixed before any result was read (2026-11-11):
 * - Scored: every auto effort decision whose answer's end was logged (`kind: 'turn'`). The label is
 *   `failures > 0`.
 * - likely: Haiku, one call, asked straight (no flipped call), with the rate as a hint. The rate is
 *   these records' own, so the level of its numbers is not judged here: only their ranking is.
 * - Without a model, to beat: the effort auto effort picked for the message (low < medium < high <
 *   xhigh; itself a Haiku reading of the message, with the previous answer's end, which this replay
 *   does not have), and the message's length.
 * - Two questions decide: ① likely's AUC against the picked effort's AUC, ② whether logit p adds to
 *   a logistic model of the picked effort (likelihood ratio). The rest is to be read as a look.
 * - Whether it only predicts a long answer: the answer's output tokens (known only afterwards) as a
 *   predictor, likely's rank correlation with them, and whether logit p still carries weight in a
 *   model that already has log(output tokens).
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { seededRandom } from '../plugins/hubblerc/hooks/likely/method'
import type { Question } from '../plugins/hubblerc/hooks/likely/method'
import { aucOf, averagePrecision, delong, fitLogistic, HAIKU, ICLOUD, isRecord, keychainKey, limiter, logit, mean, OUT_DIR, percentile, readResults, replayOne, upperTail } from './likely-replay'
import type { Logged, Variant } from './likely-replay'

const LOG_DIR = join(ICLOUD, 'auto-effort')
const NAME = 'turn-fail-v1'

const QUESTION: Question = {
  type: 'predicate',
  name: 'toolFails',
  instructions:
    'While Claude Code answers this message, will at least one of its tool calls fail (a shell command ending with a non-zero exit code, an edit that does not apply, a tool reporting an error)? For reference: about 1 in 8 answers here has a failed tool call.',
}

const VARIANT: Variant = { model: HAIKU, flip: false, hint: false, thinking: false, note: '답변 안 도구 실패, 1회', samples: 1 }

const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

type Turn = { id: string; at: string; session: string; question: string; effort: number; failures: number; outputTokens: number; durationMs: number }

/** The auto effort decisions whose answer's end was logged, oldest first. */
function loadTurns(): Turn[] {
  const decisions = new Map<string, Record<string, unknown>>()
  const ends = new Map<string, Record<string, unknown>>()
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
      else if (row.type === 'outcome' && row.kind === 'turn' && !ends.has(row.id)) ends.set(row.id, row)
    }
  }
  const turns: Turn[] = []
  for (const row of decisions.values()) {
    const end = ends.get(row.id as string)
    if (end === undefined || typeof end.failures !== 'number' || typeof row.question !== 'string' || row.question.trim() === '' || typeof row.at !== 'string') continue
    turns.push({
      id: row.id as string,
      at: row.at,
      session: typeof row.session === 'string' ? row.session : '',
      question: row.question,
      // A decision that picked nothing sits between medium and high.
      effort: typeof row.effort === 'string' ? (EFFORT_RANK[row.effort] ?? 1.5) : 1.5,
      failures: end.failures,
      outputTokens: typeof end.outputTokens === 'number' ? end.outputTokens : 0,
      durationMs: typeof end.durationMs === 'number' ? end.durationMs : 0,
    })
  }

  return turns.sort((a, b) => a.at.localeCompare(b.at))
}

/** What the model is shown of a message. */
function turnInput(question: string): string {
  return ['A message a user just sent to Claude Code, a coding agent that answers by calling tools (shell commands, file edits, searches, subagents).', `The message (its first 500 characters):\n${question}`].join('\n\n')
}

async function run(flags: Record<string, string>): Promise<void> {
  const maxUsd = Number(flags['max-usd'] ?? '1')
  const turns = loadTurns()
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${NAME}.jsonl`)
  const done = new Set(readResults(NAME).map(line => line.id))
  const todo = turns.filter(turn => !done.has(turn.id)).slice(0, flags.limit === undefined ? undefined : Number(flags.limit))
  const key = keychainKey()
  const limit = limiter(8)
  console.log(`${NAME}: 대상 ${turns.length}건, 이미 ${done.size}건, 이번 ${todo.length}건, 상한 $${maxUsd}`)
  let spent = 0
  let finished = 0
  let stop: string | undefined
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (stop === undefined) {
        if (spent >= maxUsd) {
          stop = `상한 $${maxUsd} 도달`
          break
        }
        const turn = queue.shift()
        if (turn === undefined) break
        const decision: Logged = { id: turn.id, at: turn.at, input: turnInput(turn.question), questions: [QUESTION], samples: 1, thinking: false, p: 0, failed: turn.failures > 0 }
        try {
          const line = await replayOne(decision, NAME, VARIANT, key, limit)
          spent += line.costUsd
          appendFileSync(file, `${JSON.stringify(line)}\n`)
          finished += 1
        } catch (error) {
          stop = String(error).slice(0, 300)
        }
      }
    }),
  )
  const lines = readResults(NAME)
  console.log(`${NAME}: 이번 ${finished}건 $${spent.toFixed(4)} · 파일 ${lines.length}건, 답 없음 ${lines.filter(line => line.p === null).length}건${stop === undefined ? '' : ` · 멈춤: ${stop}`}`)
}

/** Ranks, ties sharing their mean rank. */
function ranksOf(values: readonly number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0))
  const ranks = values.map(() => 0)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j < order.length && values[order[j] ?? 0] === values[order[i] ?? 0]) j += 1
    for (let k = i; k < j; k += 1) ranks[order[k] ?? 0] = (i + j + 1) / 2
    i = j
  }

  return ranks
}

function correlation(x: readonly number[], y: readonly number[]): number {
  const mx = mean(x)
  const my = mean(y)
  const cov = mean(x.map((value, i) => (value - mx) * ((y[i] ?? 0) - my)))

  return cov / Math.sqrt(mean(x.map(value => (value - mx) ** 2)) * mean(y.map(value => (value - my) ** 2)))
}

function report(): void {
  const results = new Map(readResults(NAME).flatMap(line => (line.p === null ? [] : [[line.id, line.p] as [string, number]])))
  const all = loadTurns()
  const turns = all.filter(turn => results.has(turn.id))
  const ys = turns.map(turn => turn.failures > 0)
  const fails = ys.filter(Boolean).length
  const base = fails / turns.length
  const sessions = [...new Set(turns.map(turn => turn.session))].sort()
  console.log(`답변 ${all.length}건 중 likely가 답한 ${turns.length}건, 도구 실패가 있던 답변 ${fails}건 (${(base * 100).toFixed(1)}%), 세션 ${sessions.length}개`)

  /** A figure's 95% interval, sessions drawn again whole. */
  const clusterBootstrap = (figure: (index: readonly number[]) => number, times = 2000): [number, number] => {
    const rng = seededRandom(19)
    const members = new Map<string, number[]>()
    turns.forEach((turn, i) => members.set(turn.session, [...(members.get(turn.session) ?? []), i]))
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
  const p = turns.map(turn => results.get(turn.id) ?? 0)
  const effort = turns.map(turn => turn.effort)
  const length = turns.map(turn => turn.question.length)
  const tokens = turns.map(turn => turn.outputTokens)
  const duration = turns.map(turn => turn.durationMs)
  const top = (ps: readonly number[], k: number) =>
    ps
      .map((value, i) => ({ value, y: ys[i] === true }))
      .sort((x, y) => y.value - x.value)
      .slice(0, k)
      .filter(item => item.y).length
  const tenth = Math.ceil(turns.length * 0.1)

  console.log('')
  console.log(`방법                          AUC [세션 묶음 95%]    PR-AUC   상위 ${tenth}건(10%) 중 실패`)
  const rows: [string, number[]][] = [
    ['likely (질문 글만)', p],
    ['auto effort가 고른 레벨', effort],
    ['질문 길이(500자까지)', length],
    ['[사후] 답변 출력 토큰', tokens],
    ['[사후] 답변 시간', duration],
  ]
  for (const [name, values] of rows) {
    const [lo, hi] = clusterBootstrap(index => aucOf(pick(values, index), pick(ys, index)))
    console.log(`${name.padEnd(24)}  ${aucOf(values, ys).toFixed(3)} [${lo.toFixed(2)}~${hi.toFixed(2)}]      ${averagePrecision(values, ys).toFixed(3)}    ${top(values, tenth)}`)
  }
  console.log(`(우연 기준: AUC 0.5, PR-AUC ${base.toFixed(3)}, 상위 ${tenth}건 중 기대 ${(tenth * base).toFixed(1)}건. [사후]는 답변이 끝나야 아는 값이라 예측에 쓸 수 없고, 길이가 실패를 얼마나 설명하는지 보는 용도)`)
  console.log(`likely 평균 예측 ${mean(p).toFixed(3)} 대 실제 ${base.toFixed(3)} (힌트 값이 같은 기록에서 나와 수준은 평가하지 않음)`)

  const versus = (label: string, x: readonly number[], y: readonly number[]) => {
    const test = delong(x, y, ys)
    const [lo, hi] = clusterBootstrap(index => aucOf(pick(x, index), pick(ys, index)) - aucOf(pick(y, index), pick(ys, index)))
    console.log(`  ${label.padEnd(28)} ΔAUC ${test.diff >= 0 ? '+' : ''}${test.diff.toFixed(3)} · DeLong 95% [${(test.diff - 1.96 * test.se).toFixed(3)}~${(test.diff + 1.96 * test.se).toFixed(3)}] p=${test.p.toFixed(3)} · 세션 묶음 95% [${lo.toFixed(3)}~${hi.toFixed(3)}] · 가려낼 수 있는 최소 차이 ${(2.8 * test.se).toFixed(3)}`)
  }
  const ratio = (label: string, baseColumns: (i: number) => number[]) => {
    const small = fitLogistic(turns.map((_, i) => [1, ...baseColumns(i)]), ys)
    const full = fitLogistic(turns.map((_, i) => [1, ...baseColumns(i), logit(p[i] ?? 0.5)]), ys)
    const lr = 2 * (full.logLik - small.logLik)
    const last = full.beta.length - 1
    console.log(`  ${label}: logit p의 계수 ${(full.beta[last] ?? 0).toFixed(2)}±${(full.se[last] ?? 0).toFixed(2)}, 우도비 ${lr.toFixed(2)} p=${(2 * upperTail(Math.sqrt(Math.max(0, lr)))).toFixed(4)} (답변끼리 독립이라고 본 값)`)
  }
  console.log('')
  console.log('주 비교 ① likely 대 auto effort가 고른 레벨')
  versus('likely − 고른 레벨', p, effort)
  console.log('주 비교 ② 고른 레벨에 logit p를 더하면 나아지는가')
  ratio('고른 레벨 + logit p', i => [effort[i] ?? 0])

  console.log('')
  console.log('길이만 맞히는 것인가(참고)')
  console.log(`  likely와 출력 토큰의 순위 상관 ${correlation(ranksOf(p), ranksOf(tokens)).toFixed(2)}, 고른 레벨과 출력 토큰 ${correlation(ranksOf(effort), ranksOf(tokens)).toFixed(2)}`)
  ratio('log(출력 토큰) + logit p', i => [Math.log(1 + (tokens[i] ?? 0))])
  const sortedTokens = [...tokens].sort((a, b) => a - b)
  const cuts = [percentile(sortedTokens, 1 / 3), percentile(sortedTokens, 2 / 3)]
  const third = (value: number) => (value < (cuts[0] ?? 0) ? 0 : value < (cuts[1] ?? 0) ? 1 : 2)
  for (const [k, label] of ['짧은 답변', '중간 답변', '긴 답변'].entries()) {
    const index = turns.flatMap((_, i) => (third(tokens[i] ?? 0) === k ? [i] : []))
    const y = pick(ys, index)
    const count = y.filter(Boolean).length
    console.log(`  ${label}(출력 토큰 3등분): ${index.length}건, 실패 ${count}건 (${((count / index.length) * 100).toFixed(0)}%)${count < 5 ? '' : ` · AUC likely ${aucOf(pick(p, index), y).toFixed(2)}, 고른 레벨 ${aucOf(pick(effort, index), y).toFixed(2)}`}`)
  }
  console.log('')
  console.log('고른 레벨별 실패한 답변')
  for (const [name, rank] of Object.entries(EFFORT_RANK)) {
    const index = turns.flatMap((turn, i) => (turn.effort === rank ? [i] : []))
    if (index.length > 0) console.log(`  ${name.padEnd(6)} ${index.length}건, 실패 ${pick(ys, index).filter(Boolean).length}건 (${((pick(ys, index).filter(Boolean).length / index.length) * 100).toFixed(0)}%), likely 평균 ${mean(pick(p, index)).toFixed(3)}`)
  }
  console.log(`비용: $${readResults(NAME).reduce((total, line) => total + line.costUsd, 0).toFixed(3)}`)
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 2) flags[(rest[i] ?? '').replace(/^--/, '')] = rest[i + 1] ?? ''
  if (command === 'run') await run(flags)
  else if (command === 'report') report()
  else console.log('사용법: bun tools/likely-turn.ts run [--limit N] [--max-usd X] | report')
}
