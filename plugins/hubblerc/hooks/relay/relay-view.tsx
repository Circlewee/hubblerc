import type { EngineInterface, On, ResolveInput } from 'claude-code'

import { COLORS } from '../shared/style'
import { isRecord } from '../shared/values'

/**
 * relay's calls and results in the conversation, one line each (the screen only: the text the
 * model reads is the tool's own). A call is said from its input; a result is told from the first
 * line of its text, which relay.ts writes, so tests run every action through the real tool and
 * hold these readings to its words: change a first line there and a test here breaks.
 * Where a text is not understood the result row shows its first line, cut. Nothing is read from
 * disk and no state is written here.
 */

const RELAY_TOOL = 'mcp__hubblerc__relay'
/** The cells the engine's result rows take before their text: `  ⎿  `. */
const RESULT_GUTTER = 5
const GOAL_CHARS = 30
const REASON_CHARS = 30
const RUNNER_CHARS = 24
const WARNING_CHARS = 40
const FALLBACK_CHARS = 120

/** One line of a text, whitespace folded, cut to `max` characters with `…`. */
function clip(value: string, max: number): string {
  const folded = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(folded)

  return chars.length > max ? `${chars.slice(0, max).join('')}…` : folded
}

const field = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]

  return typeof value === 'string' ? value.trim() : ''
}

/** The model's name without the `claude-` head: `claude-opus-5-5` → `opus-5-5`. */
const shortModel = (model: string): string => model.replace(/^claude-/, '')

/** The text of a tool's output as the engine hands it: the string, or the text parts of a content list. */
export function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const parts = output.flatMap(item => (isRecord(item) && typeof item.text === 'string' ? [item.text] : typeof item === 'string' ? [item] : []))

    return parts.length === 0 ? undefined : parts.join('\n')
  }
  if (isRecord(output)) {
    if (typeof output.result === 'string') return output.result
    if (typeof output.text === 'string') return output.text
    if ('content' in output) return outputText(output.content)
  }

  return undefined
}

// ── The call ──────────────────────────────────────────────

/**
 * A call as one line, from its input. `answer` (the result text, when the call has ended) only
 * supplies the revision a `task` call was written as (`A-r3`); without it the task's id stands.
 */
export function callLine(input: unknown, answer?: string): string {
  const call = isRecord(input) ? input : {}
  const action = field(call, 'action')
  switch (action) {
    case 'start':
      return `relay 시작 · ${field(call, 'name')} · ${clip(field(call, 'goal'), GOAL_CHARS)}`
    case 'task': {
      const id = field(call, 'id')
      const rev = /-r(\d+)\.md/.exec(answer?.split('\n')[0] ?? '')?.[1]
      const criteria = Array.isArray(call.done_when) ? call.done_when.length : 0
      const model = field(call, 'model')

      return `relay 지시서 ${rev === undefined ? id : `${id}-r${rev}`} · ${clip(field(call, 'title'), GOAL_CHARS)} · ${shortModel(model)}/${field(call, 'effort')} · 기준 ${criteria}`
    }
    case 'spec_text':
      return `relay 지시서 미리보기 ${field(call, 'id')}`
    case 'dispatched':
      return `relay 띄움 기록 ${field(call, 'task')} → ${clip(field(call, 'runner'), RUNNER_CHARS)}`
    case 'cancel':
      return `relay 취소 ${field(call, 'task')} · ${clip(field(call, 'reason'), REASON_CHARS)}`
    case 'report':
      return `relay 보고 확인 ${field(call, 'task')}`
    case 'check':
      return `relay 완료 검사 ${field(call, 'task')}`
    case 'package': {
      const tasks = Array.isArray(call.tasks) ? call.tasks.filter((task): task is string => typeof task === 'string') : []

      return `relay 검증 꾸러미 · ${tasks.length === 0 ? '전체' : tasks.join(', ')}`
    }
    case 'verdict':
      return `relay 판정 ${field(call, 'id')}`
    case 'pending':
      return 'relay 기다리는 결정'
    case 'list':
      return 'relay 묶음 목록'
    case 'finish':
      return 'relay 묶음 끝내기'
    default:
      return `relay ${clip(action, GOAL_CHARS)}`.trim()
  }
}

// ── The result ──────────────────────────────────────────────

export type ResultView = {
  /** The row's text. */
  line: string
  /** The user must look at it: a refusal or a failure. */
  isProblem: boolean
  /** The `⚠ relay:` lines of the text, each kept whole beneath the row. */
  notices: string[]
}

const firstLine = (value: string): string => value.split('\n').find(line => line.trim() !== '')?.trim() ?? ''

/** The first reason of a refusal: its first line, or the first `- ` line beneath one that ends in a colon. */
function firstReason(value: string): string {
  const lines = value.split('\n').map(line => line.trim()).filter(line => line !== '')
  const head = lines[0] ?? ''
  const next = lines[1]
  if (head.endsWith(':') && next !== undefined) return next.replace(/^- /, '')

  return head
}

/** The `- ` lines beneath a heading line, up to the next blank line. */
function bulletsAfter(lines: readonly string[], heading: (line: string) => boolean): string[] {
  const at = lines.findIndex(heading)
  if (at < 0) return []
  const found: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') break
    if (line.startsWith('- ')) found.push(line.slice(2))
  }

  return found
}

/** The warnings withWarnings() appended (`경고:` and its `- ` lines). */
const warningsIn = (lines: readonly string[]): string[] => bulletsAfter(lines, line => line === '경고:').filter(line => !line.startsWith('⚠ relay'))

/** `없음` or a comma list, as a count. */
const countOf = (value: string): number => (value === '' || value === '없음' ? 0 : value.split(', ').length)

/** The text after `label` on the line that starts with it. */
function after(lines: readonly string[], label: string): string | undefined {
  const found = lines.find(line => line.startsWith(label))

  return found === undefined ? undefined : found.slice(label.length).trim()
}

function milliseconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}초`
}

/** What a result's first line says it is, told apart by relay.ts's own words; undefined when none fits. */
function told(lines: readonly string[]): string | undefined {
  const head = lines[0] ?? ''
  let match: RegExpExecArray | null

  if (head.startsWith('묶음을 시작했습니다: ')) return '폴더 만듦'

  if (head.startsWith('지시서: ')) {
    const warnings = warningsIn(lines)
    const first = warnings[0]

    return first === undefined ? '씀' : `씀 · 경고 ${warnings.length}: ${clip(first, WARNING_CHARS)}`
  }

  if (head.startsWith('# Task ')) return `미리보기 ${lines.join('\n').trimEnd().split('\n').length}줄`

  if ((match = /^\S+: running · /.exec(head))) return 'running'

  if ((match = /^\S+: (.+?) → cancelled · /.exec(head))) return `${match[1]} → cancelled`

  if ((match = /^\S+: 보고 (.+?) → 상태 (\S+)/.exec(head))) {
    const outside = after(lines, '범위 밖 파일:')
    const tests = after(lines, '테스트·검사 파일 변경:')
    const mismatches = bulletsAfter(lines, line => line.startsWith('보고서 불일치')).length
    const parts = [match[1] ?? '']
    if (outside !== undefined) parts.push(`범위 밖 ${countOf(outside)}`)
    if (tests !== undefined) parts.push(`테스트 변경 ${countOf(tests)}`)
    parts.push(`경고 ${warningsIn(lines).length}`)
    if (mismatches > 0) parts.push(`불일치 ${mismatches}`)

    return parts.join(' · ')
  }

  if (/^\S+ 검사 결과\(HEAD /.test(head)) {
    const outcomes = lines.filter(line => /^- [^:]+: (pass|fail|unverified)\b/.test(line))
    const count = (result: string) => outcomes.filter(line => new RegExp(`^- [^:]+: ${result}\\b`).test(line)).length
    const total = outcomes.reduce((sum, line) => sum + Number(/ · (\d+) ms/.exec(line)?.[1] ?? 0), 0)
    const tree = lines.find(line => line.startsWith('작업 트리: '))?.slice('작업 트리: '.length) ?? ''
    const treeShort = tree.startsWith('깨끗함')
      ? '트리 깨끗함'
      : tree.startsWith('git status 실패')
        ? '트리 확인 실패'
        : tree === ''
          ? ''
          : `트리 변경 ${countOf(tree.replace(/^.*?파일 /, ''))}개`

    return [`pass ${count('pass')}`, `fail ${count('fail')}`, `미확인 ${count('unverified')}`, milliseconds(total), treeShort].filter(part => part !== '').join(' · ')
  }

  if ((match = /^검증 꾸러미 (V\d+): /.exec(head))) {
    const files = /검토할 파일 (\d+)개/.exec(lines.join('\n'))?.[1]

    return files === undefined ? (match[1] ?? '') : `${match[1]} · 검토 파일 ${files}`
  }

  if ((match = /^판정 V\d+: 기록 (pass|fail) /.exec(head))) {
    const criteria = /^기준: pass (\d+) · fail (\d+) · unverified (\d+)/.exec(lines.find(line => line.startsWith('기준: ')) ?? '')
    const findings = /^지적: high (\d+) · medium (\d+)/.exec(lines.find(line => line.startsWith('지적: ')) ?? '')
    const commit = /본 커밋 (\S+)/.exec(head)?.[1]
    const parts: string[] = [match[1] ?? '']
    if (criteria !== null) parts.push(`기준 ${criteria[1]}/${Number(criteria[1]) + Number(criteria[2]) + Number(criteria[3])}`)
    if (findings !== null) parts.push(`지적 high ${findings[1]}, medium ${findings[2]}`)
    if (commit !== undefined) parts.push(`커밋 ${commit}`)

    return parts.join(' · ')
  }

  if ((match = /^사용자 답을 기다리는 결정 (\d+)개:/.exec(head))) {
    const ids = lines.slice(1).flatMap(line => /^- (\S+) · /.exec(line)?.[1] ?? [])

    return `${match[1]}개: ${ids.join(', ')}`
  }
  if (head.startsWith('사용자 답을 기다리는 결정(asked·on hold)이 없습니다')) return '없음'

  if ((match = /^진행 중인 묶음 (\d+)개:/.exec(head))) return `진행 중 ${match[1]}`
  if (head.startsWith('이 저장소에 진행 중인 묶음이 없습니다')) return '진행 중 0'

  if ((match = /^묶음을 끝냈습니다: \S+ · 판정 (\S*) · HEAD/.exec(head))) {
    const pending = after(lines, '사용자 답을 기다리는 결정(asked·on hold):')
    const held = pending === undefined ? undefined : pending === '없음' ? 0 : bulletsAfter(lines, line => line.startsWith('사용자 답을 기다리는 결정(asked·on hold):')).length

    return `끝냄 · ${match[1] === '' ? '판정 없음' : `판정 ${match[1]}`}${held === undefined ? '' : ` · 보류 결정 ${held}`}`
  }

  return undefined
}

/**
 * A result as the row it is drawn as; undefined when the output has no text to read (the engine's
 * own row stays). A failure (the tool's own, or an error of the call) and a refusal say so with
 * their first reason; a text no reading fits is its first line, cut.
 */
export function resultView(output: unknown, isErrored: boolean): ResultView | undefined {
  const body = outputText(output)
  if (body === undefined) return undefined
  const lines = body.split('\n')
  const notices = lines.map(line => line.trim()).filter(line => line.startsWith('⚠ relay'))

  if (isErrored) {
    const reason = firstReason(body)
    const failed = reason.match(/^relay 도구가 실패했습니다: ?(.*)$/)

    return { line: failed === null ? `거절: ${clip(reason, FALLBACK_CHARS)}` : `relay 실패: ${clip(failed[1] ?? '', FALLBACK_CHARS)}`, isProblem: true, notices }
  }

  const line = told(lines.filter(row => !row.trim().startsWith('⚠ relay')))

  return { line: line ?? clip(firstLine(body), FALLBACK_CHARS), isProblem: false, notices }
}

// ── The rows ──────────────────────────────────────────────

type ToolRow = ResolveInput<'ToolResult'> & { props: { output: unknown; isErrored: boolean; isExpanded?: boolean } }

function resultRows($: EngineInterface, e: ToolRow, view: ResultView): JSX.Element {
  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={RESULT_GUTTER} flexShrink={0}>
          <Text dimColor>{'  ⎿  '}</Text>
        </Box>
        <Text wrap="truncate-end" {...(view.isProblem ? { color: COLORS.alert } : {})}>
          {view.line}
        </Text>
      </Box>
      {view.notices.map(notice => (
        <Box paddingLeft={RESULT_GUTTER}>
          <Text wrap="truncate-end" color={COLORS.warn}>
            {notice}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/**
 * relay's call and result in the conversation as one line each. Unfolded (ctrl+o, --verbose), and
 * whenever a text cannot be read at all, the engine's own rows are drawn.
 */
export function showRelayLines(on: On): void {
  on('ui.render', { component: 'ToolUse', props: { tool: RELAY_TOOL } }, async ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { isRunning, isErrored } = e.props
    const dot = isErrored ? COLORS.alert : isRunning ? undefined : COLORS.ok

    return (
      <Box>
        <Text {...(dot === undefined ? { dimColor: true as const } : { color: dot })}>{'● '}</Text>
        <Text wrap="truncate-end">{callLine(e.props.input, outputText(e.props.output))}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult', props: { tool: RELAY_TOOL } }, async ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const view = resultView(e.props.output, e.props.isErrored)

    return view === undefined ? next(e) : resultRows($, e, view)
  })
}
