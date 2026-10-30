import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { DeviceInfo } from '../types'
import { isSidebarShown } from './pane'
import { loadCatImages } from './cat-images'

const device = atom({ plugin: 'hubblerc', key: 'device' } as const, null)

/**
 * At session.start: the machine's chip, memory and OS (macOS's `sysctl` and `sw_vers`) and the
 * engine's version, for the sidebar's top box; then every 30 seconds while the sidebar shows, the
 * memory in use and the disk's room left, and the machine's again while one is missing. Each read
 * on its own: one failing leaves its field out, the rest stand.
 *
 * The commands are named by their full paths: `sysctl` lives in `/usr/sbin`, which a PATH Claude
 * Code was started with may lack.
 */
export async function startDevice($: EngineInterface): Promise<void> {
  const [machine, version, manifest] = await Promise.all([
    readMachine($),
    $.session.version().catch(() => undefined),
    $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => undefined),
  ])
  await loadCatImages($).catch(() => undefined)

  const info: DeviceInfo = { ...machine }
  if (version !== undefined) info.version = version.base ?? version.version
  const pluginVersion = manifestVersion(manifest)
  if (pluginVersion !== undefined) info.pluginVersion = pluginVersion
  // An installed copy sits in Claude Code's plugin cache (`~/.claude/plugins/cache/<market>/<name>/<version>`).
  info.isDevBuild = !$.plugin.root.includes('/plugins/cache/')
  await update($, device, () => info)

  await readResources($).catch(() => undefined)
  lastInstalledCheck = Number.NEGATIVE_INFINITY
  lastLatestCheck = Number.NEGATIVE_INFINITY
  await checkVersions($).catch(() => undefined)
  // Again every 30 seconds while the sidebar shows: nothing else draws them. The versions go by the
  // wall clock, not by a timer of their own: a timer's hour stood still while the Mac slept, so a
  // version installed in the morning went unseen (2026-10-30).
  $.clock.every(RESOURCE_MS, () => {
    void (async () => {
      if (!(await isSidebarShown($))) return
      await readResources($)
      await checkVersions($)
    })().catch(() => undefined)
  })
}

const RESOURCE_MS = 30_000
/** How often the versions folder is listed: the auto-update installs there, a restart away. */
const INSTALLED_CHECK_MS = 5 * 60_000
/** How often the npm registry is asked for the latest release. */
const LATEST_CHECK_MS = 60 * 60_000
/** When each was last read, by the wall clock; reset at session.start. */
let lastInstalledCheck = Number.NEGATIVE_INFINITY
let lastLatestCheck = Number.NEGATIVE_INFINITY

/** A command's output, or '' when it failed or did not end in time. */
async function output($: EngineInterface, argv: string[]): Promise<string> {
  const ran = await $.process.run(argv, { timeoutMs: 3000 }).catch(() => undefined)

  return ran !== undefined && ran.exitCode === 0 ? ran.stdout : ''
}

/** The chip, memory and OS: those read. */
async function readMachine($: EngineInterface): Promise<Pick<DeviceInfo, 'chip' | 'memoryGb' | 'os'>> {
  const [sysctl, os] = await Promise.all([
    output($, ['/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string', 'hw.memsize']),
    output($, ['/usr/bin/sw_vers', '-productVersion']),
  ])

  return { ...parseSysctl(sysctl), ...(os.trim() === '' ? {} : { os: `macOS ${os.trim()}` }) }
}

/**
 * The memory in use (`vm_stat`) and the startup disk's room left (`df`), each a few milliseconds;
 * and the chip, memory and OS again while one of them is missing (a read that failed at the start).
 */
async function readResources($: EngineInterface): Promise<void> {
  const [vm, df, known] = await Promise.all([output($, ['/usr/bin/vm_stat']), output($, ['/bin/df', '-k', '/']), read($, device)])
  const isMachineMissing = known?.chip === undefined || known.memoryGb === undefined || known.os === undefined
  const machine = isMachineMissing ? await readMachine($) : {}
  const memoryUsedGb = vm === '' ? undefined : parseVmStat(vm)
  const diskFreeGb = df === '' ? undefined : parseDf(df)
  await update($, device, info => ({
    ...(info ?? {}),
    ...machine,
    ...(memoryUsedGb === undefined ? {} : { memoryUsedGb }),
    ...(diskFreeGb === undefined ? {} : { diskFreeGb }),
  }))
}

/**
 * Memory in use from `vm_stat`, in GiB to a tenth: app memory (anonymous less purgeable), wired and
 * compressed pages, as Activity Monitor's "Memory Used" adds them up.
 */
export function parseVmStat(stdout: string): number | undefined {
  const pageSize = Number(/page size of (\d+) bytes/.exec(stdout)?.[1])
  const pages = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(stdout)?.[1])
  const used = pages('Anonymous pages') - pages('Pages purgeable') + pages('Pages wired down') + pages('Pages occupied by compressor')
  if (!Number.isFinite(pageSize) || !Number.isFinite(used) || used < 0) return undefined

  return Math.round((used * pageSize) / 2 ** 30 * 10) / 10
}

/** The room left on the disk `df -k` names, in whole GB of 10^9 bytes (Finder's count). */
export function parseDf(stdout: string): number | undefined {
  const kilobytes = Number(stdout.trim().split('\n').at(-1)?.trim().split(/\s+/)[3])

  return Number.isFinite(kilobytes) && kilobytes >= 0 ? Math.round((kilobytes * 1024) / 1e9) : undefined
}
const LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
export const CHANGELOG_URL = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'

/**
 * The newest version installed on the machine (the native installer keeps one file a version in
 * `~/.local/share/claude/versions`) and the newest released (the npm registry): each read on its
 * own, one failing keeps what the other found.
 */
async function checkVersions($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const isInstalledDue = now - lastInstalledCheck >= INSTALLED_CHECK_MS
  const isLatestDue = now - lastLatestCheck >= LATEST_CHECK_MS
  if (!isInstalledDue && !isLatestDue) return
  if (isInstalledDue) lastInstalledCheck = now
  if (isLatestDue) lastLatestCheck = now
  const [listed, fetched] = await Promise.all([
    isInstalledDue ? $.process.run(['sh', '-c', 'ls "$HOME/.local/share/claude/versions" 2>/dev/null'], { timeoutMs: 3000 }).catch(() => undefined) : undefined,
    isLatestDue ? $.http.fetch(LATEST_URL).catch(() => undefined) : undefined,
  ])
  const installed = newest(listed?.exitCode === 0 ? listed.stdout.split('\n') : [])
  const latest = fetched?.ok === true ? latestVersion(fetched.text) : undefined
  await update($, device, info => ({
    ...(info ?? {}),
    ...(installed === undefined ? {} : { installed }),
    ...(latest === undefined ? {} : { latest }),
  }))
}

/** The `version` of hubblerc's plugin.json. */
export function manifestVersion(json: string | undefined): string | undefined {
  if (json === undefined) return undefined
  try {
    const version = (JSON.parse(json) as { version?: unknown }).version

    return typeof version === 'string' && version !== '' ? version : undefined
  } catch {
    return undefined
  }
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

/** `sysctl -n machdep.cpu.brand_string hw.memsize`, one value a line. */
export function parseSysctl(stdout: string): Pick<DeviceInfo, 'chip' | 'memoryGb'> {
  const [chip = '', memory = ''] = stdout.split('\n').map(line => line.trim())
  const info: Pick<DeviceInfo, 'chip' | 'memoryGb'> = {}
  if (chip !== '') info.chip = chip
  const bytes = Number(memory)
  if (Number.isFinite(bytes) && bytes > 0) info.memoryGb = Math.round(bytes / 2 ** 30)

  return info
}

/** `메모리 14.7/18GB · 디스크 256GB 남음`, the halves known; '' with neither. */
export function resourceLine(info: DeviceInfo): string {
  const memory =
    info.memoryUsedGb === undefined ? '' : `메모리 ${info.memoryUsedGb.toFixed(1)}${info.memoryGb === undefined ? 'GB' : `/${info.memoryGb}GB`}`
  const disk = info.diskFreeGb === undefined ? '' : `디스크 ${info.diskFreeGb}GB 남음`

  return [memory, disk].filter(part => part !== '').join(' · ')
}

/** The box's lines about the machine: chip and memory, OS, memory in use and disk left; those known. The engine's line is drawn apart. */
export function deviceLines(info: DeviceInfo | null): string[] {
  if (info === null) return []
  const hardware = [info.chip, info.memoryGb === undefined ? undefined : `${info.memoryGb}GB`].filter(part => part !== undefined)

  return [hardware.join(' · '), info.os ?? '', resourceLine(info)].filter(line => line !== '')
}
