import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { DeviceInfo } from '../types'

const device = atom({ plugin: 'hubblerc', key: 'device' } as const, null)

/**
 * At session.start: the machine's chip, memory, OS and boot time (macOS's `sysctl` and `sw_vers`)
 * and the engine's version, for the sidebar's top box. Each read on its own: one failing leaves
 * its field out, the rest stand.
 */
export async function startDevice($: EngineInterface): Promise<void> {
  const run = async (argv: string[]) => {
    const ran = await $.process.run(argv, { timeoutMs: 3000 }).catch(() => undefined)

    return ran !== undefined && ran.exitCode === 0 ? ran.stdout : ''
  }
  const [sysctl, os, version] = await Promise.all([
    run(['sysctl', '-n', 'machdep.cpu.brand_string', 'hw.memsize', 'kern.boottime']),
    run(['sw_vers', '-productVersion']),
    $.session.version().catch(() => undefined),
  ])

  const info: DeviceInfo = { ...parseSysctl(sysctl) }
  if (os.trim() !== '') info.os = `macOS ${os.trim()}`
  if (version !== undefined) info.version = version.base ?? version.version
  await update($, device, () => info)

  await checkVersions($).catch(() => undefined)
  $.clock.every(VERSION_CHECK_MS, () => {
    void checkVersions($).catch(() => undefined)
  })
}

const VERSION_CHECK_MS = 60 * 60_000
const LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
export const CHANGELOG_URL = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'

/**
 * The newest version installed on the machine (the native installer keeps one file a version in
 * `~/.local/share/claude/versions`) and the newest released (the npm registry): each read on its
 * own, one failing keeps what the other found.
 */
async function checkVersions($: EngineInterface): Promise<void> {
  const [listed, fetched] = await Promise.all([
    $.process.run(['sh', '-c', 'ls "$HOME/.local/share/claude/versions" 2>/dev/null'], { timeoutMs: 3000 }).catch(() => undefined),
    $.http.fetch(LATEST_URL).catch(() => undefined),
  ])
  const installed = newest(listed?.exitCode === 0 ? listed.stdout.split('\n') : [])
  const latest = fetched?.ok === true ? latestVersion(fetched.text) : undefined
  await update($, device, info => ({
    ...(info ?? {}),
    ...(installed === undefined ? {} : { installed }),
    ...(latest === undefined ? {} : { latest }),
  }))
}

/** The `version` of the registry's `latest` manifest. */
export function latestVersion(json: string): string | undefined {
  try {
    const version = (JSON.parse(json) as { version?: unknown }).version

    return typeof version === 'string' && parseVersion(version) !== null ? version : undefined
  } catch {
    return undefined
  }
}

/** The highest of the names that are versions (`2.1.310`), others skipped. */
export function newest(names: readonly string[]): string | undefined {
  let best: string | undefined
  for (const name of names.map(line => line.trim())) {
    if (parseVersion(name) === null) continue
    if (best === undefined || compareVersions(name, best) > 0) best = name
  }

  return best
}

function parseVersion(text: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)

  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Above zero when `a` is the later version; versions that do not parse compare equal. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (x === null || y === null) return 0
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)

  return 0
}

/**
 * What to say beside the running version: `restart` when a later one is installed (a restart
 * applies it), else `released` when a later one is out and not yet installed; null when current.
 */
export function versionNote(info: DeviceInfo | null): { kind: 'restart' | 'released'; version: string } | null {
  const running = info?.version
  if (running === undefined) return null
  if (info?.installed !== undefined && compareVersions(info.installed, running) > 0) return { kind: 'restart', version: info.installed }
  if (info?.latest !== undefined && compareVersions(info.latest, running) > 0) return { kind: 'released', version: info.latest }

  return null
}

/** `sysctl -n machdep.cpu.brand_string hw.memsize kern.boottime`, one value a line. */
export function parseSysctl(stdout: string): Pick<DeviceInfo, 'chip' | 'memoryGb' | 'bootedAt'> {
  const [chip = '', memory = '', boot = ''] = stdout.split('\n').map(line => line.trim())
  const info: Pick<DeviceInfo, 'chip' | 'memoryGb' | 'bootedAt'> = {}
  if (chip !== '') info.chip = chip
  const bytes = Number(memory)
  if (Number.isFinite(bytes) && bytes > 0) info.memoryGb = Math.round(bytes / 2 ** 30)
  // `{ sec = 1760000000, usec = 123456 } Tue Oct 14 ...`
  const seconds = /sec = (\d+)/.exec(boot)?.[1]
  if (seconds !== undefined) info.bootedAt = Number(seconds) * 1000

  return info
}

/** `켜진 지 11일 23시간`, or within the first day `켜진 지 5시간 12분`. */
export function uptime(bootedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - bootedAt) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `켜진 지 ${days}일 ${hours}시간`
  if (hours > 0) return `켜진 지 ${hours}시간 ${minutes % 60}분`

  return `켜진 지 ${minutes}분`
}

/** The box's lines about the machine: chip and memory, OS, uptime; those known. The engine's line is drawn apart. */
export function deviceLines(info: DeviceInfo | null, now: number): string[] {
  if (info === null) return []
  const hardware = [info.chip, info.memoryGb === undefined ? undefined : `${info.memoryGb}GB`].filter(part => part !== undefined)

  return [hardware.join(' · '), info.os ?? '', info.bootedAt === undefined ? '' : uptime(info.bootedAt, now)].filter(line => line !== '')
}
