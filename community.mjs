import { parse } from 'parse5'
import { SourceError } from './feed.mjs'
import { descendants, attr, hasClass, text, clean, elements, one, count, metadata, articleUrl, recordId, checkPaging, validateListPage } from './html.mjs'

// EE and SSE use the same paginated PHP board family, with explicit table/gallery skins.
export function parseCommunityPage(html, source, currentPage) {
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const sse = source.host === 'sse'
  const headings = sse ? descendants(doc, node => hasClass(node, 'ttl01')) : elements(doc, 'h3')
  if (!headings.some(node => clean(text(node)) === source.label)) throw new SourceError('Wrong community board heading.')
  const top = one(descendants(doc, node => hasClass(node, 'list_top')), 'list header')
  const totalText = clean(text(top)).match(/^총 (\d+)건의 게시물/)
  if (!totalText) throw new SourceError('Missing list total.')
  const total = count(totalText[1])
  if (elements(top, 'input').some(node => ['sorder', 's_txt'].includes(attr(node, 'name')) && attr(node, 'value'))) throw new SourceError('Unexpected list search filter.')
  const list = source.gallery
    ? one(descendants(doc, node => hasClass(node, sse ? 'list_st01' : 'gallery_list')), 'gallery list')
    : one(sse ? elements(one(descendants(doc, node => hasClass(node, 'list_st02')), 'table wrapper'), 'table')
      : descendants(doc, node => node.tagName === 'table' && hasClass(node, 'basic_list')), 'notice table')
  const items = source.gallery ? elements(list, 'a') : elements(one(elements(list, 'tbody'), 'table body'), 'tr')
  const rows = items.filter(node => {
    const cells = source.gallery ? [] : elements(node, 'td')
    return !(total === 0 && cells.length === 1 && hasClass(cells[0], 'no_list') && clean(text(cells[0])) === '등록된 데이터가 없습니다.')
  }).map(item => {
    const cells = source.gallery ? [] : elements(item, 'td')
    if (!source.gallery && cells.length !== 4) throw new SourceError('Invalid community row.')
    const link = source.gallery ? item : one(elements(cells[1], 'a'), 'article link')
    const query = { m: 'v', ...(source.code ? { code: source.code } : {}) }
    const url = articleUrl(attr(link, 'href'), source, source.path, query)
    const id = recordId(url, 'idx')
    if (url.searchParams.get('pNo') !== String(currentPage)) throw new SourceError('Wrong article page.')
    let title = source.gallery
      ? text(one(descendants(link, node => hasClass(node, sse ? 'subject' : 'tit')), 'gallery title'))
      : link.childNodes.filter(node => node.nodeName === '#text').map(text).join('')
    if (!clean(title) && source.id === 'ee-employment') {
      // The source emitted a Korean job-post title as one unescaped opening tag.
      // Preserve only this narrow literal shape, never arbitrary markup or scripts.
      const location = link.sourceCodeLocation
      const literal = location?.endTag ? html.slice(location.startTag.endOffset, location.endTag.startOffset).trim() : ''
      const match = literal.match(/^<([A-Za-z][\p{L}\p{N}-]*)(?: [\p{L}\p{N} ·()-]+)?>$/u)
      if (match && /\p{Script=Hangul}/u.test(match[1])) title = literal
    }
    const date = source.gallery ? text(one(descendants(link, node => hasClass(node, 'date')), 'gallery date')) : text(cells[2])
    const pinned = !source.gallery && clean(text(cells[0])) === '공지'
    const ordinal = source.gallery || pinned ? null : count(clean(text(cells[0])))
    url.search = new URLSearchParams({ m: 'v', idx: String(id), ...(source.code ? { code: source.code } : {}) })
    return { id, pinned, ordinal, url: url.href, ...metadata(title, date) }
  })
  const page = validateListPage(rows, total, source, currentPage)
  if (total === 0) return page
  const paging = one(descendants(doc, node => hasClass(node, sse ? 'page_bx' : 'b_page_no')), 'pagination')
  checkPaging(elements(paging, 'a'), currentPage, page.pages, source, source.path, 'pNo')
  return page
}
