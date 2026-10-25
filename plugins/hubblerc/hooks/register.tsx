import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { trackActivity } from './activity'
import { showBashPurpose } from './bash-purpose'
import { registerCommands } from './commands'
import { findTurnForLine, summarize } from './summary'

// The validator reads state sources per file, so each file that reads `turns` declares it.
const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

export const register: Register = on => {
  trackActivity(on)
  registerCommands(on)
  showBashPurpose(on)

  // The line that closes a turn ("Baked for 2m 13s") gets the turn's activity on the line under it.
  // Under it, not beside it: the engine's line takes the row's free width and squeezes a sibling to the edge.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.waitingFor !== undefined) return drawn

    const turn = findTurnForLine(await read($, turns), e.requestId, e.props.durationMs)
    const summary = turn === undefined ? '' : summarize(turn)
    if (summary === '') return drawn

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>
          <Text dimColor>{summary}</Text>
        </Box>
      </Box>
    )
  })
}
