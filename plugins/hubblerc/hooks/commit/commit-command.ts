/**
 * Where `git … commit` stands in a Bash command, read the way a shell would: quotes, `$( )`,
 * subshells, comments and here-documents skipped, so a message that mentions "git commit" is not a
 * commit. Only a `git` word at the start of a command counts, after the global options a person
 * gives (`-C <dir>`, `-c <k=v>`, `--no-pager` and the like).
 *
 * A command this reader cannot follow (an unclosed quote or here-document, a stray `)`) gives
 * `undefined`: the caller leaves it as it is rather than guess.
 */

/** One `git … commit` in a command: the `commit` word's span, and the `-C` folder before it. */
export type CommitSpot = { at: number; end: number; dir: string | undefined }

type Context = 'code' | 'double' | 'single' | 'backtick'

type HereDoc = { word: string; stripsTabs: boolean }

/** Global options of git that take no value, which may stand between `git` and `commit`. */
const FLAG_OPTIONS = new Set(['--no-pager', '-P', '--paginate', '-p', '--bare', '--no-replace-objects', '--literal-pathspecs', '--no-optional-locks'])

/** Characters that end an unquoted word. */
const WORD_END = /[\s;&|()<>'"`\\]/

export function findCommits(command: string): CommitSpot[] | undefined {
  const spots: CommitSpot[] = []
  const stack: Context[] = ['code']
  const pending: HereDoc[] = []
  let isCommandStart = true
  let i = 0

  while (i < command.length) {
    const context = stack[stack.length - 1]
    const ch = command[i]

    if (context === 'single') {
      if (ch === "'") stack.pop()
      i += 1
      continue
    }
    if (context === 'double' || context === 'backtick') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if ((context === 'double' && ch === '"') || (context === 'backtick' && ch === '`')) {
        stack.pop()
        i += 1
        continue
      }
      if (ch === '$' && command[i + 1] === '(') {
        stack.push('code')
        isCommandStart = true
        i += 2
        continue
      }
      if (context === 'double' && ch === '`') stack.push('backtick')
      i += 1
      continue
    }

    // Code: the shell's own words and operators.
    if (ch === '\\') {
      // A backslash-newline joins lines; any other escapes one character of a word.
      if (command[i + 1] !== '\n') isCommandStart = false
      i += 2
      continue
    }
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if (ch === '\n') {
      i += 1
      if (pending.length > 0) {
        const after = skipHereDocs(command, i, pending)
        if (after === undefined) return undefined
        i = after
        pending.length = 0
      }
      isCommandStart = true
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(command[i - 1] ?? ''))) {
      while (i < command.length && command[i] !== '\n') i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      stack.push(ch === "'" ? 'single' : ch === '"' ? 'double' : 'backtick')
      isCommandStart = false
      i += 1
      continue
    }
    if (ch === '$' && command[i + 1] === '(') {
      stack.push('code')
      isCommandStart = true
      i += 2
      continue
    }
    if (ch === '<' && command[i + 1] === '<') {
      if (command[i + 2] === '<') {
        i += 3
        continue
      }
      const read = readHereDocWord(command, i + 2)
      if (read === undefined) return undefined
      pending.push(read.doc)
      i = read.end
      isCommandStart = false
      continue
    }
    if (ch === '<' || ch === '>') {
      i += command[i + 1] === '&' ? 2 : 1
      continue
    }
    if (ch === ';' || ch === '&' || ch === '|') {
      isCommandStart = true
      i += 1
      continue
    }
    if (ch === '(') {
      stack.push('code')
      isCommandStart = true
      i += 1
      continue
    }
    if (ch === ')') {
      if (stack.length === 1) return undefined
      stack.pop()
      isCommandStart = false
      i += 1
      continue
    }
    if (ch === '{' || ch === '}') {
      isCommandStart = ch === '{'
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
    const word = command.slice(start, i)
    if (!isCommandStart) continue
    // `NAME=value git commit`: an assignment leaves the command still to come.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue
    isCommandStart = false
    if (word === 'git' || word.endsWith('/git')) {
      const spot = commitAfterGit(command, i)
      if (spot !== undefined) spots.push(spot)
    }
  }

  if (stack.length !== 1 || pending.length > 0) return undefined

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
function commitAfterGit(command: string, from: number): CommitSpot | undefined {
  let dir: string | undefined
  let i = from
  for (;;) {
    const token = readToken(command, i)
    if (token === undefined) return undefined
    i = token.end
    if (token.text === '-C') {
      const value = readToken(command, i)
      if (value === undefined) return undefined
      dir = value.text
      i = value.end
      continue
    }
    if (token.text === '-c') {
      const value = readToken(command, i)
      if (value === undefined) return undefined
      i = value.end
      continue
    }
    if (FLAG_OPTIONS.has(token.text) || /^--(git-dir|work-tree|namespace|exec-path)=/.test(token.text)) continue
    if (token.text === 'commit' && token.isPlain) return { at: token.start, end: token.end, dir }

    return undefined
  }
}

/**
 * One word on the same command: blanks (and backslash-newlines) skipped, then a plain word or one
 * in quotes (`isPlain` false). Undefined at an operator, a newline or the end.
 */
function readToken(command: string, from: number): { text: string; start: number; end: number; isPlain: boolean } | undefined {
  let i = from
  while (i < command.length) {
    if (command[i] === ' ' || command[i] === '\t') i += 1
    else if (command[i] === '\\' && command[i + 1] === '\n') i += 2
    else break
  }
  const start = i
  const ch = command[i]
  if (ch === undefined || /[\n;&|()<>`\\]/.test(ch)) return undefined
  if (ch === "'" || ch === '"') {
    const close = command.indexOf(ch, i + 1)
    if (close < 0) return undefined

    return { text: command.slice(i + 1, close), start, end: close + 1, isPlain: false }
  }
  while (i < command.length && !WORD_END.test(command[i] ?? '')) i += 1

  return { text: command.slice(start, i), start, end: i, isPlain: true }
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
