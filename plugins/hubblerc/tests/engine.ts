import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, SessionMessage, UiPane } from 'claude-code'

export const NOW = Date.parse('2026-10-25T09:00:00Z')

export type StandIn = {
  clock: MockClock
  /** The panes open now, as `$.ui.panes()` answers; a test may change them. */
  panes: UiPane[]
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
  /** What the small model answers a completion (null: the call fails), and every request made. */
  completion: string | null
  completions: { model: string; system?: unknown; prompt: unknown }[]
  /** The 5-hour window's percent `$.session.usage()` answers; a test may change it. */
  fiveHourPercent: number
  /** The files of `~/.local/share/claude/versions`, and what the npm registry calls latest. */
  installedVersions: string[]
  latestVersion: string
}

/**
 * Nothing sits beneath the plugin: these hooks stand for the engine and what it reports. A pane
 * opens placed and shown unless `placeOnOpen` is false (a terminal too narrow for it).
 */
export function standInForEngine(on: On, { agents = [] as unknown[], placeOnOpen = true } = {}): StandIn {
  const standIn: StandIn = { clock: mock.clock(on, { now: NOW }), panes: [], opened: [], sessionId: 'session-1', messages: [], sent: [], agentMessages: {}, toasts: [], completion: 'high', completions: [], fiveHourPercent: 25, installedVersions: ['2.1.309', '2.1.310'], latestVersion: '2.1.310' }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } as never }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/repo/hubblerc' }))
  on('session.id', () => ({ value: standIn.sessionId }))
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
  on('agent.list', () => ({ value: agents as never }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ name: '@anthropic-ai/claude-code', version: standIn.latestVersion }) } }))
  on('session.version', () => ({ value: { version: '2.1.310', base: '2.1.310' } }))
  on('process.run', (_, e) => {
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    // Booted a day, two hours and five minutes before NOW.
    if (e.argv[0] === 'sysctl') return ok(`Apple M3 Pro\n19327352832\n{ sec = ${(NOW - (26 * 60 + 5) * 60_000) / 1000}, usec = 0 } Sat Oct 24\n`)
    if (e.argv[0] === 'sw_vers') return ok('27.0.1\n')
    if (e.argv[0] === 'sh') return ok(`${standIn.installedVersions.join('\n')}\n`)
    if (e.argv.includes('rev-parse')) {
      return { value: { exitCode: 0, stdout: '/repo/hubblerc\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }

    return {
      value: { exitCode: 0, stdout: '## main...origin/main\n M hooks/band.tsx\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  // The read answers the merged settings; a read of one key is that object, projected.
  on('settings.read', () => ({
    value: { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } } as never,
  }))
  on('ui.toast', (_, e) => {
    standIn.toasts.push(e)

    return { value: undefined as never }
  })
  on('ui.panes', () => ({ value: [...standIn.panes] }))
  on('ui.open', (_, e) => {
    standIn.opened.push(e)
    if (!standIn.panes.some(pane => pane.id === e.id)) {
      standIn.panes.push({ id: e.id, title: e.title ?? e.id, isShown: placeOnOpen, isFocused: false, isPlaced: placeOnOpen })
    }

    return { value: placeOnOpen ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'under 144 columns' } }
  })
  on('ui.close', (_, e) => {
    standIn.panes = standIn.panes.filter(pane => pane.id !== e.id)

    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    standIn.completions.push(e)
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

    return { result: {} as never }
  })

  return standIn
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo/hubblerc', surface: 'terminal', isInteractive: true })
}
