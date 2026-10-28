/**
 * Pixel art drawn with half blocks: each cell holds two pixels, the top as `▀`'s colour and the
 * bottom as the cell's background. Transparent pixels leave the background alone, so the picture
 * sits on the pane as any text does.
 */

import { CAT_PALETTE, LOOK_LEFT, LOOK_RIGHT, LOOK_UP, MOUTH, REST, SHUT, STARTLED } from './cat-art'

export { CAT_PALETTE }

/** One run of cells in one style. */
export type PixelRun = { text: string; color?: string; backgroundColor?: string }

/** The cat at rest. */
export const CAT = REST

/**
 * What the cat shows of the session:
 * - sleeping: nothing runs (eyes shut, `z`)
 * - awake: an answer runs, nothing streams yet (eyes open, a blink now and then)
 * - thinking: the response streams thinking (eyes up, `?`)
 * - writing: the response streams the answer (mouth opening and closing)
 * - busy: a tool or a subagent runs (eyes darting, an ear flicking, the tail swishing)
 * Drawn in `cat-art.ts`.
 * - startled: idle after an answer with a failed call, till the next (wide eyes, mouth open, `!`)
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

/**
 * The picture for a mood at a second of the clock, and the mark beside its head. Only a cat at
 * work moves: the mouth, or the eyes with an ear and the tail, every second; a blink one second in
 * four.
 */
export function catFrame(mood: CatMood, second: number): { art: readonly string[]; mark: string } {
  const odd = second % 2 === 1
  switch (mood) {
    case 'sleeping':
      return { art: SHUT, mark: 'z' }
    case 'awake':
      return { art: second % 4 === 0 ? SHUT : CAT, mark: '' }
    case 'thinking':
      return { art: LOOK_UP, mark: '?' }
    case 'writing':
      return { art: odd ? MOUTH : CAT, mark: '' }
    case 'busy':
      return { art: odd ? LOOK_RIGHT : LOOK_LEFT, mark: '' }
    case 'startled':
      return { art: STARTLED, mark: '!' }
  }
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

/** How many screen pixels a picture pixel takes as an Image: kept sharp when the terminal scales it to the box. */
const PICTURE_SCALE = 4

const pictures = new Map<string, { png: string }>()

/**
 * The art as an Image's source: a PNG, each art pixel a `PICTURE_SCALE` square, transparent where
 * the art is. A PNG, as pane-mod sends, not raw RGBA: a terminal may take one and not the other.
 * Kept by the art and palette, so a frame shown again is not built again.
 */
export function pixelPicture(art: readonly string[], palette: Readonly<Record<string, string>>): { png: string } {
  const id = `${JSON.stringify(palette)}\n${art.join('\n')}`
  const kept = pictures.get(id)
  if (kept !== undefined) return kept
  const across = Math.max(0, ...art.map(row => row.length))
  const width = across * PICTURE_SCALE
  const height = art.length * PICTURE_SCALE
  const bytes = new Uint8Array(width * height * 4)
  art.forEach((row, y) => {
    for (let x = 0; x < across; x += 1) {
      const hex = palette[row[x] ?? '.']
      if (hex === undefined) continue
      const rgb = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))
      for (let dy = 0; dy < PICTURE_SCALE; dy += 1) {
        for (let dx = 0; dx < PICTURE_SCALE; dx += 1) {
          const at = ((y * PICTURE_SCALE + dy) * width + x * PICTURE_SCALE + dx) * 4
          bytes.set([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255], at)
        }
      }
    }
  })
  const picture = { png: base64(png(bytes, width, height)) }
  if (pictures.size > 64) pictures.clear()
  pictures.set(id, picture)

  return picture
}

/** The art's size in pixels: as wide as its widest row, as tall as its rows. */
export function pixelSize(art: readonly string[]): { width: number; height: number } {
  return { width: Math.max(0, ...art.map(row => row.length)), height: art.length }
}

/** RGBA pixels as a whole PNG: unfiltered rows in stored (uncompressed) deflate blocks. */
function png(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  zlib.set([0x78, 0x01])
  let at = 2
  for (let i = 0; i < blocks; i += 1) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535))
    zlib.set([i === blocks - 1 ? 1 : 0, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255], at)
    zlib.set(part, at + 5)
    at += 5 + part.length
  }
  let a = 1
  let b = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  zlib.set(be32(((b << 16) | a) >>> 0), at)
  const header = new Uint8Array(13)
  header.set(be32(width))
  header.set(be32(height), 4)
  header.set([8, 6, 0, 0, 0], 8)

  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())])
}

function chunk(kind: string, data: Uint8Array): Uint8Array {
  const typed = concat([new Uint8Array([...kind].map(ch => ch.charCodeAt(0))), data])

  return concat([be32(data.length), typed, be32(crc32(typed))])
}

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1

  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 255] ?? 0) ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    text += BASE64[a >> 2]
    text += BASE64[((a & 3) << 4) | (b >> 4)]
    text += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '='
    text += i + 2 < bytes.length ? BASE64[c & 63] : '='
  }

  return text
}
