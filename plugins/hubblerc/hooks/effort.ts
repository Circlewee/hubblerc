import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

const effortOverride = atom({ plugin: 'hubblerc', key: 'effortOverride' } as const, null)
const engineEffort = atom({ plugin: 'hubblerc', key: 'engineEffort' } as const, null)

/**
 * Sends this session's main-loop requests with the effort the band chose, in place of the engine's,
 * and keeps track of the engine's own effort so the band can show it.
 *
 * Session only: the engine's setting (and other sessions) are untouched.
 */
export function controlEffort(on: On): void {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || e.effort === undefined) return yield* next(e)

    const sent = String(e.effort)
    if ((await read($, engineEffort)) !== sent) await update($, engineEffort, () => sent)

    const override = await read($, effortOverride)

    return yield* next(override === null ? e : { ...e, effort: override })
  })
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
