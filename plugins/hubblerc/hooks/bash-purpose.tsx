import type { On } from 'claude-code'

/** What the model said a Bash call is for: its `description`, when it gave one. */
export function bashPurpose(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const description = (input as Record<string, unknown>).description

  return typeof description === 'string' && description.trim() !== '' ? description.trim() : undefined
}

/**
 * Added to the Bash tool's description: the `description` is drawn under the command, so the model
 * writes it in Korean. The response language setting does not reach tool arguments (seen: sessions
 * in other projects wrote them in English).
 */
export const KOREAN_PURPOSE_RULE =
  '\n\nThe `description` you give is shown to the user on screen, under the command. Write it in Korean: a short phrase saying what the command does, such as "전체 테스트 실행" or "작업 트리 상태 확인".'

/** Shows what each Bash call is for under the line that names the command (a folded run's: tool-lines.tsx). */
export function showBashPurpose(on: On): void {
  // Read once a session (the engine caches the answer), so it costs nothing per turn.
  on('tool.describe', { tool: 'Bash' }, async ($, e, next) => {
    const described = await next(e)

    return described.description.includes(KOREAN_PURPOSE_RULE) ? described : { ...described, description: described.description + KOREAN_PURPOSE_RULE }
  }).catch(($, e, next) => next(e))

  // A Bash call drawn as its own row: the purpose goes under the command line, above its result.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    const purpose = bashPurpose(e.props.input)
    if (purpose === undefined) return next(e)

    // The full view (ctrl+o) draws the result inside this row, so a line under it would land after
    // the output. There the purpose goes on the command line itself, as a shell comment.
    if (e.props.isExpanded === true) {
      const input = e.props.input as Record<string, unknown>
      if (typeof input.command !== 'string') return next(e)

      return next({ ...e, props: { ...e.props, input: { ...input, command: `${input.command}  # ${purpose}` } } })
    }

    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>
          <Text dimColor>↳ </Text>
          <Text>{purpose}</Text>
        </Box>
      </Box>
    )
  })
}
