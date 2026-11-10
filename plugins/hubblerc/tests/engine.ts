import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { CommandSpec, On, PromptFillMode, SessionMessage, UiPane } from 'claude-code'

export const NOW = Date.parse('2026-10-25T09:00:00Z')

export type StandIn = {
  clock: MockClock
  /** The session's model, as `$.session.model()` answers; a test may change it. */
  modelId: string
  /** The panes open now, as `$.ui.panes()` answers; a test may change them. */
  panes: UiPane[]
  /** How many times the plugin asked for the panes. */
  paneReads: number
  /** Every `$.ui.open` the plugin made, in order. */
  opened: unknown[]
  /** What `$.session.id()` answers. */
  sessionId: string
  /** The transcript `$.session.messages()` answers, as the model was sent it (`as: "api"`), and each subagent's by its id. */
  messages: SessionMessage[]
  sent: { role: 'user' | 'assistant'; content: { type: string; [field: string]: unknown }[] }[]
  agentMessages: Record<string, SessionMessage[]>
  /** Every toast the plugin showed. */
  toasts: unknown[]
  /** What the small model answers a completion (null: the call fails), and every request made; how long it takes on the mocked clock. */
  completion: string | null
  completionDelayMs: number
  completions: { model: string; system?: unknown; prompt: unknown }[]
  /** The 5-hour window's percent `$.session.usage()` answers; a test may change it. */
  fiveHourPercent: number
  /** The files of `~/.local/share/claude/versions`, and what the npm registry calls latest. */
  installedVersions: string[]
  latestVersion: string
  /** How many times the plugin asked the npm registry. */
  fetches: number
  /**
   * The session's sign-in as `$.session.authorize()` holds it (null: none, as with an API provider);
   * what the usage endpoint answers; and every ask of it, with the handle it carried.
   */
  signIn: 'bearer' | 'api-key' | null
  usageAnswer: { status: number; body: unknown; headers?: Record<string, string> }
  usageCalls: { auth: string | undefined }[]
  /** Every `git status` the plugin ran, its argv. */
  gitStatusArgs: string[][]
  /** What `git diff --numstat` answers (`added\tremoved\tpath` lines); a test may change it. */
  gitNumstat: string
  /** The session's name its transcript's last `custom-title` row gives (null: none). */
  sessionName: string | null
  /** The transcript's last row of `/effort` turning ultracode on or off ('' none), and whether the `ultracode` setting is on. */
  ultracodeRow: string
  ultracodeSetting: boolean
  /** Every command the plugin ran, its argv. */
  ran: string[][]
  /** How many times the plugin read the subagent list. */
  agentListCalls: number
  /** How many reads of the machine (`sysctl`, `sw_vers`) fail before they answer. */
  failMachineReads: number
  /** What `$.session.root()` answers: the project the to-dos are kept for. */
  root: string
  /** Every slash command the plugin registered. */
  commands: CommandSpec[]
  /** Every tool the plugin registered for the model. */
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  /** Whether the prompt box takes a suggestion now (empty, no answer running), and every text offered. */
  isSuggestionShown: boolean
  suggestions: string[]
  /**
   * The prompt box `$.prompt.read()` answers (the draft, the cursor in UTF-16 units), which a fill
   * changes; whether a fill lands (false: refused, as under a dialog); and every fill asked.
   */
  promptBox: { text: string; cursor: number }
  isFillTaken: boolean
  fills: { text: string; mode: PromptFillMode }[]
  /**
   * The Messages API (`https://api.anthropic.com/v1/messages`): what it answers a request, by the
   * request's body; every request made, with its headers; and how long each takes on the mocked clock.
   */
  anthropic: (body: Record<string, unknown>) => { status: number; body: unknown }
  anthropicCalls: { headers: Record<string, string>; body: Record<string, unknown> }[]
  anthropicDelayMs: number
  /** Files the plugin appended lines to (`tee -a`) and reads back in pieces (`tail -c | head -c`), by path. */
  files: Record<string, string>
  /** Paths `$.fs.exists` finds, besides the files above. */
  existing: string[]
  /** Whether an open asking `focus` gives the pane the keyboard (the prompt's composer empty); false: refused. */
  grantsFocus: boolean
  /** The key the keychain holds under `hubblerc-likely` (null: no such item), and how many times it was read. */
  keychain: string | null
  keychainReads: number
}

/** A Messages API reply holding `text` as its one text block. */
export function messageReply(text: string, extra: Record<string, unknown> = {}): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 300, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      ...extra,
    },
  }
}

/** The bytes of a text as UTF-8, and back: how the stand-in cuts a file the way `tail -c` and `head -c` do. */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Nothing sits beneath the plugin: these hooks stand for the engine and what it reports. A pane
 * opens placed and shown unless `placeOnOpen` is false (a terminal too narrow for it).
 */
export function standInForEngine(on: On, { agents = [] as unknown[], placeOnOpen = true } = {}): StandIn {
  const standIn: StandIn = { clock: mock.clock(on, { now: NOW }), modelId: 'claude-opus-5-5', panes: [], paneReads: 0, opened: [], sessionId: 'session-1', messages: [], sent: [], agentMessages: {}, toasts: [], completion: 'high', completionDelayMs: 0, completions: [], fiveHourPercent: 25, installedVersions: ['2.1.309', '2.1.310'], latestVersion: '2.1.310', fetches: 0, signIn: null, usageAnswer: { status: 200, body: {} }, usageCalls: [], gitStatusArgs: [], gitNumstat: '', sessionName: null, ultracodeRow: '', ultracodeSetting: false, failMachineReads: 0, ran: [], agentListCalls: 0, root: '/repo/hubblerc', commands: [], tools: [], isSuggestionShown: true, suggestions: [], promptBox: { text: '', cursor: 0 }, isFillTaken: true, fills: [], anthropic: () => messageReply('{"answers":[{"probabilities":[0.5]}]}'), anthropicCalls: [], anthropicDelayMs: 0, files: {}, existing: [], keychain: null, keychainReads: 0, grantsFocus: true }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    standIn.commands.push({ ...e })

    return { value: { command: e.name } as never }
  })
  on('session.model', () => ({ value: standIn.modelId }))
  on('session.cwd', () => ({ value: '/repo/hubblerc' }))
  on('session.id', () => ({ value: standIn.sessionId }))
  on('session.root', () => ({ value: standIn.root }))
  on('tool.register', (_, e) => {
    standIn.tools.push({ name: e.name, description: e.description, inputSchema: e.inputSchema })

    return { value: { tool: `mcp__hubblerc__${e.name}` } }
  })
  on('prompt.suggest', (_, e) => {
    standIn.suggestions.push(e.text)

    return { isShown: standIn.isSuggestionShown }
  })
  on('prompt.read', () => ({ value: { ...standIn.promptBox } }))
  // As the box writes a fill: over the draft, after it, or in at the cursor, the cursor moved past it.
  on('prompt.fill', (_, e) => {
    standIn.fills.push({ text: e.text, mode: e.mode })
    if (!standIn.isFillTaken) return { isFilled: false, refusal: 'dialog' as const }
    const box = standIn.promptBox
    const at = Math.min(Math.max(box.cursor, 0), box.text.length)
    if (e.mode === 'insert') standIn.promptBox = { text: box.text.slice(0, at) + e.text + box.text.slice(at), cursor: at + e.text.length }
    else if (e.mode === 'append') standIn.promptBox = { text: box.text + e.text, cursor: box.text.length + e.text.length }
    else standIn.promptBox = { text: e.text, cursor: e.text.length }

    return { isFilled: true }
  })
  on('session.messages', (_, e) => {
    if (e.agentId === undefined) return { value: e.as === 'api' ? (standIn.sent as never) : standIn.messages }

    return { value: standIn.agentMessages[e.agentId] ?? { deny: `no transcript for ${e.agentId}` } }
  })
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 1_000_000, percent: 45 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: standIn.fiveHourPercent, resetsAt: new Date(NOW + 90 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 12 },
      ],
      cost: { usd: 1.2 },
    } as never,
  }))
  on('agent.list', () => {
    standIn.agentListCalls += 1

    return { value: agents as never }
  })
  on('http.fetch', async (_, e) => {
    if (e.url === 'https://api.anthropic.com/v1/messages') {
      // The plugin sends its body as text; bytes (`{ base64 }`) are not what the Messages API is asked with here.
      const sent = e.init?.body
      const body = JSON.parse(typeof sent === 'string' ? sent : '{}') as Record<string, unknown>
      standIn.anthropicCalls.push({ headers: { ...(e.init?.headers ?? {}) }, body })
      if (standIn.anthropicDelayMs > 0) await standIn.clock.sleep(standIn.anthropicDelayMs)
      const answer = standIn.anthropic(body)

      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: JSON.stringify(answer.body) } }
    }
    if (e.url === 'https://api.anthropic.com/api/oauth/usage') {
      standIn.usageCalls.push({ auth: e.init?.auth })
      const { status, body, headers = {} } = standIn.usageAnswer

      return { value: { status, ok: status >= 200 && status < 300, headers, text: typeof body === 'string' ? body : JSON.stringify(body) } }
    }
    standIn.fetches += 1

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ name: '@anthropic-ai/claude-code', version: standIn.latestVersion }) } }
  })
  on('session.authorize', () => ({ value: standIn.signIn === null ? null : { handle: 'handle-1', kind: standIn.signIn } }))
  on('session.version', () => ({ value: { version: '2.1.310', base: '2.1.310' } }))
  on('fs.exists', (_, e) => ({ value: standIn.existing.includes(e.path) || standIn.files[e.path] !== undefined || Object.keys(standIn.files).some(path => path.startsWith(`${e.path}/`)) }))
  on('process.run', (_, e) => {
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    // The decision log: appended to, made with its folder, read back in pieces; the machine's name; a zip.
    if (e.argv[0] === '/usr/bin/tee' && e.argv[1] === '-a') {
      const path = e.argv[2] ?? ''
      standIn.files[path] = (standIn.files[path] ?? '') + (e.init?.stdin ?? '')

      return done(e.init?.stdin ?? '')
    }
    if (e.argv[0] === '/bin/sh' && e.argv[2]?.includes('mkdir -p')) {
      const path = e.argv[5] ?? ''
      standIn.files[path] = standIn.files[path] ?? ''

      return done('')
    }
    if (e.argv[0] === '/bin/sh' && e.argv[2]?.includes('| head -c')) {
      standIn.ran.push([...e.argv])
      const bytes = encoder.encode(standIn.files[e.argv[5] ?? ''] ?? '')
      const from = Number(e.argv[4]) - 1

      return done(decoder.decode(bytes.slice(from, from + Number(e.argv[6]))))
    }
    if (e.argv[0] === '/usr/sbin/scutil') return done('Test Mac\n')
    // The keychain, as `security find-generic-password -s hubblerc-likely -w` answers: the password and a newline, or 44.
    if (e.argv[0] === '/usr/bin/security') {
      standIn.keychainReads += 1
      if (standIn.keychain === null || !e.argv.includes('hubblerc-likely')) {
        return { value: { exitCode: 44, stdout: '', stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n', isStdoutTruncated: false, isStderrTruncated: false } }
      }

      return done(`${standIn.keychain}\n`)
    }
    if (e.argv[0] === '/usr/bin/zip') {
      standIn.ran.push([...e.argv, `cwd=${e.init?.cwd ?? ''}`])

      return done('')
    }
    // The status hubblerc polls must never take the index lock a person's commit needs.
    if (e.argv.includes('status')) standIn.gitStatusArgs.push([...e.argv])
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const isMachine = e.argv[0] === '/usr/sbin/sysctl' || e.argv[0] === '/usr/bin/sw_vers'
    if (isMachine && standIn.failMachineReads > 0) {
      if (e.argv[0] === '/usr/bin/sw_vers') standIn.failMachineReads -= 1

      return { value: { exitCode: 1, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    standIn.ran.push([...e.argv])
    // The transcript, found by the session's id; its last custom-title row.
    if (e.argv[0] === '/bin/sh' && e.argv.includes('"type":"custom-title"')) {
      return ok(standIn.sessionName === null ? '' : `${JSON.stringify({ type: 'custom-title', customTitle: standIn.sessionName, sessionId: standIn.sessionId })}\n`)
    }
    if (e.argv[0] === '/bin/sh' && e.argv.some(arg => arg.includes('Ultracode (on|off)'))) return ok(standIn.ultracodeRow === '' ? '' : `${standIn.ultracodeRow}\n`)
    if (e.argv[0] === '/bin/sh' && e.argv[2]?.includes('projects')) return ok(`/home/me/.claude/projects/-repo-hubblerc/${standIn.sessionId}.jsonl\n`)
    if (e.argv[0] === '/usr/sbin/sysctl') return ok('Apple M3 Pro\n19327352832\n')
    // 13.7 GiB in use (app, wired, compressed); 256 GB left on the disk.
    if (e.argv[0] === '/usr/bin/vm_stat') return ok('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                     6279.\nPages wired down:                             198111.\nPages purgeable:                               15550.\nAnonymous pages:                              392549.\nPages stored in compressor:                   625561.\nPages occupied by compressor:                 323642.\n')
    if (e.argv[0] === '/bin/df') return ok('Filesystem     1024-blocks     Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s1s1   482797652 13339736 250280580     6%  484019 2502817280    0%   /\n')
    if (e.argv[0] === '/usr/bin/sw_vers') return ok('27.0.1\n')
    if (e.argv[0] === 'sh') return ok(`${standIn.installedVersions.join('\n')}\n`)
    if (e.argv.includes('--numstat')) return ok(standIn.gitNumstat)
    if (e.argv.includes('rev-parse')) {
      return { value: { exitCode: 0, stdout: '/repo/hubblerc\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }

    return {
      value: { exitCode: 0, stdout: '## main...origin/main\n M hooks/band.tsx\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  // The read answers the merged settings; a read of one key is that object, projected.
  on('settings.read', () => ({
    value: { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } }, ...(standIn.ultracodeSetting ? { ultracode: true } : {}) } as never,
  }))
  on('ui.toast', (_, e) => {
    standIn.toasts.push(e)

    return { value: undefined as never }
  })
  on('ui.panes', () => {
    standIn.paneReads += 1

    return { value: [...standIn.panes] }
  })
  on('ui.open', (_, e) => {
    standIn.opened.push(e)
    if (!standIn.panes.some(pane => pane.id === e.id)) {
      standIn.panes.push({ id: e.id, title: e.title ?? e.id, isShown: placeOnOpen, isFocused: false, isPlaced: placeOnOpen })
    }
    if (e.focus === true && standIn.grantsFocus) standIn.panes = standIn.panes.map(pane => (pane.id === e.id ? { ...pane, isFocused: true } : pane))

    return { value: placeOnOpen ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'under 144 columns' } }
  })
  on('ui.close', (_, e) => {
    standIn.panes = standIn.panes.filter(pane => pane.id !== e.id)

    return { value: undefined }
  })
  on('model.complete', async (_, e) => {
    standIn.completions.push(e)
    if (standIn.completionDelayMs > 0) await standIn.clock.sleep(standIn.completionDelayMs)
    const usage = { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    if (standIn.completion === null) {
      return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as never, usage } }
    }

    return { value: { isAnswered: true as const, text: standIn.completion, usage } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_, e) => {
    if (e.tool === 'Agent') return { result: { status: 'async_launched', agentId: 'ag-1' } as never }
    // A command that removes is refused, as a person might: a failed call.
    if (e.tool === 'Bash' && String((e as { command?: unknown }).command).startsWith('rm')) return { deny: 'refused' }
    if (e.tool === 'Write') return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [] } as never }
    // A command that exits non-zero, as the Bash tool reports it: an error.
    if (e.tool === 'Bash' && String((e as { command?: unknown }).command).startsWith('false')) return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }

    return { result: {} as never }
  })

  return standIn
}

/** A 4×2 PNG, base64. */
export const PNG_4X2 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC'

/**
 * The cat's pictures as assets/cat holds them: one awake frame, which every mood shows. Without
 * them the sidebar draws no cat.
 */
export function catPictures(on: On): void {
  on('fs.list', (_, e) => (e.path.endsWith('/assets/cat/awake') ? { value: [{ name: '01.png', kind: 'file' as const, size: 70, mtimeMs: 0, isLink: false }] } : { deny: 'no folder' }))
  on('fs.read', (_, e) => (e.path.includes('/assets/cat/awake/') ? { value: { base64: PNG_4X2 } as never } : { deny: 'no file' }))
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo/hubblerc', surface: 'terminal', isInteractive: true })
}
