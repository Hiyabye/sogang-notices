import { parse, parseFragment } from 'parse5'
import { boardUrl } from './sources.mjs'
import { SourceError } from './feed.mjs'

import { descendants, attr, hasClass, text, clean, one } from './html.mjs'

export function parseCmsPage(html, source, currentPage) {
  const pageSize = source.pageSize ?? 10
  const doc = parse(html)
  const inputs = descendants(doc, node => node.tagName === 'input')
  for (const [key, expected] of [['bbsConfigFK', String(source.board)], ['siteId', source.site]]) {
    const values = inputs.filter(node => attr(node, 'name') === key).map(node => attr(node, 'value'))
    if (!values.length || values.some(value => value !== expected)) throw new SourceError('Wrong CMS board identity.')
  }
  if (inputs.some(node => attr(node, 'name') === 'searchValue' && attr(node, 'value'))) throw new SourceError('Unexpected CMS search filter.')
  const gallery = source.gallery === true
  const lists = descendants(doc, node => hasClass(node, gallery ? 'board_photo_list' : 'list_box') && !hasClass(node, 'for_mobile'))
  if (lists.length !== 1) throw new SourceError('Missing CMS list.')
  const entries = descendants(lists[0], node => node.tagName === 'li')
  const paging = descendants(doc, node => hasClass(node, 'board_paging'))[0]
  if (currentPage === 1 && !paging && entries.length === 1 && hasClass(entries[0], 'nothing') &&
      clean(text(entries[0])) === '검색된 게시물이 없습니다.' && !descendants(entries[0], node => node.tagName === 'a').length) {
    return { currentPage, pages: 1, total: 0, rows: [] }
  }
  const total = paging && descendants(paging, node => hasClass(node, 'total_cnt'))[0]
  const selected = paging && descendants(paging, node => hasClass(node, 'on'))[0]
  if (!total || !/^\/\s*\d+$/.test(clean(text(total))) || !selected || Number(clean(text(selected))) !== currentPage) {
    throw new SourceError('Invalid CMS pagination.')
  }
  const pages = Number(clean(text(total)).slice(1).trim())
  if (!Number.isSafeInteger(pages) || pages < currentPage || pages > 100000) throw new SourceError('Invalid CMS page count.')
  const rows = entries.map(entry => {
    const links = descendants(entry, node => node.tagName === 'a' && (gallery || hasClass(node, 'title')))
    if (links.length !== 1) throw new SourceError('Invalid CMS entry.')
    const link = links[0]
    let url
    try { url = new URL(attr(link, 'href'), boardUrl(source)) } catch { throw new SourceError('Invalid CMS article URL.') }
    const id = url.searchParams.get('pkid')
    if (url.origin !== new URL(boardUrl(source)).origin || url.username || url.password || url.pathname !== '/front/cmsboardview.do' ||
        ['bbsConfigFK', 'siteId', 'pkid'].some(key => url.searchParams.getAll(key).length !== 1) ||
        url.searchParams.get('bbsConfigFK') !== String(source.board) || url.searchParams.get('siteId') !== source.site ||
        !/^[1-9]\d*$/.test(id ?? '') || !Number.isSafeInteger(Number(id))) throw new SourceError('Invalid CMS article identity.')
    const comments = descendants(link, node => node.nodeName === '#comment')
    const pinned = descendants(link, node => node.tagName === 'strong').some(node => clean(text(node)) === '[공지]')
    const directTitle = pinned && ['ai-news', 'ai-careers', 'computing-notices', 'eng-careers', 'bellarmine'].includes(source.id)
    if (!gallery && comments.length !== (directTitle ? 0 : 1)) throw new SourceError('Missing full CMS title.')
    // Comments contain the untruncated title with HTML entities. RCDATA decodes
    // those entities without interpreting title text as markup or executing it.
    const title = gallery ? clean(text(one(descendants(link, node => hasClass(node, 'title')), 'gallery title'))) : directTitle
      ? clean(link.childNodes.filter(node => node.tagName !== 'strong').map(text).join(''))
      : clean(text(parseFragment(`<textarea>${comments[0].data.replaceAll('<', '&lt;')}</textarea>`)))
    const info = descendants(entry, node => hasClass(node, 'info'))[0]
    const spans = info && descendants(info, node => node.tagName === 'span')
    const date = gallery ? clean(text(one(descendants(link, node => hasClass(node, 'date')), 'gallery date'))).split(' | ')[0].replaceAll('.', '-')
      : spans?.[1] && clean(text(spans[1])).replaceAll('.', '-')
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (!title || title.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
        !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new SourceError('Invalid CMS title or date.')
    // Keep board and site scope. Cross-host aliases and global pkid scope are not assumed.
    url.search = new URLSearchParams({ bbsConfigFK: String(source.board), siteId: source.site, pkid: id })
    const wrapper = entry.childNodes.find(node => node.tagName === 'div')
    const number = wrapper?.childNodes.find(node => node.tagName === 'div')
    const ordinal = pinned || gallery ? null : number && Number(clean(text(number)))
    if (!pinned && !gallery && (!Number.isSafeInteger(ordinal) || ordinal <= 0)) throw new SourceError('Invalid CMS row number.')
    return { id: Number(id), pinned, ordinal, title, url: url.href, publishedDate: date }
  })
  if (gallery && new Set(rows.map(row => row.url)).size !== rows.length) throw new SourceError('Duplicate gallery article.')
  const regular = rows.filter(row => !row.pinned)
  if (rows.length === 0 || rows.length > 500 || regular.length > pageSize || (currentPage < pages && regular.length !== pageSize)) {
    throw new SourceError('Incomplete CMS list.')
  }
  const totalRegular = gallery ? null : regular.length ? regular[0].ordinal + (currentPage - 1) * pageSize : 0
  if (!gallery && ((totalRegular && Math.ceil(totalRegular / pageSize) !== pages) || regular.length !== Math.min(pageSize, totalRegular - (currentPage - 1) * pageSize) ||
      regular.some((row, index) => row.ordinal !== regular[0].ordinal - index))) throw new SourceError('Truncated or inconsistent CMS rows.')
  for (const pinned of [true, false]) {
    const group = rows.filter(row => row.pinned === pinned)
    if (group.some((row, i) => i && row.publishedDate > group[i - 1].publishedDate)) throw new SourceError('CMS date ordering changed.')
  }
  return { currentPage, pages, total: totalRegular, rows }
}
