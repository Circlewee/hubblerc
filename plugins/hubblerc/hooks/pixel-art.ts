/**
 * Pixel art drawn with half blocks: each cell holds two pixels, the top as `▀`'s colour and the
 * bottom as the cell's background. Transparent pixels leave the background alone, so the picture
 * sits on the pane as any text does.
 */

/** One run of cells in one style. */
export type PixelRun = { text: string; color?: string; backgroundColor?: string }

/** A cat's face, 12 pixels by 8: `.` transparent, other letters keys of `CAT_PALETTE`. */
export const CAT = [
  '.O........O.',
  '.OO......OO.',
  '.OPOOOOOOPO.',
  'OOOOOOOOOOOO',
  'OODOOOOOODOO',
  'OODOOPPOODOO',
  '.OOOCCCCOOO.',
  '...OOOOOO...',
]

/**
 * What the cat shows of the session:
 * - sleeping: nothing runs (eyes shut, `z`)
 * - awake: an answer runs, nothing streams yet (eyes open, a blink now and then)
 * - thinking: the response streams thinking (eyes up, `?`)
 * - writing: the response streams the answer (mouth opening and closing)
 * - busy: a tool or a subagent runs (eyes darting, ears twitching)
 * - startled: idle after an answer with a failed call, till the next (round eyes, mouth open, `!`)
 */
export type CatMood = 'sleeping' | 'awake' | 'thinking' | 'writing' | 'busy' | 'startled'

export type CatState = {
  /** An answer of the main loop runs. */
  isWorking: boolean
  /** A tool call runs, or a subagent. */
  isToolRunning: boolean
  phase: 'thinking' | 'text' | null
  /** The last finished answer had a failed call. */
  lastFailed: boolean
}

/** The mood, the first that holds: busy, thinking, writing, awake; idle, startled or sleeping. */
export function catMood(state: CatState): CatMood {
  if (state.isToolRunning) return 'busy'
  if (state.isWorking) return state.phase === 'thinking' ? 'thinking' : state.phase === 'text' ? 'writing' : 'awake'

  return state.lastFailed ? 'startled' : 'sleeping'
}

/** The cat with some of its pixel rows swapped. */
function withRows(rows: Readonly<Record<number, string>>): string[] {
  return CAT.map((row, y) => rows[y] ?? row)
}

const EYES_SHUT = withRows({ 4: 'OOOOOOOOOOOO', 5: 'ODDOOPPOODDO' })
const EYES_UP = withRows({ 3: 'OODOOOOOODOO', 4: 'OODOOOOOODOO', 5: 'OOOOOPPOOOOO' })
const MOUTH_OPEN = withRows({ 6: '.OOOCDDCOOO.' })
const LOOK_LEFT = withRows({ 4: 'ODOOOOOODOOO', 5: 'ODOOOPPODOOO' })
const LOOK_RIGHT = withRows({ 0: 'O..........O', 4: 'OOODOOOOOODO', 5: 'OOODOPPOOODO' })
const STARTLED = withRows({ 3: 'ODDOOOOOODDO', 4: 'ODDOOOOOODDO', 5: 'OOOOOPPOOOOO', 6: '.OOOCDDCOOO.' })

/**
 * The picture for a mood at a second of the clock, and the mark beside its head. Only a cat at
 * work moves: the mouth and the eyes every second, a blink one second in four.
 */
export function catFrame(mood: CatMood, second: number): { art: readonly string[]; mark: string } {
  const odd = second % 2 === 1
  switch (mood) {
    case 'sleeping':
      return { art: EYES_SHUT, mark: 'z' }
    case 'awake':
      return { art: second % 4 === 0 ? EYES_SHUT : CAT, mark: '' }
    case 'thinking':
      return { art: EYES_UP, mark: '?' }
    case 'writing':
      return { art: odd ? MOUTH_OPEN : CAT, mark: '' }
    case 'busy':
      return { art: odd ? LOOK_RIGHT : LOOK_LEFT, mark: '' }
    case 'startled':
      return { art: STARTLED, mark: '!' }
  }
}

export const CAT_PALETTE: Record<string, string> = {
  O: '#F0A04B',
  D: '#3A3A3A',
  P: '#F4A6B8',
  C: '#FBE3C0',
}

/** The picture as rows of cells, two pixel rows to a cell row, runs of one style merged. */
export function pixelRows(art: readonly string[], palette: Readonly<Record<string, string>>): PixelRun[][] {
  const rows: PixelRun[][] = []
  for (let y = 0; y < art.length; y += 2) {
    const top = art[y] ?? ''
    const bottom = art[y + 1] ?? ''
    const runs: PixelRun[] = []
    for (let x = 0; x < Math.max(top.length, bottom.length); x += 1) {
      const cell = halfBlock(palette[top[x] ?? '.'], palette[bottom[x] ?? '.'])
      const last = runs.at(-1)
      if (last !== undefined && last.color === cell.color && last.backgroundColor === cell.backgroundColor) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }

  return rows
}

function halfBlock(top: string | undefined, bottom: string | undefined): PixelRun {
  if (top === undefined && bottom === undefined) return { text: ' ' }
  if (top === undefined) return { text: '▄', color: bottom }
  if (bottom === undefined || bottom === top) return { text: bottom === top ? '█' : '▀', color: top }

  return { text: '▀', color: top, backgroundColor: bottom }
}
