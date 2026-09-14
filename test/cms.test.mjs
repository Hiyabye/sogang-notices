import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { parseCmsPage } from '../cms.mjs'
import { selectNotices } from '../list.mjs'
import { sources } from '../sources.mjs'
import { collectSource } from '../collect.mjs'

const source = sources.find(source => source.id === 'aibased-news')
const html = await readFile(new URL('./fixtures/cms-list.html', import.meta.url), 'utf8')
const empty = await readFile(new URL('./fixtures/cms-empty.html', import.meta.url), 'utf8')

test('CMS accepts the observed explicit empty structure without pagination, never a missing list', () => {
  assert.deepEqual(selectNotices([parseCmsPage(empty, source, 1)]), [])
  assert.throws(() => parseCmsPage(empty.replace('검색된 게시물이 없습니다.', ''), source, 1))
  assert.throws(() => parseCmsPage(empty, source, 2))
  assert.throws(() => parseCmsPage(empty.replace('name="searchValue" value=""', 'name="searchValue" value="unexpected filter"'), source, 1))
})

test('CMS list preserves full comment titles, pins, dates, and board-scoped identities', () => {
  const page = parseCmsPage(html, source, 1)
  assert.equal(page.pages, 1)
  assert.equal(page.rows.length, 7)
  assert.equal(page.rows.filter(row => row.pinned).length, 4)
  const notices = selectNotices([page])
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

for (const [id, count, regular, pages] of [
  ['computing-notices', 19, 91, 7], ['computing-news', 15, 18, 2],
]) {
  test(`${id} accepts its observed 15-row page, full titles and strict board identity`, async () => {
    const source = sources.find(source => source.id === id)
    const html = await readFile(new URL(`./fixtures/${id}.html`, import.meta.url), 'utf8')
    const page = parseCmsPage(html, source, 1)
    assert.equal(page.rows.length, count)
    assert.equal(page.total, regular)
    assert.equal(page.pages, pages)
    if (id === 'computing-notices') {
      assert.equal(page.rows[0].title, '[공지] 2026년 상반기 - 제26회 TOPCIT 정기평가 접수 안내 (~9/7)')
      assert.equal(page.rows[0].pinned, true)
    } else {
      assert.equal(page.rows[3].title, '최우수국제학술대회 European Conference on Computer Vision (ECCV) 2026 정규 발표 논문 채택')
      assert.equal(page.rows[10].title, '[홍보] Sogang University & Vietnamese Universities Collaborative Workshop')
    }
    for (const row of page.rows) {
      const url = new URL(row.url)
      assert.equal(url.origin, 'https://computing.sogang.ac.kr')
      assert.equal(url.search, `?bbsConfigFK=${source.board}&siteId=computing&pkid=${row.id}`)
    }
    assert.throws(() => parseCmsPage(html, { ...source, pageSize: 10 }, 1), /Incomplete CMS list/)
    assert.throws(() => parseCmsPage(html.replaceAll(`value="${source.board}"`, 'value="1"'), source, 1), /identity/)
    assert.throws(() => parseCmsPage(html.replace(/<!--[^]*?-->/g, ''), source, 1), /full CMS title/)
  })
}

test('15-row CMS collection requests only two pages and rejects a truncated or inconsistent second page', async () => {
  const source = sources.find(source => source.id === 'computing-notices')
  const pageHtml = page => `<input name="siteId" value="computing"><input name="bbsConfigFK" value="7332">
    <div class="list_box"><ul>${Array.from({ length: 15 }, (_, index) => {
      const ordinal = 45 - (page - 1) * 15 - index
      return `<li><div><div>${ordinal}</div><a class="title" href="/front/cmsboardview.do?siteId=computing&bbsConfigFK=7332&pkid=${ordinal}"><!-- Notice ${ordinal} -->Short</a><div class="info"><span></span><span>2026.09.01</span></div></div></li>`
    }).join('')}</ul></div><div class="board_paging"><span class="on">${page}</span><span class="total_cnt">/ 3</span></div>`
  const requested = []
  const feed = await collectSource(source, async (url, options) => {
    const page = Number(new URL(url).searchParams.get('currentPage'))
    requested.push(page)
    assert.equal(options.redirect, 'error')
    return new Response(pageHtml(page), { headers: { 'Content-Type': 'text/html' } })
  })
  assert.deepEqual(requested, [1, 2])
  assert.deepEqual(feed.notices.map(notice => notice.title), Array.from({ length: 30 }, (_, index) => `Notice ${45 - index}`))
  for (const html of [pageHtml(2).replace(/<li>[^]*?<\/li>/, ''), pageHtml(2).replace('/ 3', '/ 4')]) {
    await assert.rejects(collectSource(source, async url => new Response(
      new URL(url).searchParams.get('currentPage') === '1' ? pageHtml(1) : html,
      { headers: { 'Content-Type': 'text/html' } },
    )), /Incomplete|inconsistent|pagination/)
  }
})

test('CMS selection rejects incomplete sampling and conflicts, mixes pins, and limits to 30', () => {
  const page = parseCmsPage(html, source, 1)
  assert.throws(() => selectNotices([{ ...page, pages: 2 }]))
  assert.throws(() => selectNotices([{ ...page, rows: [...page.rows, { ...page.rows[0], title: 'Conflict' }] }]))
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...page.rows[0], id: 100 - i, url: `https://example.com/${i}`, pinned: false }))
  assert.equal(selectNotices([{ ...page, rows }]).length, 30)
})
