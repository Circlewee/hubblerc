import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStepResult } from 'claude-code'

import type { EffortSample, EffortSource } from '../types'
import { autoLevelFor, isAutoOn } from './auto-effort'

const effortOverride = atom({ plugin: 'hubblerc', key: 'effortOverride' } as const, null)
const engineEffort = atom({ plugin: 'hubblerc', key: 'engineEffort' } as const, null)
const effortLog = atom({ plugin: 'hubblerc', key: 'effortLog' } as const, [])

const MAX_SAMPLES = 300

/**
 * Sends this session's main-loop requests with the effort the slider chose, else auto's pick for
 * the turn, else the engine's; keeps track of the engine's own effort so the band can show it, and
 * logs each request's effort and tokens (`/effort-log`), to see what a change of effort costs.
 *
 * Session only: the engine's setting (and other sessions) are untouched.
 */
export function controlEffort(on: On, autoByDefault: boolean): void {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || e.effort === undefined) return yield* next(e)

    const engine = String(e.effort)
    if ((await read($, engineEffort)) !== engine) await update($, engineEffort, () => engine)

    let effort = e.effort
    let source: EffortSource = 'engine'
    const override = await read($, effortOverride)
    if (override !== null) {
      effort = override
      source = 'manual'
    } else if (await isAutoOn($, autoByDefault)) {
      const picked = await autoLevelFor($, e.turnId, e.index).catch(() => undefined)
      if (picked !== undefined) {
        effort = picked
        source = 'auto'
      }
    }

    const result: TurnStepResult = yield* next(effort === e.effort ? e : { ...e, effort })
    await logRequest($, { turnId: e.turnId, index: e.index, effort: String(effort), source }, result).catch(() => undefined)

    return result
  })
}

async function logRequest($: EngineInterface, sent: Pick<EffortSample, 'turnId' | 'index' | 'effort' | 'source'>, result: TurnStepResult): Promise<void> {
  const usage = result.usage
  if (usage === null) return

  const sample: EffortSample = {
    ...sent,
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    output: usage.output_tokens,
  }
  await update($, effortLog, log => [...log, sample].slice(-MAX_SAMPLES))
}

/** At session.start: before the first request, the engine's effort is what settings say for the model. */
export async function startEffort($: EngineInterface): Promise<void> {
  const [modelId, level, perModel] = await Promise.all([
    $.session.model(),
    $.settings.read({ key: 'effortLevel' }),
    $.settings.read({ key: 'modelSettings' }),
  ])
  const known = modelEffort(perModel, modelId) ?? (typeof level === 'string' ? level : null)
  if (known !== null) await update($, engineEffort, previous => previous ?? known)
}

/** `modelSettings[<model>].effortLevel`, the model's id matched with or without a `[1m]` suffix. */
export function modelEffort(perModel: unknown, modelId: string): string | null {
  if (typeof perModel !== 'object' || perModel === null) return null
  const id = modelId.replace(/\[.*\]$/, '')
  const entry = (perModel as Record<string, unknown>)[id]
  if (typeof entry !== 'object' || entry === null) return null
  const level = (entry as Record<string, unknown>).effortLevel

  return typeof level === 'string' ? level : null
}
