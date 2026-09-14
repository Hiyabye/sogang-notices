import { SourceError } from './feed.mjs'

// Parsers validate each skin's counts and ordinals. This shared selection checks
// cross-page consistency and distinct regular coverage before mixing in pins.
export function selectNotices(pages, pinsConsumeSlots = false) {
  const unique = new Map()
  let regular = 0
  let previousDate
  let previousPinnedDate
  for (const [index, page] of pages.entries()) {
    if (page.currentPage !== index + 1 || page.pages !== pages[0].pages || page.total !== pages[0].total) throw new SourceError('List pagination changed during collection.')
    for (const row of page.rows) {
      if (pinsConsumeSlots && row.pinned) {
        if (previousDate || (previousPinnedDate && row.publishedDate > previousPinnedDate)) throw new SourceError('List pin ordering changed.')
        previousPinnedDate = row.publishedDate
      }
      const previous = unique.get(row.url)
      if (previous && (previous.title !== row.title || previous.publishedDate !== row.publishedDate)) throw new SourceError('Conflicting list duplicate.')
      if (!row.pinned) {
        if (previousDate && row.publishedDate > previousDate) throw new SourceError('List cross-page date ordering changed.')
        previousDate = row.publishedDate
        if (!previous) regular++
      }
      unique.set(row.url, row)
    }
  }
  if (pages.length < pages[0].pages && regular < 30) throw new SourceError('Incomplete regular sample.')
  return [...unique.values()].sort((a, b) => b.publishedDate.localeCompare(a.publishedDate) || b.id - a.id)
    .slice(0, 30).map(({ title, url, publishedDate }) => ({ title, url, publishedDate }))
}
