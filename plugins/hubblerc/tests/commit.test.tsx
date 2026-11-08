import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { findCommits, shellQuote, withAround } from '../hooks/commit/commit-command'
import { deviceFrom, effortLabel } from '../hooks/commit/trailers'

const PROFILE = 'Hardware:\n\n    Hardware Overview:\n\n      Model Name: MacBook Pro\n      Model Identifier: Mac15,6\n      Chip: Apple M3 Pro\n'

type Seen = { commands: string[]; gitConfig: string }

/** Stands for the engine beneath the plugin: the session, git's config and the machine, and the Bash tool, which records what it was handed. */
function standIn(on: On, gitConfig = ''): Seen {
  const seen: Seen = { commands: [], gitConfig }
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.now', () => ({ value: 1_000 }))
  on('session.cwd', () => ({ value: '/repo/hubblerc' }))
  on('process.run', (_, e) => {
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === '/usr/sbin/system_profiler') return out(PROFILE)
    if (e.argv.includes('hubblerc.trailers')) return seen.gitConfig === '' ? out('', 1) : out(`${seen.gitConfig}\n`)

    return out('')
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') seen.commands.push(String((e as { command?: unknown }).command))

    return { result: {} as never }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: e.model, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })
  on('attribution.text', (_, e) => ({ text: e.text }))

  return seen
}

/** One main-loop request at xhigh, as the engine sends it: the model and effort the next commit is signed with. */
async function request($: Engine): Promise<void> {
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })) void chunk
}

async function bash($: Engine, command: string): Promise<void> {
  await $.tool.call({ tool: 'Bash', command, description: '커밋' } as never)
}

const spotsIn = (command: string) => findCommits(command)?.map(spot => command.slice(spot.at, spot.end))

// ── Finding the commits, pure ──────────────────────────────────────

test('a commit is found at the start of a command, after && or ;, in a subshell, after an assignment', () => {
  expect(spotsIn('git commit -m "x"')).toEqual(['commit'])
  expect(spotsIn('git add a.ts && git commit -m x')).toEqual(['commit'])
  expect(spotsIn('git commit -m a; git commit -m b')).toEqual(['commit', 'commit'])
  expect(spotsIn('(cd x && git commit -m y)')).toEqual(['commit'])
  expect(spotsIn('GIT_EDITOR=true git commit --amend')).toEqual(['commit'])
  expect(spotsIn('/usr/bin/git --no-pager commit -m x')).toEqual(['commit'])
})

test('git -C names the folder the commit is made in', () => {
  expect(findCommits('git -C /repo/x commit -m x')?.[0]?.dir).toBe('/repo/x')
  expect(findCommits('git -c user.name=me commit -m x')?.[0]?.dir).toBeUndefined()
})

test('a message, a here-document, a comment or another git command is no commit', () => {
  const claudeStyle = `git add a.ts && git commit -m "$(cat <<'EOF'\nSubject "quoted"\n\nBody mentions git commit -m\nEOF\n)"`
  expect(spotsIn(claudeStyle)).toEqual(['commit'])
  expect(spotsIn('cd sub && git commit -F - <<EOF\nmsg git commit\nEOF')).toEqual(['commit'])
  expect(spotsIn('echo "git commit"')).toEqual([])
  expect(spotsIn('# git commit\nls')).toEqual([])
  expect(spotsIn('git log --grep commit')).toEqual([])
  expect(spotsIn('git commit-tree abc')).toEqual([])
  expect(spotsIn('git status | grep commit')).toEqual([])
})

test('a command the reader cannot follow is left alone', () => {
  expect(findCommits('git commit -m "x')).toBeUndefined()
  expect(findCommits('git commit -F - <<EOF\nno end')).toBeUndefined()
  expect(findCommits('git commit -m x )')).toBeUndefined()
})

test('the trailers go right after commit, the replace setting right before it', () => {
  const command = 'git add a && git commit -m x'
  const spots = findCommits(command) ?? []
  expect(withAround(command, spots, '-c trailer.ifexists=replace ', ` --trailer ${shellQuote('Agent: claude')}`)).toBe("git add a && git -c trailer.ifexists=replace commit --trailer 'Agent: claude' -m x")
  expect(shellQuote("it's")).toBe(`'it'\\''s'`)
})

test('the machine is its model and chip, never the computer name', () => {
  expect(deviceFrom(PROFILE)).toBe('MacBook Pro (M3 Pro)')
  expect(deviceFrom('      Model Name: MacBook Pro\n      Processor Name: Quad-Core Intel Core i7\n')).toBe('MacBook Pro (Quad-Core Intel Core i7)')
  expect(deviceFrom('      Model Name: Mac mini\n')).toBe('Mac mini')
  expect(deviceFrom('nothing here')).toBeUndefined()
})

// ── The hook ──────────────────────────────────────────────

test('a commit Claude runs is signed with the session, the model and effort its request went out at, and the machine', async ($, on) => {
  const seen = standIn(on)
  await request($)
  await bash($, 'git add a.ts && git commit -m "Fix the box"')

  expect(seen.commands).toEqual([
    "git add a.ts && git -c trailer.ifexists=replace commit --trailer 'Agent: claude' --trailer 'Session: session-1' --trailer 'Model: claude-opus-5-5' --trailer 'Effort: xhigh' --trailer 'Device: MacBook Pro (M3 Pro)' -m \"Fix the box\"",
  ])
})

test('an effort auto picked reads "auto · <level>"', () => {
  expect(effortLabel('medium', true)).toBe('auto · medium')
  expect(effortLabel('xhigh', false)).toBe('xhigh')
})

test('a repository with hubblerc.trailers false gets none; a command with no commit is untouched', async ($, on) => {
  const seen = standIn(on, 'false')
  await request($)
  await bash($, 'git commit -m x')
  await bash($, 'echo "git commit"')

  expect(seen.commands).toEqual(['git commit -m x', 'echo "git commit"'])
})

test("Claude Code's own attribution lines are dropped from commits and pull requests; its other texts pass", async ($, on) => {
  standIn(on)

  expect((await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude <noreply@anthropic.com>' })).text).toBe('')
  expect((await $.attribution.text({ kind: 'pr', text: '🤖 Generated with [Claude Code](https://claude.com/claude-code)' })).text).toBe('')
  expect((await $.attribution.text({ kind: 'exemption', text: 'an engine sentence' })).text).toBe('an engine sentence')
})
