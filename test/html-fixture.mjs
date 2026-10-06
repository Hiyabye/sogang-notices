import { boardUrl } from '../sources.mjs'

// Synthetic list-only markup for bootstrap and failure tests. Source-specific
// real templates are tested separately; this helper never fetches or writes data.
export function engineeringFixture(source, page = 1, total = 3) {
  const size = source.pageSize ?? 10
  const pages = Math.max(1, Math.ceil(total / size))
  const records = Array.from({ length: Math.max(0, Math.min(size, total - (page - 1) * size)) }, (_, index) => total - (page - 1) * size - index)
  const paginationUrl = number => {
    const url = new URL(boardUrl(source, number))
    if (source.code) url.searchParams.set('code', source.code)
    return source.kind === 'mechanical' ? `${url.pathname}${url.search}` : url.href
  }
  const paging = `<a class="on" href="${paginationUrl(page)}">${page}</a>${pages > 1 ? `<a href="${paginationUrl(pages)}">${pages}</a>` : ''}`
  if (source.kind === 'computing') {
    const rows = records.map(id => `<tr><td class="board-list-number">${id}</td><td class="board-list-title"><a href="/ko/community/${source.board}/detail/${id}?num=${page}">Notice ${id}</a></td><td class="board-list-date">2026-09-01</td></tr>`).join('')
    const category = source.board === 'academicNotice' ? '<div class="board-category"><button aria-pressed="true">전체</button></div>' : ''
    const start = Math.floor((page - 1) / 10) * 10 + 1
    const numbers = Array.from({ length: Math.min(10, pages - start + 1) }, (_, index) => {
      const number = start + index
      return `<button${number === page ? ' class="is-active" aria-current="page"' : ''}>${number}</button>`
    }).join('')
    const arrows = [['첫 페이지', page === 1], ['이전 페이지', page === 1], ['다음 페이지', page === pages], ['마지막 페이지', page === pages]]
      .map(([label, disabled]) => `<button class="board-pagination-arrow" aria-label="${label}"${disabled ? ' disabled' : ''}></button>`).join('')
    return `<aside class="board-lnb"><a href="${source.path}" aria-current="page">${source.label}</a></aside><section class="board-content"><header class="board-content-header"><h2>${source.label}</h2>${category}</header><div class="board-toolbar"><strong>${total}</strong><input id="board-search-keyword" value=""></div><div class="board-list"><table><tbody>${rows}</tbody></table></div>${total ? '' : '<p class="cont-empty-title">등록된 게시물이 없습니다</p>'}<nav class="board-pagination">${numbers}${arrows}</nav></section>`
  }
  if (source.kind === 'community') {
    const sse = source.host === 'sse'
    const heading = sse ? `<div class="ttl01">${source.label}</div>` : `<h3>${source.label}</h3>`
    const rows = records.map(id => {
      const href = `${source.path}?m=v&idx=${id}&pNo=${page}${source.code ? `&code=${source.code}` : ''}`
      return source.gallery ? `<a href="${href}"><strong class="${sse ? 'subject' : 'tit'}">Notice ${id}</strong><p class="date">2026.09.01</p><p class="txt">Not a title</p></a>`
        : `<tr><td>${id}</td><td><a href="${href}">Notice ${id}</a></td><td>2026.09.01</td><td></td></tr>`
    }).join('')
    const emptyRow = !total && !sse ? '<tr><td class="no_list">등록된 데이터가 없습니다.</td></tr>' : ''
    const list = source.gallery ? `<div class="${sse ? 'list_st01' : 'gallery_list'}">${rows}</div>`
      : `<div class="list_st02"><table class="basic_list"><tbody>${rows || emptyRow}</tbody></table></div>`
    return `${heading}<div class="list_top"><p>총 ${total}건의 게시물</p><input name="sorder" value=""></div>${list}<div class="${sse ? 'page_bx' : 'b_page_no'}">${paging}</div>`
  }
  if (source.kind === 'mechanical') {
    const path = `/ko/board/${source.board}`
    const rows = records.map(id => `<tr><td>${id}</td><td><a href="${path}/${id}">Notice ${id}<span>📎</span></a></td><td></td><td>2026.09.01</td><td></td></tr>`).join('')
    const list = total ? `<table><tbody>${rows}</tbody></table>` : '<p>등록된 게시물이 없습니다.</p>'
    return `<main><h1>${source.label}</h1><form action="${path}"><input name="q" value=""></form><p>총 ${total}건</p>${list}${pages > 1 ? paging.replace('class="on"', 'class="bg-sg-ink"') : ''}</main>`
  }
  if (source.kind === 'semiconductor') {
    const rows = records.map(id => `<li><a href="/board/board_view.php?board_id=${source.board}&no=${id}&page=${page}"><p class="num">${id}</p><p class="txt">Notice ${id}</p><p class="date">2026-09-01</p></a></li>`).join('')
    return `<h2 id="title">${source.label}</h2><input name="board_id" value="${source.board}"><input name="searcher" value=""><div class="list_count"><strong>${total}</strong></div><ul class="notice_list">${rows}</ul><div class="paging">${paging}</div>`
  }
  if (source.gallery) {
    const rows = records.map(id => `<li><a href="/front/cmsboardview.do?bbsConfigFK=${source.board}&siteId=${source.site}&pkid=${id}"><div class="title">Notice ${id}</div><div class="date">2026.09.01 | 조회수 : 0</div></a></li>`).join('')
    return `<input name="bbsConfigFK" value="${source.board}"><input name="siteId" value="${source.site}"><div class="board_photo_list"><ul>${rows}</ul></div><div class="board_paging"><span class="on">${page}</span><span class="total_cnt">/ ${pages}</span></div>`
  }
  throw new Error(`Unsupported test template: ${source.id}`)
}
