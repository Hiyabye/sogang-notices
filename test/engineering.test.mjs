import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { sources } from '../sources.mjs'
import { collectSource } from '../collect.mjs'
import { parseCmsPage } from '../cms.mjs'
import { parseCommunityPage } from '../community.mjs'
import { parseMechanicalPage } from '../mechanical.mjs'
import { parseSemiconductorPage } from '../semiconductor.mjs'
import { engineeringFixture } from './html-fixture.mjs'

const parser = source => source.kind === 'community' ? parseCommunityPage : source.kind === 'mechanical' ? parseMechanicalPage : source.kind === 'semiconductor' ? parseSemiconductorPage : parseCmsPage
const response = html => new Response(html, { headers: { 'Content-Type': 'text/html' } })
for (const [id, length, pages, firstTitle] of [
  ['ee-general', 10, 30, '관세감면 신청 절차 안내'],
  ['ee-news', 12, 15, '박성보 석박통합과정(지도교수 안길초), TCAS-I 2026 논문 Accept'],
  ['sse-notices', 10, 13, '시스템반도체공학과 선후수 과목표(2026학년도 1학기 기준)'],
  ['sse-news', 9, 7, '박성보 석박통합과정(지도교수 안길초), TCAS-I 2026 논문 Accept'],
  ['me-general', 15, 34, '대한기계학회 기계공학 소개 자료'],
  ['se-notices', 17, 2, '[교육] 2026학년도 2학기 연구실안전 정기교육 안내 (~12/21)'],
  ['eng-newsletter', 12, 4, '공과대학 뉴스레터 2026년 1호'],
  ['eng-careers', 16, 2, '[홍보] [현대모비스] 서강대 트랙 26년 하반기 선발 안내 (~9/29)'],
]) {
  test(`${id} parses the observed list skin without summaries, authors or images`, async () => {
    const source = sources.find(source => source.id === id)
    const html = await readFile(new URL(`./fixtures/${id}.html`, import.meta.url), 'utf8')
    const page = parser(source)(html, source, 1)
    assert.equal(page.rows.length, length)
    assert.equal(page.pages, pages)
    assert.equal(page.rows[0].title, firstTitle)
    for (const row of page.rows) {
      assert.deepEqual(Object.keys(row).sort(), ['id', 'ordinal', 'pinned', 'publishedDate', 'title', 'url'])
      assert.equal(new URL(row.url).hostname, `${source.host}.sogang.ac.kr`)
      assert.ok(row.title.length <= 2000)
    }
    assert.throws(() => parser(source)(html, source, 2), /page|pagination|ordinals|CMS/)
  })
}

for (const source of sources.filter(source => source.kind)) {
  test(`${source.id} keeps list identity, exact metadata, empty state and validation boundaries`, async () => {
    const html = engineeringFixture(source)
    const parse = value => parser(source)(value, source, 1)
    const feed = await collectSource(source, async () => response(html))
    assert.equal(feed.sourceId, source.id)
    assert.deepEqual(feed.notices.map(row => row.title), ['Notice 3', 'Notice 2', 'Notice 1'])
    assert.deepEqual(feed.notices.map(row => row.publishedDate), Array(3).fill('2026-09-01'))
    assert.deepEqual(parse(engineeringFixture(source, 1, 0)).rows, [])
    assert.equal(parse(html.replace('Notice 3', '&lt;b&gt;literal&lt;/b&gt;')).rows[0].title, '<b>literal</b>')
    assert.equal(parse(html.replace('Notice 3', '가'.repeat(2000))).rows[0].title.length, 2000)
    for (const invalid of [
      '<html>Unavailable</html>',
      html.replace(source.label, 'Wrong board'),
      html.replace('Notice 3', ''),
      html.replace('Notice 3', '가'.repeat(2001)),
      html.replaceAll('2026.09.01', '2026.02.30').replaceAll('2026-09-01', '2026-02-30'),
      html.replace('총 3건', '총 4건').replace('총 3건의', '총 4건의').replace('<strong>3</strong>', '<strong>4</strong>'),
      html.replace('총 3건', '총 0건').replace('<strong>3</strong>', '<strong>0</strong>'),
    ]) assert.throws(() => parse(invalid), undefined, source.id)
    const firstHref = html.match(/href="([^"]+)"/)[1]
    for (const origin of ['https://evil.example.org', `https://user:pass@${source.host}.sogang.ac.kr`])
      assert.throws(() => parse(html.replace(firstHref, origin + firstHref)), /identity|URL/)
    const url = new URL(feed.notices[0].url)
    assert.equal(url.origin, `https://${source.host}.sogang.ac.kr`)
    assert.equal(url.searchParams.has('page') || url.searchParams.has('pNo'), false)
    if (source.kind !== 'mechanical') {
      const key = source.kind === 'community' ? 'idx' : 'no'
      assert.throws(() => parse(html.replace(`${key}=3`, `${key}=3&${key}=4`)), /ID/)
    }
  })
}

test('community sampling covers pins before thirty regular rows and stops at six pages', async () => {
  const source = sources.find(source => source.id === 'ee-general')
  const requested = []
  await collectSource(source, async url => {
    const page = Number(new URL(url).searchParams.get('pNo'))
    requested.push(page)
    let html = engineeringFixture(source, page, 100)
    if (page <= 2) html = html.replace(/<td>\d+<\/td>/g, '<td>공지</td>')
    return response(html)
  })
  assert.deepEqual(requested, [1, 2, 3, 4, 5])
  let attempts = 0
  await assert.rejects(collectSource(source, async url => {
    attempts++
    const page = Number(new URL(url).searchParams.get('pNo'))
    return response(engineeringFixture(source, page, 100).replace(/<td>\d+<\/td>/g, '<td>공지</td>'))
  }), /Incomplete regular sample/)
  assert.equal(attempts, 6)
  await assert.rejects(collectSource(source, async url => {
    const page = Number(new URL(url).searchParams.get('pNo'))
    const html = engineeringFixture(source, page, 100)
    return response(page === 2 ? html.replace(/<td>\d+<\/td>/, '<td>공지</td>') : html)
  }), /pin ordering/)
})

test('semiconductor pins may retain page-one navigation without changing board or article identity', () => {
  const source = sources.find(source => source.id === 'se-notices')
  const first = engineeringFixture(source, 1, 19)
  const pin = first.match(/<li>[\s\S]*?<\/li>/)[0].replace('<p class="num">19</p>', '<p class="num">공지</p>')
  const second = engineeringFixture(source, 2, 19).replace('<ul class="notice_list">', `<ul class="notice_list">${pin}`)
  const page = parseSemiconductorPage(second, source, 2)
  assert.equal(page.rows.length, 10)
  assert.equal(page.rows[0].pinned, true)
  assert.equal(page.rows[0].url, 'https://se.sogang.ac.kr/board/board_view.php?board_id=notice&no=19')
  assert.throws(() => parseSemiconductorPage(second.replace('no=19', 'board_id=news&no=19'), source, 2), /identity/)
})

test('observed empty placeholders are not arbitrary error rows, and zero regular totals retain semiconductor pins', () => {
  const ee = sources.find(source => source.id === 'ee-general')
  const empty = engineeringFixture(ee, 1, 0)
  assert.throws(() => parseCommunityPage(empty.replace('등록된 데이터가 없습니다.', 'Source error'), ee, 1), /row/)
  const me = sources.find(source => source.id === 'me-general')
  assert.throws(() => parseMechanicalPage(engineeringFixture(me, 1, 0).replace('등록된 게시물이 없습니다.', ''), me, 1), /empty list/)
  const se = sources.find(source => source.id === 'se-notices')
  const pinned = engineeringFixture(se).replace('<strong>3</strong>', '<strong>0</strong>').replace(/<p class="num">\d+<\/p>/g, '<p class="num">공지</p>')
  const page = parseSemiconductorPage(pinned, se, 1)
  assert.equal(page.rows.length, 3)
  assert.ok(page.rows.every(row => row.pinned))
})

test('only the approved unescaped Korean job-title shape is retained literally, never arbitrary markup', () => {
  const source = sources.find(source => source.id === 'ee-employment')
  const html = engineeringFixture(source)
  const literal = '<HD현대삼호 온라인 채용설명회>'
  assert.equal(parseCommunityPage(html.replace('Notice 3', literal), source, 1).rows[0].title, literal)
  for (const invalid of ['<script>bad()</script>', '<img src=x onerror=bad()>', '<img 한국어>', '<div>임의 내용</div>', ''])
    assert.throws(() => parseCommunityPage(html.replace('Notice 3', invalid), source, 1), /title/)
})
