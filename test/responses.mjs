import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { sourceUrl } from '../collect.mjs'
import { sources, boardUrl } from '../sources.mjs'
import { engineeringFixture } from './html-fixture.mjs'

const academic = JSON.parse(await readFile(new URL('./fixtures/board-list.json', import.meta.url), 'utf8'))
const cms = await readFile(new URL('./fixtures/cms-list.html', import.meta.url), 'utf8')
export function healthy(url) {
  if (url === sourceUrl) return Response.json(academic)
  const requested = new URL(url)
  const source = sources.find(source => {
    const expected = new URL(boardUrl(source))
    return expected.origin === requested.origin && expected.pathname === requested.pathname &&
      ['bbsConfigFK', 'siteId', 'board_id'].every(key => expected.searchParams.get(key) === requested.searchParams.get(key))
  })
  assert.ok(source, 'Only a catalog board may be requested.')
  let html
  if (source.kind || source.gallery) html = engineeringFixture(source)
  else {
    html = cms.replaceAll('7530', String(source.board)).replaceAll('aibased', source.site)
    if (['ai-news', 'ai-careers', 'computing-notices', 'eng-careers'].includes(source.id))
      html = html.replace(/(<strong>\[공지\] <\/strong>)\s*<!--[\s\S]*?-->/g, '$1')
  }
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}
