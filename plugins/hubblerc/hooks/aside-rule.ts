import type { EngineInterface, On } from 'claude-code'

/**
 * Added to the WebSearch and WebFetch descriptions where the Aside CLI is installed. A skill is read
 * only when the model judges it needed, and in research it did not reach for `hubblerc:aside-research`,
 * so this short line rides on the tools the model already uses for the web.
 */
export const ASIDE_RULE =
  "\n\nIf the task needs a signed-in site, a JS-rendered or blocked page, the user's personal context, or checking a web page on screen, use the `hubblerc:aside-research` skill from the start; if search results come back thin or out of date, switch to it."

const WEB_TOOLS = ['WebSearch', 'WebFetch'] as const

/**
 * Whether the Aside CLI is on this machine, looked up by the first describe and kept for the module's
 * life (a process, as session.start: never again on /clear). A failed lookup counts as not installed.
 */
let asideFound: Promise<boolean> | undefined

/**
 * An `aside` executable in a PATH folder or in `~/.local/bin` (where its installer links it, which a
 * GUI-launched process may not have on PATH). Only file lookups, no process: a link is followed, so
 * one left behind by a removed app leads nowhere and does not count.
 */
async function findAside($: EngineInterface): Promise<boolean> {
  const [path, home] = await Promise.all([$.env.get('PATH'), $.env.get('HOME')])
  const folders = new Set((path ?? '').split(':').filter(folder => folder.startsWith('/')))
  if (home !== undefined && home !== '') folders.add(`${home}/.local/bin`)
  const found = await Promise.all([...folders].map(folder => $.fs.stat(`${folder}/aside`).then(
    stat => stat.kind === 'file',
    () => false,
  )))

  return found.includes(true)
}

/** Whether Aside is installed, looked up once. */
export function hasAside($: EngineInterface): Promise<boolean> {
  asideFound ??= findAside($).catch(() => false)

  return asideFound
}

/**
 * Points research that needs Aside at the skill, on machines that have Aside (this plugin is also
 * installed where it is not). The engine reads a tool's description once a session and caches the
 * answer; a tool behind ToolSearch is described twice (its short text, then the one loaded), and an
 * answer already carrying the line is left as it is.
 */
export function addAsideRule(on: On): void {
  for (const tool of WEB_TOOLS) {
    on('tool.describe', { tool }, async ($, e, next) => {
      const described = await next(e)
      if (described.description.includes(ASIDE_RULE) || !(await hasAside($))) return described

      return { ...described, description: described.description + ASIDE_RULE }
    }).catch(($, e, next) => next(e))
  }
}
