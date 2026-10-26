import type { EngineInterface, On, ResolveInput, ToolGroupCall } from 'claude-code'

import { changedLines } from './activity'
import { COLORS } from './band-format'
import { bashPurpose } from './bash-purpose'
import { basename, signed } from './summary'

const MAX_GROUP_PURPOSES = 6
const MAX_READ_NAMES = 3
/** The cells the engine's result rows take before their text: `  ⎿  `. */
const RESULT_GUTTER = 5

/**
 * A folded run of calls in the conversation, said in Korean: `파일 3개 읽음 · 명령 1개 실행`.
 * Bash is counted as commands, whatever they did; their purposes follow on their own lines.
 */
export function groupLine(calls: readonly ToolGroupCall[]): string {
  const counts = new Map<string, number>()
  const add = (kind: string) => counts.set(kind, (counts.get(kind) ?? 0) + 1)
  let added = 0
  let removed = 0
  const edited = new Set<string>()

  for (const call of calls) {
    const input = isRecord(call.input) ? call.input : {}
    switch (call.tool) {
      case 'Read':
        add('read')
        break
      case 'Grep':
      case 'Glob':
        add('search')
        break
      case 'Bash':
        add('bash')
        break
      case 'Edit':
      case 'Write':
      case 'NotebookEdit': {
        const path = text(input.file_path) ?? text(input.notebook_path) ?? `#${edited.size}`
        edited.add(path)
        const lines = changedLines(call.output)
        added += lines?.added ?? 0
        removed += lines?.removed ?? 0
        break
      }
      case 'WebSearch':
        add('webSearch')
        break
      case 'WebFetch':
        add('webFetch')
        break
      case 'Agent':
        add('agent')
        break
      default:
        add(call.tool.startsWith('mcp__') ? 'mcp' : `tool:${call.tool}`)
    }
  }

  const parts: string[] = []
  const count = (kind: string) => counts.get(kind) ?? 0
  if (count('read') > 0) parts.push(`파일 ${count('read')}개 읽음`)
  if (edited.size > 0) parts.push(`파일 ${edited.size}개 수정${added + removed > 0 ? ` (${signed(added, removed)})` : ''}`)
  if (count('search') > 0) parts.push(`검색 ${count('search')}번`)
  if (count('bash') > 0) parts.push(`명령 ${count('bash')}개 실행`)
  if (count('webSearch') > 0) parts.push(`웹 검색 ${count('webSearch')}번`)
  if (count('webFetch') > 0) parts.push(`웹 페이지 ${count('webFetch')}개 읽음`)
  if (count('agent') > 0) parts.push(`에이전트 ${count('agent')}개 실행`)
  if (count('mcp') > 0) parts.push(`MCP 도구 ${count('mcp')}번`)
  for (const [kind, n] of counts) if (kind.startsWith('tool:')) parts.push(`${kind.slice(5)} ${n}번`)

  return parts.join(' · ')
}

/** `register.tsx, band.tsx 외 1`: the files a run read, each once, in the order read; '' when it read none. */
export function readNames(calls: readonly ToolGroupCall[]): string {
  const names: string[] = []
  for (const call of calls) {
    if (call.tool !== 'Read' || !isRecord(call.input)) continue
    const path = text(call.input.file_path)
    if (path === undefined) continue
    const name = basename(path)
    if (!names.includes(name)) names.push(name)
  }
  if (names.length === 0) return ''
  const shown = names.slice(0, MAX_READ_NAMES).join(', ')

  return names.length > MAX_READ_NAMES ? `${shown} 외 ${names.length - MAX_READ_NAMES}` : shown
}

/**
 * The conversation's tool rows, made to say more:
 * - a folded run (`Read 3 files, ran 1 shell command`) names the files it read and what each Bash
 *   call was for, and once it is done, says its counts in Korean
 * - an edit's diff folds to one line of lines added and removed; ctrl+o shows it whole
 */
export function showToolLines(on: On): void {
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    // Unfolded, each call is its own ToolUse row and shows its own path and purpose.
    if (e.props.isExpanded) return next(e)

    const { calls } = e.props
    const names = readNames(calls)
    const purposes = calls.flatMap(call => {
      const purpose = call.tool === 'Bash' ? bashPurpose(call.input) : undefined

      return purpose === undefined ? [] : [{ purpose, isErrored: call.isErrored }]
    })
    // While the run is live the engine's line animates and names the task at hand: it stays. Done,
    // and holding nothing but calls (no recalled memory, hook or failure the line would tell of),
    // the line is said in Korean, as the engine lays it: a row of air above, two cells in, dim.
    const korean = !e.props.isActive && e.props.isCallsOnly === true ? groupLine(calls) : ''
    if (names === '' && purposes.length === 0 && korean === '') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const head =
      korean === '' ? (
        await next(e)
      ) : (
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>{korean}</Text>
        </Box>
      )
    const shown = purposes.slice(0, MAX_GROUP_PURPOSES)
    const hidden = purposes.length - shown.length

    return (
      <Box flexDirection="column">
        {head}
        {names === '' ? null : (
          <Box paddingLeft={2}>
            <Text dimColor>↳ 읽음: </Text>
            <Text>{names}</Text>
          </Box>
        )}
        {shown.map(({ purpose, isErrored }) => (
          <Box paddingLeft={2}>
            <Text dimColor>↳ </Text>
            <Text>{purpose}</Text>
            {isErrored && <Text dimColor> · 실패</Text>}
          </Box>
        ))}
        {hidden > 0 && (
          <Box paddingLeft={2}>
            <Text dimColor>↳ 외 {hidden}개</Text>
          </Box>
        )}
      </Box>
    )
  })

  // An edit's result is its diff, often many rows: one line of what changed, the path being on the
  // call's row above. The full view (ctrl+o) passes, so the diff is a key away; a failure passes too.
  on('ui.render', { component: 'ToolResult', props: { tool: 'Edit' } }, async ($, e, next) => diffLine($, e) ?? next(e))
  on('ui.render', { component: 'ToolResult', props: { tool: 'Write' } }, async ($, e, next) => diffLine($, e) ?? next(e))
}

type ResultRow = ResolveInput<'ToolResult'> & { props: { output: unknown; isErrored: boolean; isExpanded?: boolean } }

/** An Edit or Write result as one line (`⎿  +40 −12 · ctrl+o로 전체 보기`); undefined where the engine's own is drawn. */
function diffLine($: EngineInterface, e: ResultRow): JSX.Element | undefined {
  const { output } = e.props
  if (e.props.isExpanded === true || e.props.isErrored || !isRecord(output)) return undefined
  const isNew = output.type === 'create'
  // Without a patch there is nothing to count from (a new file counts its content).
  if (!isNew && !Array.isArray(output.structuredPatch)) return undefined
  const lines = changedLines(output)
  if (lines === undefined) return undefined

  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box>
      <Box width={RESULT_GUTTER} flexShrink={0}>
        <Text dimColor>{'  ⎿  '}</Text>
      </Box>
      {isNew ? (
        <Text>{`새 파일 ${lines.added}줄`}</Text>
      ) : lines.added + lines.removed === 0 ? (
        <Text>바뀐 줄 없음</Text>
      ) : (
        <Box columnGap={1}>
          {lines.added > 0 ? <Text color={COLORS.ok}>{`+${lines.added}`}</Text> : null}
          {lines.removed > 0 ? <Text color={COLORS.alert}>{`−${lines.removed}`}</Text> : null}
        </Box>
      )}
      <Text dimColor> · ctrl+o로 전체 보기</Text>
    </Box>
  )
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
