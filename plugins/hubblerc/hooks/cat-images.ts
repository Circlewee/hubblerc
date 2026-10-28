import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CatMood } from './pixel-art'

/** How many of the cat's pictures were read: written once they are, so the sidebar redraws. */
const catImageCount = atom({ plugin: 'hubblerc', key: 'catImageCount' } as const, 0)

/** One frame of the cat as a picture: a whole PNG, base64, and its size in pixels. */
export type CatImage = { png: string; width: number; height: number }

const MOODS: readonly CatMood[] = ['sleeping', 'awake', 'thinking', 'writing', 'busy', 'startled']

/** What an Image takes, decoded: 2 MiB. */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024

/**
 * Each mood's pictures, read at session.start. Kept here, not in state: the PNGs are large and a
 * render reads state every second.
 */
const images = new Map<CatMood, CatImage[]>()

/**
 * Reads the cat's pictures, `assets/cat/<mood>/*.png` (drawn for hubblerc; a user may put their
 * own there instead), each mood's in name order. A file that is not a PNG, or over what an Image takes, is left out; a folder
 * missing gives none.
 */
export async function loadCatImages($: EngineInterface): Promise<void> {
  images.clear()
  const root = `${$.plugin.root}/assets/cat`
  let count = 0
  for (const mood of MOODS) {
    const entries = await $.fs.list(`${root}/${mood}`).catch(() => [])
    const names = entries
      .filter(entry => entry.kind === 'file' && /\.png$/i.test(entry.name))
      .map(entry => entry.name)
      .sort()
    const frames: CatImage[] = []
    for (const name of names) {
      const read = await $.fs.read(`${root}/${mood}/${name}`, { as: 'bytes' }).catch(() => undefined)
      const base64 = typeof read === 'object' && read !== null ? read.base64 : undefined
      if (base64 === undefined || (base64.length * 3) / 4 > IMAGE_MAX_BYTES) continue
      const size = pngSize(base64)
      if (size !== null) frames.push({ png: base64, ...size })
    }
    if (frames.length > 0) images.set(mood, frames)
    count += frames.length
  }
  await update($, catImageCount, () => count)
}

/**
 * The pictures for a mood: its own, else the awake cat's (a mood left without any still shows the
 * cat), else none.
 */
export function catImagesFor(mood: CatMood): readonly CatImage[] | null {
  return images.get(mood) ?? images.get('awake') ?? null
}

/** A PNG's width and height, from its header (base64); null when it is not a PNG. */
export function pngSize(base64: string): { width: number; height: number } | null {
  const head = decodeHead(base64.slice(0, 32))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (head.length < 24 || signature.some((byte, i) => head[i] !== byte)) return null
  const word = (at: number) => (((head[at] ?? 0) << 24) | ((head[at + 1] ?? 0) << 16) | ((head[at + 2] ?? 0) << 8) | (head[at + 3] ?? 0)) >>> 0
  const width = word(16)
  const height = word(20)

  return width > 0 && height > 0 ? { width, height } : null
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The bytes of a whole number of base64 quads. */
function decodeHead(text: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i + 4 <= text.length; i += 4) {
    const [a, b, c, d] = [...text.slice(i, i + 4)].map(ch => BASE64.indexOf(ch))
    if (a === undefined || b === undefined || a < 0 || b < 0) break
    bytes.push((a << 2) | (b >> 4))
    if (c !== undefined && c >= 0) bytes.push(((b & 15) << 4) | (c >> 2))
    if (c !== undefined && c >= 0 && d !== undefined && d >= 0) bytes.push(((c & 3) << 6) | d)
  }

  return bytes
}
