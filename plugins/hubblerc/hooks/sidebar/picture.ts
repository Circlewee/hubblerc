import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import { isSidebarShown, SIDEBAR_ID } from '../shared/pane'

/**
 * The cat's picture in the sidebar's device box: whether the terminal draws it (the probe), and
 * sending it again as the person comes back (a terminal can drop one it drew).
 */

const catPicture = atom({ plugin: 'hubblerc', key: 'catPicture' } as const, 'unknown')

/** The cat as a picture: as tall as the lines beside it. */
export const PICTURE_ROWS = 5
/** The picture's key in the drawing: what a blit names. */
export const PICTURE_KEY = 'cat-picture'
/** A blit refused because the terminal drew the picture's `alt`: no placeholder images, or a file it cannot read. */
const NO_PICTURE = /placeholder|\balt\b|cannot read/i
/** The picture the sidebar last drew, for the probe to send again; null while it draws none. */
let drawnPicture: { source: { png: string }; columns: number; rows: number } | null = null

/**
 * Whether the terminal draws the cat's picture: once the sidebar has drawn one, a blit of the same
 * source answers. Refused for the `alt`, the cat goes and the lines stand alone (the sidebar redraws on
 * the write); refused for anything else (not mounted yet), the next second asks again. Asked from
 * a timer: a render hook writes no state.
 */
async function probePicture($: EngineInterface): Promise<boolean> {
  if ((await read($, catPicture)) !== 'unknown') return true
  const drawn = drawnPicture
  if (drawn === null) return false
  const result = await $.ui.blit({ requestId: SIDEBAR_ID, key: PICTURE_KEY, ...drawn }).catch((error: unknown) => ({ deny: String(error) }))
  if (result.deny !== undefined && !NO_PICTURE.test(result.deny)) return false
  if (result.deny === undefined) {
    sentPicture = drawn.source.png
    sentAt = await $.clock.now()
  }
  await update($, catPicture, () => (result.deny === undefined ? 'shown' : 'blocked'))

  return true
}

const PROBE_MS = 1000
/** Seconds the probe waits for a drawn picture before it stops; the sidebar's next drawing starts it again. */
const PROBE_IDLE_TICKS = 10
let probeTimer: Timer | null = null

/**
 * Asks each second whether the terminal draws the picture, till it has said. With no picture drawn
 * for ten seconds (a band layout, a closed sidebar) it stops rather than wake each second all
 * session; the sidebar's next drawing of a picture starts it again while that is not known.
 */
function startProbe($: EngineInterface): void {
  if (probeTimer !== null) return
  let idleTicks = 0
  const stop = () => {
    timer.cancel()
    if (probeTimer === timer) probeTimer = null
  }
  const timer = $.clock.every(PROBE_MS, () => {
    idleTicks = drawnPicture === null ? idleTicks + 1 : 0
    void probePicture($)
      .then(isKnown => {
        if (isKnown || idleTicks >= PROBE_IDLE_TICKS) stop()
      })
      .catch(() => undefined)
  })
  probeTimer = timer
}

/**
 * How long after the picture was last sent a sign of the person back sends it again: keys typed
 * one after another send it once.
 */
const RESEND_GAP_MS = 10_000
/** The picture last sent to the terminal (a new frame drawn, or a blit) and when. */
let sentPicture: string | null = null
let sentAt = Number.NEGATIVE_INFINITY
/** A resend under way: the keys typed meanwhile start none. */
let isResending = false

/**
 * As the person shows they are back (a key in the prompt box, a question; register.tsx): the cat's
 * picture sent again, if ten seconds have gone since it last was and the sidebar shows. Orca drops
 * a picture while its tab is hidden behind another, and a drawing with an unchanged source sends
 * nothing, so an idle cat stays blank till this; a moving cat's new frames are sent anyway. No
 * timer: a sidebar woken every two seconds to send it cost more than all else idle (2026-11-06).
 * Once the sidebar is closed or hidden the picture is forgotten, so the keys after it ask nothing;
 * the sidebar's next drawing records it again.
 */
export async function resendPicture($: EngineInterface): Promise<void> {
  const drawn = drawnPicture
  if (drawn === null || isResending) return
  isResending = true
  try {
    const now = await $.clock.now()
    if (now - sentAt < RESEND_GAP_MS) return
    if ((await read($, catPicture)) !== 'shown') return
    if (!(await isSidebarShown($))) {
      if (drawnPicture === drawn) drawnPicture = null

      return
    }
    await $.ui.blit({ requestId: SIDEBAR_ID, key: PICTURE_KEY, ...drawn })
    sentPicture = drawn.source.png
    sentAt = now
  } finally {
    isResending = false
  }
}

/** At session.start: each second till the terminal has said whether it draws the cat's picture. */
export function startPictures($: EngineInterface): void {
  probeTimer = null
  startProbe($)
  sentPicture = null
  sentAt = Number.NEGATIVE_INFINITY
}

/**
 * As the sidebar draws (a render hook: module state only): the picture it drew, for the probe and a
 * resend; a new source is sent with the drawing; drawn while the probe had stopped (nothing drawn in
 * its first ten seconds), ask again.
 */
export function notePicture($: EngineInterface, picture: { png: string } | null, columns: number, state: string, now: number): void {
  drawnPicture = picture === null ? null : { source: picture, columns, rows: PICTURE_ROWS }
  // A new source goes to the terminal with this drawing.
  if (picture !== null && picture.png !== sentPicture) {
    sentPicture = picture.png
    sentAt = now
  }
  // Drawn while the probe had stopped (nothing drawn in its first ten seconds): ask again.
  if (picture !== null && state === 'unknown') startProbe($)
}
