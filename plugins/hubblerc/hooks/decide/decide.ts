import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { DecideStatus } from '../../types'
import { addSpend, addTokens, costOf, dollars, limitReached, NO_TOKENS, spendAt, tokensOf } from './cost'
import type { Limits, Spend, Tokens } from './cost'
import { combine, distributionsOf, invalidQuestions, layoutCall, MAX_SAMPLES, METHOD_VERSION, readReply, requestBody, seededRandom, seedOf } from './method'
import type { Answer, Question, Reply } from './method'
import { maskSecrets, MAX_INPUT_CHARS, safeFileName, utf8Length } from './record'
import type { CallLog, DecisionLine, OutcomeLine } from './record'

const decideStatus = atom({ plugin: 'hubblerc', key: 'decideStatus' } as const, null)

export const API_URL = 'https://api.anthropic.com/v1/messages'
export const API_VERSION = '2026-10-21'
export const DEFAULT_MODEL = 'claude-haiku-5-5'
/** Where this machine's totals are kept (`$.store` is the machine's own). */
const SPEND_KEY = 'decideSpend'

/** The decide options of the plugin's `userConfig`, read once a load. */
export type DecideOptions = {
  /** The Anthropic API key (a secret option); '' when unset: nothing is decided. */
  apiKey: string
  model: string
  /** A runaway guard: decisions stop for the day once they cost this much. */
  dailyCapUsd: number
  /** The budget period's limit, the measure the spend is managed by. */
  budgetUsd: number
  /** The day of the month a budget period starts, 1 to 31. */
  periodStartDay: number
  /** The log's folder as set; '' for the default. */
  logDir: string
}

export function decideOptions(raw: PluginOptions): DecideOptions {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const amount = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback)
  const day = typeof raw.decidePeriodStartDay === 'number' && Number.isFinite(raw.decidePeriodStartDay) ? Math.round(raw.decidePeriodStartDay) : 1

  return {
    apiKey: text(raw.anthropicApiKey),
    model: text(raw.decideModel) || DEFAULT_MODEL,
    dailyCapUsd: amount(raw.decideDailyCapUsd, 5),
    budgetUsd: amount(raw.decideMonthlyBudgetUsd, 100),
    periodStartDay: Math.min(31, Math.max(1, day)),
    logDir: text(raw.decideLogDir),
  }
}

let options: DecideOptions = decideOptions({})

/** At load (`register`): the options a change in `/config` reloads the module with. */
export function configureDecide(raw: PluginOptions): void {
  options = decideOptions(raw)
}

/** Whether decisions can be made at all: an API key is set. */
export function hasApiKey(): boolean {
  return options.apiKey !== ''
}

export function currentOptions(): Readonly<DecideOptions> {
  return options
}

/** The log's folder and this machine's file, found once a session. */
let logFile: { dir: string; path: string } | null = null
/** The folder was made (and the file, private) this session: an append needs no shell. */
let isLogReady = false
/** The machine's totals are read, changed and written one change at a time within the session. */
let spendQueue: Promise<unknown> = Promise.resolve()
/** Lines are appended one at a time. */
let writeQueue: Promise<unknown> = Promise.resolve()

/** At session.start: what the sidebar shows of the spend, and the command. */
export async function startDecide($: EngineInterface): Promise<void> {
  logFile = null
  isLogReady = false
  await refreshDecideStatus($)
}

/**
 * The sidebar's line from the machine's totals: at session.start, after each decision, and on the
 * 30-second tick while the sidebar shows (another session's decisions, a new day). Null with no key.
 */
export async function refreshDecideStatus($: EngineInterface): Promise<void> {
  const next = hasApiKey() ? statusOf(spendAt(await $.store.get(SPEND_KEY), await $.clock.now(), options.periodStartDay)) : null
  if (JSON.stringify(next) !== JSON.stringify(await read($, decideStatus))) await update($, decideStatus, () => next)
}

function statusOf(spend: Spend): DecideStatus {
  return { todayCount: spend.dayCount, periodUsd: Math.round(spend.periodUsd * 10_000) / 10_000, budgetUsd: options.budgetUsd }
}

/** The machine's totals as they stand now. */
export async function currentSpend($: EngineInterface): Promise<Spend> {
  return spendAt(await $.store.get(SPEND_KEY), await $.clock.now(), options.periodStartDay)
}

/** A change to the machine's totals, after the changes before it: `change` answers the new totals (null: none) and a value. */
async function withSpend<T>($: EngineInterface, change: (spend: Spend) => { spend: Spend | null; value: T }): Promise<T> {
  const work = async () => {
    const changed = change(await currentSpend($))
    if (changed.spend !== null) await $.store.set(SPEND_KEY, changed.spend)

    return changed.value
  }
  const run = spendQueue.then(work, work)
  spendQueue = run.catch(() => undefined)

  return run
}

export type DecideRequest = {
  /** What the decision is for (`bash-fail`): the log and `/decide stats` group by it. */
  task: string
  input: string
  questions: Question[]
  /** Calls made at once, 1 to 10; 5 when not given. */
  samples?: number
  /** Adaptive thinking at low effort; off when not given. */
  thinking?: boolean
  /** Logged with the decision. */
  meta?: Record<string, string>
}

/** One call's outcome: its distributions in each question's own order, a refusal, or why it gave nothing. */
export type RawCall = { distributions?: number[][]; refused?: true; error?: string }

export type DecideResult = {
  id: string
  answers: Answer[]
  /** Each call's distributions, before averaging: what a later calibration is fitted on. */
  raw: RawCall[]
  /** Not yet: the chances are the model's own, averaged. */
  calibrated: false
  /** Calls that answered (refusals left out). */
  samples: number
  model: string
  latencyMs: number
  costUsd: number
  tokens: Tokens
  methodVersion: number
  /** The log file the decision went to; absent when it could not be written (`logError`). */
  logPath?: string
  logError?: string
}

/** No decision made, and why: no API key, or a limit reached. */
export type DecideSkip = { skipped: 'no-key' | 'daily-cap' | 'budget'; reason: string }

export const NO_KEY_TEXT = 'Anthropic API 키가 설정되지 않아 판정하지 않습니다. hubblerc 설정의 anthropicApiKey에 넣어 주세요(세션 안 `/plugin configure`, 또는 `claude plugin configure`).'

/**
 * A decision: `samples` calls at once to the Messages API, each showing the questions its own way;
 * their distributions averaged into answers. Some calls failing, the rest decide; all failing throws;
 * every call refusing answers refusals. Not made with no key or past a limit (a toast, the first time
 * a day or a period). The decision is logged, its cost added to the machine's totals.
 */
export async function decide($: EngineInterface, request: DecideRequest): Promise<DecideResult | DecideSkip> {
  if (!hasApiKey()) return { skipped: 'no-key', reason: NO_KEY_TEXT }
  const invalid = invalidQuestions(request.questions)
  if (invalid !== undefined) throw new Error(`판정 질문이 잘못됐습니다: ${invalid}`)
  const samples = Math.min(MAX_SAMPLES, Math.max(1, Math.round(request.samples ?? 5)))
  const thinking = request.thinking === true
  const limits: Limits = { dailyCapUsd: options.dailyCapUsd, budgetUsd: options.budgetUsd, periodStartDay: options.periodStartDay }

  const blocked = await withSpend($, spend => {
    const limit = limitReached(spend, limits)
    if (limit === null) return { spend: null, value: null }
    const isWarned = limit === 'budget' ? spend.warnedPeriod === spend.period : spend.warnedDay === spend.day
    const marked: Spend = limit === 'budget' ? { ...spend, warnedPeriod: spend.period } : { ...spend, warnedDay: spend.day }

    return { spend: isWarned ? null : marked, value: { limit, isWarned, spend } }
  })
  if (blocked !== null) {
    const reason =
      blocked.limit === 'budget'
        ? `판정이 이번 예산 주기(${blocked.spend.period}부터) 예산 ${dollars(options.budgetUsd)}에 닿아, 다음 주기(매달 ${options.periodStartDay}일 시작)까지 판정하지 않습니다.`
        : `판정이 폭주 방지 상한(하루 ${dollars(options.dailyCapUsd)})에 닿아 오늘은 판정하지 않습니다. 오늘 ${blocked.spend.dayCount}건 $${blocked.spend.dayUsd.toFixed(2)}.`
    if (!blocked.isWarned) $.ui.toast(reason)

    return { skipped: blocked.limit, reason }
  }

  const started = await $.clock.now()
  const id = `d_${started.toString(36)}_${Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')}`
  const input = maskSecrets(request.input).slice(0, MAX_INPUT_CHARS)
  const random = seededRandom(seedOf(id))
  const layouts = Array.from({ length: samples }, (_, i) => layoutCall(request.questions, i, random))
  const calls = await Promise.all(layouts.map(layout => callOnce($, requestBody({ model: options.model, input, questions: request.questions, layout, thinking }))))
  const latencyMs = (await $.clock.now()) - started

  const logs: CallLog[] = []
  const raw: RawCall[] = []
  const answered: number[][][] = []
  let refusals = 0
  let model = options.model
  calls.forEach((call, i) => {
    const layout = layouts[i] ?? { symbols: 'A', questions: [] }
    const log: CallLog = { layout, latencyMs: call.latencyMs, tokens: call.tokens }
    if (call.model !== undefined) model = call.model
    const reply: Reply = call.reply ?? { kind: 'invalid', reason: call.error ?? 'no reply' }
    if (reply.kind === 'answered') {
      log.received = reply.values
      const distributions = distributionsOf(reply.values, request.questions, layout)
      if (typeof distributions === 'string') {
        log.error = distributions
        raw.push({ error: distributions })
      } else {
        log.distributions = distributions
        answered.push(distributions)
        raw.push({ distributions })
      }
    } else if (reply.kind === 'refused') {
      log.refused = true
      refusals += 1
      raw.push({ refused: true })
    } else {
      log.error = call.error ?? reply.reason
      raw.push({ error: log.error })
    }
    logs.push(log)
  })
  const tokens = calls.reduce((total, call) => addTokens(total, call.tokens), NO_TOKENS)
  const costUsd = calls.reduce((total, call) => total + costOf(call.tokens), 0)
  const isDecided = answered.length > 0 || refusals > 0
  await withSpend($, spend => ({ spend: addSpend(spend, costUsd, isDecided), value: undefined })).catch(() => undefined)
  await refreshDecideStatus($).catch(() => undefined)
  if (!isDecided) throw new Error(`판정 호출 ${samples}개가 모두 실패했습니다: ${raw.find(call => call.error !== undefined)?.error ?? '응답 없음'}`)

  const answers = combine(request.questions, answered)
  const line: DecisionLine = {
    type: 'decision',
    id,
    at: new Date(started).toISOString(),
    task: request.task,
    methodVersion: METHOD_VERSION,
    model,
    samples,
    thinking,
    effort: 'low',
    input,
    questions: request.questions,
    calls: logs,
    answers,
    latencyMs,
    tokens,
    costUsd,
    ...(request.meta === undefined ? {} : { meta: request.meta }),
    outcome: null,
  }
  const result: DecideResult = { id, answers, raw, calibrated: false, samples: answered.length, model, latencyMs, costUsd, tokens, methodVersion: METHOD_VERSION }
  try {
    result.logPath = await appendLine($, JSON.stringify(line))
  } catch (error) {
    result.logError = String(error).slice(0, 200)
  }

  return result
}

type CallOutcome = { latencyMs: number; tokens: Tokens; reply?: Reply; model?: string; error?: string }

/** One call to the Messages API with the key of the options: what it answered, or why not. */
async function callOnce($: EngineInterface, body: Record<string, unknown>): Promise<CallOutcome> {
  const started = await $.clock.now()
  try {
    const response = await $.http.fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
    })
    const latencyMs = (await $.clock.now()) - started
    let parsed: unknown
    try {
      parsed = JSON.parse(response.text)
    } catch {
      parsed = undefined
    }
    const tokens = tokensOf(parsed)
    if (!response.ok) return { latencyMs, tokens, error: httpError(response.status, parsed) }
    const model = isRecord(parsed) && typeof parsed.model === 'string' ? parsed.model : undefined

    return { latencyMs, tokens, reply: readReply(parsed), ...(model === undefined ? {} : { model }) }
  } catch (error) {
    return { latencyMs: (await $.clock.now()) - started, tokens: NO_TOKENS, error: `요청 실패: ${String(error)}`.slice(0, 200) }
  }
}

/** `HTTP 401 authentication_error: invalid x-api-key`: the API's error, cut short. */
export function httpError(status: number, body: unknown): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {}
  const kind = typeof error.type === 'string' ? ` ${error.type}` : ''
  const message = typeof error.message === 'string' ? `: ${error.message}` : ''

  return `HTTP ${status}${kind}${message}`.slice(0, 200)
}

/**
 * The log's folder: the one set in the options (`~/` for home); else iCloud Drive's
 * `hubblerc/decide` where iCloud Drive is on; else `~/.claude/hubblerc/decide`.
 */
export async function logFolder($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  if (options.logDir !== '') return options.logDir.replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')
  const icloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`
  if (await $.fs.exists(icloud).catch(() => false)) return `${icloud}/hubblerc/decide`

  return `${home}/.claude/hubblerc/decide`
}

/** The machine's name (its Sharing name, else its host name), as its log file is named. */
async function machineName($: EngineInterface): Promise<string> {
  for (const argv of [['/usr/sbin/scutil', '--get', 'ComputerName'], ['/bin/hostname', '-s']]) {
    const ran = await $.process.run(argv, { timeoutMs: 3000 }).catch(() => undefined)
    const name = ran?.exitCode === 0 ? ran.stdout.trim() : ''
    if (name !== '') return name
  }

  return 'mac'
}

/** This machine's log file, found once a session. */
export async function logPath($: EngineInterface): Promise<{ dir: string; path: string }> {
  if (logFile !== null) return logFile
  const dir = await logFolder($)
  logFile = { dir, path: `${dir}/${safeFileName(await machineName($))}.jsonl` }

  return logFile
}

/**
 * A line added at the end of this machine's log (`tee -a`: the file is never written over), after
 * the lines before it. The first of a session makes the folder and the file, readable by the user alone.
 */
function appendLine($: EngineInterface, line: string): Promise<string> {
  const work = async () => {
    const file = await logPath($)
    if (!isLogReady) {
      const made = await $.process.run(['/bin/sh', '-c', 'umask 077 && mkdir -p "$1" && touch "$2"', 'sh', file.dir, file.path], { timeoutMs: 10_000 })
      if (made.exitCode !== 0) throw new Error(made.stderr.trim() || `기록 폴더를 만들지 못했습니다(${made.exitCode})`)
      isLogReady = true
    }
    const ran = await $.process.run(['/usr/bin/tee', '-a', file.path], { stdin: `${line}\n`, timeoutMs: 10_000 })
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `기록을 쓰지 못했습니다(${ran.exitCode})`)

    return file.path
  }
  const run = writeQueue.then(work, work)
  writeQueue = run.catch(() => undefined)

  return run
}

/** What came true for a logged decision, appended as a line of its own. */
export async function recordOutcome($: EngineInterface, id: string, outcome: boolean | string | null, note?: string): Promise<void> {
  const line: OutcomeLine = { type: 'outcome', id, at: new Date(await $.clock.now()).toISOString(), outcome, ...(note === undefined ? {} : { note }) }
  await appendLine($, JSON.stringify(line))
}

/** How much a read of a log takes at once: under the 4 MiB a command's output is cut at. */
const CHUNK_BYTES = 3 * 1024 * 1024

/**
 * A whole log file, in pieces of whole lines (`tail -c +offset | head -c`), each handed on as it is
 * read: a file past `$.fs.read`'s 4 MiB is read all the same, and never held whole.
 */
export async function readLogPieces($: EngineInterface, path: string, each: (piece: string) => void): Promise<void> {
  let offset = 0
  for (let piece = 0; piece < 10_000; piece += 1) {
    const ran = await $.process.run(['/bin/sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(offset + 1), path, String(CHUNK_BYTES)], { timeoutMs: 30_000 })
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `${path}를 읽지 못했습니다`)
    const text = ran.stdout
    if (text === '') break
    // A piece shorter than asked is the file's end.
    if (utf8Length(text) < CHUNK_BYTES - 4) {
      each(text)
      break
    }
    // Up to the last whole line: a character cut at the piece's end is read again with its line.
    const end = text.lastIndexOf('\n')
    if (end < 0) break
    const whole = text.slice(0, end + 1)
    each(whole)
    offset += utf8Length(whole)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
