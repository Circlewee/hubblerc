import { expect, test } from 'claude-code/testing'
import type { FsStat, On } from 'claude-code'

const provider = { plugin: 'engine', tier: 'core' } as const
const RULE = 'hubblerc:aside-research'
const HOME = '/Users/me'

/**
 * The machine beneath the plugin: its PATH and HOME, and the files that are there (by path, what a
 * stat of each answers). Every lookup is counted, so a test sees how often the plugin looked.
 */
function machine(on: On, files: Record<string, FsStat['kind']>, path = '/usr/bin:/bin'): { stats: string[] } {
  const seen = { stats: [] as string[] }
  on('tool.describe', (_, e) => ({ description: e.description }))
  on('env.get', (_, e) => ({ value: e.name === 'PATH' ? path : e.name === 'HOME' ? HOME : undefined }))
  on('fs.stat', (_, e) => {
    seen.stats.push(e.path)
    const kind = files[e.path]

    return kind === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { kind, size: 0, mtimeMs: 0, isLink: true } }
  })

  return seen
}

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

test('with Aside installed, WebSearch and WebFetch point at the skill once, described twice or not', async ($, on) => {
  // Linked where its installer puts it, a folder this process's PATH lacks.
  const seen = machine(on, { [`${HOME}/.local/bin/aside`]: 'file' })

  for (const tool of ['WebSearch', 'WebFetch']) {
    // Behind ToolSearch: its short text, then the one loaded.
    const short = await $.tool.describe({ tool, description: `${tool} (short).`, provider, isDeferred: true })
    const loaded = await $.tool.describe({ tool, description: `${tool} does its work.`, provider, isDeferred: true })
    expect(short.description.startsWith(`${tool} (short).`)).toBe(true)
    expect(loaded.description.startsWith(`${tool} does its work.`)).toBe(true)
    expect(count(short.description, RULE)).toBe(1)
    expect(count(loaded.description, RULE)).toBe(1)
    expect(loaded.description).toContain('signed-in site')

    // Handed a description that already carries the line (a second describe of the answer): kept as it is.
    const again = await $.tool.describe({ tool, description: loaded.description, provider })
    expect(again.description).toBe(loaded.description)
  }

  // Looked up once for all six describes: one stat per folder (PATH's two and ~/.local/bin).
  expect(seen.stats.length).toBe(3)
})

test('without Aside, the web tools are described as the engine gave them', async ($, on) => {
  machine(on, {})

  for (const tool of ['WebSearch', 'WebFetch']) {
    const described = await $.tool.describe({ tool, description: `${tool} does its work.`, provider })
    expect(described.description).toBe(`${tool} does its work.`)
  }
})

test('a link left by a removed Aside, or a folder named aside, does not count', async ($, on) => {
  machine(on, { [`${HOME}/.local/bin/aside`]: 'other', '/usr/bin/aside': 'dir' })

  const described = await $.tool.describe({ tool: 'WebSearch', description: 'Searches the web.', provider })
  expect(described.description).toBe('Searches the web.')
})

test('Aside on PATH counts too', async ($, on) => {
  machine(on, { '/opt/aside/bin/aside': 'file' }, '/usr/bin:/opt/aside/bin')

  const described = await $.tool.describe({ tool: 'WebFetch', description: 'Fetches a page.', provider })
  expect(count(described.description, RULE)).toBe(1)
})

test('other tools never get the line, and Bash keeps its Korean rule beside it', async ($, on) => {
  machine(on, { [`${HOME}/.local/bin/aside`]: 'file' })

  const bash = await $.tool.describe({ tool: 'Bash', description: 'Executes a bash command.', provider })
  expect(bash.description).toContain('Write it in Korean')
  expect(bash.description).not.toContain(RULE)

  const read = await $.tool.describe({ tool: 'Read', description: 'Reads a file.', provider })
  expect(read.description).toBe('Reads a file.')

  const search = await $.tool.describe({ tool: 'WebSearch', description: 'Searches the web.', provider })
  expect(count(search.description, RULE)).toBe(1)
  expect(search.description).not.toContain('Write it in Korean')
})
