import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { activityTable } from './summary'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

/** `/activity`: every recorded answer of the session with its tool and file summary, as a table. */
export function registerCommands(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'activity',
      description: '이번 세션의 답변별 도구 사용과 파일 변경 요약 (hubblerc)',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'activity' }, async $ => ({ text: activityTable(await read($, turns)) }))
}
