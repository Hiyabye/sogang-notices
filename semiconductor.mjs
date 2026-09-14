import { parse } from 'parse5'
import { SourceError } from './feed.mjs'
import { descendants, attr, hasClass, text, clean, elements, one, count, metadata, articleUrl, recordId, checkPaging, validateListPage } from './html.mjs'

export function parseSemiconductorPage(html, source, currentPage) {
  const doc = parse(html)
  const heading = one(descendants(doc, node => attr(node, 'id') === 'title'), 'board heading')
  if (clean(text(heading)) !== source.label) throw new SourceError('Wrong semiconductor board heading.')
  const identities = elements(doc, 'input').filter(node => attr(node, 'name') === 'board_id')
  if (!identities.length || identities.some(node => attr(node, 'value') !== source.board) ||
      elements(doc, 'input').some(node => attr(node, 'name') === 'searcher' && attr(node, 'value'))) throw new SourceError('Wrong semiconductor board identity.')
  const countBox = one(descendants(doc, node => hasClass(node, 'list_count')), 'list count')
  const total = count(clean(text(one(elements(countBox, 'strong'), 'total'))))
  const list = one(descendants(doc, node => hasClass(node, 'notice_list')), 'notice list')
  const rows = elements(list, 'li').filter(node => !(total === 0 && !elements(node, 'a').length && clean(text(node)) === '등록된 게시물이 없습니다.')).map(row => {
    const link = one(elements(row, 'a'), 'article link')
    const url = articleUrl(attr(link, 'href'), source, '/board/board_view.php', { board_id: source.board })
    const id = recordId(url, 'no')
    // Pins retain page=1 even on later list pages; navigation state is not identity.
    const number = clean(text(one(descendants(link, node => hasClass(node, 'num')), 'row number')))
    const pinned = number === '공지'
    const title = text(one(descendants(link, node => hasClass(node, 'txt')), 'list title'))
    const date = text(one(descendants(link, node => hasClass(node, 'date')), 'list date'))
    url.search = new URLSearchParams({ board_id: source.board, no: String(id) })
    return { id, url: url.href, pinned, ordinal: pinned ? null : count(number), ...metadata(title, date) }
  })
  const page = validateListPage(rows, total, source, currentPage, true)
  if (total === 0) return page
  const paging = one(descendants(doc, node => hasClass(node, 'paging')), 'pagination')
  checkPaging(elements(paging, 'a'), currentPage, page.pages, source, '/board/board_list.php', 'page')
  return page
}
