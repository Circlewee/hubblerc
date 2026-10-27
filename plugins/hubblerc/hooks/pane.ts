import type { EngineInterface } from 'claude-code'

/** The sidebar's pane, by the id it is opened under. */
export const SIDEBAR_ID = 'hubblerc'

/** Whether the sidebar is drawn and shown now: what only it shows need not be read while it is not. */
export async function isSidebarShown($: EngineInterface): Promise<boolean> {
  const pane = (await $.ui.panes()).find(open => open.id === SIDEBAR_ID)

  return pane !== undefined && pane.isPlaced && pane.isShown
}
