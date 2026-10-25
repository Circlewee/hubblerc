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
  /** Bash: what the model said the command is for, and the command. */
  description?: string
  command?: string
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
  startedAt: number
  /** Set when the turn completes; null while it runs. */
  durationMs: number | null
  runs: ToolRun[]
  /**
   * Subagents started during this turn. Their tool calls count here, even after the turn ends
   * (a background agent keeps working). Absent on records made before this field existed.
   */
  agents?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    hubblerc: {
      turns: TurnRecord[]
    }
  }
}
