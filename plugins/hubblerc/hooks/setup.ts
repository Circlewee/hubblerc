import type { EngineInterface } from 'claude-code'

/**
 * What a machine needs beside the plugin, which no install carries: the keys in
 * `~/.claude/keybindings.json`, the fullscreen layout; and what it is better without or with:
 * claude-hud's status line (the band takes its place), a response language.
 *
 * At session.start the needed ones are checked and, when one is missing, one line says so; `/setup`
 * shows them all and adds the missing keys. Settings files are the person's: those are only told.
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
}

export function setupState(keyFile: string | undefined, settings: SettingsFacts): SetupState {
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
  }
}

/** How many of the needed things are missing: our keys, and the fullscreen layout. The rest are advice. */
export function missingCount(state: SetupState): number {
  return state.keys.filter(key => key.state !== 'ok').length + (state.isFullscreen ? 0 : 1)
}

/** `/setup`'s report: each item ticked or not, what was done, and what is the person's to do. */
export function setupReport(state: SetupState, keyFile: string, added: readonly string[], backup: string | null): string {
  const lines = ['hubblerc 설정 점검', '']
  for (const key of state.keys) {
    if (key.state === 'ok') lines.push(`✓ 키 ${key.key}: ${key.label}`)
    else if (added.includes(key.key)) lines.push(`✓ 키 ${key.key}: ${key.label} (방금 추가함)`)
    else if (key.state === 'conflict') lines.push(`✗ 키 ${key.key}: 이미 \`${key.current}\`에 묶여 있어 그대로 둠. 쓰려면 \`${keyFile}\`에서 직접 바꾸세요`)
    else lines.push(`✗ 키 ${key.key}: ${key.label}`)
  }
  if (state.isKeyFileBroken) lines.push(`✗ \`${keyFile}\`가 JSON이 아니라 키를 읽거나 더할 수 없습니다. 파일을 고친 뒤 다시 \`/setup\``)
  if (backup !== null) lines.push(`  원래 파일은 \`${backup}\`에 두었습니다`)

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

/** Where the keybindings file is: under `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
async function keyFilePath($: EngineInterface): Promise<string | undefined> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir !== undefined && configDir !== '') return `${configDir.replace(/\/$/, '')}/keybindings.json`
  const home = await $.env.get('HOME')

  return home === undefined || home === '' ? undefined : `${home}/.claude/keybindings.json`
}

async function readState($: EngineInterface): Promise<{ path: string | undefined; text: string | undefined; state: SetupState }> {
  const path = await keyFilePath($)
  const text = path === undefined ? undefined : await $.fs.read(path).catch(() => undefined)
  const [tui, language, statusLine] = await Promise.all([
    $.settings.read({ key: 'tui' }),
    $.settings.read({ key: 'language' }),
    $.settings.read({ key: 'statusLine' }),
  ])

  return { path, text, state: setupState(text, { tui, language, statusLine }) }
}

/** At session.start: when a needed thing is missing, one line in the conversation says so. */
export async function checkSetup($: EngineInterface): Promise<void> {
  const { state } = await readState($)
  const missing = missingCount(state)
  if (missing > 0) $.ui.log(`hubblerc 설정 ${missing}개가 덜 됐습니다. \`/setup\`으로 확인하세요`)
}

/** `/setup`: adds the missing keys (the file kept beside as `.bak` first) and reports every item. */
export async function runSetup($: EngineInterface): Promise<string> {
  const { path, text, state } = await readState($)
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

  return setupReport(state, path, added, backup)
}
