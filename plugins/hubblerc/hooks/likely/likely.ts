import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { LikelyStatus } from '../../types'
import { addSpend, addTokens, costOf, dollars, limitReached, NO_TOKENS, spendAt, tokensOf } from './cost'
import type { Limits, Spend, Tokens } from './cost'
import { combine, distributionsOf, invalidQuestions, layoutCall, MAX_SAMPLES, METHOD_VERSION, readReply, requestBody, seededRandom, seedOf, spreadOf } from './method'
import type { Answer, Question, Reply, Spread } from './method'
import { MAX_INPUT_CHARS, utf8Length } from './record'
import type { CallLog, DecisionLine, OutcomeLine } from './record'
import { appendLogLine, defaultLogFolder, homeFolder, logFileIn, resetLogs } from '../shared/jsonl-log'
import { maskSecrets } from '../shared/log-safety'
import { isRecord } from '../shared/values'

const likelyStatus = atom({ plugin: 'hubblerc', key: 'likelyStatus' } as const, null)

export const API_URL = 'https://api.anthropic.com/v1/messages'
export const API_VERSION = '2026-10-21'
export const DEFAULT_MODEL = 'claude-haiku-5-5'
/** Where this machine's totals are kept (`$.store` is the machine's own). */
const SPEND_KEY = 'likelySpend'

/** The likely options of the plugin's `userConfig`, read once a load. */
export type LikelyOptions = {
  /** The Anthropic API key (a secret option); '' when unset: the keychain's is looked for. */
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
  /** Whether each Bash call is predicted to fail or not (off since 2026-11-11: a forecast the command's text does not hold). */
  bashFail: boolean
}

export function likelyOptions(raw: PluginOptions): LikelyOptions {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const amount = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback)
  const day = typeof raw.likelyPeriodStartDay === 'number' && Number.isFinite(raw.likelyPeriodStartDay) ? Math.round(raw.likelyPeriodStartDay) : 1

  return {
    apiKey: text(raw.anthropicApiKey),
    model: text(raw.likelyModel) || DEFAULT_MODEL,
    dailyCapUsd: amount(raw.likelyDailyCapUsd, 5),
    budgetUsd: amount(raw.likelyMonthlyBudgetUsd, 100),
    periodStartDay: Math.min(31, Math.max(1, day)),
    logDir: text(raw.likelyLogDir),
    bashFail: raw.likelyBashFail === true,
  }
}

let options: LikelyOptions = likelyOptions({})

/** At load (`register`): the options a change in `/config` reloads the module with. */
export function configureLikely(raw: PluginOptions): void {
  options = likelyOptions(raw)
}

/** The keychain item the key is read from where the options have none (the shell's `hubblerc-key set` puts it there). */
export const KEYCHAIN_SERVICE = 'hubblerc-likely'

/**
 * The key read from the keychain, kept in the module alone: never in state, the store or the log.
 * Read at session.start where the options have no key (a plugin loaded from its folder, `--plugin-dir`,
 * is not installed, so `/plugin configure` cannot set its secret option), and again when `/likely`
 * finds none. No environment variable is read: what is set in this process reaches every Bash child.
 */
let keychainKey = ''

/** The key decisions are made with: the secret option, else the keychain's; '' for none. */
function apiKey(): string {
  return options.apiKey !== '' ? options.apiKey : keychainKey
}

/** Where the key comes from: the secret option, the keychain, or nowhere. */
export function keySource(): 'options' | 'keychain' | null {
  return options.apiKey !== '' ? 'options' : keychainKey !== '' ? 'keychain' : null
}

/** Whether Bash calls are to be predicted: the option, off unless set. */
export function predictsBash(): boolean {
  return options.bashFail
}

/** Whether decisions can be made at all: an API key is set. */
export function hasApiKey(): boolean {
  return apiKey() !== ''
}

/**
 * The key from the macOS keychain (any account), where the options have none. Missing, refused or
 * not answering in time: none, said nowhere.
 */
export async function readKeychainKey($: EngineInterface): Promise<void> {
  if (options.apiKey !== '') return
  const ran = await $.process.run(['/usr/bin/security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeoutMs: 5000 }).catch(() => undefined)
  keychainKey = ran?.exitCode === 0 ? ran.stdout.trim() : ''
}

export function currentOptions(): Readonly<LikelyOptions> {
  return options
}

/** The log's folder, found once a session. */
let folder: string | null = null
/** The machine's totals are read, changed and written one change at a time within the session. */
let spendQueue: Promise<unknown> = Promise.resolve()

/** At session.start: the key from the keychain where the options have none, and what the sidebar shows of the spend. */
export async function startLikely($: EngineInterface): Promise<void> {
  folder = null
  resetLogs()
  await readKeychainKey($).catch(() => undefined)
  await refreshLikelyStatus($)
}

/**
 * The sidebar's line from the machine's totals: at session.start, after each decision, and on the
 * 30-second tick while the sidebar shows (another session's decisions, a new day). Null with no key.
 */
export async function refreshLikelyStatus($: EngineInterface): Promise<void> {
  const next = hasApiKey() ? statusOf(spendAt(await $.store.get(SPEND_KEY), await $.clock.now(), options.periodStartDay)) : null
  if (JSON.stringify(next) !== JSON.stringify(await read($, likelyStatus))) await update($, likelyStatus, () => next)
}

function statusOf(spend: Spend): LikelyStatus {
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

export type LikelyRequest = {
  /** What the decision is for (`bash-fail`): the log and `/likely stats` group by it. */
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

export type LikelyResult = {
  id: string
  answers: Answer[]
  /** Each call's distributions, before averaging: what a later calibration is fitted on. */
  raw: RawCall[]
  /** Not yet: the chances are the model's own, averaged. */
  calibrated: false
  /** Calls that answered (refusals left out). */
  samples: number
  /** How far the answered calls part on each question (`spreadOf`): the robustness of the decision. */
  spread: Spread[]
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
export type LikelySkip = { skipped: 'no-key' | 'daily-cap' | 'budget'; reason: string }

/**
 * Where the key stands, in words (never the key): the secret option, the keychain, or none.
 */
export function keyStateText(): string {
  const source = keySource()

  return source === 'options' ? '설정 비밀 항목에 있음' : source === 'keychain' ? '키체인에 있음' : '없음'
}

/**
 * How to put a key in, change it or take it out: the shell's `hubblerc-key` (shell/relaunch.zsh), or,
 * before `/setup` put that in, `/setup` first. `hasCommand`: the shell has it.
 */
export function keyHowto(hasCommand: boolean): string {
  return [
    '키 넣기·바꾸기: 터미널에서 `hubblerc-key set` · 지우기: `hubblerc-key delete` · 확인: `hubblerc-key`',
    ...(hasCommand ? [] : ['  `hubblerc-key`가 아직 없습니다: `/setup`을 실행한 뒤 새 터미널에서 쓰세요.']),
    '  설치본은 세션 안 /plugin configure hubblerc@hubblerc 의 anthropicApiKey로도 넣을 수 있습니다(개발판 hcc는 키체인뿐).',
  ].join('\n')
}

export const NO_KEY_TEXT = `Anthropic API 키가 없어 판정하지 않습니다.\n${keyHowto(true)}`

/**
 * A decision: `samples` calls at once to the Messages API, each showing the questions its own way;
 * their distributions averaged into answers. Some calls failing, the rest decide; all failing throws;
 * every call refusing answers refusals. Not made with no key or past a limit (a toast, the first time
 * a day or a period). The decision is logged, its cost added to the machine's totals.
 */
export async function likely($: EngineInterface, request: LikelyRequest): Promise<LikelyResult | LikelySkip> {
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
  await refreshLikelyStatus($).catch(() => undefined)
  if (!isDecided) throw new Error(`판정 호출 ${samples}개가 모두 실패했습니다: ${raw.find(call => call.error !== undefined)?.error ?? '응답 없음'}`)

  const answers = combine(request.questions, answered)
  const spread = spreadOf(request.questions, answered)
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
    spread,
    latencyMs,
    tokens,
    costUsd,
    ...(request.meta === undefined ? {} : { meta: request.meta }),
    outcome: null,
  }
  const result: LikelyResult = { id, answers, raw, calibrated: false, samples: answered.length, spread, model, latencyMs, costUsd, tokens, methodVersion: METHOD_VERSION }
  try {
    result.logPath = await appendLine($, JSON.stringify(line))
  } catch (error) {
    result.logError = String(error).slice(0, 200)
  }

  return result
}

type CallOutcome = { latencyMs: number; tokens: Tokens; reply?: Reply; model?: string; error?: string }

/** One call to the Messages API with the key: what it answered, or why not. */
async function callOnce($: EngineInterface, body: Record<string, unknown>): Promise<CallOutcome> {
  const started = await $.clock.now()
  try {
    const response = await $.http.fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey(), 'anthropic-version': API_VERSION },
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
 * `hubblerc/likely` where iCloud Drive is on; else `~/.claude/hubblerc/likely`.
 */
export async function logFolder($: EngineInterface): Promise<string> {
  if (options.logDir !== '') return options.logDir.replace(/^~(?=\/|$)/, await homeFolder($)).replace(/\/+$/, '')

  return defaultLogFolder($, 'likely')
}

/** This machine's log file. */
export async function logPath($: EngineInterface): Promise<{ dir: string; path: string }> {
  folder ??= await logFolder($)

  return { dir: folder, path: await logFileIn($, folder) }
}

/** A line appended to this machine's log (`jsonl-log.ts`). */
async function appendLine($: EngineInterface, line: string): Promise<string> {
  folder ??= await logFolder($)

  return appendLogLine($, folder, line)
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
