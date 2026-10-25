import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { activityTable } from './summary'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

/** At session.start: `/activity`, every recorded answer of the session with its summary. */
export async function registerCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'activity',
    description: '이번 세션의 답변별 도구 사용과 파일 변경 요약 (hubblerc)',
    immediate: true,
  })
}

export function answerCommands(on: On): void {
  on('command.run', { command: 'activity' }, async $ => ({ text: activityTable(await read($, turns)) }))
}
