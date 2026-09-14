import { SourceError } from './feed.mjs'

export function descendants(node, predicate) {
  const result = []
  for (const child of node.childNodes ?? []) {
    if (predicate(child)) result.push(child)
    result.push(...descendants(child, predicate))
  }
  return result
}
export const attr = (node, name) => node?.attrs?.find(attr => attr.name === name)?.value
export const hasClass = (node, name) => attr(node, 'class')?.split(/\s+/).includes(name)
export const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes ?? []).map(text).join('')
export const clean = value => value.replace(/\s+/g, ' ').trim()
export const elements = (node, tag) => descendants(node, child => child.tagName === tag)
export function one(nodes, description) {
  if (nodes.length !== 1) throw new SourceError(`Invalid ${description}.`)
  return nodes[0]
}
export function count(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 1000000) throw new SourceError('Invalid list count.')
  return Number(value)
}
export function metadata(title, date) {
  title = clean(title)
  date = clean(date).replaceAll('.', '-')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!title || title.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new SourceError('Invalid list title or date.')
  return { title, publishedDate: date }
}
export function recordId(url, key) {
  const value = url.searchParams.get(key)
  if (url.searchParams.getAll(key).length !== 1 || !/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new SourceError('Invalid article ID.')
  return Number(value)
}
export function checkPaging(links, currentPage, pages, source, path, parameter, activeClass = 'on') {
  const selected = one(links.filter(node => hasClass(node, activeClass)), 'selected page')
  if (clean(text(selected)) !== String(currentPage)) throw new SourceError('Wrong current page.')
  const numbers = [currentPage]
  for (const link of links) {
    const href = attr(link, 'href')
    if (!href) continue
    const query = source.kind === 'semiconductor' ? { board_id: source.board } : source.code ? { code: source.code } : {}
    const url = articleUrl(href, source, path, query)
    if (url.searchParams.getAll(parameter).length !== 1) throw new SourceError('Invalid pagination URL.')
    const number = count(url.searchParams.get(parameter) ?? '')
    if (number < 1 || number > pages) throw new SourceError('Invalid page range.')
    numbers.push(number)
  }
  if (Math.max(...numbers) !== pages) throw new SourceError('Incomplete pagination.')
}
export function articleUrl(href, source, path, query) {
  let url
  try { url = new URL(href, `https://${source.host}.sogang.ac.kr`) } catch { throw new SourceError('Invalid article URL.') }
  if (url.origin !== `https://${source.host}.sogang.ac.kr` || url.username || url.password || url.pathname !== path ||
      Object.entries(query).some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) throw new SourceError('Wrong article identity.')
  return url
}
// New list templates count pins either within the page or outside it. Never infer
// the expected page size from a response that may already have been truncated.
export function validateListPage(rows, total, source, currentPage, pinsOutside = false) {
  const pageSize = source.pageSize ?? 10
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const regular = rows.filter(row => !row.pinned)
  const counted = pinsOutside ? regular : rows
  if (currentPage > pages || rows.length > 500 || new Set(rows.map(row => row.url)).size !== rows.length ||
      counted.length !== Math.min(pageSize, total - (currentPage - 1) * pageSize)) throw new SourceError('Incomplete list page.')
  for (const [index, row] of counted.entries()) {
    if (!row.pinned && row.ordinal !== null && row.ordinal !== total - (currentPage - 1) * pageSize - index) throw new SourceError('Inconsistent list ordinals.')
  }
  for (const pinned of [true, false]) {
    const group = rows.filter(row => row.pinned === pinned)
    if (group.some((row, index) => index && row.publishedDate > group[index - 1].publishedDate)) throw new SourceError('List date ordering changed.')
  }
  return { currentPage, pages, total, rows }
}
