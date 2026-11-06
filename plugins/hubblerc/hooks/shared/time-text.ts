/** Time until `iso`, short: `1h30m`, `45m`, `2d3h`, `<1m` (`isSpaced`, `1h 30m`, `2d 3h`); '' when unknown or past. */
export function countdown(iso: string | undefined, now: number, isSpaced = false): string {
  const gap = isSpaced ? ' ' : ''
  if (iso === undefined) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${gap}${String(minutes % 60).padStart(2, '0')}m`

  return `${Math.floor(hours / 24)}d${gap}${hours % 24}h`
}

/** How long something has run, short: `12s`, `2m15s`, `1h3m`. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}
