import type { On } from 'claude-code'

const MAX_GROUP_PURPOSES = 6

/** What the model said a Bash call is for: its `description`, when it gave one. */
export function bashPurpose(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const description = (input as Record<string, unknown>).description

  return typeof description === 'string' && description.trim() !== '' ? description.trim() : undefined
}

/** Shows what each Bash call is for under the line that names the command. */
export function showBashPurpose(on: On): void {
  // A Bash call drawn as its own row: the purpose goes under the command line, above its result.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    const drawn = await next(e)
    const purpose = bashPurpose(e.props.input)
    if (purpose === undefined) return drawn

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

  // A run folded into one line ("ran 2 shell commands") hides each command: list their purposes.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const drawn = await next(e)
    // Unfolded, each call is its own ToolUse row and gets its purpose there.
    if (e.props.isExpanded) return drawn

    const purposes = e.props.calls.flatMap(call => {
      const purpose = call.tool === 'Bash' ? bashPurpose(call.input) : undefined

      return purpose === undefined ? [] : [{ purpose, isErrored: call.isErrored }]
    })
    if (purposes.length === 0) return drawn

    const { Box, Text } = $.ui.resolve(e)
    const shown = purposes.slice(0, MAX_GROUP_PURPOSES)
    const hidden = purposes.length - shown.length

    return (
      <Box flexDirection="column">
        {drawn}
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
}
