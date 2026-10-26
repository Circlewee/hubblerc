import type { FiveHourPoint, RateWindow, TokenTotals } from '../types'

/** Readings older than this are dropped. */
const KEEP_MS = 2 * 60 * 60_000
const MAX_POINTS = 240
/** The pace is measured over the last hour... */
const PACE_WINDOW_MS = 60 * 60_000
/** ...once it spans ten minutes and two points, so one jump raises no alarm. */
const MIN_SPAN_MS = 10 * 60_000
const MIN_RISE = 2
/** The burn-out chip shows only when the window would run out within this many minutes, before it resets. */
export const BURNOUT_HORIZON_MIN = 60
/** Two readings of one window may name its reset a little apart. */
const SAME_RESET_MS = 10 * 60_000

/**
 * The log with the window's reading added, when it moved since the last one (the percent, or the
 * reset that starts a new window); null when nothing changed, so the caller writes nothing.
 */
export function addFiveHourPoint(log: readonly FiveHourPoint[], window: RateWindow | undefined, now: number): FiveHourPoint[] | null {
  if (window === undefined) return null
  const last = log.at(-1)
  if (last !== undefined && last.percent === window.percent && isSameWindow(last.resetsAt, window.resetsAt)) return null

  const point: FiveHourPoint = { at: now, percent: window.percent, ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }) }

  return [...log.filter(old => now - old.at <= KEEP_MS), point].slice(-MAX_POINTS)
}

/**
 * Minutes until the 5-hour window runs out at the pace of the last hour, when that is within
 * `BURNOUT_HORIZON_MIN` and before the window resets; else null.
 *
 * The pace runs to now, so it slows while nothing is used. Readings are whole points: the pace is
 * only trusted once it rose two points over ten minutes.
 */
export function burnoutMinutes(log: readonly FiveHourPoint[], window: RateWindow | undefined, now: number): number | null {
  if (window === undefined || window.percent >= 100) return null

  const points = log.filter(point => isSameWindow(point.resetsAt, window.resetsAt) && point.at <= now)
  const windowStart = now - PACE_WINDOW_MS
  // The reading that stood an hour ago counts from then; else the first one since.
  const before = points.filter(point => point.at <= windowStart).at(-1)
  const base = before !== undefined ? { at: windowStart, percent: before.percent } : points[0]
  if (base === undefined) return null

  const span = now - base.at
  const rise = window.percent - base.percent
  if (span < MIN_SPAN_MS || rise < MIN_RISE) return null

  const msLeft = ((100 - window.percent) * span) / rise
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000))
  if (minutes > BURNOUT_HORIZON_MIN) return null

  const reset = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt)
  if (Number.isFinite(reset) && now + msLeft >= reset) return null

  return minutes
}

function isSameWindow(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  const gap = Math.abs(Date.parse(a) - Date.parse(b))

  return Number.isFinite(gap) ? gap <= SAME_RESET_MS : a === b
}

/**
 * The clock time of the last main-loop request (`14:32`), on the machine's clock: right however
 * long it stands undrawn, as "N분 전" was not. Null before one.
 */
export function requestTime(lastRequestAt: number | null): string | null {
  if (lastRequestAt === null) return null
  const at = new Date(lastRequestAt)

  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/**
 * How much of an answer's prompts the cache served, in whole percent: what it read from the cache
 * over all it was sent. Low means the cache was cold or missed, and the answer cost the more.
 * Null with nothing known.
 */
export function cacheShare(tokens: TokenTotals | undefined): number | null {
  if (tokens === undefined) return null
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite

  return prompt === 0 ? null : Math.round((tokens.cacheRead / prompt) * 100)
}

/** A token count, short: `850`, `1.2k`, `12k`, `1.3M`. */
export function tokenCount(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${trimZero((count / 1000).toFixed(1))}k`
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`

  return `${trimZero((count / 1_000_000).toFixed(1))}M`
}

function trimZero(text: string): string {
  return text.replace(/\.0$/, '')
}

/** The totals with one request's tokens added. */
export function addTokens(totals: TokenTotals | undefined, request: TokenTotals): TokenTotals {
  return {
    input: (totals?.input ?? 0) + request.input,
    cacheRead: (totals?.cacheRead ?? 0) + request.cacheRead,
    cacheWrite: (totals?.cacheWrite ?? 0) + request.cacheWrite,
    output: (totals?.output ?? 0) + request.output,
  }
}

/** Points of the window a turn took: the reading after it less the one before, in the same window; null when unknown. */
export function pointsUsed(before: RateWindow | undefined, after: RateWindow | undefined): number | null {
  if (before === undefined || after === undefined || !isSameWindow(before.resetsAt, after.resetsAt)) return null

  return Math.max(0, Math.round(after.percent - before.percent))
}
