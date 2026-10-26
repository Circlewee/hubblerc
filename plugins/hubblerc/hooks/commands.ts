import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { toggleSidebar } from './sidebar'
import type { Layout } from './sidebar'
import { activityTable } from './summary'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])

/**
 * At session.start: `/activity`, every recorded answer of the session with its summary, and
 * `/panel`, which opens or closes the sidebar (~/.claude/keybindings.json binds ctrl+x ctrl+p to it).
 */
export async function registerCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'activity',
    description: '이번 세션의 답변별 도구 사용과 파일 변경 요약 (hubblerc)',
    immediate: true,
  })
  await $.command.register({
    name: 'panel',
    description: '상태와 답변별 타임라인을 보여 주는 사이드바 열기/닫기 (hubblerc)',
    immediate: true,
  })
}

export function answerCommands(on: On, layout: Layout): void {
  on('command.run', { command: 'activity' }, async $ => ({ text: activityTable(await read($, turns)) }))
  on('command.run', { command: 'panel' }, async ($, e) => {
    const text = await toggleSidebar($, layout, e.presentation)

    return text === undefined ? {} : { text }
  })
}
