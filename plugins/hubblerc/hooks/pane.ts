import type { EngineInterface } from 'claude-code'

/**
 * The surfaces drawn by an app, not a terminal: the desktop app, and VS Code [assumed to draw the
 * same way; not seen]. There a Button is drawn padded, a box's border and its title over the top
 * border do not show, and half blocks part with a gap between rows (2026-11-05, the desktop app).
 */
export function isAppSurface(surface: string): boolean {
  return surface === 'desktop' || surface === 'vscode'
}

/** The sidebar's pane, by the id it is opened under. */
export const SIDEBAR_ID = 'hubblerc'
/** The pane an answer of the contents opens in when its row cannot be scrolled to (`answer.tsx`). */
export const ANSWER_ID = 'hubblerc-answer'
export const SIDEBAR_TITLE = 'hubblerc'
/** The width the dock is asked for; the engine holds it to 24..45% of the terminal. */
export const SIDEBAR_COLUMNS = 56

/** Whether the sidebar is drawn and shown now: what only it shows need not be read while it is not. */
export async function isSidebarShown($: EngineInterface): Promise<boolean> {
  const pane = (await $.ui.panes()).find(open => open.id === SIDEBAR_ID)

  return pane !== undefined && pane.isPlaced && pane.isShown
}

/**
 * Asks the keyboard for the sidebar where it lacks it (a mouse press leaves the keys in the prompt):
 * an open of the open pane with `focus`, its title and width as every open of it gives them, nothing
 * else (each open sets those anew; re-opening an open id makes no second pane). A request: the
 * surface grants it only while the prompt holds the keys over an empty composer. Answers whether the
 * pane holds the keyboard after; undefined with no sidebar open.
 */
export async function askSidebarKeyboard($: EngineInterface): Promise<boolean | undefined> {
  const pane = (await $.ui.panes()).find(open => open.id === SIDEBAR_ID)
  if (pane === undefined) return undefined
  if (pane.isFocused) return true
  await $.ui.open({ id: SIDEBAR_ID, title: SIDEBAR_TITLE, columns: SIDEBAR_COLUMNS, focus: true })

  return (await $.ui.panes()).find(open => open.id === SIDEBAR_ID)?.isFocused === true
}
