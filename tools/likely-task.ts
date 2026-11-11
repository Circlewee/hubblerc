/**
 * One way to try likely on a judgment: a question whose answer is in the input, asked of a sample of
 * logged inputs by Haiku (as likely would) and by Opus 5.5 as the reference, then read side by side.
 * The tasks are entries in likely-tasks.ts.
 *
 *   bun tools/likely-task.ts tasks
 *   bun tools/likely-task.ts run <task> haiku|opus [--max-usd X]
 *   bun tools/likely-task.ts report <task>
 *
 * Writes to hubblerc/likely-replay in iCloud, outside the repository: `<prefix>-sample.json` (the ids
 * drawn, kept so both models and every rerun see the same inputs though the logs grow),
 * `<prefix>-haiku.jsonl` and `<prefix>-opus.jsonl` (ids and numbers), and from the report
 * `<prefix>-disagreements.md` (the inputs the two disagree on, for the user to read).
 *
 * The order of work, as it went for the first two tasks (spec F10, 2026-11-11):
 * 1. Write the question with its criteria listed. 2. Run both models. 3. Read the disagreements:
 * most show a gap in the wording, not in the model. 4. Mend the wording and run it on inputs the
 * mending did not see (`notIn`). 5. Pick the threshold from the report's table.
 *
 * Haiku: three calls asked straight (a choice's options shuffled each call), averaged. Opus 5.5: one
 * call, effort high; its answer (a predicate at 0.5, a choice's likeliest option) is the reference
 * label: a model's reading, not the truth.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { seededRandom } from '../plugins/hubblerc/hooks/likely/method'
import { aucOf, HAIKU, keychainKey, limiter, mean, OUT_DIR, readResults, replayOne } from './likely-replay'
import type { Logged, ResultLine, Variant } from './likely-replay'
import { TASKS } from './likely-tasks'
import type { Item, Task } from './likely-tasks'

const WHO: Record<string, Variant> = {
  haiku: { model: HAIKU, flip: false, hint: false, thinking: false, note: 'Haiku 3회', samples: 3 },
  opus: { model: 'claude-opus-5-5', flip: false, hint: false, thinking: true, note: 'Opus 5.5 effort high 1회(기준)', samples: 1, effort: 'high', request: { max_tokens: 16000 } },
}

const readIds = (file: string): string[] => (existsSync(join(OUT_DIR, file)) ? (JSON.parse(readFileSync(join(OUT_DIR, file), 'utf8')) as string[]) : [])

/** The task's inputs: the ids its sample file holds, or drawn now and written there. */
function sampleOf(task: Task): Item[] {
  const all = task.items()
  const file = `${task.prefix}-sample.json`
  if (existsSync(join(OUT_DIR, file))) {
    const byId = new Map(all.map(item => [item.id, item]))

    return readIds(file).flatMap(id => byId.get(id) ?? [])
  }
  const byId = new Map(all.map(item => [item.id, item]))
  const seen = new Set((task.notIn ?? []).flatMap(readIds).flatMap(id => byId.get(id)?.shown ?? []))
  const fresh = all.filter(item => !seen.has(item.shown))
  let drawn = fresh
  if (task.sample !== undefined) {
    const random = seededRandom(task.seed ?? 1)
    const shuffled = [...fresh]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j] as Item, shuffled[i] as Item]
    }
    drawn = shuffled.slice(0, task.sample)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, file), JSON.stringify(drawn.map(item => item.id)))

  return drawn
}

async function run(task: Task, who: string, maxUsd: number): Promise<void> {
  const variant = WHO[who]
  if (variant === undefined) throw new Error('haiku 또는 opus')
  const name = `${task.prefix}-${who}`
  const all = sampleOf(task)
  const done = new Set(readResults(name).map(line => line.id))
  const queue = all.filter(item => !done.has(item.id))
  const key = keychainKey()
  const limit = limiter(8)
  console.log(`${name} (${variant.note}): 표본 ${all.length}건, 이번 ${queue.length}건, 상한 $${maxUsd}`)
  let spent = 0
  let stop: string | undefined
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (stop === undefined) {
        if (spent >= maxUsd) {
          stop = `상한 $${maxUsd} 도달`
          break
        }
        const item = queue.shift()
        if (item === undefined) break
        const decision: Logged = { id: item.id, at: item.at, input: item.input, questions: [task.question], samples: variant.samples ?? 1, thinking: variant.thinking, p: 0, failed: false }
        try {
          const line = await replayOne(decision, name, variant, key, limit)
          spent += line.costUsd
          appendFileSync(join(OUT_DIR, `${name}.jsonl`), `${JSON.stringify(line)}\n`)
        } catch (error) {
          stop = String(error).slice(0, 300)
        }
      }
    }),
  )
  const lines = readResults(name)
  console.log(`${name}: $${spent.toFixed(3)} · 파일 ${lines.length}건, 답 없음 ${lines.filter(line => line.p === null).length}건${stop === undefined ? '' : ` · 멈춤: ${stop}`}`)
}

/** A decision's answer as a distribution over the options: a predicate's is [yes, no]. */
function distributionOf(line: ResultLine | undefined, options: number): number[] | undefined {
  const calls = (line?.calls ?? []).flatMap(call => (call.dist !== undefined ? [call.dist] : typeof call.p === 'number' ? [[call.p, 1 - call.p]] : []))

  // Rounded as the result files round a decision's number: 0.08, 0.1 and 0.12 average to 0.1, not to 0.0999….
  return calls.length === 0 ? undefined : Array.from({ length: options }, (_, i) => Math.round(mean(calls.map(dist => dist[i] ?? 0)) * 10_000) / 10_000)
}

const likeliest = (dist: readonly number[]) => dist.indexOf(Math.max(...dist))

type Pair = { item: Item; h: number[]; o: number[]; calls: number[][] }

function report(task: Task): void {
  const question = task.question
  const options = question.type === 'choice' ? question.choices.map(choice => choice.value) : question.type === 'score' ? question.levels.map(level => level.label) : ['예', '아니오']
  const haiku = new Map(readResults(`${task.prefix}-haiku`).map(line => [line.id, line]))
  const opus = new Map(readResults(`${task.prefix}-opus`).map(line => [line.id, line]))
  const sample = sampleOf(task)
  const pairs: Pair[] = sample.flatMap(item => {
    const h = distributionOf(haiku.get(item.id), options.length)
    const o = distributionOf(opus.get(item.id), options.length)
    const calls = (haiku.get(item.id)?.calls ?? []).flatMap(call => (call.dist !== undefined ? [call.dist] : typeof call.p === 'number' ? [[call.p, 1 - call.p]] : []))

    return h === undefined || o === undefined ? [] : [{ item, h, o, calls }]
  })
  if (pairs.length === 0) {
    console.log(`${task.title}: 두 모델이 모두 답한 것이 없습니다. run <과제> haiku, run <과제> opus를 먼저 돌리세요.`)

    return
  }
  const apart = pairs.filter(pair => likeliest(pair.h) !== likeliest(pair.o))
  console.log(`과제: ${task.title}`)
  console.log(`표본 ${sample.length}건 중 둘 다 답한 ${pairs.length}건. Haiku의 답이 기준(Opus)과 같은 것 ${pairs.length - apart.length}건 (${(((pairs.length - apart.length) / pairs.length) * 100).toFixed(1)}%)`)
  console.log('')
  console.log(`기준(Opus)의 답 ↓ / Haiku의 답 →  ${options.map(option => option.padStart(9)).join('')}      합계`)
  options.forEach((option, i) => {
    const of = pairs.filter(pair => likeliest(pair.o) === i)
    console.log(`  ${option.padEnd(28)}${options.map((_, j) => String(of.filter(pair => likeliest(pair.h) === j).length).padStart(9)).join('')}   ${String(of.length).padStart(7)}`)
  })
  console.log('')
  if (question.type === 'predicate') {
    const p = pairs.map(pair => pair.h[0] ?? 0)
    const reference = pairs.map(pair => (pair.o[0] ?? 0) >= 0.5)
    const yes = reference.filter(Boolean).length
    console.log(`기준이 "${task.yes ?? '예'}"고 본 것 ${yes}건 (${((yes / pairs.length) * 100).toFixed(1)}%). 가려내는 힘(AUC, 0.5 우연·1.0 완벽): ${aucOf(p, reference).toFixed(3)}`)
    console.log('Haiku가 말한 확률 구간별: 건수, 그중 기준이 예라고 본 비율 (확률이 말 그대로면 구간 값과 비슷해야 함)')
    for (const [lo, hi] of [[0, 0.1], [0.1, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]] as const) {
      const index = pairs.flatMap((_, i) => ((p[i] ?? 0) >= lo && (p[i] ?? 0) < hi ? [i] : []))
      if (index.length > 0) console.log(`  ${lo.toFixed(1)}~${Math.min(1, hi).toFixed(1)}: ${String(index.length).padStart(4)}건, 평균 예측 ${mean(index.map(i => p[i] ?? 0)).toFixed(2)}, 기준 예 ${((index.filter(i => reference[i]).length / index.length) * 100).toFixed(0)}%`)
    }
    console.log('기준값별(Haiku의 확률이 이 값 이상이면 예로 봄): 예로 본 건수, 기준의 예 중 놓친 건수')
    for (const cut of [0.5, 0.3, 0.2, 0.1]) console.log(`  ${cut.toFixed(1)}: ${String(p.filter(value => value >= cut).length).padStart(4)}건, 놓침 ${p.filter((value, i) => value < cut && reference[i]).length}/${yes}`)
  } else {
    console.log('Haiku의 확신(고른 답의 확률) 구간별: 건수, 그중 기준과 같은 비율 (확률이 말 그대로면 구간 값과 비슷해야 함)')
    for (const [lo, hi] of [[0, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]] as const) {
      const of = pairs.filter(pair => Math.max(...pair.h) >= lo && Math.max(...pair.h) < hi)
      if (of.length > 0) console.log(`  ${lo.toFixed(1)}~${Math.min(1, hi).toFixed(1)}: ${String(of.length).padStart(4)}건, 평균 확신 ${mean(of.map(pair => Math.max(...pair.h))).toFixed(2)}, 기준과 같음 ${((of.filter(pair => likeliest(pair.h) === likeliest(pair.o)).length / of.length) * 100).toFixed(0)}%`)
    }
  }
  const split = pairs.filter(pair => new Set(pair.calls.map(likeliest)).size > 1)
  const spreads = pairs.map(pair => {
    const values = pair.calls.map(dist => dist[likeliest(pair.h)] ?? 0)

    return values.length < 2 ? 0 : Math.max(...values) - Math.min(...values)
  })
  console.log(`Haiku 3회의 흔들림: 고른 답의 확률 최대−최소 평균 ${mean(spreads).toFixed(3)}, 3회가 서로 다른 답을 고른 것 ${split.length}건 — 그중 기준과 어긋난 것 ${split.filter(pair => likeliest(pair.h) !== likeliest(pair.o)).length}건`)
  const noted = pairs.filter(pair => pair.item.note !== undefined)
  if (noted.length > 0) console.log(`기록에 남은 실제 답이 있는 ${noted.length}건: Haiku와 같음 ${noted.filter(pair => options[likeliest(pair.h)] === pair.item.note).length}건, Opus와 같음 ${noted.filter(pair => options[likeliest(pair.o)] === pair.item.note).length}건`)
  const cost = (who: string) => readResults(`${task.prefix}-${who}`).reduce((total, line) => total + line.costUsd, 0)
  console.log(`비용: Haiku $${cost('haiku').toFixed(3)} · Opus $${cost('opus').toFixed(3)}`)
  const file = join(OUT_DIR, `${task.prefix}-disagreements.md`)
  const show = (dist: readonly number[]) => `${options[likeliest(dist)]} ${Math.max(...dist).toFixed(2)}`
  writeFileSync(file, [`# ${task.title}: Haiku와 Opus가 어긋난 ${apart.length}건`, '', ...apart.map((pair, i) => `## ${i + 1}. Haiku ${show(pair.h)} · Opus ${show(pair.o)}\n\n\`\`\`\n${pair.item.shown.slice(0, 600)}\n\`\`\`\n`)].join('\n'))
  console.log(`어긋난 ${apart.length}건은 ${file} 에 적음(저장소 밖)`)
}

if (import.meta.main) {
  const [command, name, who, flag, value] = process.argv.slice(2)
  const task = name === undefined ? undefined : TASKS[name]
  if (command === 'tasks') for (const [key, entry] of Object.entries(TASKS)) console.log(`${key}: ${entry.title} (${entry.question.type}, 파일 ${entry.prefix}-*)`)
  else if (command === 'run' && task !== undefined && who !== undefined) await run(task, who, flag === '--max-usd' ? Number(value) : who === 'opus' ? 6 : 0.5)
  else if (command === 'report' && task !== undefined) report(task)
  else console.log(`사용법: bun tools/likely-task.ts tasks | run <과제> haiku|opus [--max-usd X] | report <과제>   (과제: ${Object.keys(TASKS).join(', ')})`)
}
