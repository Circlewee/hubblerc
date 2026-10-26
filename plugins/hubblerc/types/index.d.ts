/** One tool call made while a main-loop turn ran. */
export type ToolRun = {
  /** The call's tool_use_id ('' when the engine gave none). */
  id: string
  tool: string
  /** Set when a subagent made the call; absent on the main loop. */
  agentId?: string
  /** How long the call took, in milliseconds. */
  ms: number
  /** True when the tool failed or the call was refused. */
  isError: boolean
  /** The file the call read or changed. */
  path?: string
  /** Bash: what the model said the command is for, and the command. Agent: the task it was given. */
  description?: string
  command?: string
  /** Grep and Glob: the pattern. WebSearch: the query. */
  pattern?: string
  /** Agent: the kind of subagent and the id of the one it started. */
  agentType?: string
  spawned?: string
  /** Edit and Write: lines added and removed. */
  added?: number
  removed?: number
}

/** One main-loop turn of the session and the tool calls made while it ran. */
export type TurnRecord = {
  /** The turn's id, as turn.start and turn.complete carry it. */
  id: string
  /** The start of the prompt that began the turn, wrapper tags taken off ('' for a continuation). */
  prompt: string
  /**
   * The id of the transcript row that closes the turn ("Baked for 3s"), which its line is drawn
   * from. Absent until the engine appends that row.
   */
  lineId?: string
  /** The id of the transcript row of the question that began the turn, when the person typed it. */
  promptRowId?: string
  /** What that row shows, flattened (`promptKey`): how the contents find the row without its id. */
  promptKey?: string
  startedAt: number
  /** Set when the turn completes; null while it runs. */
  durationMs: number | null
  runs: ToolRun[]
  /**
   * Subagents started during this turn. Their tool calls count here, even after the turn ends
   * (a background agent keeps working). Absent on records made before this field existed.
   */
  agents?: string[]
  /**
   * Rebuilt from the transcript when the session was opened again (--resume, /resume): the
   * transcript keeps no times, so `durationMs` is 0 and each run's `ms` is unknown (0).
   */
  restored?: true
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A tool call still running, on the main loop or in a subagent. */
export type RunningCall = {
  id: string
  tool: string
  /** What the band names it by: a Bash call's purpose, a file's name, ... ('' when nothing fits). */
  label: string
  startedAt: number
  agentId?: string
}

/** A todo of the main loop, from TodoWrite or TaskCreate/TaskUpdate. */
export type TodoItem = {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** A subagent as `$.agent.list()` last reported it, with when it started when known. */
export type AgentSeen = {
  id: string
  type: string
  description: string
  status: string
  startedAt?: number
}

export type RateWindow = { percent: number; resetsAt?: string }

/** The status line's figures, as `$.session.usage()` last reported them. */
export type UsageSnapshot = {
  contextPercent?: number
  fiveHour?: RateWindow
  sevenDay?: RateWindow
  costUsd?: number
}

export type GitInfo = { branch: string; isDirty: boolean }

declare module 'claude-code' {
  interface PluginState {
    hubblerc: {
      turns: TurnRecord[]
      /** The session the turns belong to: another one (a resume, /clear) rebuilds them. */
      sessionId: string
      running: RunningCall[]
      todos: TodoItem[]
      agents: AgentSeen[]
      /** When each subagent this session started was started, by agent id. */
      agentStarts: Record<string, number>
      usage: UsageSnapshot | null
      git: GitInfo | null
      /** The working folder's name. */
      project: string
      /** The session's model id (`claude-opus-5-5`). */
      model: string
      /** The effort this session's requests are sent with in place of the engine's; null: the engine's. */
      effortOverride: EffortLevel | null
      /** The effort the engine sends with, as the last main-loop request carried it or settings say. */
      engineEffort: string | null
      /** Bumped by the band's timer so elapsed times and countdowns redraw. */
      tick: number
      /** When the effort slider was opened (it stands in line 3); null while closed. */
      effortPicker: number | null
    }
  }
}
