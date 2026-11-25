import { expect, mock, test } from 'claude-code/testing'

import { foundText, liveIn, sessionTrailerIn } from '../hooks/status/find-session'
import { startedText } from '../hooks/status/peer'
import { NOW, standInForEngine, start } from './engine'

const COMMAND = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } }
const ID = '55bd25fd-e9bc-4cc5-9193-1843d42a4f28'
const SHA = 'abcdef0123456789abcdef0123456789abcdef01'
const ok = (stdout: string) => ({ exitCode: 0, stdout })
const failed = { exitCode: 1, stdout: '' }

test("a registry entry is the session's when its id is the one asked for, or starts with it", () => {
  const raw = JSON.stringify({ pid: 85333, sessionId: ID, startedAt: NOW, name: 'hubblerc-8b', cwd: '/repo' })
  expect(liveIn(raw, ID)).toEqual({ sessionId: ID, name: 'hubblerc-8b', startedAt: NOW, pid: 85333, cwd: '/repo' })
  expect(liveIn(raw, '55BD25FD')?.name).toBe('hubblerc-8b')
  expect(liveIn(raw, '66bd25fd')).toBeUndefined()
  expect(liveIn('{', ID)).toBeUndefined()
  expect(sessionTrailerIn(`\n${ID}\n\n`)).toBe(ID)
  expect(sessionTrailerIn('\n')).toBeUndefined()
})

test('the answer says the name to message a running session by, or how to resume an ended one, or that it is nowhere', () => {
  const live = { sessionId: ID, name: 'hubblerc-8b', startedAt: NOW, pid: 1, cwd: '/repo' }
  expect(foundText({ id: ID, commit: SHA, live: [live], isThis: false }, 'hubblerc-8b (x 시작)')).toBe(
    `세션 ${ID}(커밋 abcdef0의 Session trailer): 떠 있음\n- SendMessage 이름: hubblerc-8b (${startedText(NOW)} 시작, pid 1, /repo)\n- 복사함: hubblerc-8b (x 시작)`,
  )
  expect(foundText({ id: ID, live: [], transcript: { path: `/p/${ID}.jsonl`, cwd: '/repo' }, isThis: false })).toBe(
    `세션 ${ID}: 지금 떠 있지 않음\n- 대화 기록: /p/${ID}.jsonl\n- 이어 가기: cd /repo && claude --resume ${ID}`,
  )
  expect(foundText({ id: ID, live: [], isThis: true })).toContain('· 이 세션: 세션 등록 파일과 대화 기록 어디에도 없습니다')
})

test('/find-session with a commit reads its Session trailer, finds the running session, passes over a dead entry, and copies the name', async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  const registry: Record<string, string> = {
    '/home/me/.claude/sessions/111.json': JSON.stringify({ pid: 111, sessionId: ID, startedAt: NOW - 60_000, name: 'stale' }),
    '/home/me/.claude/sessions/222.json': JSON.stringify({ pid: 222, sessionId: ID, startedAt: NOW - 3_600_000, name: 'hubblerc-8b' }),
  }
  on('fs.list', (_, e) => (e.path === '/home/me/.claude/sessions' ? { value: ['111.json', '222.json'].map(name => ({ name, kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false })) } : { deny: 'no folder' }))
  on('fs.read', (_, e) => (registry[e.path] === undefined ? { deny: 'no file' } : { value: registry[e.path] as never }))
  standIn.run = argv => {
    if (argv[0] === 'git' && argv[1] === 'log' && argv.some(arg => arg.startsWith('--format=%H'))) return argv.includes('abcdef0') ? ok(`${SHA}\n${ID}\n\n`) : failed
    if (argv[0] === '/bin/ps') return argv[2] === '222' ? ok('  222\n') : failed
    if (argv[0] === '/bin/sh' && argv[2]?.includes('projects/*/"$2"*')) return ok('')

    return undefined
  }
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } as never }
  })
  await start($)

  const text = ((await $.command.run({ ...COMMAND, command: 'find-session', args: 'abcdef0' })) as { text?: string }).text ?? ''
  expect(text.split('\n')[0]).toBe(`세션 ${ID}(커밋 abcdef0의 Session trailer): 떠 있음`)
  expect(text).toContain('- SendMessage 이름: hubblerc-8b')
  expect(text).not.toContain('stale')
  expect(copied).toEqual([`hubblerc-8b (${startedText(NOW - 3_600_000)} 시작)`])

  // An id's start that is no commit is taken as the id.
  expect(((await $.command.run({ ...COMMAND, command: 'find-session', args: '55bd25fd' })) as { text?: string }).text).toContain('떠 있음')
  expect(((await $.command.run({ ...COMMAND, command: 'find-session', args: 'nope!' })) as { text?: string }).text).toBe('nope!: 이 저장소의 커밋도, session id도 아닙니다.')
})

test('an ended session answers with its transcript and the command that resumes it in its folder', async ($, on) => {
  const standIn = standInForEngine(on)
  mock.env(on, { HOME: '/home/me' })
  on('fs.list', () => ({ value: [] }))
  standIn.run = argv => (argv[0] === '/bin/sh' && argv[2]?.includes('projects/*/"$2"*') ? ok(`/home/me/.claude/projects/-repo/${ID}.jsonl\n"cwd":"/repo"\n`) : undefined)
  await start($)

  const text = ((await $.command.run({ ...COMMAND, command: 'find-session', args: '55bd25fd-e9bc' })) as { text?: string }).text ?? ''
  expect(text).toBe(`세션 ${ID}: 지금 떠 있지 않음\n- 대화 기록: /home/me/.claude/projects/-repo/${ID}.jsonl\n- 이어 가기: cd /repo && claude --resume ${ID}`)
})
