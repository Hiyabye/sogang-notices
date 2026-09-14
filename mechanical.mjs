import { parse } from 'parse5'
import { SourceError } from './feed.mjs'
import { attr, text, clean, elements, one, count, metadata, articleUrl, checkPaging, validateListPage } from './html.mjs'

// Read only the server-rendered table, not Next.js scripts or serialized article bodies.
export function parseMechanicalPage(html, source, currentPage) {
  const doc = parse(html)
  const main = one(elements(doc, 'main'), 'mechanical main')
  const path = `/ko/board/${source.board}`
  if (clean(text(one(elements(main, 'h1'), 'board heading'))) !== source.label) throw new SourceError('Wrong mechanical board.')
  const form = one(elements(main, 'form'), 'search form')
  if (attr(form, 'action') !== path || elements(form, 'input').some(node => attr(node, 'value'))) throw new SourceError('Wrong mechanical search state.')
  const totalNode = one(elements(main, 'p').filter(node => /^총 \d+건$/.test(clean(text(node)))), 'list count')
  const total = count(clean(text(totalNode)).slice(2, -1))
  if (total === 0) {
    one(elements(main, 'p').filter(node => clean(text(node)) === '등록된 게시물이 없습니다.'), 'empty list message')
    if (elements(main, 'table').length) throw new SourceError('Unexpected rows in empty list.')
    return validateListPage([], total, source, currentPage)
  }
  const body = one(elements(one(elements(main, 'table'), 'notice table'), 'tbody'), 'table body')
  const rows = elements(body, 'tr').map(row => {
    const cells = elements(row, 'td')
    if (cells.length !== 5) throw new SourceError('Invalid mechanical row.')
    const link = one(elements(cells[1], 'a'), 'article link')
    const href = attr(link, 'href') ?? ''
    const match = href.match(new RegExp(`^${path}/([1-9]\\d*)$`))
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new SourceError('Wrong mechanical article identity.')
    const url = articleUrl(href, source, `${path}/${match[1]}`, {})
    const pinned = clean(text(cells[0])) === '공지'
    const title = link.childNodes.filter(node => node.nodeName === '#text').map(text).join('')
    return { id: Number(match[1]), url: url.href, pinned, ordinal: pinned ? null : count(clean(text(cells[0]))), ...metadata(title, text(cells[3])) }
  })
  const page = validateListPage(rows, total, source, currentPage)
  const paging = elements(main, 'a').filter(node => (attr(node, 'href') ?? '').startsWith(`${path}?page=`))
  if (page.pages > 1) checkPaging(paging, currentPage, page.pages, source, path, 'page', 'bg-sg-ink')
  else if (paging.length) throw new SourceError('Unexpected single-page pagination.')
  return page
}
