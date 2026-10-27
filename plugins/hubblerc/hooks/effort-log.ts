import type { AutoPick, EffortSample, EffortSource, TurnRecord, UsageSnapshot } from '../types'

const SOURCE_LABELS: Record<EffortSource, string> = { engine: '엔진', manual: '직접', auto: 'auto' }

/**
 * The `/effort-log` table: the last main-loop requests with the effort each went out with and its
 * tokens, then how much of the prompt the cache served right after a change of effort and otherwise,
 * the measure of what auto effort's switching costs.
 */
export function effortLogTable(samples: readonly EffortSample[], list: readonly TurnRecord[], pick: AutoPick | null, shown = 20): string {
  if (samples.length === 0) return '아직 기록된 모델 요청이 없습니다.'

  const numbers = new Map(list.map((turn, i) => [turn.id, i + 1]))
  const rows = samples.slice(-shown).map(sample => {
    const number = numbers.get(sample.turnId)
    const effort = `${SOURCE_LABELS[sample.source]} ${sample.effort}`

    return [
      (number === undefined ? '#?' : `#${number}`).padEnd(5),
      String(sample.index).padStart(4),
      effort.padEnd(12),
      count(sample.input).padStart(8),
      count(sample.cacheRead).padStart(10),
      count(sample.cacheWrite).padStart(10),
      count(sample.output).padStart(8),
    ].join('  ')
  })

  const header = ['답변 ', '요청', 'effort      ', '    입력', ' 캐시 읽기', ' 캐시 쓰기', '    출력'].join('  ')
  const lines = [`요청별 effort (전체 ${samples.length}개 중 최근 ${rows.length}개)`, header, ...rows, '', cacheSummary(samples)]
  if (pick !== null) lines.push(`마지막 auto 판정: ${pick.level} (${(pick.ms / 1000).toFixed(1)}s)`)

  return lines.join('\n')
}

/**
 * Which rate-limit windows the engine handed over (`$.session.usage()`, the status line's figures),
 * and the usual two it left out: `엔진이 준 한도: seven_day 52% (five_hour 없음)`. What tells a
 * window the account lacks, or the engine has not had, from one hubblerc failed to draw.
 */
export function limitsLine(usage: UsageSnapshot | null): string {
  if (usage === null) return '엔진이 준 한도: 아직 읽지 못함'
  const limits = usage.limits ?? []
  const given = limits.map(limit => `${limit.kind} ${limit.percent}%`)
  const missing = ['five_hour', 'seven_day'].filter(kind => !limits.some(limit => limit.kind === kind))
  const listed = given.length === 0 ? '없음' : given.join(', ')

  return `엔진이 준 한도: ${listed}${missing.length === 0 || given.length === 0 ? '' : ` (${missing.map(kind => `${kind} 없음`).join(', ')})`}`
}

/** The cache's share of each request's prompt, averaged over requests right after a change of effort and the rest. */
export function cacheSummary(samples: readonly EffortSample[]): string {
  const changed: number[] = []
  const same: number[] = []
  samples.forEach((sample, i) => {
    const before = samples[i - 1]
    if (before === undefined) return
    const prompt = sample.input + sample.cacheRead + sample.cacheWrite
    if (prompt === 0) return
    ;(sample.effort === before.effort ? same : changed).push(sample.cacheRead / prompt)
  })

  return `캐시 읽기 비율: effort가 바뀐 직후 ${share(changed)} · 그대로인 요청 ${share(same)}`
}

function share(ratios: readonly number[]): string {
  if (ratios.length === 0) return '0건'
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length

  return `${ratios.length}건 평균 ${Math.round(mean * 100)}%`
}

function count(value: number): string {
  return value.toLocaleString('en-US')
}
