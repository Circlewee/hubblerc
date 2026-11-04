import type { EngineInterface } from 'claude-code'

/**
 * The file `$.store` keeps this plugin's values in, so the engine can watch it (classic SessionStart's
 * `watchPaths`) and another session's write to the to-dos shows at once.
 *
 * The engine names it `<config>/plugins/store/<id, @ as _>-<first 12 hex of SHA-256 of id>.json`, the
 * id being `<plugin>@<marketplace>`, `<plugin>@inline` for a plugin loaded from its folder
 * (`--plugin-dir`). Found by hashing the ids of the files on this Mac (2026-11-04, engine 2.1.318):
 * `hubblerc@inline` gives `hubblerc_inline-c039cadca8b5.json`, `hubblerc@hubblerc` gives
 * `hubblerc_hubblerc-3be9b6e2c135.json`. The type documents say only "a JSON file of the plugin's own
 * under the user's Claude Code configuration directory"; the rule is the engine's and may change.
 */

/** The store files watched this session, by path. */
let watched = new Set<string>()

/**
 * The plugin's id as the engine keys its store: an installed copy runs from
 * `<config>/plugins/cache/<marketplace>/<plugin>/<version>`, anything else (`--plugin-dir`) is `inline`.
 * A copy read from a folder marketplace would read as inline wrongly: `storeWatchPaths` falls back then.
 */
export function pluginId(name: string, root: string): string {
  const cached = /\/plugins\/cache\/([^/]+)\/[^/]+\//.exec(`${root}/`)

  return `${name}@${cached?.[1] ?? 'inline'}`
}

/** The store file's name for a plugin id. */
export function storeFileName(id: string): string {
  return `${id.replace('@', '_')}-${sha256Hex(id).slice(0, 12)}.json`
}

/**
 * At the classic SessionStart: the store file to watch. Where the file the rule names is not there
 * (the rule changed, the id guessed wrong), every `<plugin>_*.json` in the store folder: a write to
 * another copy's (installed and dev) only costs a read that finds nothing new. None there yet: the
 * named one, for when it is made.
 */
export async function storeWatchPaths($: EngineInterface): Promise<string[]> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const config = configDir !== undefined && configDir !== '' ? configDir : home !== undefined && home !== '' ? `${home}/.claude` : undefined
  if (config === undefined) return []
  const folder = `${config}/plugins/store`
  const named = `${folder}/${storeFileName(pluginId($.plugin.name, $.plugin.root))}`
  let paths = [named]
  if (!(await $.fs.exists(named).catch(() => false))) {
    const entries = await $.fs.list(folder).catch(() => [])
    const mine = entries.filter(entry => entry.name.startsWith(`${$.plugin.name}_`) && entry.name.endsWith('.json')).map(entry => `${folder}/${entry.name}`)
    if (mine.length > 0) paths = mine
  }
  watched = new Set(paths)

  return paths
}

/** At the classic FileChanged: whether the file is this plugin's store. */
export function isStoreFile(path: string): boolean {
  return watched.has(path)
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** SHA-256 of a text's UTF-8 bytes, as hex: the plugin's environment has no crypto module to ask. */
export function sha256Hex(text: string): string {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  const bits = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(shift >= 32 ? Math.floor(bits / 2 ** shift) & 0xff : (bits >>> shift) & 0xff)

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  const w = new Array<number>(64).fill(0)
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4
      w[i] = (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] ?? 0
      const b = w[i - 2] ?? 0
      w[i] = ((w[i - 16] ?? 0) + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + (w[i - 7] ?? 0) + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0
    }
    let [a, b, c, d, e, f, g, k] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i += 1) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      k = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    ;[a, b, c, d, e, f, g, k].forEach((value, i) => (h[i] = ((h[i] ?? 0) + value) >>> 0))
  }

  return h.map(value => value.toString(16).padStart(8, '0')).join('')
}
