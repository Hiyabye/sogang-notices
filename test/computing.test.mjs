import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { sources, boardUrl } from '../sources.mjs'
import { parseComputingPage } from '../computing.mjs'
import { collectSource } from '../collect.mjs'
import { engineeringFixture } from './html-fixture.mjs'
import { SourceError } from '../feed.mjs'

const computing = sources.filter(source => source.kind === 'computing')
test('Computing catalog is exactly the five approved SSR boards, with 27 unchanged sources', () => {
  assert.equal(sources.length, 32)
  assert.deepEqual(computing.map(source => [source.id, source.board, source.label]), [
    ['computing-academic', 'academicNotice', '학사 공지'],
    ['computing-graduate', 'graduateNotice', '대학원 공지'],
    ['computing-external', 'externalInfo', '대외정보'],
    ['computing-updates', 'news', '소식'],
    ['computing-career', 'career', '취업·인턴십'],
  ])
  for (const source of computing) assert.equal(boardUrl(source, 2), `https://computing.sogang.ac.kr/ko/community/${source.board}/list?num=2`)
  assert.ok(sources.every(source => !['cs', 'ai', 'aibased'].includes(source.site)))
})

for (const [index, source] of computing.entries()) {
  test(`${source.id} parses observed rendered rows, excludes private fields, and canonicalizes navigation`, async () => {
    const html = await readFile(new URL(`./fixtures/${source.id}.html`, import.meta.url), 'utf8')
    const page = parseComputingPage(html, source, 1)
    assert.equal(page.total, [913, 124, 1935, 265, 3408][index])
    assert.equal(page.rows.filter(row => row.pinned).length, [22, 2, 2, 4, 3][index])
    assert.equal(page.rows.filter(row => !row.pinned).length, 10)
    assert.equal(page.rows.find(row => !row.pinned).ordinal, page.total)
    for (const row of page.rows) {
      assert.equal(row.url, `https://computing.sogang.ac.kr/ko/community/${source.board}/detail/${row.id}`)
      assert.deepEqual(Object.keys(row).sort(), ['id', 'ordinal', 'pinned', 'publishedDate', 'title', 'url'])
    }
    // Mobile mirrors and hydration must never contribute a second list.
    const mirrored = html.replace('</section>', '<ul class="board-list-mobile"><li>Ignored mobile copy</li></ul><script>throw new Error("never execute")</script></section>')
    assert.deepEqual(parseComputingPage(mirrored, source, 1), page)
  })
  test(`${source.id} samples 30 distinct regular notices through GET num pages only`, async () => {
    const requested = []
    const feed = await collectSource(source, async (url, options) => {
      const number = Number(new URL(url).searchParams.get('num'))
      requested.push(number)
      assert.equal(url, boardUrl(source, number))
      assert.equal(options.redirect, 'error')
      assert.equal(options.credentials, 'omit')
      assert.equal(options.referrerPolicy, 'no-referrer')
      assert.equal(options.method, undefined)
      return new Response(engineeringFixture(source, number, 45), { headers: { 'Content-Type': 'text/html' } })
    })
    assert.deepEqual(requested, [1, 2, 3])
    assert.deepEqual(feed.notices.map(notice => notice.title), Array.from({ length: 30 }, (_, index) => `Notice ${45 - index}`))
  })
  test(`${source.id} supports explicit empty/sparse/final pages and rejects malformed source structures`, () => {
    const html = engineeringFixture(source)
    assert.equal(parseComputingPage(html, source, 1).rows.length, 3)
    assert.equal(parseComputingPage(engineeringFixture(source, 2, 13), source, 2).rows.length, 3)
    assert.equal(parseComputingPage(engineeringFixture(source, 11, 105), source, 11).rows.length, 5)
    assert.equal(parseComputingPage(engineeringFixture(source, 1, 0), source, 1).rows.length, 0)
    for (const bad of [
      html.replace(`<h2>${source.label}</h2>`, '<h2>Different board</h2>'),
      html.replace(`href="${source.path}"`, 'href="/ko/community/interview/list"'),
      html.replace('value=""', 'value="filtered"'),
      html.replace('2026-09-01', '2026-02-30'),
      html.replace('Notice 3', ''),
      html.replace('/detail/3', '/detail/0'),
      html.replace('/detail/3', '/detail/9007199254740992'),
      html.replace('/ko/community/', 'https://evil.example.org/ko/community/'),
      html.replace('Notice 3', '가'.repeat(2001)),
      html.replace('/detail/3', '/detail/2'),
      html.replace('?num=1', '?num=2'),
      html.replace('?num=1', '?num=1&num=1'),
      html.replace('?num=1', '?clsfCd=CS'),
      html.replace('<strong>3</strong>', '<strong>4</strong>'),
      html.replace('<td class="board-list-number">3</td>', '<td class="board-list-number">2</td>'),
      html.replace('class="is-active" aria-current="page">1', 'class="is-active" aria-current="page">2'),
      html.replace('aria-label="다음 페이지" disabled', 'aria-label="다음 페이지"'),
      html.replace('class="board-list"', 'class="unexpected-list"'),
      '<html>Unavailable</html>',
    ]) assert.throws(() => parseComputingPage(bad, source, 1), SourceError)
    assert.throws(() => parseComputingPage(html, source, 2), SourceError)
    assert.throws(() => parseComputingPage(engineeringFixture(source, 1, 0).replace('등록된 게시물이 없습니다', 'Server error'), source, 1), SourceError)
  })
}

test('Computing traversal is stack-safe and pinned-only lists still require explicit empty regular state', () => {
  const source = computing[3]
  const fixture = engineeringFixture(source)
  const nested = '<div>'.repeat(10000) + 'irrelevant' + '</div>'.repeat(10000)
  assert.deepEqual(parseComputingPage(fixture.replace('</section>', nested + '</section>'), source, 1), parseComputingPage(fixture, source, 1))
  const pinnedOnly = engineeringFixture(source, 1, 0).replace('<strong>0</strong>', '<strong>1</strong>').replace('<tbody>', '<tbody><tr><td class="board-list-number"><span class="board-list-notice">공지</span></td><td class="board-list-title"><a href="/ko/community/news/detail/100">Pinned</a></td><td class="board-list-date">2026-09-02</td></tr>')
  const page = parseComputingPage(pinnedOnly, source, 1)
  assert.equal(page.total, 0)
  assert.equal(page.rows[0].pinned, true)
})

test('academic category filtering fails closed rather than fabricating department feeds', () => {
  const source = computing[0]
  assert.throws(() => parseComputingPage(engineeringFixture(source).replace('aria-pressed="true">전체', 'aria-pressed="true">컴퓨터공학과'), source, 1), /category filter/)
})

test('Computing collection retains repeated pins independently of the regular sample and rejects cross-page overlap', async () => {
  const source = computing[3]
  const fixture = page => engineeringFixture(source, page, 43).replace('<strong>43</strong>', '<strong>44</strong>').replace('<tbody>', `<tbody><tr><td class="board-list-number"><span class="board-list-notice">공지</span></td><td class="board-list-title"><a href="/ko/community/news/detail/100?num=${page}">Pinned</a></td><td class="board-list-date">2026-09-02</td></tr>`)
  const feed = await collectSource(source, async url => new Response(fixture(Number(new URL(url).searchParams.get('num'))), { headers: { 'Content-Type': 'text/html' } }))
  assert.equal(feed.notices.length, 30)
  assert.equal(feed.notices[0].title, 'Pinned')
  assert.equal(feed.notices.filter(row => row.title === 'Pinned').length, 1)
  await assert.rejects(collectSource(source, async url => {
    const page = Number(new URL(url).searchParams.get('num'))
    return new Response(fixture(page).replace(page === 2 ? '/detail/33?' : 'not-present', '/detail/43?'), { headers: { 'Content-Type': 'text/html' } })
  }), /Conflicting|Duplicate/)
})
