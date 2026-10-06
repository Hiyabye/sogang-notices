import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'parse5'
import { sources } from '../sources.mjs'
import { collectSource } from '../collect.mjs'
import { parseCmsPage } from '../cms.mjs'
import { parseCommunityPage } from '../community.mjs'
import { parseMechanicalPage } from '../mechanical.mjs'
import { parseSemiconductorPage } from '../semiconductor.mjs'
import { descendants, text } from '../html.mjs'
import { selectNotices } from '../list.mjs'
import { SourceError } from '../feed.mjs'
import { engineeringFixture } from './html-fixture.mjs'

const response = html => new Response(html, { headers: { 'Content-Type': 'text/html' } })
const cms = { id: 'eng-general', site: 'eng', host: 'eng', board: 1624 }
function cmsFixture(page = 1, total = 3) {
  const rows = Array.from({ length: Math.max(0, Math.min(10, total - (page - 1) * 10)) }, (_, index) => {
    const id = total - (page - 1) * 10 - index
    return `<li><div><div>${id}</div><a class="title" href="/front/cmsboardview.do?siteId=eng&bbsConfigFK=1624&pkid=${id}"><!-- Notice ${id} -->Short</a><div class="info"><span></span><span>2026.09.01</span></div></div></li>`
  }).join('')
  return `<input name="siteId" value="eng"><input name="bbsConfigFK" value="1624"><div class="list_box"><ul>${rows}</ul></div><div class="board_paging"><span class="on">${page}</span><span class="total_cnt">/ ${Math.max(1, Math.ceil(total / 10))}</span></div>`
}

const cases = [
  { source: cms, fixture: cmsFixture, parser: parseCmsPage, parameter: 'currentPage', key: 'pkid' },
  ...[
    ['eng-newsletter', parseCmsPage, 'currentPage', 'pkid'],
    ['ee-general', parseCommunityPage, 'pNo', 'idx'],
    ['ee-news', parseCommunityPage, 'pNo', 'idx'],
    ['sse-notices', parseCommunityPage, 'pNo', 'idx'],
    ['sse-news', parseCommunityPage, 'pNo', 'idx'],
    ['me-general', parseMechanicalPage, 'page', null],
    ['se-notices', parseSemiconductorPage, 'page', 'no'],
  ].map(([id, parser, parameter, key]) => {
    const source = sources.find(source => source.id === id)
    return { source, fixture: (page, total) => engineeringFixture(source, page, total), parser, parameter, key }
  }),
]

for (const { source, fixture, parser, parameter, key } of cases) {
  test(`${source.id} rejects duplicate regular identities within a complete page`, () => {
    const html = fixture(1, 3)
    const duplicate = (key ? html.replace(`${key}=3`, `${key}=2`) : html.replace(`/board/${source.board}/3`, `/board/${source.board}/2`))
      .replace('Notice 3', 'Notice 2')
    assert.throws(() => parser(duplicate, source, 1), /Duplicate|Incomplete list page/)
  })
  test(`${source.id} rejects final-page regular overlaps rather than publishing an incomplete small board`, async () => {
    const total = (source.pageSize ?? 10) + 1
    const first = fixture(1, total)
    const second = fixture(2, total)
    const overlap = (key ? second.replace(`${key}=1`, `${key}=2`) : second.replace(`/board/${source.board}/1`, `/board/${source.board}/2`))
      .replace('Notice 1', 'Notice 2')
    // Each page is individually complete; only cross-page identity is corrupt.
    assert.equal(parser(overlap, source, 2).rows.length, 1)
    await assert.rejects(collectSource(source, async url => response(Number(new URL(url).searchParams.get(parameter)) === 1 ? first : overlap)), /Duplicate regular article/)
    const requested = []
    const feed = await collectSource(source, async url => {
      const page = Number(new URL(url).searchParams.get(parameter))
      requested.push(page)
      return response(page === 1 ? first : second)
    })
    assert.deepEqual(requested, [1, 2])
    assert.deepEqual(feed.notices.map(row => row.title), Array.from({ length: total }, (_, index) => `Notice ${total - index}`))
  })
}

test('ordinary CMS rejects duplicate regular identities even when ordinals and count are complete', () => {
  const duplicate = cmsFixture().replace('pkid=2', 'pkid=3').replace('<!-- Notice 2 -->', '<!-- Notice 3 -->')
  assert.throws(() => parseCmsPage(duplicate, cms, 1), /Duplicate regular CMS article/)
})

for (const { source, fixture, parser, parameter } of cases.filter(({ source }) => ['community', 'mechanical', 'semiconductor'].includes(source.kind))) {
  test(`${source.id} requires selected pagination text and URL to agree`, () => {
    const total = (source.pageSize ?? 10) * 2 + 1
    const html = fixture(1, total)
    const selected = html.match(/<a class="(?:on|bg-sg-ink)" href="([^"]+)">1<\/a>/)
    assert.ok(selected)
    const wrong = selected[1].replace(`${parameter}=1`, `${parameter}=2`)
    assert.notEqual(wrong, selected[1])
    assert.throws(() => parser(html.replace(selected[0], selected[0].replace(selected[1], wrong)), source, 1), /Wrong selected page URL/)
    assert.equal(parser(html, source, 1).currentPage, 1)
  })
}

test('shared selection preserves repeated pins and counts a regular occurrence independently of a prior pin', () => {
  const row = id => ({ id, ordinal: id, pinned: false, title: `Notice ${id}`, url: `https://example.org/${id}`, publishedDate: '2026-09-01' })
  const pin = { ...row(100), pinned: true, ordinal: null }
  const pages = [
    { currentPage: 1, pages: 3, total: 31, rows: [pin, ...Array.from({ length: 15 }, (_, index) => row(30 - index))] },
    { currentPage: 2, pages: 3, total: 31, rows: [pin, { ...row(100) }, ...Array.from({ length: 14 }, (_, index) => row(15 - index))] },
  ]
  const notices = selectNotices(pages)
  assert.equal(notices.length, 30)
  assert.deepEqual(notices.map(notice => notice.title), ['Notice 100', ...Array.from({ length: 29 }, (_, index) => `Notice ${30 - index}`)])
  assert.throws(() => selectNotices([{ ...pages[0], pages: 1, rows: [row(1), row(1)] }]), /Duplicate regular article/)
})

test('semiconductor collection keeps repeated pins across pages while rejecting repeated regular records', async () => {
  const source = sources.find(source => source.id === 'se-notices')
  const pin = '<li><a href="/board/board_view.php?board_id=notice&no=100&page=1"><p class="num">공지</p><p class="txt">Notice 100</p><p class="date">2026-09-01</p></a></li>'
  const feed = await collectSource(source, async url => {
    const page = Number(new URL(url).searchParams.get('page'))
    return response(engineeringFixture(source, page, 11).replace('<ul class="notice_list">', `<ul class="notice_list">${pin}`))
  })
  assert.deepEqual(feed.notices.map(row => row.title), ['Notice 100', ...Array.from({ length: 11 }, (_, index) => `Notice ${11 - index}`)])
})

test('DOM traversal preserves document order and text semantics without recursion', () => {
  const doc = parse('<div>A<!-- ignored --><span>B<b>C</b>D</span>E</div><p>F</p>')
  assert.deepEqual(descendants(doc, node => ['div', 'span', 'b', 'p'].includes(node.tagName)).map(node => node.tagName), ['div', 'span', 'b', 'p'])
  assert.equal(text(doc), 'ABCDEF')
  assert.equal(text(undefined), '')
  const deep = parse('<div>'.repeat(10000) + 'inside' + '</div>'.repeat(10000))
  assert.equal(descendants(deep, node => node.tagName === 'div').length, 10000)
  assert.equal(text(deep), 'inside')
})

for (const { source, fixture } of cases) {
  test(`${source.id} handles deeply nested source markup below the body limit through collection`, async () => {
    const html = '<div>'.repeat(10000) + 'outside' + '</div>'.repeat(10000) + fixture(1, 3)
    assert.ok(Buffer.byteLength(html) < 2 * 1024 * 1024)
    const feed = await collectSource(source, async () => response(html))
    assert.deepEqual(feed.notices.map(row => row.title), ['Notice 3', 'Notice 2', 'Notice 1'])
    const nestedTitle = '<span>'.repeat(10000) + 'Notice 3' + '</span>'.repeat(10000)
    const nested = fixture(1, 3).replace(source === cms ? 'Short' : 'Notice 3', nestedTitle)
    if (source.kind === 'mechanical' || source.kind === 'community' && !source.gallery) {
      // These templates deliberately exclude spans from direct title text.
      await assert.rejects(collectSource(source, async () => response(nested)), error => error instanceof SourceError && error.message === 'Invalid list title or date.')
    } else {
      const result = await collectSource(source, async () => response(nested))
      assert.deepEqual(result.notices.map(row => row.title), ['Notice 3', 'Notice 2', 'Notice 1'])
    }
  })
}
