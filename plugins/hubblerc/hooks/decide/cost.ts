/**
 * What decisions cost, counted from each response's usage, and the totals kept per machine: today's,
 * a runaway guard (the daily cap), and the budget period's, the measure the budget is managed by.
 * Pure: the engine side keeps the totals in `$.store`.
 */

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Claude Haiku 5.5's prices in dollars per million tokens: $0.10 in and $0.50 out while the prompt is
 * 100K tokens or fewer, $0.50 and $2.50 above; a cache read is 0.1x the input price, a five-minute
 * cache write 1.25x. Source: the claude-api skill's model table and its Haiku 5.5 migration notes
 * (cached 2026-10-06), which follow https://platform.claude.com/docs/en/about-claude/pricing; check
 * there before trusting a bill to them. Another model set in the options is counted at these prices too.
 */
export const HAIKU_PRICES = {
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  longInputPerMTok: 0.5,
  longOutputPerMTok: 2.5,
  longPromptTokens: 100_000,
  cacheReadFactor: 0.1,
  cacheWriteFactor: 1.25,
} as const

/** A response's usage as the Messages API reports it; zero for what it leaves out. */
export function tokensOf(body: unknown): Tokens {
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {}
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
  }
}

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }
}

/** One call's cost in dollars: the long-prompt rates once the prompt (input and cache together) passes 100K tokens. */
export function costOf(tokens: Tokens): number {
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
  const isLong = prompt > HAIKU_PRICES.longPromptTokens
  const input = isLong ? HAIKU_PRICES.longInputPerMTok : HAIKU_PRICES.inputPerMTok
  const output = isLong ? HAIKU_PRICES.longOutputPerMTok : HAIKU_PRICES.outputPerMTok

  return (tokens.input * input + tokens.cacheRead * input * HAIKU_PRICES.cacheReadFactor + tokens.cacheWrite * input * HAIKU_PRICES.cacheWriteFactor + tokens.output * output) / 1_000_000
}

/**
 * The totals kept on this machine: the day's (local date) and the budget period's (from its start
 * date), and the day and period a toast already said a limit was reached in.
 */
export type Spend = {
  day: string
  dayUsd: number
  dayCount: number
  period: string
  periodUsd: number
  periodCount: number
  warnedDay?: string
  warnedPeriod?: string
}

/** The decide options' figures the limits are checked against. */
export type Limits = { dailyCapUsd: number; budgetUsd: number; periodStartDay: number }

/** The local date of a time, `2026-11-04`. */
export function localDay(ms: number): string {
  const date = new Date(ms)

  return dayText(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * The first day of the budget period a time falls in: the latest date on or before it whose day of
 * the month is the start day (the month's last day where the month is shorter).
 */
export function periodStart(ms: number, startDay: number): string {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = date.getMonth()
  const thisStart = Math.min(startDay, daysIn(year, month))
  if (date.getDate() >= thisStart) return dayText(year, month, thisStart)
  const previous = new Date(year, month - 1, 1)

  return dayText(previous.getFullYear(), previous.getMonth(), Math.min(startDay, daysIn(previous.getFullYear(), previous.getMonth())))
}

/** The stored totals as they stand at `now`: a new day or a new period starts again from zero. */
export function spendAt(stored: unknown, now: number, startDay: number): Spend {
  const day = localDay(now)
  const period = periodStart(now, startDay)
  const held = isRecord(stored) ? stored : {}
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
  const sameDay = held.day === day
  const samePeriod = held.period === period
  const spend: Spend = {
    day,
    dayUsd: sameDay ? number(held.dayUsd) : 0,
    dayCount: sameDay ? number(held.dayCount) : 0,
    period,
    periodUsd: samePeriod ? number(held.periodUsd) : 0,
    periodCount: samePeriod ? number(held.periodCount) : 0,
  }
  if (typeof held.warnedDay === 'string') spend.warnedDay = held.warnedDay
  if (typeof held.warnedPeriod === 'string') spend.warnedPeriod = held.warnedPeriod

  return spend
}

/** A decision's cost added; `counts` false for one that answered nothing. */
export function addSpend(spend: Spend, usd: number, counts: boolean): Spend {
  const n = counts ? 1 : 0

  return { ...spend, dayUsd: spend.dayUsd + usd, dayCount: spend.dayCount + n, periodUsd: spend.periodUsd + usd, periodCount: spend.periodCount + n }
}

/** Which limit stops decisions now, the period's budget first. */
export function limitReached(spend: Spend, limits: Limits): 'budget' | 'daily-cap' | null {
  if (spend.periodUsd >= limits.budgetUsd) return 'budget'
  if (spend.dayUsd >= limits.dailyCapUsd) return 'daily-cap'

  return null
}

/** `$100` for whole dollars, `$1.50` otherwise. */
export function dollars(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`
}

/** The sidebar's line: `판정 오늘 12건 · 이번 달 $0.42 / $100`. */
export function statusLine(status: { todayCount: number; periodUsd: number; budgetUsd: number }): string {
  return `판정 오늘 ${status.todayCount}건 · 이번 달 $${status.periodUsd.toFixed(2)} / ${dollars(status.budgetUsd)}`
}

function daysIn(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function dayText(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
