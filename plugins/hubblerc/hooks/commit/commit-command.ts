/**
 * Where `git … commit` stands in a Bash command, read the way a shell would: quotes, `$( )`,
 * subshells, comments and here-documents skipped, so a message that mentions "git commit" is not a
 * commit. Only a `git` word at the start of a command counts, after the global options a person
 * gives (`-C <dir>`, `-c <k=v>`, `--no-pager` and the like).
 *
 * A command this reader cannot follow (an unclosed quote or here-document, a stray `)`) gives
 * `undefined`: the caller leaves it as it is rather than guess.
 */

type Context = 'code' | 'double' | 'single' | 'backtick'

type HereDoc = { word: string; stripsTabs: boolean }

/** One word of a command: its text with quotes and escapes taken off, its span, and whether it was written with none. */
export type CommandWord = { text: string; start: number; end: number; isPlain: boolean }

/** A word being read, and the frame (one `code` level: the command line, a subshell, a `$( )`) that owns it. */
type Frame = { isCommandStart: boolean; command: CommandWord[] | undefined; word: CommandWord | undefined; skipWord: boolean }

type Layer = { kind: Context; frame: Frame; isDollar: boolean }

/** Global options of git that take no value, which may stand between `git` and `commit`. */
const FLAG_OPTIONS = new Set(['--no-pager', '-P', '--paginate', '-p', '--bare', '--no-replace-objects', '--literal-pathspecs', '--no-optional-locks'])

/** Characters that end an unquoted word. */
const WORD_END = /[\s;&|()<>'"`\\]/

const newFrame = (): Frame => ({ isCommandStart: true, command: undefined, word: undefined, skipWord: false })

/**
 * Every command in a Bash command, as its words: the command word first, then the words up to the
 * next operator or newline. Read the way a shell would (quotes, `$( )`, subshells, comments and
 * here-documents skipped), so what a message or a here-document mentions is no command. `NAME=value`
 * words before the command are left out, redirections and their targets are not words. A `$( )` in a
 * word reads as `$(…)` in its text. Undefined when the command cannot be followed (an unclosed quote
 * or here-document, a stray `)`).
 */
export function findCommands(command: string): CommandWord[][] | undefined {
  const commands: CommandWord[][] = []
  const top = newFrame()
  const stack: Layer[] = [{ kind: 'code', frame: top, isDollar: false }]
  const pending: HereDoc[] = []
  let i = 0

  /** Adds text to the frame's word, starting one at `start` when none is open. */
  const extend = (frame: Frame, text: string, start: number, end: number, isPlain: boolean) => {
    frame.word ??= { text: '', start, end: start, isPlain: true }
    frame.word.text += text
    frame.word.end = end
    if (!isPlain) frame.word.isPlain = false
  }
  /** The frame's word is whole: the command word, an argument, or nothing (an assignment, a redirection's target). */
  const finish = (frame: Frame) => {
    const word = frame.word
    if (word === undefined) return
    frame.word = undefined
    if (frame.skipWord) {
      frame.skipWord = false

      return
    }
    if (frame.command !== undefined) frame.command.push(word)
    else if (frame.isCommandStart && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text)) {
      frame.command = [word]
      commands.push(frame.command)
      frame.isCommandStart = false
    }
  }
  /** An operator: the command is over and the next word starts one. */
  const endCommand = (frame: Frame) => {
    finish(frame)
    frame.command = undefined
    frame.isCommandStart = true
    frame.skipWord = false
  }

  while (i < command.length) {
    const layer = stack[stack.length - 1]
    if (layer === undefined) return undefined
    const { kind: context, frame } = layer
    const ch = command[i]

    if (context === 'single') {
      if (ch === "'") {
        stack.pop()
        if (frame.word !== undefined) frame.word.end = i + 1
      } else extend(frame, ch ?? '', i, i + 1, false)
      i += 1
      continue
    }
    if (context === 'double' || context === 'backtick') {
      if (ch === '\\') {
        const next = command[i + 1]
        if (context === 'double' && next !== undefined) extend(frame, next === '"' || next === '\\' || next === '$' || next === '`' ? next : `\\${next}`, i, i + 2, false)
        i += 2
        continue
      }
      if ((context === 'double' && ch === '"') || (context === 'backtick' && ch === '`')) {
        stack.pop()
        if (frame.word !== undefined) frame.word.end = i + 1
        i += 1
        continue
      }
      if (ch === '$' && command[i + 1] === '(') {
        stack.push({ kind: 'code', frame: newFrame(), isDollar: true })
        i += 2
        continue
      }
      if (context === 'double' && ch === '`') stack.push({ kind: 'backtick', frame, isDollar: false })
      else if (context === 'double') extend(frame, ch ?? '', i, i + 1, false)
      i += 1
      continue
    }

    // Code: the shell's own words and operators.
    if (ch === '\\') {
      // A backslash-newline joins lines; any other escapes one character of a word.
      if (command[i + 1] === '\n') finish(frame)
      else extend(frame, command[i + 1] ?? '', i, i + 2, false)
      i += 2
      continue
    }
    if (ch === ' ' || ch === '\t') {
      finish(frame)
      i += 1
      continue
    }
    if (ch === '\n') {
      finish(frame)
      i += 1
      if (pending.length > 0) {
        const after = skipHereDocs(command, i, pending)
        if (after === undefined) return undefined
        i = after
        pending.length = 0
      }
      endCommand(frame)
      continue
    }
    if (ch === '#' && frame.word === undefined && (i === 0 || /\s/.test(command[i - 1] ?? ''))) {
      while (i < command.length && command[i] !== '\n') i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      stack.push({ kind: ch === "'" ? 'single' : ch === '"' ? 'double' : 'backtick', frame, isDollar: false })
      extend(frame, '', i, i + 1, false)
      i += 1
      continue
    }
    if (ch === '$' && command[i + 1] === '(') {
      stack.push({ kind: 'code', frame: newFrame(), isDollar: true })
      i += 2
      continue
    }
    if (ch === '<' && command[i + 1] === '<') {
      finish(frame)
      if (command[i + 2] === '<') {
        frame.skipWord = true
        i += 3
        continue
      }
      const read = readHereDocWord(command, i + 2)
      if (read === undefined) return undefined
      pending.push(read.doc)
      i = read.end
      continue
    }
    if (ch === '<' || ch === '>') {
      // `2>&1`: the digits before it belong to the redirection; its target is no argument.
      if (frame.word !== undefined && frame.word.end === i && /^\d+$/.test(frame.word.text)) frame.word = undefined
      else finish(frame)
      frame.skipWord = true
      i += command[i + 1] === '&' ? 2 : 1
      continue
    }
    if (ch === ';' || ch === '&' || ch === '|') {
      endCommand(frame)
      i += 1
      continue
    }
    if (ch === '(') {
      finish(frame)
      frame.command = undefined
      frame.isCommandStart = false
      stack.push({ kind: 'code', frame: newFrame(), isDollar: false })
      i += 1
      continue
    }
    if (ch === ')') {
      if (stack.length === 1) return undefined
      endCommand(frame)
      stack.pop()
      const outer = stack[stack.length - 1]
      if (outer === undefined) return undefined
      if (layer.isDollar) extend(outer.frame, '$(…)', i, i + 1, false)
      else {
        outer.frame.command = undefined
        outer.frame.isCommandStart = false
      }
      i += 1
      continue
    }
    if (ch === '{' || ch === '}') {
      finish(frame)
      frame.command = undefined
      frame.isCommandStart = ch === '{'
      i += 1
      continue
    }

    // A word.
    const start = i
    while (i < command.length && !WORD_END.test(command[i] ?? '') && !(command[i] === '$' && command[i + 1] === '(')) i += 1
    if (i === start) {
      i += 1
      continue
    }
    extend(frame, command.slice(start, i), start, i, true)
  }

  if (stack.length !== 1 || pending.length > 0) return undefined
  finish(top)

  return commands
}

/**
 * One `git … commit` in a command: the `commit` word's span, the `-C` folder before it, whether it
 * rewrites the last commit (`--amend` among its words), and the words after `commit` up to the end
 * of that git command (not the commands that follow it).
 */
export type CommitSpot = { at: number; end: number; dir: string | undefined; isAmend: boolean; args: CommandWord[] }

export function findCommits(command: string): CommitSpot[] | undefined {
  const commands = findCommands(command)
  if (commands === undefined) return undefined
  const spots: CommitSpot[] = []
  for (const words of commands) {
    const first = words[0]
    if (first === undefined || !first.isPlain || !(first.text === 'git' || first.text.endsWith('/git'))) continue
    const spot = commitAfterGit(words)
    if (spot !== undefined) spots.push(spot)
  }

  return spots
}

/** Puts `before` ahead of each `commit` word and `after` right behind it, last spot first. */
export function withAround(command: string, spots: readonly CommitSpot[], before: string, after: string): string {
  let out = command
  for (const spot of [...spots].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, spot.at) + before + out.slice(spot.at, spot.end) + after + out.slice(spot.end)
  }

  return out
}

/** One shell word, single-quoted. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** After `git`: its global options, then `commit` as a whole word, or nothing. */
function commitAfterGit(words: readonly CommandWord[]): CommitSpot | undefined {
  let dir: string | undefined
  for (let at = 1; at < words.length; at += 1) {
    const token = words[at]
    if (token === undefined) return undefined
    if (token.text === '-C' || token.text === '-c') {
      const value = words[at + 1]
      if (value === undefined) return undefined
      if (token.text === '-C') dir = value.text
      at += 1
      continue
    }
    if (FLAG_OPTIONS.has(token.text) || /^--(git-dir|work-tree|namespace|exec-path)=/.test(token.text)) continue
    if (token.text === 'commit' && token.isPlain) {
      const args = words.slice(at + 1)

      return { at: token.start, end: token.end, dir, isAmend: args.some(word => word.isPlain && word.text === '--amend'), args }
    }

    return undefined
  }

  return undefined
}

/** After `<<`: an optional `-`, then the delimiter, bare or quoted. */
function readHereDocWord(command: string, from: number): { doc: HereDoc; end: number } | undefined {
  let i = from
  const stripsTabs = command[i] === '-'
  if (stripsTabs) i += 1
  while (command[i] === ' ' || command[i] === '\t') i += 1
  const quote = command[i]
  if (quote === "'" || quote === '"') {
    const close = command.indexOf(quote, i + 1)
    if (close <= i + 1) return undefined

    return { doc: { word: command.slice(i + 1, close), stripsTabs }, end: close + 1 }
  }
  const start = i
  while (i < command.length && !/[\s;&|()<>'"`]/.test(command[i] ?? '')) i += 1
  if (i === start) return undefined

  return { doc: { word: command.slice(start, i).replace(/\\/g, ''), stripsTabs }, end: i }
}

/** Skips each pending here-document's body, from the line after its `<<`; undefined if one never closes. */
function skipHereDocs(command: string, from: number, docs: readonly HereDoc[]): number | undefined {
  let i = from
  for (const doc of docs) {
    for (;;) {
      if (i > command.length) return undefined
      const newline = command.indexOf('\n', i)
      const lineEnd = newline < 0 ? command.length : newline
      const line = command.slice(i, lineEnd)
      i = newline < 0 ? command.length + 1 : newline + 1
      if ((doc.stripsTabs ? line.replace(/^\t+/, '') : line) === doc.word) break
      if (newline < 0) return undefined
    }
  }

  return Math.min(i, command.length)
}
