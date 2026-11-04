/**
 * The decision log: one JSON line a decision in a machine's own `<machine>.jsonl`, and the answer
 * that turned out true appended later as a line of its own (the file is only ever appended to).
 * Read back for `/decide stats`. Pure: the engine side writes and reads the files.
 */
import type { Tokens } from './cost'
import type { Answer, CallLayout, Question } from './method'

/** One call of a decision as logged: how it showed the questions, what it gave back, and what it took. */
export type CallLog = {
  layout: CallLayout
  /** The numbers as the call gave them, per question in the order shown. */
  received?: number[][]
  /** Each question's distribution from this call, in the question's own order (a predicate's chance of yes). */
  distributions?: number[][]
  refused?: true
  /** Why the call gave nothing usable: an HTTP error, a reply out of shape. */
  error?: string
  latencyMs: number
  tokens: Tokens
}

export type DecisionLine = {
  type: 'decision'
  id: string
  /** ISO time the decision was asked. */
  at: string
  task: string
  methodVersion: number
  model: string
  /** Calls asked for. */
  samples: number
  thinking: boolean
  effort: 'low'
  /** The input as sent, secrets masked. */
  input: string
  questions: Question[]
  calls: CallLog[]
  answers: Answer[]
  latencyMs: number
  tokens: Tokens
  costUsd: number
  /** What a caller adds (a Bash call's id). */
  meta?: Record<string, string>
  /** Filled by an `outcome` line appended later; null here always. */
  outcome: null
}

/** What came true for a decision, appended once known: for a predicate, whether it held; null when unknowable. */
export type OutcomeLine = { type: 'outcome'; id: string; at: string; outcome: boolean | string | null; note?: string }

/** How many characters of the input a decision sends and logs. */
export const MAX_INPUT_CHARS = 4000

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // A value named as a key, token, secret or password: `API_KEY=…`, `"password": "…"`, `token: …`.
  [/\b([A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|credential)[A-Za-z0-9_.-]*)("?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"'&;|,)]+)/gi, '$1$2***'],
  // A flag's: `--password …`, `--token=…`.
  [/(--?(?:password|passwd|token|secret|api-?key)[= ])("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  // A header's: `Bearer …`, `Basic …`.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 ***'],
  // API keys of the `sk-` kind (Anthropic's `sk-ant-…`, OpenAI's).
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  // Long hex: 32 characters and more.
  [/\b[0-9a-fA-F]{32,}\b/g, '***'],
  // Long base64 or URL-safe tokens holding letters and digits: 32 characters and more, no slash (a path is not one).
  [/(?<![A-Za-z0-9+_-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{32,}={0,2}/g, '***'],
]

/** The text with what looks like a secret masked as `***`. */
export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), text)
}

/** A machine's name made a file name: letters, digits, `.`, `_` and `-`, the rest one `-`; `mac` when nothing is left. */
export function safeFileName(name: string): string {
  const safe = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 64)

  return safe === '' ? 'mac' : safe
}

/** The bytes a text takes in UTF-8. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }

  return bytes
}

/** A decision as `/decide stats` reads it, with what came true when an outcome line was found. */
export type LoggedDecision = {
  id: string
  task: string
  methodVersion: number
  thinking: boolean
  /** The first predicate's chance of yes, when the decision has a predicate answered. */
  probability?: number
  costUsd: number
  /** undefined: no outcome line yet; null: known to be unknowable. */
  outcome?: boolean | string | null
}

/** Reads log lines into decisions by id; a line that is not one of ours is skipped. */
export function readLog(text: string, into: Map<string, LoggedDecision> = new Map()): Map<string, LoggedDecision> {
  const outcomes: { id: string; outcome: boolean | string | null }[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(row) || typeof row.id !== 'string') continue
    if (row.type === 'outcome') {
      const outcome = row.outcome
      outcomes.push({ id: row.id, outcome: typeof outcome === 'boolean' || typeof outcome === 'string' ? outcome : null })
    } else if (row.type === 'decision' && typeof row.task === 'string') {
      const answers = Array.isArray(row.answers) ? row.answers : []
      const predicate = answers.find((answer): answer is { type: 'predicate'; probability: number } => isRecord(answer) && answer.type === 'predicate' && typeof answer.probability === 'number')
      const decision: LoggedDecision = {
        id: row.id,
        task: row.task,
        methodVersion: typeof row.methodVersion === 'number' ? row.methodVersion : 0,
        thinking: row.thinking === true,
        costUsd: typeof row.costUsd === 'number' ? row.costUsd : 0,
      }
      if (predicate !== undefined) decision.probability = predicate.probability
      const known = into.get(row.id)
      if (known?.outcome !== undefined) decision.outcome = known.outcome
      into.set(row.id, decision)
    }
  }
  // Outcomes after their decisions, wherever in the text they stood.
  for (const { id, outcome } of outcomes) {
    const decision = into.get(id)
    if (decision !== undefined) decision.outcome = outcome
    else into.set(id, { id, task: '', methodVersion: 0, thinking: false, costUsd: 0, outcome })
  }

  return into
}

export type Bin = { from: number; to: number; count: number; meanProbability: number; actual: number }

export type Calibration = { count: number; brier: number; ece: number; accuracy: number; baseRate: number; bins: Bin[] }

/**
 * How well predicted chances match what came true: the Brier score (mean squared error), the
 * expected calibration error over ten equal bins (each bin's |mean prediction - share true|,
 * weighted by its count), the accuracy at 0.5, and each bin's figures.
 */
export function calibrationOf(pairs: readonly { probability: number; actual: boolean }[]): Calibration | null {
  if (pairs.length === 0) return null
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, to: (i + 1) / 10, count: 0, sum: 0, hits: 0 }))
  let squared = 0
  let correct = 0
  let trues = 0
  for (const { probability, actual } of pairs) {
    const y = actual ? 1 : 0
    squared += (probability - y) ** 2
    if (probability >= 0.5 === actual) correct += 1
    trues += y
    const bin = bins[Math.min(9, Math.max(0, Math.floor(probability * 10)))]
    if (bin !== undefined) {
      bin.count += 1
      bin.sum += probability
      bin.hits += y
    }
  }
  const n = pairs.length
  const ece = bins.reduce((total, bin) => (bin.count === 0 ? total : total + (bin.count / n) * Math.abs(bin.sum / bin.count - bin.hits / bin.count)), 0)

  return {
    count: n,
    brier: squared / n,
    ece,
    accuracy: correct / n,
    baseRate: trues / n,
    bins: bins.map(bin => ({ from: bin.from, to: bin.to, count: bin.count, meanProbability: bin.count === 0 ? 0 : bin.sum / bin.count, actual: bin.count === 0 ? 0 : bin.hits / bin.count })),
  }
}

/** The decisions of a task whose predicate has a yes-or-no outcome: what `calibrationOf` takes. */
export function predicatePairs(decisions: Iterable<LoggedDecision>, task: string, filter: (decision: LoggedDecision) => boolean = () => true): { probability: number; actual: boolean }[] {
  const pairs: { probability: number; actual: boolean }[] = []
  for (const decision of decisions) {
    if (decision.task !== task || decision.probability === undefined || typeof decision.outcome !== 'boolean' || !filter(decision)) continue
    pairs.push({ probability: decision.probability, actual: decision.outcome })
  }

  return pairs
}

/** Count of decisions and of those with an outcome, by task, most decisions first. */
export function taskCounts(decisions: Iterable<LoggedDecision>): { task: string; count: number; withOutcome: number }[] {
  const counts = new Map<string, { count: number; withOutcome: number }>()
  for (const decision of decisions) {
    if (decision.task === '') continue
    const entry = counts.get(decision.task) ?? { count: 0, withOutcome: 0 }
    entry.count += 1
    if (decision.outcome !== undefined && decision.outcome !== null) entry.withOutcome += 1
    counts.set(decision.task, entry)
  }

  return [...counts.entries()].map(([task, entry]) => ({ task, ...entry })).sort((a, b) => b.count - a.count || a.task.localeCompare(b.task))
}

/** Lines of a calibration: the figures, then the bins with any decision, prediction against what came true. */
export function calibrationLines(label: string, calibration: Calibration | null): string[] {
  if (calibration === null) return [`${label}: 정답 붙은 판정 없음`]
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  const lines = [
    `${label}: ${calibration.count}건 · Brier ${calibration.brier.toFixed(3)} · ECE ${calibration.ece.toFixed(3)} · 정확도 ${percent(calibration.accuracy)} (0.5 기준) · 실제 비율 ${percent(calibration.baseRate)}`,
    '  구간        건수   예측    실제',
  ]
  for (const bin of calibration.bins) {
    if (bin.count === 0) continue
    lines.push(`  ${bin.from.toFixed(1)}~${bin.to.toFixed(1)}  ${String(bin.count).padStart(6)}   ${bin.meanProbability.toFixed(2)}    ${bin.actual.toFixed(2)}`)
  }

  return lines
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
