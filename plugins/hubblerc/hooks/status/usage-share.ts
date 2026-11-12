import type { RateWindow, UsageSnapshot } from '../../types'
import { isRecord } from '../shared/values'

/** What the sessions share under `$.store`: the account's windows as the latest response of any of them reported. */
export const USAGE_SHARED_KEY = 'usageWindows'
/** Mid-answer, a session writes its reading at most this often; as its answer ends, at once. */
export const USAGE_SHARE_GAP_MS = 30_000

/**
 * The 5-hour and 7-day windows a response reported and when it came (`$.clock.now()`), whichever
 * session it answered. The windows count the account, and a session knows only what its own last
 * response said: an idle one learns here what the others used, with no request made.
 */
export type SharedUsage = { fiveHour?: RateWindow; sevenDay?: RateWindow; at: number }

function windowOf(value: unknown): RateWindow | undefined {
  if (!isRecord(value) || typeof value.percent !== 'number' || !Number.isFinite(value.percent)) return undefined

  return { percent: value.percent, ...(typeof value.resetsAt === 'string' ? { resetsAt: value.resetsAt } : {}) }
}

/** The store's record as far as it holds: null when unset or not of that shape. */
export function readSharedUsage(value: unknown): SharedUsage | null {
  if (!isRecord(value) || typeof value.at !== 'number' || !Number.isFinite(value.at)) return null
  const fiveHour = windowOf(value.fiveHour)
  const sevenDay = windowOf(value.sevenDay)

  return { ...(fiveHour === undefined ? {} : { fiveHour }), ...(sevenDay === undefined ? {} : { sevenDay }), at: value.at }
}

/** A session's own reading as a record to share; null when it has neither window (an API key, a fresh session). */
export function sharedFrom(own: UsageSnapshot, at: number): SharedUsage | null {
  if (own.fiveHour === undefined && own.sevenDay === undefined) return null

  return { ...(own.fiveHour === undefined ? {} : { fiveHour: own.fiveHour }), ...(own.sevenDay === undefined ? {} : { sevenDay: own.sevenDay }), at }
}

/** Whether two records hold the same windows, whenever each was read. */
export function hasSameWindows(a: SharedUsage | null, b: SharedUsage | null): boolean {
  const windows = (record: SharedUsage | null) => JSON.stringify([record?.fiveHour ?? null, record?.sevenDay ?? null])

  return windows(a) === windows(b)
}

/**
 * A session's own reading with the shared windows in place of its own, when the shared ones are
 * newer (`ownAt`: when this session's last response came, 0 none yet). A shared window whose reset
 * is past is left out, as the engine leaves its own; one the shared record lacks stays the session's.
 */
export function withSharedUsage(own: UsageSnapshot, ownAt: number, shared: SharedUsage | null, now: number): UsageSnapshot {
  if (shared === null || shared.at <= ownAt) return own
  const live = (window: RateWindow | undefined) => (window === undefined || (window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now) ? undefined : window)
  const fiveHour = live(shared.fiveHour) ?? own.fiveHour
  const sevenDay = live(shared.sevenDay) ?? own.sevenDay
  const { fiveHour: _five, sevenDay: _seven, limits: ownLimits, modelLimits, ...rest } = own
  // The windows the engine named, with the shared readings: `/effort-log` lists them, and the 5h dash goes by them.
  const limits = (ownLimits ?? []).filter(limit => limit.kind !== 'five_hour' && limit.kind !== 'seven_day')
  if (fiveHour !== undefined) limits.push({ kind: 'five_hour', percent: fiveHour.percent })
  else limits.push(...(ownLimits ?? []).filter(limit => limit.kind === 'five_hour'))
  if (sevenDay !== undefined) limits.push({ kind: 'seven_day', percent: sevenDay.percent })
  else limits.push(...(ownLimits ?? []).filter(limit => limit.kind === 'seven_day'))

  return {
    ...rest,
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(sevenDay === undefined ? {} : { sevenDay }),
    limits,
    ...(modelLimits === undefined ? {} : { modelLimits }),
  }
}
