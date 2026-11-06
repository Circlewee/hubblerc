import type { EffortLevel } from '../../types'

export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function isEffortLevel(value: unknown): value is EffortLevel {
  return EFFORT_LEVELS.some(level => level === value)
}
