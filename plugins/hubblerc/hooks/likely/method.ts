/**
 * How a decision is asked and read: an input and questions (a predicate, a choice, a score) go to the
 * model in several calls at once; each call states a probability for every answer, the options
 * shuffled and relabelled call by call (a predicate asked the other way round in half of them), and
 * the calls' numbers, put back in the questions' own order, are averaged. Pure: no engine here.
 */

/**
 * Raised whenever the prompt or the way probabilities are read and combined changes: records are
 * compared within one version, and a later calibration is fitted per version.
 */
export const METHOD_VERSION = 1

export type Question =
  | { type: 'predicate'; name: string; instructions: string }
  | { type: 'choice'; name: string; instructions: string; choices: { value: string; description?: string }[] }
  | { type: 'score'; name: string; instructions: string; levels: { label: string; description?: string }[] }

/**
 * A question answered: a predicate's chance of yes; a choice's option most likely and every option's
 * chance; a score's expected level (levels count from 0, as listed), the likeliest level and each
 * level's chance. `confidence` is the largest chance. Every call refused: a refusal.
 */
export type Answer =
  | { type: 'predicate'; name: string; probability: number; value: boolean }
  | { type: 'choice'; name: string; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; name: string; score: number; label: string; confidence: number; probabilities: { label: string; probability: number; value: number }[] }
  | { type: 'refusal'; name: string }

/** How one call shows a question: the original options in the order shown, and a predicate asked as "no". */
export type QuestionLayout = { order: number[]; negated: boolean }

/** How one call shows every question, and the symbols its options are listed under. */
export type CallLayout = { symbols: SymbolSet; questions: QuestionLayout[] }

export type SymbolSet = 'A' | 'a' | '1'

/** What a call's probability may be at most and at least once read: no answer is taken as certain. */
export const PROBABILITY_FLOOR = 0.02
export const PROBABILITY_CEILING = 0.98

/** Options a choice may have, and levels a score: listed under single letters, and kept short. */
export const MAX_OPTIONS = 20
export const MAX_SAMPLES = 10

/** The model's reply, the same for every decision: one entry a question, its probabilities in the order asked. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { probabilities: { type: 'array', items: { type: 'number' } } },
        required: ['probabilities'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
} as const

export const SYSTEM_PROMPT = [
  'You judge an input by answering questions about it with probabilities.',
  'Read the input, then give each question the probabilities it asks for.',
  'Reply with JSON only: "answers" has one entry per question, in the order the questions come, and each entry\'s "probabilities" lists the numbers its question asks for, in the order it asks for them.',
  'Every probability is a number from 0 to 1. Where a question lists options or levels, give one probability for each, adding up to 1.',
  'Be calibrated: of all the times you say 0.8, about 8 in 10 should turn out true. Do not hedge toward even odds, and do not claim certainty you lack.',
].join(' ')

/** Why a request cannot be asked; undefined when it can. */
export function invalidQuestions(questions: readonly Question[]): string | undefined {
  if (questions.length === 0) return 'no questions'
  const names = new Set<string>()
  for (const question of questions) {
    if (question.name.trim() === '' || names.has(question.name)) return `question names must be unique and not empty: "${question.name}"`
    names.add(question.name)
    if (question.instructions.trim() === '') return `${question.name}: no instructions`
    const count = question.type === 'choice' ? question.choices.length : question.type === 'score' ? question.levels.length : 2
    if (count < 2 || count > MAX_OPTIONS) return `${question.name}: 2 to ${MAX_OPTIONS} options or levels`
    if (question.type === 'choice' && new Set(question.choices.map(choice => choice.value)).size !== count) return `${question.name}: option values repeat`
  }

  return undefined
}

/** How many numbers a question's answer holds: a predicate's one, one an option or level. */
export function answerLength(question: Question): number {
  return question.type === 'predicate' ? 1 : question.type === 'choice' ? question.choices.length : question.levels.length
}

/** A generator of numbers in [0, 1) from a seed (mulberry32): the same decision id shuffles the same way. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over the text: a seed from a decision's id. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/** 0..n-1 in a random order (Fisher-Yates). */
export function shuffledOrder(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const held = order[i] ?? i
    order[i] = order[j] ?? j
    order[j] = held
  }

  return order
}

const SYMBOL_SETS: readonly SymbolSet[] = ['A', 'a', '1']

/** The symbols the options of a call are listed under: letters, small letters or numbers. */
export function symbolsOf(set: SymbolSet, n: number): string[] {
  return Array.from({ length: n }, (_, i) => (set === '1' ? String(i + 1) : String.fromCharCode((set === 'A' ? 65 : 97) + i)))
}

/**
 * How call `index` of a decision shows its questions: a choice's options in a random order; a
 * score's levels lowest first in even calls and highest first in odd ones (a scale stays a scale);
 * a predicate asked as "no" in odd calls. The symbols are drawn at random too.
 */
export function layoutCall(questions: readonly Question[], index: number, random: () => number): CallLayout {
  const symbols = SYMBOL_SETS[Math.floor(random() * SYMBOL_SETS.length)] ?? 'A'
  const isOdd = index % 2 === 1

  return {
    symbols,
    questions: questions.map(question => {
      if (question.type === 'predicate') return { order: [0], negated: isOdd }
      if (question.type === 'choice') return { order: shuffledOrder(question.choices.length, random), negated: false }
      const ascending = question.levels.map((_, i) => i)

      return { order: isOdd ? ascending.reverse() : ascending, negated: false }
    }),
  }
}

/** The user message of one call: the input, then each question as this call shows it. */
export function promptText(input: string, questions: readonly Question[], layout: CallLayout): string {
  const parts = [`<input>\n${input}\n</input>`]
  questions.forEach((question, i) => {
    const shown = layout.questions[i] ?? { order: [], negated: false }
    const head = `Question ${i + 1} of ${questions.length}`
    if (question.type === 'predicate') {
      parts.push(`${head} (yes or no)\n${question.instructions}\nGive 1 probability: that the answer is ${shown.negated ? 'NO' : 'YES'}.`)

      return
    }
    const symbols = symbolsOf(layout.symbols, shown.order.length)
    const items = question.type === 'choice' ? question.choices.map(choice => ({ name: choice.value, description: choice.description })) : question.levels.map(level => ({ name: level.label, description: level.description }))
    const lines = shown.order.map((original, k) => {
      const item = items[original]
      const description = item?.description === undefined || item.description === '' ? '' : ` - ${item.description}`

      return `${symbols[k] ?? k + 1}. ${item?.name ?? ''}${description}`
    })
    if (question.type === 'choice') {
      parts.push(`${head} (one of the options)\n${question.instructions}\nOptions:\n${lines.join('\n')}\nGive ${lines.length} probabilities, one per option, in the order listed.`)
    } else {
      const direction = (shown.order[0] ?? 0) === 0 ? 'lowest first' : 'highest first'
      parts.push(`${head} (a level on a scale)\n${question.instructions}\nLevels, ${direction}:\n${lines.join('\n')}\nGive ${lines.length} probabilities, one per level, in the order listed.`)
    }
  })

  return parts.join('\n\n')
}

export type CallRequest = { model: string; input: string; questions: readonly Question[]; layout: CallLayout; thinking: boolean }

/** Output tokens a call may take: the JSON alone is short; thinking (at low effort) takes room before it. */
export const MAX_TOKENS = 400
export const MAX_TOKENS_THINKING = 3000

/**
 * A Messages API request: no sampling parameters (Claude Haiku 5.5 refuses any), the reply held to
 * `OUTPUT_SCHEMA` by structured outputs, effort low; thinking off, or adaptive (Haiku 5.5 takes no
 * thinking budget: its effort sets how much it thinks).
 */
export function requestBody(request: CallRequest): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.thinking ? MAX_TOKENS_THINKING : MAX_TOKENS,
    thinking: request.thinking ? { type: 'adaptive' } : { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText(request.input, request.questions, request.layout) }],
  }
}

/** What a call answered: its numbers per question as given, a refusal, or a reply that cannot be read. */
export type Reply = { kind: 'answered'; values: number[][] } | { kind: 'refused' } | { kind: 'invalid'; reason: string }

/** Reads a Messages API response body (already parsed JSON). */
export function readReply(body: unknown): Reply {
  if (!isRecord(body)) return { kind: 'invalid', reason: 'not an object' }
  if (body.stop_reason === 'refusal') return { kind: 'refused' }
  if (body.stop_reason === 'max_tokens') return { kind: 'invalid', reason: 'max_tokens' }
  const blocks = Array.isArray(body.content) ? body.content : []
  const text = blocks
    .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'invalid', reason: 'reply is not JSON' }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return { kind: 'invalid', reason: 'no answers' }
  const values: number[][] = []
  for (const answer of parsed.answers) {
    const probabilities = isRecord(answer) ? answer.probabilities : undefined
    if (!Array.isArray(probabilities) || !probabilities.every(value => typeof value === 'number')) return { kind: 'invalid', reason: 'probabilities are not numbers' }
    values.push(probabilities as number[])
  }

  return { kind: 'answered', values }
}

/**
 * One question's numbers as a call gave them, made a distribution over the question's own options:
 * each in [0, 1] (else unreadable: null), scaled to add up to 1, put back in the original order (a
 * predicate asked as "no" turned into yes), each held to [0.02, 0.98] and scaled again. A predicate's
 * is one number, its chance of yes.
 */
export function toDistribution(received: readonly number[], question: Question, layout: QuestionLayout): number[] | null {
  const n = answerLength(question)
  if (received.length !== n || layout.order.length !== n) return null
  if (!received.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null
  if (question.type === 'predicate') {
    const value = received[0] ?? 0.5

    return [clip(layout.negated ? 1 - value : value)]
  }
  const sum = received.reduce((total, value) => total + value, 0)
  if (sum <= 0) return null
  const original = new Array<number>(n).fill(0)
  layout.order.forEach((index, k) => {
    original[index] = (received[k] ?? 0) / sum
  })

  return normalize(original.map(clip))
}

/** Every question's distribution from one call's reply, or why the reply cannot be used. */
export function distributionsOf(values: readonly number[][], questions: readonly Question[], layout: CallLayout): number[][] | string {
  if (values.length !== questions.length) return `${values.length} answers for ${questions.length} questions`
  const distributions: number[][] = []
  for (const [i, question] of questions.entries()) {
    const distribution = toDistribution(values[i] ?? [], question, layout.questions[i] ?? { order: [], negated: false })
    if (distribution === null) return `${question.name}: probabilities out of range or of the wrong count`
    distributions.push(distribution)
  }

  return distributions
}

/** The calls' distributions of each question averaged, as answers. None: every question refused. */
export function combine(questions: readonly Question[], samples: readonly number[][][]): Answer[] {
  return questions.map((question, i) => {
    const each = samples.map(sample => sample[i]).filter((distribution): distribution is number[] => distribution !== undefined)
    if (each.length === 0) return { type: 'refusal', name: question.name }

    return toAnswer(question, mean(each))
  })
}

/** The element-wise mean of distributions of one length. */
export function mean(distributions: readonly number[][]): number[] {
  const n = distributions[0]?.length ?? 0
  const sums = new Array<number>(n).fill(0)
  for (const distribution of distributions) distribution.forEach((value, i) => (sums[i] = (sums[i] ?? 0) + value))

  return sums.map(sum => sum / distributions.length)
}

export function toAnswer(question: Question, distribution: readonly number[]): Answer {
  if (question.type === 'predicate') {
    const probability = round(distribution[0] ?? 0.5)

    return { type: 'predicate', name: question.name, probability, value: probability >= 0.5 }
  }
  const best = distribution.reduce((top, value, i) => (value > (distribution[top] ?? -1) ? i : top), 0)
  const confidence = round(distribution[best] ?? 0)
  if (question.type === 'choice') {
    return {
      type: 'choice',
      name: question.name,
      choice: question.choices[best]?.value ?? '',
      confidence,
      probabilities: Object.fromEntries(question.choices.map((choice, i) => [choice.value, round(distribution[i] ?? 0)])),
    }
  }

  return {
    type: 'score',
    name: question.name,
    score: round(distribution.reduce((total, value, i) => total + value * i, 0)),
    label: question.levels[best]?.label ?? '',
    confidence,
    probabilities: question.levels.map((level, i) => ({ label: level.label, probability: round(distribution[i] ?? 0), value: i })),
  }
}

export function clip(value: number): number {
  return Math.min(PROBABILITY_CEILING, Math.max(PROBABILITY_FLOOR, value))
}

function normalize(values: readonly number[]): number[] {
  const sum = values.reduce((total, value) => total + value, 0)

  return values.map(value => value / sum)
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** How far the calls of a decision part on a question: the largest less the smallest of their values, and their standard deviation. */
export type Spread = { name: string; range: number; sd: number }

/**
 * Each question's spread over the calls that answered: a predicate's chance of yes, a choice's or a
 * score's chance of the option the decision chose (the likeliest on average). What the robustness of
 * a decision is measured by: the calls show the same question in other orders, symbols and wordings.
 */
export function spreadOf(questions: readonly Question[], samples: readonly number[][][]): Spread[] {
  return questions.flatMap((question, i) => {
    const each = samples.map(sample => sample[i]).filter((distribution): distribution is number[] => distribution !== undefined)
    if (each.length === 0) return []
    const average = mean(each)
    const top = question.type === 'predicate' ? 0 : average.reduce((best, value, k) => (value > (average[best] ?? -1) ? k : best), 0)

    return [{ name: question.name, ...spreadOfValues(each.map(distribution => distribution[top] ?? 0)) }]
  })
}

/** The largest less the smallest of some values, and their standard deviation, to four places. */
export function spreadOfValues(values: readonly number[]): { range: number; sd: number } {
  if (values.length === 0) return { range: 0, sd: 0 }
  const average = values.reduce((total, value) => total + value, 0) / values.length
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length

  return { range: round(Math.max(...values) - Math.min(...values)), sd: round(Math.sqrt(variance)) }
}
