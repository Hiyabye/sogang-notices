import { parse } from 'parse5'
import { SourceError } from './feed.mjs'
import { attr, clean, count, descendants, elements, hasClass, metadata, one, text, validateListPage } from './html.mjs'

const byClass = (node, name) => descendants(node, child => hasClass(child, name))

// Read only the rendered Korean list. Nuxt hydration and browser API calls are
// deliberately outside this collector's data boundary.
export function parseComputingPage(html, source, currentPage) {
  const document = parse(html)
  const content = one(byClass(document, 'board-content'), 'Computing content')
  const heading = one(byClass(content, 'board-content-header'), 'Computing header')
  if (clean(text(one(elements(heading, 'h2'), 'Computing heading'))) !== source.label) throw new SourceError('Wrong Computing board.')
  const menu = one(byClass(document, 'board-lnb'), 'Computing menu')
  const active = one(elements(menu, 'a').filter(node => attr(node, 'aria-current') === 'page'), 'Computing selected board')
  if (attr(active, 'href') !== source.path) throw new SourceError('Wrong Computing board identity.')
  const search = one(elements(content, 'input').filter(node => attr(node, 'id') === 'board-search-keyword'), 'Computing search')
  if (attr(search, 'value')) throw new SourceError('Unexpected Computing search filter.')
  const categories = byClass(heading, 'board-category')
  if (source.board === 'academicNotice') {
    const selected = one(elements(one(categories, 'Computing categories'), 'button').filter(node => attr(node, 'aria-pressed') === 'true'), 'Computing category')
    if (clean(text(selected)) !== '전체') throw new SourceError('Unexpected Computing category filter.')
  } else if (categories.length) throw new SourceError('Unexpected Computing categories.')
  const toolbar = one(byClass(content, 'board-toolbar'), 'Computing toolbar')
  const declaredTotal = count(clean(text(one(elements(toolbar, 'strong'), 'Computing total'))))
  const list = one(byClass(content, 'board-list'), 'Computing list')
  const table = one(elements(list, 'table'), 'Computing table')
  const body = one(elements(table, 'tbody'), 'Computing rows')
  const rows = elements(body, 'tr').map(row => {
    const number = one(byClass(row, 'board-list-number'), 'Computing ordinal')
    const pinned = byClass(number, 'board-list-notice').length === 1
    if (pinned && clean(text(number)) !== '공지') throw new SourceError('Invalid Computing pin.')
    const ordinal = pinned ? null : count(clean(text(number)))
    const anchor = one(elements(one(byClass(row, 'board-list-title'), 'Computing title'), 'a'), 'Computing title link')
    let url
    try { url = new URL(attr(anchor, 'href'), `https://${source.host}.sogang.ac.kr`) } catch { throw new SourceError('Invalid Computing article URL.') }
    const prefix = `/ko/community/${source.board}/detail/`
    const id = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
    if (url.origin !== `https://${source.host}.sogang.ac.kr` || url.username || url.password || url.hash || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new SourceError('Wrong Computing article identity.')
    if ([...url.searchParams.keys()].some(key => key !== 'num') || (url.search && (url.searchParams.getAll('num').length !== 1 || url.searchParams.get('num') !== String(currentPage)))) throw new SourceError('Invalid Computing article navigation.')
    url.search = ''
    return { id: Number(id), pinned, ordinal, url: url.href,
      ...metadata(text(anchor), text(one(byClass(row, 'board-list-date'), 'Computing date'))) }
  })
  // The toolbar includes pins; the ten numbered regular rows exclude them.
  // The same pins repeat on every page, without consuming regular page slots.
  const total = declaredTotal - rows.filter(row => row.pinned).length
  if (total < 0) throw new SourceError('Invalid Computing total.')
  if (!total && clean(text(one(byClass(content, 'cont-empty-title'), 'Computing empty message'))) !== '등록된 게시물이 없습니다') throw new SourceError('Invalid Computing empty list.')
  const page = validateListPage(rows, total, source, currentPage, true)
  const pager = one(byClass(content, 'board-pagination'), 'Computing pagination')
  const buttons = elements(pager, 'button')
  const selected = one(buttons.filter(node => attr(node, 'aria-current') === 'page' && hasClass(node, 'is-active')), 'Computing current page')
  if (clean(text(selected)) !== String(currentPage)) throw new SourceError('Wrong Computing current page.')
  const numbers = buttons.filter(node => !hasClass(node, 'board-pagination-arrow')).map(node => count(clean(text(node))))
  const start = Math.floor((currentPage - 1) / 10) * 10 + 1
  const expected = Array.from({ length: Math.min(10, page.pages - start + 1) }, (_, index) => start + index)
  if (numbers.length !== expected.length || numbers.some((number, index) => number !== expected[index])) throw new SourceError('Incomplete Computing pagination.')
  for (const [label, disabled] of [['첫 페이지', currentPage === 1], ['이전 페이지', currentPage === 1], ['다음 페이지', currentPage === page.pages], ['마지막 페이지', currentPage === page.pages]]) {
    const button = one(buttons.filter(node => attr(node, 'aria-label') === label), 'Computing page arrow')
    if ((attr(button, 'disabled') !== undefined) !== disabled) throw new SourceError('Inconsistent Computing page arrow.')
  }
  return page
}
