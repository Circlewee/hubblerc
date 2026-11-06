/** A string that holds something; undefined for anything else. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Lines in a text: a final newline closes the last one. */
export function lineCount(text: string): number {
  if (text === '') return 0
  const count = text.split('\n').length

  return text.endsWith('\n') ? count - 1 : count
}
