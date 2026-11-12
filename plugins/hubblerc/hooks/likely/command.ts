import type { EngineInterface, On } from 'claude-code'

import { BASH_TASK } from './bash-fail'
import { dollars } from './cost'
import { currentOptions, currentSpend, hasApiKey, keyHowto, keyStateText, likely, logFolder, readKeychainKey, readLogPieces } from './likely'
import { hasKeyCommand } from '../system/setup'
import { METHOD_VERSION } from './method'
import { calibrationLines, calibrationOf, predicatePairs, readLog, robustnessLines, spreadBins, taskCounts, variantSummary } from './record'
import type { LoggedDecision } from './record'

/** At session.start: `/likely`. */
export async function registerLikelyCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'likely',
    description: 'likely(Haiku로 확률 판정): 질문이나 글을 주면 예일 확률 · stats [task] 기록 통계 · export 기록 zip (hubblerc)',
    argumentHint: '<질문> | stats [task] | export',
    immediate: true,
  })
}

export function answerLikelyCommand(on: On): void {
  on('command.run', { command: 'likely' }, async ($, e) => ({
    text: await runLikelyCommand($, e.args).catch((error: unknown) => `판정 명령을 마치지 못했습니다: ${String(error)}`),
  }))
}

/**
 * `/likely stats [task]` and `/likely export`; any other text is a question (or a statement) decided
 * at once; nothing, how to use it. With no key yet, the keychain is read again first: a key added
 * there works without a reload.
 */
export async function runLikelyCommand($: EngineInterface, args: string): Promise<string> {
  const text = args.trim()
  const [word = '', ...rest] = text.split(/\s+/)
  if (word === 'stats') return statsText($, rest[0])
  if (word === 'export') return exportLog($)
  if (!hasApiKey()) await readKeychainKey($).catch(() => undefined)
  if (text !== '') return askOnce($, text)

  return usageText($)
}

async function usageText($: EngineInterface): Promise<string> {
  const folder = await logFolder($).catch(() => '(알 수 없음)')

  return [
    '/likely <질문이나 글>  예일(참일) 확률을 판정 하나로. 키 확인용, 크레딧이 듭니다. 예) /likely 이 명령은 실패할까: ls /없는경로',
    '/likely stats [task]   판정 기록 통계: task별 건수·정답 수, 비용, bash-fail의 calibration(Brier·ECE·정확도)',
    '/likely export         기록 폴더를 zip으로 묶기',
    `API 키: ${keyStateText()} · 기록 폴더: ${folder}`,
    keyHowto(await hasKeyCommand($).catch(() => false)),
  ].join('\n')
}

/** Every machine's log in the folder, read into decisions by id. */
async function readAllLogs($: EngineInterface): Promise<{ folder: string; files: number; decisions: Map<string, LoggedDecision> }> {
  const folder = await logFolder($)
  const decisions = new Map<string, LoggedDecision>()
  if (!(await $.fs.exists(folder).catch(() => false))) return { folder, files: 0, decisions }
  const entries = await $.fs.list(folder)
  const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
  for (const file of files) await readLogPieces($, `${folder}/${file.name}`, piece => readLog(piece, decisions))

  return { folder, files: files.length, decisions }
}

/**
 * `/likely stats [task]`: decisions and outcomes by task (every machine's log in the folder), this
 * machine's spend against its limits, and a predicate task's calibration (bash-fail unless named),
 * with thinking off and on apart.
 */
async function statsText($: EngineInterface, task: string | undefined): Promise<string> {
  const { folder, files, decisions } = await readAllLogs($)
  const all = [...decisions.values()]
  const counts = taskCounts(all).filter(entry => task === undefined || entry.task === task)
  const lines = [`판정 기록: ${folder} (파일 ${files}개)`]
  if (counts.length === 0) {
    lines.push(task === undefined ? '  기록된 판정이 없습니다.' : `  ${task} 판정이 없습니다.`)
  } else {
    lines.push('task별 판정 건수 (정답 붙은 수)')
    const width = Math.max(...counts.map(entry => entry.task.length))
    for (const entry of counts) lines.push(`  ${entry.task.padEnd(width)}  ${String(entry.count).padStart(6)}건 (${entry.withOutcome})`)
  }

  const options = currentOptions()
  const spend = await currentSpend($)
  lines.push(
    `비용(이 기기): 오늘 ${spend.dayCount}건 $${spend.dayUsd.toFixed(2)} / runaway cap ${dollars(options.dailyCapUsd)} · 이번 주기(${spend.period}부터) ${spend.periodCount}건 $${spend.periodUsd.toFixed(2)} / 예산 ${dollars(options.budgetUsd)}`,
  )

  const target = task ?? BASH_TASK
  const current = (decision: LoggedDecision) => decision.methodVersion === METHOD_VERSION
  const pairs = predicatePairs(all, target, current)
  const older = predicatePairs(all, target, decision => !current(decision)).length
  lines.push('', `${target} calibration (판정 방식 v${METHOD_VERSION}${older > 0 ? `, 다른 버전 ${older}건 제외` : ''})`)
  lines.push(...calibrationLines('  전체', calibrationOf(pairs)))
  for (const [label, thinking] of [
    ['thinking 끔', false],
    ['thinking low', true],
  ] as const) {
    const part = calibrationOf(predicatePairs(all, target, decision => current(decision) && decision.thinking === thinking))
    lines.push(calibrationLines(`  ${label}`, part)[0] ?? '')
  }
  lines.push('', ...robustnessLines(spreadBins(all, target, current), variantSummary(all, target, current)))

  return lines.join('\n')
}

/** `/likely export`: the log folder in a zip, in Downloads (else the home folder). */
async function exportLog($: EngineInterface): Promise<string> {
  const folder = await logFolder($)
  if (!(await $.fs.exists(folder).catch(() => false))) return `판정 기록이 아직 없습니다: ${folder}`
  const home = (await $.env.get('HOME')) ?? ''
  const downloads = `${home}/Downloads`
  const into = (await $.fs.exists(downloads).catch(() => false)) ? downloads : home
  const out = `${into}/hubblerc-likely-${stamp(await $.clock.now())}.zip`
  const cut = folder.lastIndexOf('/')
  const ran = await $.process.run(['/usr/bin/zip', '-r', '-q', '-X', out, folder.slice(cut + 1)], { cwd: cut <= 0 ? '/' : folder.slice(0, cut), timeoutMs: 120_000 })
  if (ran.exitCode !== 0) return `zip이 실패했습니다(${ran.exitCode}): ${ran.stderr.trim()}`

  return `판정 기록을 묶었습니다: ${out}`
}

/** The one question `/likely <글>` asks of its text. */
export const ASK_QUESTION = {
  type: 'predicate' as const,
  name: 'yes',
  instructions: 'The input is a yes-or-no question, or a statement. Answer the question; for a statement, whether it is true.',
}

/** `/likely <글>`: one predicate on the text, decided and shown call by call. */
async function askOnce($: EngineInterface, text: string): Promise<string> {
  if (!hasApiKey()) return `Anthropic API 키가 없어 판정하지 않습니다.\n${keyHowto(await hasKeyCommand($).catch(() => false))}`
  const result = await likely($, { task: 'ask', input: text, questions: [ASK_QUESTION] })
  if ('skipped' in result) return result.reason
  const answer = result.answers[0]
  const head =
    answer?.type === 'predicate'
      ? `예일 확률 ${answer.probability.toFixed(2)} (${answer.value ? '예' : '아니오'})`
      : answer?.type === 'refusal'
        ? '모든 호출이 거절했습니다'
        : '답 없음'
  const calls = result.raw.map(call => (call.distributions !== undefined ? (call.distributions[0]?.[0] ?? 0).toFixed(2) : call.refused === true ? '거절' : `실패(${call.error ?? ''})`))
  const seconds = (result.latencyMs / 1000).toFixed(1)

  return [
    `likely: ${head} · 호출 ${result.samples}/${result.raw.length} · ${seconds}초 · ${result.model}`,
    `호출별 예일 확률: ${calls.join(' · ')}`,
    ...result.spread.slice(0, 1).map(spread => `spread(호출 ${result.samples}개): 최대−최소 ${spread.range.toFixed(2)} · 표준편차 ${spread.sd.toFixed(2)}`),
    `토큰: 입력 ${result.tokens.input} · 출력 ${result.tokens.output} · 캐시 읽기 ${result.tokens.cacheRead} · 비용 $${result.costUsd.toFixed(5)}`,
    result.logPath !== undefined ? `기록: ${result.logPath} (${result.id})` : `기록하지 못했습니다: ${result.logError ?? ''}`,
    'Console의 Billing에서 크레딧이 줄었는지 확인해 보세요.',
  ].join('\n')
}

/** `20261104-153012`, local time. */
function stamp(ms: number): string {
  const date = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

