import type { ModelLimit } from '../../types'
import { isRecord } from '../shared/values'

/** Where `/usage` reads its figures: the weekly limits of single models are here, not in `$.session.usage()`. */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
/** A name longer than this is cut: the sidebar pads every usage label to the longest. */
const NAME_CELLS = 8

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
