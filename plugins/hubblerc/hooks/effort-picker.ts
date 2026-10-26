import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { EffortLevel } from '../types'
import { isEffortLevel } from './band-format'

const effortOverride = atom({ plugin: 'hubblerc', key: 'effortOverride' } as const, null)
const effortPicker = atom({ plugin: 'hubblerc', key: 'effortPicker' } as const, null)
const effortAuto = atom({ plugin: 'hubblerc', key: 'effortAuto' } as const, null)

/**
 * The engine keybinding action the effort control answers to. A mod cannot add a keybinding of its
 * own, but a Button naming an engine action is pressed by the person's chord for that action from
 * the prompt while the Button is drawn; this one belongs to the diff panel, whose own handler only
 * takes it while that panel is open. ~/.claude/keybindings.json binds ctrl+x ctrl+e to it (taken from
 * the external editor, which ctrl+g still opens): a chord of control keys, which no input method holds
 * back. A letter after ctrl+x waits in the Korean composer, a single control key (ctrl+q, ctrl+t)
 * never reached the button, and Option+E types an accent on macOS.
 */
export const EFFORT_KEY_ACTION = 'app:cycleDiffBase'
/** The slider closes by itself after this long. */
const PICKER_OPEN_MS = 10_000

/** Opens the effort slider in the band, or closes it when open. Open, it closes by itself later. */
export async function togglePicker($: EngineInterface): Promise<void> {
  if ((await read($, effortPicker)) !== null) {
    await update($, effortPicker, () => null)

    return
  }

  const openedAt = await $.clock.now()
  await update($, effortPicker, () => openedAt)
  $.clock.after(PICKER_OPEN_MS, () => {
    void update($, effortPicker, current => (current === openedAt ? null : current))
  })
}

/**
 * Sends this session's requests at `level` from now on, or at auto's pick for each question
 * (`auto`), or at the engine's (null); and closes the slider.
 */
export async function choose($: EngineInterface, level: EffortLevel | 'auto' | null): Promise<void> {
  await update($, effortOverride, () => (level !== null && level !== 'auto' && isEffortLevel(level) ? level : null))
  await update($, effortAuto, () => level === 'auto')
  await update($, effortPicker, () => null)
}

/** At a main-loop turn's start: a slider left open closes. */
export async function closeEffortPicker($: EngineInterface): Promise<void> {
  if ((await read($, effortPicker)) !== null) await update($, effortPicker, () => null)
}
