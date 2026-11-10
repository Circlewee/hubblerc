import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { effortSamples } from './effort/effort'
import { effortLogTable, limitsLine } from './effort/effort-log'
import { requestRestart } from './system/relaunch'
import { runSetup } from './system/setup'
import { toggleSidebar } from './sidebar/sidebar'
import type { Layout } from './sidebar/sidebar'
import { activityTable } from './activity/summary'
import { relayStatusText } from './relay/relay'
import { runTodoCommand } from './todo/todo'

const turns = atom({ plugin: 'hubblerc', key: 'turns' } as const, [])
const autoPick = atom({ plugin: 'hubblerc', key: 'autoPick' } as const, null)
const usage = atom({ plugin: 'hubblerc', key: 'usage' } as const, null)

/**
 * At session.start: `/activity`, every recorded answer of the session with its summary,
 * `/panel`, which opens or closes the sidebar (~/.claude/keybindings.json binds ctrl+x ctrl+p to it),
 * `/todo`, the person's own to-dos, mid-answer too, and `/relay-status`, relay's runs not finished
 * as the sidebar's relay box shows them (not `/relay`, which the skill hubblerc:relay may answer to).
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
    description: '이 기기의 hubblerc 설정 점검: 빠진 키 설정과 셸 설정(재시작 함수, Orca 그림)을 추가하고, 전체 화면·claude-hud·언어 설정을 안내 (hubblerc)',
    immediate: true,
  })
  await $.command.register({
    name: 'todo',
    description: '이 프로젝트의 할 일에 적기. 내용 없이 실행하면 목록, 수정 <번호> <내용>으로 고치기, 휴지통으로 지운 것 보기, 복원 <번호>로 되살리기 (hubblerc)',
    argumentHint: '[내용 | 수정 <번호> <내용> | 휴지통 | 복원 <번호>]',
    immediate: true,
  })
  await $.command.register({
    name: 'relaunch',
    description: '진행 중인 작업이 끝나면 Claude Code를 다시 띄워 같은 세션을 이어서 연다. 새 버전이 설치돼 있으면 그 버전으로. 다시 실행하면 취소 (hubblerc)',
    immediate: true,
  })
  await $.command.register({
    name: 'relay-status',
    description: '이 저장소의 안 끝난 relay 묶음: 작업별 상태·모델·실행 환경, 사용자 답을 기다리는 결정, 마지막 판정 (hubblerc)',
    immediate: true,
  })
}

export function answerCommands(on: On, layout: Layout): void {
  on('command.run', { command: 'activity' }, async $ => ({ text: activityTable(await read($, turns)) }))
  on('command.run', { command: 'effort-log' }, async $ => ({
    text: `${effortLogTable(effortSamples(), await read($, turns), await read($, autoPick))}\n\n${limitsLine(await read($, usage))}`,
  }))
  on('command.run', { command: 'setup' }, async $ => ({ text: await runSetup($).catch((error: unknown) => `hubblerc 설정 점검 실패: ${String(error)}`) }))
  on('command.run', { command: 'relaunch' }, async $ => ({ text: await requestRestart($) }))
  on('command.run', { command: 'todo' }, async ($, e) => ({ text: await runTodoCommand($, e.args).catch((error: unknown) => `할 일을 다루지 못했습니다: ${String(error)}`) }))
  on('command.run', { command: 'relay-status' }, async $ => ({ text: await relayStatusText($).catch((error: unknown) => `relay 묶음을 읽지 못했습니다: ${String(error)}`) }))
  on('command.run', { command: 'panel' }, async ($, e) => {
    const text = await toggleSidebar($, layout, e.presentation)

    return text === undefined ? {} : { text }
  })
}
