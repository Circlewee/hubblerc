/** What the machine-local logs (likely's decisions, auto effort's picks) write safely: no secrets in a text, a file name from a machine's name. */

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // A value named as a key, token, secret or password: `API_KEY=…`, `"password": "…"`, `token: …`.
  [/\b([A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|credential)[A-Za-z0-9_.-]*)("?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"'&;|,)]+)/gi, '$1$2***'],
  // A flag's: `--password …`, `--token=…`.
  [/(--?(?:password|passwd|token|secret|api-?key)[= ])("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  // A header's: `Bearer …`, `Basic …`.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 ***'],
  // API keys of the `sk-` kind (Anthropic's `sk-ant-…`, OpenAI's).
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  // Long hex: 32 characters and more.
  [/\b[0-9a-fA-F]{32,}\b/g, '***'],
  // Long base64 or URL-safe tokens holding letters and digits: 32 characters and more, no slash (a path is not one).
  [/(?<![A-Za-z0-9+_-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{32,}={0,2}/g, '***'],
]

/** The text with what looks like a secret masked as `***`. */
export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), text)
}

/** A machine's name made a file name: letters, digits, `.`, `_` and `-`, the rest one `-`; `mac` when nothing is left. */
export function safeFileName(name: string): string {
  const safe = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 64)

  return safe === '' ? 'mac' : safe
}
