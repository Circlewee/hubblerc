import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { effortLogTable } from './effort-log'
import { runSetup } from './setup'
import { toggleSidebar } from './sidebar'
import type { Layout } from './sidebar'
import { activityTable } from './summary'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const effortLog = atom({ plugin: 'hubblerc', key: 'effortLog' } as const, [])
const autoPick = atom({ plugin: 'hubblerc', key: 'autoPick' } as const, null)

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
    name: 'effort-log',
    description: '이번 세션의 모델 요청별 effort와 토큰, effort가 바뀔 때의 캐시 읽기 비율 (hubblerc)',
    immediate: true,
  })
  await $.command.register({
    name: 'panel',
    description: '상태와 답변별 타임라인을 보여 주는 사이드바 열기/닫기 (hubblerc)',
    immediate: true,
  })
  await $.command.register({
    name: 'setup',
    description: '이 기기의 hubblerc 설정 점검: 빠진 키 설정을 추가하고, 전체 화면·claude-hud·언어 설정을 안내 (hubblerc)',
    immediate: true,
  })
}

export function answerCommands(on: On, layout: Layout): void {
  on('command.run', { command: 'activity' }, async $ => ({ text: activityTable(await read($, turns)) }))
  on('command.run', { command: 'effort-log' }, async $ => ({
    text: effortLogTable(await read($, effortLog), await read($, turns), await read($, autoPick)),
  }))
  on('command.run', { command: 'setup' }, async $ => ({ text: await runSetup($).catch((error: unknown) => `hubblerc 설정 점검 실패: ${String(error)}`) }))
  on('command.run', { command: 'panel' }, async ($, e) => {
    const text = await toggleSidebar($, layout, e.presentation)

    return text === undefined ? {} : { text }
  })
}
