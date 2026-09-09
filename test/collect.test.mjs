import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFeed, collect, collectSource, sourceUrl } from '../collect.mjs'
import { sources, feedUrl } from '../sources.mjs'
import { validateFeed } from '../feed.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/board-list.json', import.meta.url), 'utf8'))
const fetchedAt = new Date('2026-09-08T12:00:00Z')

test('mixes pinned and regular notices by registration date, not board position', () => {
  const feed = buildFeed(fixture, fetchedAt)
  assert.equal(feed.schemaVersion, 2)
  assert.equal(feed.fetchedAt, '2026-09-08T12:00:00.000Z')
  assert.equal(feed.notices.length, 30)
  assert.deepEqual(feed.notices.slice(0, 5).map(row => new URL(row.url).pathname), [
    '/ko/detail/551152', '/ko/detail/551111', '/ko/detail/551110', '/ko/detail/551012', '/ko/detail/550997',
  ])
  assert.equal(feed.notices[0].publishedDate, '2026-09-04')
  assert.equal(feed.notices[0].title, '[수업,수강신청] 2026학년도 2학기 학부 개설과목 폐강 안내')
  assert.equal(new URL(feed.notices[0].url).searchParams.get('redirect'), '/ko/academic-support/notices')
  assert.equal(new URL(feed.notices[0].url).searchParams.get('bbsConfigFk'), '2')
})

test('selects the newest 30 unique entries and rejects insufficient regular coverage', () => {
  const expected = [...new Map(fixture.data.list.map(row => [row.pkId, row])).values()]
    .sort((a, b) => b.regDate.localeCompare(a.regDate) || b.pkId - a.pkId)
    .slice(0, 30).map(row => `/ko/detail/${row.pkId}`)
  assert.deepEqual(buildFeed(fixture).notices.map(row => new URL(row.url).pathname), expected)
  const copy = structuredClone(fixture)
  const regular = copy.data.list.filter(row => row.isTop === 'N')
  for (const row of regular.slice(29)) row.isTop = 'Y'
  copy.data.list.sort((a, b) => b.regDate.localeCompare(a.regDate))
  assert.throws(() => buildFeed(copy), /Too few regular notices/)
  Object.assign(copy.data, { total: copy.data.size, hasNextPage: false })
  assert.equal(buildFeed(copy).notices.length, 30)
  Object.assign(copy.data, { list: regular.slice(0, 7), size: 7, total: 7 })
  assert.equal(buildFeed(copy).notices.length, 7)
})

test('deduplicates pinned copies and uses the ID to break date ties', () => {
  const copy = structuredClone(fixture)
  copy.data.list[18] = { ...copy.data.list[17] }
  assert.equal(buildFeed(copy).notices.filter(row => row.url.includes('/551152?')).length, 1)
  copy.data.list[1].regDate = copy.data.list[0].regDate
  assert.match(buildFeed(copy).notices[1].url, /\/551111\?/)
})

test('accepts a confirmed empty board, not a missing or truncated list', () => {
  const copy = structuredClone(fixture)
  Object.assign(copy.data, { list: [], total: 0, size: 0, hasNextPage: false })
  assert.deepEqual(buildFeed(copy).notices, [])
  copy.data.total = 1586
  assert.throws(() => buildFeed(copy))
})

test('rejects malformed metadata, changed ordering, and pin saturation', () => {
  for (const change of [
    x => { x.statusCode = 500 },
    x => { delete x.data.list },
    x => { x.data.pageNum = 2 },
    x => { x.data.size = 15 },
    x => { x.data.list[0].title = ' ' },
    x => { x.data.list[0].pkId = '../bad' },
    x => { x.data.list[0].configId = 3 },
    x => { x.data.list[0].regDate = '20260230100000' },
    x => { x.data.list[0].regDate = '20260903240000' },
    x => { x.data.list[0].regDate = null },
    x => { x.data.list[0].isTop = 'unknown' },
    x => { x.data.list[18].regDate = '20260905120000' },
    x => { x.data.list[1].pkId = x.data.list[0].pkId },
    x => { x.data.list = x.data.list.slice(0, 49); x.data.size = 49 },
  ]) {
    const copy = structuredClone(fixture)
    change(copy)
    assert.throws(() => buildFeed(copy))
  }
  const pinned = structuredClone(fixture)
  for (const row of pinned.data.list) row.isTop = 'Y'
  pinned.data.list.sort((a, b) => b.regDate.localeCompare(a.regDate))
  assert.throws(() => buildFeed(pinned), /Too few regular notices/)
  for (const invalid of [null, {}, '<html>Unavailable</html>']) assert.throws(() => buildFeed(invalid))
})

test('academic requests retain timeout, TLS-safe redirect policy, and JSON checks', async () => {
  const feed = await collectSource(sources[0], async (url, options) => {
    assert.equal(url, sourceUrl)
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.redirect, 'error')
    return Response.json(fixture)
  })
  assert.equal(feed.notices.length, 30)
  for (const response of [new Response('Unavailable', { status: 503 }), new Response('<html>Error</html>'), Response.json({})]) {
    await assert.rejects(collectSource(sources[0], async () => response))
  }
})

const cms = await readFile(new URL('./fixtures/cms-list.html', import.meta.url), 'utf8')
function cmsFixture(source) {
  let html = cms.replaceAll('7530', String(source.board)).replaceAll('aibased', source.site)
  if (['ai-news', 'ai-careers'].includes(source.id)) {
    // These two templates put pinned titles directly in the anchor, without comments.
    html = html.replace(/(<strong>\[공지\] <\/strong>)\s*<!--[\s\S]*?-->/g, '$1')
  }
  return html
}
function healthy(url) {
  if (url === sourceUrl) return Response.json(fixture)
  const source = sources.find(source => source.board === Number(new URL(url).searchParams.get('bbsConfigFK')))
  assert.ok(source)
  return new Response(cmsFixture(source), { headers: { 'Content-Type': 'text/html' } })
}

test('all-board bootstrap, recovered failures, unsafe recovery and write failures preserve publication safety', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sogang-notices-'))
  try {
    const feeds = await collect(directory, async url => healthy(url))
    assert.equal(feeds.length, 13)
    for (const feed of feeds) assert.deepEqual(JSON.parse(await readFile(join(directory, 'feeds', `${feed.sourceId}.json`), 'utf8')), feed)
    const before = await readFile(join(directory, 'feeds', 'sogang-academic.json'), 'utf8')
    const old = { ...feeds[0], fetchedAt: fetchedAt.toISOString(), lastAttemptAt: fetchedAt.toISOString() }
    const recoveryFetcher = previous => async url => {
      if (url === sourceUrl) return new Response('Failed', { status: 503 })
      if (url === feedUrl(sources[0])) return Response.json(previous)
      return healthy(url)
    }
    for (const previous of [null, {}, { ...old, sourceId: 'cs-main' }, { ...old, schemaVersion: 1 },
      { ...old, fetchedAt: '2999-01-01T00:00:00.000Z' }, { ...old, notices: [{ ...old.notices[0], url: 'javascript:1' }] }]) {
      await assert.rejects(collect(directory, recoveryFetcher(previous)))
      assert.equal(await readFile(join(directory, 'feeds', 'sogang-academic.json'), 'utf8'), before)
    }
    await assert.rejects(collect(directory, async url => url === sourceUrl || url === feedUrl(sources[0]) ? new Response('', { status: 404 }) : healthy(url)))
    const recovered = await collect(directory, recoveryFetcher(old))
    assert.equal(recovered[0].collectionStatus, 'error')
    assert.equal(recovered[0].fetchedAt, old.fetchedAt)
    assert.deepEqual(recovered[0].notices, old.notices)
    assert.ok(recovered[0].lastAttemptAt >= old.lastAttemptAt)
    assert.ok(recovered.slice(1).every(feed => feed.collectionStatus === 'ok'))
    const file = join(directory, 'blocked')
    await writeFile(file, 'unchanged')
    await assert.rejects(collect(file, async url => healthy(url)))
    assert.equal(await readFile(file, 'utf8'), 'unchanged')
    for (const bad of [{ ...old, lastAttemptAt: '2025-01-01T00:00:00.000Z' }, { ...old, notices: Array(31).fill(old.notices[0]) },
      { ...old, notices: [{ ...old.notices[0], publishedDate: '2026-02-30' }] }]) assert.throws(() => validateFeed(bad, sources[0]))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
