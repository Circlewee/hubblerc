import type { EffortLevel, TaskKind } from '../../types'

/**
 * Auto effort in two halves (2026-11-11): the small model sorts a message by the kind of work it asks
 * for, knowing nothing of the model that answers; this table says what effort each kind gets on each
 * model. Effort names do not mean the same amount of thinking across models or versions, so a row is
 * keyed by the full model id, version included, and a model without a row inherits nothing: its
 * turns go out at the engine's effort.
 */

/** The kinds, in the order of how much work they are. */
export const TASK_KINDS: readonly TaskKind[] = ['ask', 'routine', 'hard', 'long']

/** The kind a turn is taken for when no pick came in time: not the lightest, not the costliest. */
export const FALLBACK_KIND: TaskKind = 'hard'

export const TASK_LABELS: Record<TaskKind, string> = { ask: '질문·조회', routine: '일상 작업', hard: '설계·디버깅', long: '큰 장기 작업' }

/**
 * First values (2026-11-11), from the effort sweeps Anthropic published (system cards, launch posts,
 * Optimizing for cost and intelligence) and two independent ones (Artificial Analysis, ARC Prize);
 * the figures and the rule are in docs/spec.md. The sweeps are of hard coding, agentic and research
 * tasks, so `ask` and `routine` are read off them, not measured. Rule: `ask` the lowest level before
 * the scores fall off, `routine` the lowest within about 3 points of `high` on everyday coding sets,
 * `hard` the level past which a step buys under about 3 points for twice the cost or more, `long`
 * one above it where a gain was published, never past `xhigh` (above it is only `max`, which auto
 * never sends), so `long` equals `hard` where `hard` is already `xhigh`. `long` is work of 30
 * minutes or more with no one watching: the size at which the sweeps show a gain above `high`.
 */
export const EFFORT_TABLE: Readonly<Record<string, Readonly<Record<TaskKind, EffortLevel>>>> = {
  // low falls off (AA index 35 to 48, Terminal-Bench 4.0 38.5% to 57.6%); medium within 2.5 of high on SWE-bench Pro and
  // the top on FrontierCode; high +6.6 on Terminal-Bench 4.0 for 1.3 times; xhigh on GDPval-AA 98.6% of max on half the tokens.
  'claude-opus-5-5': { ask: 'medium', routine: 'medium', hard: 'high', long: 'xhigh' },
  // low holds (AA 54 to 56, HLE 68.4 to 68.6); medium level with high on SWE-bench Pro; high +7.7 on FrontierCode 2.0;
  // xhigh its top there (49.1%, max lower) but level with high on the AA index for 1.6 times: the person chose xhigh for long.
  'claude-fable-5-2': { ask: 'low', routine: 'medium', hard: 'high', long: 'xhigh' },
  // medium 7 to 15 points under high on coding; xhigh +5.3 on CursorBench and +8 on the AA index.
  // hard xhigh (2026-11-11, the person's decision to follow the rule): high to xhigh still buys over 3 points (+8 AA, +5.3 CursorBench) for 2.5 times.
  'claude-sonnet-5-5': { ask: 'medium', routine: 'high', hard: 'xhigh', long: 'xhigh' },
  // No coding sweep published: from the AA index (19, 25, 30, 35, 36) and ARC-AGI-2 alone. The weakest row.
  // hard xhigh (2026-11-11, the person's decision to follow the rule): high to xhigh buys +5 on the AA index for 1.6 times.
  'claude-haiku-5-5': { ask: 'medium', routine: 'high', hard: 'xhigh', long: 'xhigh' },
}

/** The model's row, its id matched with or without a `[1m]` suffix; undefined for a model without one. */
export function levelsFor(modelId: string): Readonly<Record<TaskKind, EffortLevel>> | undefined {
  return EFFORT_TABLE[modelId.replace(/\[.*\]$/, '')]
}

export function isTaskKind(value: unknown): value is TaskKind {
  return TASK_KINDS.some(kind => kind === value)
}
