import type { ModelLimit } from '../../types'
import { isRecord } from '../shared/values'

/** Where `/usage` reads its figures: the weekly limits of single models are here, not in `$.session.usage()`. */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
/** A name longer than this is cut: the sidebar pads every usage label to the longest. */
const NAME_CELLS = 8
/** The endpoint is asked at most this often, by all the sessions that share the store together. */
export const MODEL_LIMITS_GAP_MS = 5 * 60_000
/** Refused (429, 403), it is left alone this long at least and an hour at most, as the engine's own `/usage` leaves it. */
const REFUSAL_MAX_MS = 60 * 60_000
/** What the sessions share under `$.store`: one asks, the others take what it learned. */
export const MODEL_LIMITS_KEY = 'modelLimits'

/**
 * What the last ask of the usage endpoint learned, whichever session made it: the limits, when the
 * endpoint may be asked next, and how many times in a row it refused.
 */
export type SharedModelLimits = { limits: ModelLimit[]; nextAt: number; refusals: number }

/** The store's record as far as it holds: null when unset or not of that shape. */
export function readSharedModelLimits(value: unknown): SharedModelLimits | null {
  if (!isRecord(value) || !Array.isArray(value.limits) || typeof value.nextAt !== 'number' || !Number.isFinite(value.nextAt)) return null
  const limits: ModelLimit[] = []
  for (const limit of value.limits) {
    if (!isRecord(limit) || typeof limit.name !== 'string' || typeof limit.percent !== 'number') continue
    limits.push({ name: limit.name, percent: limit.percent, ...(typeof limit.resetsAt === 'string' ? { resetsAt: limit.resetsAt } : {}) })
  }

  return { limits, nextAt: value.nextAt, refusals: typeof value.refusals === 'number' && value.refusals > 0 ? Math.floor(value.refusals) : 0 }
}

/**
 * How long a refusing endpoint is left alone: its `retry-after` (seconds) when it names one, else
 * the gap doubled with each refusal in a row; never under the gap, never over an hour.
 */
export function refusalWaitMs(headers: Record<string, string>, refusals: number): number {
  const seconds = Number(headers['retry-after'])
  const asked = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : MODEL_LIMITS_GAP_MS * 2 ** Math.max(0, refusals - 1)

  return Math.min(REFUSAL_MAX_MS, Math.max(MODEL_LIMITS_GAP_MS, asked))
}

/**
 * The weekly limits that count one model alone (`/usage`'s "Current week (Fable)"), from the usage
 * endpoint's answer: its `limits` of kind `weekly_scoped` that name a model. Null when the answer
 * cannot be read (what was known stays); empty when the account has none.
 */
export function parseModelLimits(text: string): ModelLimit[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) return null
  if (!Array.isArray(parsed.limits)) return []
  const found: ModelLimit[] = []
  for (const limit of parsed.limits) {
    if (!isRecord(limit) || limit.kind !== 'weekly_scoped' || typeof limit.percent !== 'number' || !Number.isFinite(limit.percent)) continue
    const model = isRecord(limit.scope) ? limit.scope.model : undefined
    const name = isRecord(model) && typeof model.display_name === 'string' ? model.display_name.trim() : ''
    if (name === '') continue
    found.push({ name: name.slice(0, NAME_CELLS), percent: limit.percent, ...(typeof limit.resets_at === 'string' ? { resetsAt: limit.resets_at } : {}) })
  }

  return found
}
