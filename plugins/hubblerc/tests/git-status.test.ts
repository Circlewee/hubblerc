import { expect, test } from 'claude-code/testing'

import { standInForEngine, start } from './engine'

test('the git status polled for the band and the files takes no optional lock', async ($, on) => {
  const standIn = standInForEngine(on)
  await start($)
  await standIn.clock.advance(6000)

  expect(standIn.gitStatusArgs.length).toBeGreaterThan(0)
  for (const argv of standIn.gitStatusArgs) expect(argv.slice(0, 2)).toEqual(['git', '--no-optional-locks'])
})
