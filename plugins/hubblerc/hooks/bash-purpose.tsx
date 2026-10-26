import type { On } from 'claude-code'

/** What the model said a Bash call is for: its `description`, when it gave one. */
export function bashPurpose(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const description = (input as Record<string, unknown>).description

  return typeof description === 'string' && description.trim() !== '' ? description.trim() : undefined
}

/** Shows what each Bash call is for under the line that names the command (a folded run's: tool-lines.tsx). */
export function showBashPurpose(on: On): void {
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
