import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { parseCmsPage, selectCmsNotices } from '../cms.mjs'
import { sources } from '../sources.mjs'

const source = sources.find(source => source.id === 'aibased-news')
const html = await readFile(new URL('./fixtures/cms-list.html', import.meta.url), 'utf8')
const empty = await readFile(new URL('./fixtures/cms-empty.html', import.meta.url), 'utf8')

test('CMS accepts the observed explicit empty structure without pagination, never a missing list', () => {
  assert.deepEqual(selectCmsNotices([parseCmsPage(empty, source, 1)]), [])
  assert.throws(() => parseCmsPage(empty.replace('검색된 게시물이 없습니다.', ''), source, 1))
  assert.throws(() => parseCmsPage(empty, source, 2))
  assert.throws(() => parseCmsPage(empty.replace('name="searchValue" value=""', 'name="searchValue" value="unexpected filter"'), source, 1))
})

test('CMS list preserves full comment titles, pins, dates, and board-scoped identities', () => {
  const page = parseCmsPage(html, source, 1)
  assert.equal(page.pages, 1)
  assert.equal(page.rows.length, 7)
  assert.equal(page.rows.filter(row => row.pinned).length, 4)
  const notices = selectCmsNotices([page])
  assert.equal(notices.length, 7)
  assert.equal(notices[5].title, '낭종호 교수 연구팀, Computer Vision 분야 Premiere conference ‘WACV 2025’ 논문 채택')
  assert.equal(new URL(notices[5].url).searchParams.get('bbsConfigFK'), '7530')
  assert.equal(new URL(notices[5].url).searchParams.get('siteId'), 'aibased')
  assert.equal(notices[5].publishedDate, '2025-04-28')
})

test('CMS rejects wrong sources, truncated pages, malformed identities, dates and missing full titles', () => {
  for (const bad of [html.replaceAll('7530', '7510'), html.replace('2026.06.30', '2026.02.30'),
    html.replace('pkid=937984', 'pkid=937984&pkid=42'),
    html.replace('pkid=937984', 'pkid=../bad'), html.replace('<!-- 소프트웨어융합대학 소식지_2026 여름호 -->', ''),
    html.replace('/ 1', '/ 2'), '<html>Unavailable</html>']) {
    assert.throws(() => parseCmsPage(bad, source, 1))
  }
  assert.throws(() => parseCmsPage(html, source, 2))
})

test('CMS selection rejects incomplete sampling and conflicts, mixes pins, and limits to 30', () => {
  const page = parseCmsPage(html, source, 1)
  assert.throws(() => selectCmsNotices([{ ...page, pages: 2 }]))
  assert.throws(() => selectCmsNotices([{ ...page, rows: [...page.rows, { ...page.rows[0], title: 'Conflict' }] }]))
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...page.rows[0], id: 100 - i, url: `https://example.com/${i}`, pinned: false }))
  assert.equal(selectCmsNotices([{ ...page, rows }]).length, 30)
})
