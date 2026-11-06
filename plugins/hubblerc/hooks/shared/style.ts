/** How the band and the sidebar style their text: runs of one style, and what each colour means in each. */

/**
 * A run of text in one style. `role` marks what the band draws its own way: a bar's filled and
 * empty cells, and the effort value (a control that opens the effort slider).
 */
export type Segment = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  role?: 'barFilled' | 'barEmpty' | 'effort'
}

/** What each colour means: the same roles on the band and in the sidebar, each drawn from its own palette. */
export type Palette = {
  ok: string
  warn: string
  /** Between warn and alert: the sidebar's fourth step of a usage reading. */
  caution: string
  alert: string
  effort: string
  sessionEffort: string
  branch: string
  dirty: string
  running: string
  faint: string
  /** Ultracode, beside the effort. */
  ultracode: string
}

/**
 * The band's colours, by the terminal's own names: the band has no background but the terminal's,
 * so the terminal theme (Kanagawa, …) picks the shade and the band sits in it; only what needs
 * attention is coloured.
 */
export const COLORS: Palette = {
  ok: 'green',
  warn: 'yellow',
  caution: 'yellow',
  alert: 'red',
  effort: 'cyan',
  sessionEffort: 'yellow',
  branch: 'magenta',
  dirty: 'yellow',
  running: 'blue',
  faint: 'gray',
  ultracode: 'magenta',
}

/**
 * The sidebar's colours, by Claude Code's theme keys: the engine paints the pane's background
 * from the theme, so what is drawn on it follows the same theme, light or dark, `auto` or a custom
 * one, and stays readable on it.
 */
export const THEME_COLORS: Palette = {
  ok: 'success',
  warn: 'warning',
  // Claude's orange: between the theme's yellow and red.
  caution: 'claude',
  alert: 'error',
  effort: 'suggestion',
  sessionEffort: 'warning',
  branch: 'merged',
  dirty: 'warning',
  running: 'permission',
  faint: 'inactive',
  // Claude's orange, as the engine draws its own ultracode mark.
  ultracode: 'claude',
}

/** A segment's style as `Text` props, only those it sets. */
export function textStyle(segment: Segment): { color?: string; dimColor?: true; bold?: true } {
  return {
    ...(segment.color === undefined ? {} : { color: segment.color }),
    ...(segment.dim === true ? { dimColor: true as const } : {}),
    ...(segment.bold === true ? { bold: true as const } : {}),
  }
}
