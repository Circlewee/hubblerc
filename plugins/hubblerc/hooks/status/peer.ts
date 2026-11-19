import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isRecord, text } from '../shared/values'

const peerName = atom({ plugin: 'hubblerc', key: 'peerName' } as const, null)

/** What another session's SendMessage addresses this one by, and when it started (epoch ms). */
export type PeerName = { name: string; startedAt: number }

/**
 * This session's entry in Claude Code's session registry (`<config>/sessions/<pid>.json`): its
 * peer name (`hubblerc-1b`, what ListAgents shows and SendMessage takes) and start. Another
 * session finds this one by that name, not by the session id. Undefined for another session's
 * entry, or one without a name.
 */
export function peerIn(raw: string, sessionId: string): PeerName | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.sessionId !== sessionId) return undefined
  const name = text(parsed.name)
  const startedAt = parsed.startedAt
  if (name === undefined || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined

  return { name, startedAt }
}

/** `11-19 13:03`, local time. */
export function startedText(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** What the sidebar copies for another session to message this one: `hubblerc-1b (11-19 13:03 시작)`. */
export function peerCopyText(peer: PeerName): string {
  return `${peer.name} (${startedText(peer.startedAt)} 시작)`
}

/** The registry file found to be this session's: read alone after the first scan. */
let entryPath: string | undefined

async function registryDir($: EngineInterface): Promise<string | undefined> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir !== undefined && configDir !== '') return `${configDir}/sessions`
  const home = await $.env.get('HOME')

  return home !== undefined && home !== '' ? `${home}/.claude/sessions` : undefined
}

async function readEntry($: EngineInterface, path: string, sessionId: string): Promise<PeerName | undefined> {
  const raw = await $.fs.read(path).catch(() => undefined)

  return typeof raw === 'string' ? peerIn(raw, sessionId) : undefined
}

/**
 * Reads this session's peer name from the registry: the file found before, else each `*.json`
 * there until one is this session's. Written only when it changed; nothing found leaves it.
 * Called where the `/rename` name is read (start, the sidebar's half-minute read, after `/rename`),
 * so it adds no wake-up of its own.
 */
export async function refreshPeerName($: EngineInterface): Promise<PeerName | undefined> {
  const sessionId = await $.session.id()
  let found = entryPath === undefined ? undefined : await readEntry($, entryPath, sessionId)
  if (found === undefined) {
    entryPath = undefined
    const dir = await registryDir($)
    if (dir === undefined) return undefined
    const entries = await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      const path = `${dir}/${entry.name}`
      found = await readEntry($, path, sessionId)
      if (found !== undefined) {
        entryPath = path
        break
      }
    }
  }
  if (found === undefined) return undefined
  const known = await read($, peerName)
  const next = found
  if (known?.name !== next.name || known.startedAt !== next.startedAt) await update($, peerName, () => next)

  return next
}

/** Forgets the registry file found (a new session in the same process reads it again). */
export function forgetPeerEntry(): void {
  entryPath = undefined
}
