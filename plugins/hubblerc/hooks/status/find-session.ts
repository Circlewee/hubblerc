import type { EngineInterface, On } from 'claude-code'

import { isRecord, text } from '../shared/values'
import { peerCopyText, startedText } from './peer'

/**
 * `/find-session <id | commit>` and the model's tool `find_session`: from a session id (a commit's
 * `Session:` trailer, whole or its start) or a commit that carries one, the session as it is now.
 * A commit keeps the id, not the name: the id never changes, and names change with `/rename`
 * (and a renamed name may say anything, which a public repository should not keep). While the
 * session runs, Claude Code's session registry (`<config>/sessions/<pid>.json`) holds its id
 * beside its current name, what another session's SendMessage takes; once it ended, its
 * transcript (`<config>/projects/<folder>/<id>.jsonl`) is what `claude --resume <id>` opens.
 * Read only when asked: no timer, no watch.
 */

const TOOL_NAME = 'find_session'
const TOOL_PATTERN = /^mcp__hubblerc__find_session$/
const TOOL_DESCRIPTION =
  "Finds a Claude Code session from its session id (a commit's Session: trailer, whole or its first 8+ characters) or from a commit sha whose Session: trailer names it. A running session answers with the name SendMessage takes; an ended one with its transcript and the command that resumes it."

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^[0-9a-f]{7,40}$/i
const ID_START = /^[0-9a-f]{8}[0-9a-f-]*$/i
const RUN_MS = 3000

/** A running session's registry entry. */
export type LiveSession = { sessionId: string; name: string; startedAt: number; pid: number; cwd?: string }

/** An entry of the registry whose id is `id` or starts with it; undefined for any other, or one unread. */
export function liveIn(raw: string, id: string): LiveSession | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const sessionId = text(parsed.sessionId)
  const name = text(parsed.name)
  const { startedAt, pid } = parsed
  if (sessionId === undefined || !sessionId.toLowerCase().startsWith(id.toLowerCase())) return undefined
  if (name === undefined || typeof startedAt !== 'number' || typeof pid !== 'number') return undefined
  const cwd = text(parsed.cwd)

  return { sessionId, name, startedAt, pid, ...(cwd === undefined ? {} : { cwd }) }
}

/** What a commit's message says the session was: its first `Session:` trailer. */
export function sessionTrailerIn(trailers: string): string | undefined {
  return trailers
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
}

export type Found = {
  id: string
  /** The commit the id was read from, when the input was one. */
  commit?: string
  live: LiveSession[]
  transcript?: { path: string; cwd?: string }
  isThis: boolean
}

/** The answer, for the person and the model alike. */
export function foundText(found: Found, copied?: string): string {
  const head = `세션 ${found.id}${found.commit === undefined ? '' : `(커밋 ${found.commit.slice(0, 7)}의 Session trailer)`}${found.isThis ? ' · 이 세션' : ''}`
  if (found.live.length > 0) {
    return [
      `${head}: 떠 있음`,
      ...found.live.map(live => `- SendMessage 이름: ${live.name} (${startedText(live.startedAt)} 시작, pid ${live.pid}${live.cwd === undefined ? '' : `, ${live.cwd}`})`),
      ...(copied === undefined ? [] : [`- 복사함: ${copied}`]),
    ].join('\n')
  }
  if (found.transcript !== undefined) {
    const { path, cwd } = found.transcript
    const resume = `claude --resume ${found.id}`

    return [`${head}: 지금 떠 있지 않음`, `- 대화 기록: ${path}`, `- 이어 가기: ${cwd === undefined ? resume : `cd ${cwd} && ${resume}`}`].join('\n')
  }

  return `${head}: 세션 등록 파일과 대화 기록 어디에도 없습니다(다른 기기의 세션이거나 기록이 지워졌을 수 있음).`
}

async function configDir($: EngineInterface): Promise<string | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured !== undefined && configured !== '') return configured
  const home = await $.env.get('HOME')

  return home !== undefined && home !== '' ? `${home}/.claude` : undefined
}

async function isRunning($: EngineInterface, pid: number): Promise<boolean> {
  const ran = await $.process.run(['/bin/ps', '-p', String(pid), '-o', 'pid='], { timeoutMs: RUN_MS }).catch(() => undefined)

  return ran?.exitCode === 0 && ran.stdout.trim() !== ''
}

/** The entries of running sessions with this id (a file left by a session that crashed is passed over). */
async function liveSessions($: EngineInterface, dir: string, id: string): Promise<LiveSession[]> {
  const entries = await $.fs.list(`${dir}/sessions`).catch(() => [])
  const found: LiveSession[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const raw = await $.fs.read(`${dir}/sessions/${entry.name}`).catch(() => undefined)
    const live = typeof raw === 'string' ? liveIn(raw, id) : undefined
    if (live !== undefined && (await isRunning($, live.pid))) found.push(live)
  }

  return found
}

/** The transcript whose name starts with the id, and the working folder its first rows name. */
async function transcriptOf($: EngineInterface, dir: string, id: string): Promise<{ path: string; cwd?: string } | undefined> {
  const script = 'f=$(ls "$1"/projects/*/"$2"*.jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0; echo "$f"; head -c 262144 "$f" | grep -o \'"cwd":"[^"]*"\' | head -n 1'
  const ran = await $.process.run(['/bin/sh', '-c', script, 'sh', dir, id], { timeoutMs: RUN_MS }).catch(() => undefined)
  const [path, cwdRow] = (ran?.exitCode === 0 ? ran.stdout : '').split('\n').map(line => line.trim())
  if (path === undefined || path === '') return undefined
  const cwd = /^"cwd":"(.*)"$/.exec(cwdRow ?? '')?.[1]

  return cwd === undefined || cwd === '' ? { path } : { path, cwd }
}

/** The `Session:` trailer of a commit in the working repository; undefined when no commit has that name. */
async function sessionOfCommit($: EngineInterface, ref: string): Promise<{ commit: string; id?: string } | undefined> {
  const ran = await $.process.run(['git', 'log', '-1', '--format=%H%n%(trailers:key=Session,valueonly)', ref, '--'], { timeoutMs: RUN_MS }).catch(() => undefined)
  if (ran?.exitCode !== 0) return undefined
  const [commit = '', ...rest] = ran.stdout.split('\n')
  if (!/^[0-9a-f]{40}$/i.test(commit.trim())) return undefined
  const id = sessionTrailerIn(rest.join('\n'))

  return id === undefined ? { commit: commit.trim() } : { commit: commit.trim(), id }
}

/** Finds the session `input` names; a string is why it could not. */
export async function findSession($: EngineInterface, input: string): Promise<Found | string> {
  const ref = input.trim()
  if (ref === '') return 'session id나 커밋 sha를 주세요: /find-session <id | 커밋>'
  let id: string | undefined
  let commit: string | undefined
  if (UUID.test(ref)) id = ref
  else if (HEX.test(ref) || !ID_START.test(ref)) {
    // A commit first: an id's first 8 characters look like a short sha too.
    const fromCommit = await sessionOfCommit($, ref)
    if (fromCommit !== undefined) {
      if (fromCommit.id === undefined) return `커밋 ${fromCommit.commit.slice(0, 7)}에는 Session trailer가 없습니다.`
      id = fromCommit.id
      commit = fromCommit.commit
    } else if (ID_START.test(ref)) id = ref
    else return `${ref}: 이 저장소의 커밋도, session id도 아닙니다.`
  } else id = ref

  const dir = await configDir($)
  if (dir === undefined) return 'Claude Code 설정 폴더를 알 수 없습니다(HOME 없음).'
  const live = await liveSessions($, dir, id)
  const transcript = live.length > 0 ? undefined : await transcriptOf($, dir, id)
  const fullId = live[0]?.sessionId ?? (transcript === undefined ? id : (/([0-9a-f-]{36})\.jsonl$/i.exec(transcript.path)?.[1] ?? id))
  const isThis = fullId === (await $.session.id().catch(() => ''))

  return { id: fullId, ...(commit === undefined ? {} : { commit }), live, ...(transcript === undefined ? {} : { transcript }), isThis }
}

/** `/find-session`: the answer, and a running session's name and start copied as the session line copies them. */
export async function runFindSessionCommand($: EngineInterface, args: string): Promise<string> {
  const found = await findSession($, args)
  if (typeof found === 'string') return found
  const only = found.live.length === 1 ? found.live[0] : undefined
  if (only === undefined) return foundText(found)
  const copyText = peerCopyText(only)
  const copied = await $.ui.copy({ text: copyText }).catch(() => ({ isCopied: false }))

  return foundText(found, copied.isCopied ? copyText : undefined)
}

/** At session.start: the model's tool, deferred (only its name is listed until a search loads it). */
export async function registerFindSessionTool($: EngineInterface): Promise<void> {
  await $.tool
    .register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'A session id (whole, or its first 8+ characters) or a commit sha' } },
        required: ['ref'],
      },
    })
    .catch(() => undefined)
}

export function serveFindSessionTool(on: On): void {
  on('tool.call', { tool: TOOL_PATTERN }, async ($, e) => {
    const ref = (e as unknown as Record<string, unknown>).ref
    if (typeof ref !== 'string') return { deny: 'find_session needs ref: a session id or a commit sha.' }
    const found = await findSession($, ref).catch((error: unknown) => `세션을 찾지 못했습니다: ${String(error)}`)

    return typeof found === 'string' ? { deny: found } : { result: foundText(found) }
  }).catch(() => ({ deny: 'find_session failed.' }))
}
