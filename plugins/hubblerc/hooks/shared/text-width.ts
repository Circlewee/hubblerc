/**
 * Terminal cells a text takes: East Asian wide characters and emoji drawn as emoji take two; the
 * variation selectors and the zero-width joiner take none.
 */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0xfe0e || code === 0xfe0f || code === 0x200d) continue
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      isEmojiInBmp(code)
    width += isWide ? 2 : 1
  }

  return width
}

/**
 * The characters below U+10000 drawn as emoji with no variation selector (Emoji_Presentation):
 * ⌚⌛ ⏩–⏬ ⏰ ⏳ ◽◾ ☔☕ ♈–♓ ♿ ⚓ ⚡ ⚪⚫ ⚽⚾ ⛄⛅ ⛎ ⛔ ⛪ ⛲⛳ ⛵ ⛺ ⛽ ✅ ✊✋ ✨ ❌ ❎ ❓–❕ ❗ ➕–➗ ➰ ➿ ⬛⬜ ⭐ ⭕.
 * One drawn as text by default (⚠ ✓ ✕ ↗ ◐) stays one cell.
 */
const EMOJI_IN_BMP: readonly (readonly [number, number])[] = [
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
]

function isEmojiInBmp(code: number): boolean {
  if (code < 0x231a || code > 0x2b55) return false

  return EMOJI_IN_BMP.some(([from, to]) => code >= from && code <= to)
}
