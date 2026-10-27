import type { EngineInterface } from 'claude-code'

import { canRelaunch } from './relaunch'

/**
 * What a machine needs beside the plugin, which no install carries: the keys in
 * `~/.claude/keybindings.json`, auto-update, the relaunch shell function (sourced from
 * `~/.zshrc`), the fullscreen layout; and what it is better without or with: claude-hud's status
 * line (the band takes its place), a response language.
 *
 * At session.start the needed ones are checked and, when one is missing, one line says so; `/setup`
 * shows them all, adds the missing keys, turns auto-update on and puts the function in place (each
 * file it changes kept as `.bak` first). The fullscreen layout and the advice are only told.
 */

/** The keys hubblerc binds in the Chat context, with what each is for. */
export const KEYS: readonly { key: string; action: string; label: string }[] = [
  { key: 'ctrl+x ctrl+e', action: 'app:cycleDiffBase', label: 'effort 슬라이더' },
  { key: 'ctrl+x ctrl+p', action: 'command:panel', label: '사이드바 열기/닫기' },
]

/** One key's state in a keybindings file: bound to ours, missing, or bound to something else. */
export type KeyState = { key: string; label: string; state: 'ok' | 'missing' | 'conflict'; current?: string }

type Keybindings = { bindings?: { context?: string; bindings?: Record<string, unknown> }[]; [field: string]: unknown }

/** Each of our keys as the file has it; a file that is absent or not JSON has none. */
export function keyStates(text: string | undefined): KeyState[] {
  const chat = chatBindings(parse(text))

  return KEYS.map(({ key, action, label }) => {
    const current = chat[key]
    if (current === undefined) return { key, label, state: 'missing' as const }
    if (current === action) return { key, label, state: 'ok' as const }

    return { key, label, state: 'conflict' as const, current: String(current) }
  })
}

/**
 * The file's text with our missing keys added to its Chat context (made when there is none), and
 * nothing else changed; a key bound to something else is left as it is. Null when nothing is
 * missing, or the file is there but not JSON (it is not ours to rewrite).
 */
export function withKeys(text: string | undefined): string | null {
  const file = text === undefined || text.trim() === '' ? {} : parse(text)
  if (file === null) return null
  const missing = keyStates(text).filter(state => state.state === 'missing')
  if (missing.length === 0) return null

  const bindings = Array.isArray(file.bindings) ? [...file.bindings] : []
  let index = bindings.findIndex(block => block?.context === 'Chat')
  if (index === -1) {
    bindings.push({ context: 'Chat', bindings: {} })
    index = bindings.length - 1
  }
  const chat = { ...(bindings[index]?.bindings ?? {}) }
  for (const { key } of missing) chat[key] = KEYS.find(entry => entry.key === key)?.action
  bindings[index] = { ...bindings[index], context: 'Chat', bindings: chat }

  const base =
    text === undefined || text.trim() === ''
      ? { $schema: 'https://www.schemastore.org/claude-code-keybindings.json', $docs: 'https://code.claude.com/docs/en/keybindings' }
      : {}

  return `${JSON.stringify({ ...base, ...file, bindings }, null, 2)}\n`
}

function parse(text: string | undefined): Keybindings | null {
  if (text === undefined || text.trim() === '') return {}
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Keybindings) : null
  } catch {
    return null
  }
}

function chatBindings(file: Keybindings | null): Record<string, unknown> {
  const blocks = Array.isArray(file?.bindings) ? file.bindings : []
  const chat: Record<string, unknown> = {}
  for (const block of blocks) if (block?.context === 'Chat') Object.assign(chat, block.bindings ?? {})

  return chat
}

/** The marketplace hubblerc is installed from, as `/plugin marketplace add Circlewee/hubblerc` declares it. */
export const MARKETPLACE = { name: 'hubblerc', source: { source: 'github', repo: 'Circlewee/hubblerc' } } as const

/**
 * Whether the user's settings turn auto-update on for hubblerc's marketplace: then Claude Code
 * fetches it and updates the plugin as it starts. Off by default for a marketplace added from
 * GitHub (the engine's rule, 2.1.310: an `autoUpdate` set wins, else only Anthropic's own are on).
 */
export function isAutoUpdating(settingsText: string | undefined): boolean {
  const settings = parse(settingsText)
  const markets = settings?.extraKnownMarketplaces

  return typeof markets === 'object' && markets !== null && (markets as Record<string, { autoUpdate?: unknown }>)[MARKETPLACE.name]?.autoUpdate === true
}

/**
 * The user's settings with auto-update on for hubblerc's marketplace (its entry made when there is
 * none), nothing else changed; null when it is on already, or the file is there but not JSON.
 */
export function withAutoUpdate(settingsText: string | undefined): string | null {
  if (isAutoUpdating(settingsText)) return null
  const settings = settingsText === undefined || settingsText.trim() === '' ? {} : parse(settingsText)
  if (settings === null) return null

  const markets = typeof settings.extraKnownMarketplaces === 'object' && settings.extraKnownMarketplaces !== null ? (settings.extraKnownMarketplaces as Record<string, object>) : {}
  const entry = markets[MARKETPLACE.name] ?? { source: MARKETPLACE.source }

  return `${JSON.stringify({ ...settings, extraKnownMarketplaces: { ...markets, [MARKETPLACE.name]: { ...entry, autoUpdate: true } } }, null, 2)}\n`
}

/** What marks hubblerc's line in a shell's startup file: the script it sources. */
const RELAUNCH_MARK = 'hubblerc/relaunch.zsh'

/**
 * The relaunch shell function (`shell/relaunch.zsh`) on this machine: what `/relaunch` and the
 * sidebar's "재시작" need to open the session again. Absent: the plugin's copy could not be read.
 */
export type RelaunchFacts = {
  /** The person's shell is zsh: the script is zsh's. */
  isZsh: boolean
  /** The script the plugin ships. */
  shipped: string
  /** The copy under Claude Code's folder, if any. */
  installed: string | undefined
  /** The shell's startup file (`~/.zshrc`), if any. */
  zshrc: string | undefined
  /** This session was launched through the function (`HUBBLERC_RELAUNCH_FILE` is set). */
  isActive: boolean
}

export type RelaunchState = {
  isZsh: boolean
  /** The copy is there and is the plugin's current one. */
  isInstalled: boolean
  /** The startup file sources it. */
  isSourced: boolean
  /** The startup file has an alias named `claude`, which would win over the function. */
  hasAlias: boolean
  isActive: boolean
}

export function relaunchState(facts: RelaunchFacts): RelaunchState {
  return {
    isZsh: facts.isZsh,
    isInstalled: facts.installed === facts.shipped,
    isSourced: facts.zshrc?.includes(RELAUNCH_MARK) === true,
    hasAlias: /^\s*alias\s+claude=/m.test(facts.zshrc ?? ''),
    isActive: facts.isActive,
  }
}

/** Whether `/setup` has something to do for the function: a copy to put or update, a line to add. */
export function needsRelaunch(state: RelaunchState | null): boolean {
  return state !== null && state.isZsh && !state.hasAlias && (!state.isInstalled || !state.isSourced)
}

/**
 * The startup file with a line that sources the script (written with `$HOME` when it is under the
 * home folder), after what is there; null when it has one already.
 */
export function withRelaunchLine(zshrc: string | undefined, scriptPath: string, home: string): string | null {
  if (zshrc?.includes(RELAUNCH_MARK) === true) return null
  const path = home !== '' && scriptPath.startsWith(`${home}/`) ? `$HOME${scriptPath.slice(home.length)}` : scriptPath
  const block = `# hubblerc: 재시작한 Claude Code를 같은 세션으로 다시 띄우는 셸 함수 (hubblerc의 /setup이 추가)\n[ -f "${path}" ] && source "${path}"\n`
  const text = zshrc ?? ''
  const gap = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n'

  return `${text}${gap}${block}`
}

/**
 * What the settings say that the setup looks at, merged: what applies in this folder. A project's
 * own `statusLine` (this repository's settings.local.json sets a no-op one) hides claude-hud here
 * while the user's file still runs it elsewhere, and here it is rightly not reported.
 */
export type SettingsFacts = { tui: unknown; language: unknown; statusLine: unknown }

/** The machine's state: our keys, and the settings' fullscreen, language and status line. */
export type SetupState = {
  keys: KeyState[]
  isFullscreen: boolean
  hasLanguage: boolean
  /** claude-hud's status line is on: it shows what the band does, twice. */
  hasClaudeHud: boolean
  /** The keybindings file is there and is not JSON: its keys cannot be read or added. */
  isKeyFileBroken: boolean
  /** Claude Code updates hubblerc as it starts (the user's settings say so). */
  isAutoUpdating: boolean
  /** The relaunch shell function; null when the plugin's script could not be read. */
  relaunch: RelaunchState | null
}

export function setupState(keyFile: string | undefined, settings: SettingsFacts, settingsFile?: string, relaunch?: RelaunchFacts): SetupState {
  const runsHud = (line: unknown) => {
    const command = typeof line === 'object' && line !== null ? (line as { command?: unknown }).command : undefined

    return typeof command === 'string' && command.includes('claude-hud')
  }

  return {
    keys: keyStates(keyFile),
    isFullscreen: settings.tui === 'fullscreen',
    hasLanguage: typeof settings.language === 'string' && settings.language.trim() !== '',
    hasClaudeHud: runsHud(settings.statusLine),
    isKeyFileBroken: keyFile !== undefined && keyFile.trim() !== '' && parse(keyFile) === null,
    isAutoUpdating: isAutoUpdating(settingsFile),
    relaunch: relaunch === undefined ? null : relaunchState(relaunch),
  }
}

/**
 * How many of the needed things are missing: our keys, the fullscreen layout, auto-update, the
 * relaunch function where `/setup` can put it. The rest are advice.
 */
export function missingCount(state: SetupState): number {
  return (
    state.keys.filter(key => key.state !== 'ok').length +
    (state.isFullscreen ? 0 : 1) +
    (state.isAutoUpdating ? 0 : 1) +
    (needsRelaunch(state.relaunch) ? 1 : 0)
  )
}

/** What `/setup` did for the relaunch function: the copy put or updated, the line added (and where the old file went), or could not. */
export type RelaunchChange = { copied: boolean; sourced: boolean; backup: string | null; scriptPath: string; zshrcPath: string } | null

/** What `/setup` did to the user's settings for auto-update: turned it on (and where the old file went), or could not. */
export type AutoUpdateChange = { done: 'on'; backup: string | null } | { done: 'broken'; path: string } | null

/** `/setup`'s report: each item ticked or not, what was done, and what is the person's to do. */
export function setupReport(
  state: SetupState,
  keyFile: string,
  added: readonly string[],
  backup: string | null,
  autoUpdate: AutoUpdateChange = null,
  relaunchChange: RelaunchChange = null,
): string {
  const lines = ['hubblerc 설정 점검', '']
  // Our keys on one line, each with what it is for and, when not plainly there, what became of it.
  const keyParts = state.keys.map(key => {
    const name = `${key.key}(${key.label})`
    if (key.state === 'ok') return name
    if (added.includes(key.key)) return `${name} 방금 추가함`
    if (key.state === 'conflict') return `${name} 이미 \`${key.current}\`에 묶여 있어 그대로 둠`

    return `${name} 없음`
  })
  const isEveryKeySet = state.keys.every(key => key.state === 'ok' || added.includes(key.key))
  lines.push(`${isEveryKeySet ? '✓' : '✗'} 키: ${keyParts.join(', ')}`)
  if (state.keys.some(key => key.state === 'conflict')) lines.push(`  다른 동작에 묶인 키는 \`${keyFile}\`에서 직접 바꾸세요`)
  if (state.isKeyFileBroken) lines.push(`✗ \`${keyFile}\`가 JSON이 아니라 키를 읽거나 더할 수 없습니다. 파일을 고친 뒤 다시 \`/setup\``)
  if (backup !== null) lines.push(`  원래 파일은 \`${backup}\`에 두었습니다`)

  if (state.isAutoUpdating) lines.push('✓ 자동 업데이트: Claude Code를 시작할 때 hubblerc 새 버전을 받음')
  else if (autoUpdate?.done === 'on') {
    lines.push('✓ 자동 업데이트: 방금 켬. 다음에 Claude Code를 시작할 때부터 hubblerc 새 버전을 받음')
    if (autoUpdate.backup !== null) lines.push(`  원래 설정은 \`${autoUpdate.backup}\`에 두었습니다`)
  } else if (autoUpdate?.done === 'broken') lines.push(`✗ 자동 업데이트: \`${autoUpdate.path}\`가 JSON이 아니라 켜지 못했습니다`)
  else lines.push('✗ 자동 업데이트가 꺼져 있습니다')

  lines.push(...relaunchLines(state.relaunch, relaunchChange))

  lines.push(state.isFullscreen ? '✓ 전체 화면 (tui: fullscreen)' : '✗ 전체 화면이 아닙니다: `/tui fullscreen`을 실행하거나 `~/.claude/settings.json`에 `"tui": "fullscreen"`. 사이드바와 버튼 클릭은 전체 화면에서만 됩니다')

  lines.push('', '권장')
  lines.push(
    state.hasClaudeHud
      ? '· claude-hud 상태줄이 켜져 있어 밴드와 같은 정보가 두 번 보입니다. `~/.claude/settings.json`에서 `"statusLine"`을 지우고, 다른 곳에서도 안 쓰면 `/plugin uninstall claude-hud`. hubblerc를 이 폴더에서만 켰다면 다른 폴더에서는 그대로 두어도 됩니다'
      : '✓ claude-hud 상태줄 없음',
  )
  lines.push(state.hasLanguage ? '✓ 응답 언어(language) 설정됨' : '· 응답 언어가 없습니다: `~/.claude/settings.json`에 `"language": "korean"`. hubblerc 문구는 한국어입니다')

  return lines.join('\n')
}

/** The report's lines on the relaunch function: there, just put there, or why not. */
function relaunchLines(state: RelaunchState | null, change: RelaunchChange): string[] {
  const name = '재시작 셸 함수(사이드바 "재시작", `/relaunch`)'
  if (state === null) return [`✗ ${name}: 플러그인의 셸 스크립트를 읽지 못했습니다`]
  if (!state.isZsh) return [`· ${name}: 셸이 zsh가 아니라 넣지 않았습니다. zsh 전용입니다`]
  if (state.hasAlias) return [`✗ ${name}: \`~/.zshrc\`에 \`alias claude=\`가 있어 넣지 않았습니다. 그 alias를 지운 뒤 다시 \`/setup\``]

  if (change !== null && (change.copied || change.sourced)) {
    const done = [change.copied ? `\`${change.scriptPath}\`에 복사` : '', change.sourced ? `\`${change.zshrcPath}\`에 불러오는 줄 추가` : '']
      .filter(part => part !== '')
      .join(', ')
    const lines = [`✓ ${name}: 방금 ${done}. 새 터미널에서 연 Claude Code부터 적용`]
    if (change.backup !== null) lines.push(`  원래 \`${change.zshrcPath}\`는 \`${change.backup}\`에 두었습니다`)

    return lines
  }
  if (state.isInstalled && state.isSourced) {
    return [state.isActive ? `✓ ${name}: 이 세션에 적용됨` : `✓ ${name}: 설치됨. 이 세션은 그 전에 열려서, 새 터미널에서 연 Claude Code부터 적용`]
  }

  return [`✗ ${name}이 설치되지 않았습니다`]
}

/** Claude Code's folder: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
async function configDir($: EngineInterface): Promise<string | undefined> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir !== undefined && dir !== '') return dir.replace(/\/$/, '')
  const home = await $.env.get('HOME')

  return home === undefined || home === '' ? undefined : `${home}/.claude`
}

/** Where the relaunch function goes and is sourced from, and what is there now. */
type RelaunchFiles = { scriptPath: string; zshrcPath: string; home: string; facts: RelaunchFacts }

type ReadState = {
  path: string | undefined
  text: string | undefined
  settingsPath: string | undefined
  settingsText: string | undefined
  relaunch: RelaunchFiles | undefined
  state: SetupState
}

async function readState($: EngineInterface): Promise<ReadState> {
  const dir = await configDir($)
  const path = dir === undefined ? undefined : `${dir}/keybindings.json`
  const settingsPath = dir === undefined ? undefined : `${dir}/settings.json`
  const text = path === undefined ? undefined : await $.fs.read(path).catch(() => undefined)
  const settingsText = settingsPath === undefined ? undefined : await $.fs.read(settingsPath).catch(() => undefined)
  const [tui, language, statusLine] = await Promise.all([
    $.settings.read({ key: 'tui' }),
    $.settings.read({ key: 'language' }),
    $.settings.read({ key: 'statusLine' }),
  ])
  const relaunch = await readRelaunch($, dir).catch(() => undefined)

  return { path, text, settingsPath, settingsText, relaunch, state: setupState(text, { tui, language, statusLine }, settingsText, relaunch?.facts) }
}

/** The script the plugin ships, the copy under Claude Code's folder, and the shell's startup file (`$ZDOTDIR` or home). */
async function readRelaunch($: EngineInterface, dir: string | undefined): Promise<RelaunchFiles | undefined> {
  const home = (await $.env.get('HOME')) ?? ''
  if (dir === undefined || home === '') return undefined
  const shipped = await $.fs.read(`${$.plugin.root}/shell/relaunch.zsh`).catch(() => undefined)
  if (shipped === undefined) return undefined

  const zdotdir = await $.env.get('ZDOTDIR')
  const zshrcPath = `${zdotdir !== undefined && zdotdir !== '' ? zdotdir.replace(/\/$/, '') : home}/.zshrc`
  const scriptPath = `${dir}/hubblerc/relaunch.zsh`
  const [installed, zshrc, shell, launched] = await Promise.all([
    $.fs.read(scriptPath).catch(() => undefined),
    $.fs.read(zshrcPath).catch(() => undefined),
    $.env.get('SHELL'),
    canRelaunch($),
  ])

  return { scriptPath, zshrcPath, home, facts: { isZsh: (shell ?? '').endsWith('/zsh'), shipped, installed, zshrc, isActive: launched } }
}

/** At session.start: when a needed thing is missing, one line in the conversation says so. */
export async function checkSetup($: EngineInterface): Promise<void> {
  const { state } = await readState($)
  const missing = missingCount(state)
  if (missing > 0) $.ui.log(`hubblerc 설정 ${missing}개가 덜 됐습니다. \`/setup\`으로 확인하세요`)
}

/**
 * `/setup`: adds the missing keys, turns auto-update on in the user's settings, and puts the
 * relaunch function in place (its script copied, a line sourcing it added to `~/.zshrc`); each file
 * it changes kept beside as `.bak` first, a file that is not JSON left alone. Reports every item.
 */
export async function runSetup($: EngineInterface): Promise<string> {
  const { path, text, settingsPath, settingsText, relaunch, state } = await readState($)
  if (path === undefined) return 'hubblerc 설정 점검: 홈 폴더를 알 수 없어 키 설정 파일을 찾지 못했습니다.'

  const next = withKeys(text)
  let backup: string | null = null
  let added: string[] = []
  if (next !== null) {
    if (text !== undefined) {
      backup = `${path}.bak`
      await $.fs.write(backup, text)
    }
    await $.fs.write(path, next)
    added = state.keys.filter(key => key.state === 'missing').map(key => key.key)
  }

  let autoUpdate: AutoUpdateChange = null
  if (!state.isAutoUpdating && settingsPath !== undefined) {
    const nextSettings = withAutoUpdate(settingsText)
    if (nextSettings === null) autoUpdate = { done: 'broken', path: settingsPath }
    else {
      const settingsBackup = settingsText === undefined ? null : `${settingsPath}.bak`
      if (settingsBackup !== null && settingsText !== undefined) await $.fs.write(settingsBackup, settingsText)
      await $.fs.write(settingsPath, nextSettings)
      autoUpdate = { done: 'on', backup: settingsBackup }
    }
  }

  let relaunchChange: RelaunchChange = null
  if (relaunch !== undefined && needsRelaunch(state.relaunch)) {
    const { scriptPath, zshrcPath, home, facts } = relaunch
    const copied = state.relaunch?.isInstalled !== true
    if (copied) await $.fs.write(scriptPath, facts.shipped)
    const nextZshrc = withRelaunchLine(facts.zshrc, scriptPath, home)
    let zshrcBackup: string | null = null
    if (nextZshrc !== null) {
      if (facts.zshrc !== undefined) {
        zshrcBackup = `${zshrcPath}.bak`
        await $.fs.write(zshrcBackup, facts.zshrc)
      }
      await $.fs.write(zshrcPath, nextZshrc)
    }
    relaunchChange = { copied, sourced: nextZshrc !== null, backup: zshrcBackup, scriptPath, zshrcPath }
  }

  return setupReport(state, path, added, backup, autoUpdate, relaunchChange)
}
