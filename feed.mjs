// Only explicitly classified source failures may use published recovery data.
export class SourceError extends Error {}

export function validateFeed(feed, source, now = Date.now()) {
  if (!feed || feed.schemaVersion !== 2 || feed.sourceId !== source.id ||
      !['ok', 'error'].includes(feed.collectionStatus) || !Array.isArray(feed.notices) || feed.notices.length > 30) throw new Error('Invalid feed envelope.')
  for (const value of [feed.fetchedAt, feed.lastAttemptAt]) {
    const date = new Date(value)
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        !Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getTime() > now + 300000) throw new Error('Invalid feed timestamp.')
  }
  if (feed.lastAttemptAt < feed.fetchedAt) throw new Error('Attempt precedes successful fetch.')
  const seen = new Set()
  let previousDate
  const notices = feed.notices.map(row => {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 2000 ||
        typeof row.url !== 'string' || typeof row.publishedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.publishedDate)) throw new Error('Invalid feed notice.')
    const date = new Date(`${row.publishedDate}T00:00:00.000Z`)
    const url = new URL(row.url)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.publishedDate ||
        !['https:', 'http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href) ||
        (previousDate && row.publishedDate > previousDate)) throw new Error('Unsafe, duplicate, or unordered feed notice.')
    seen.add(url.href)
    previousDate = row.publishedDate
    return { title: row.title.trim(), url: url.href, publishedDate: row.publishedDate }
  })
  return { schemaVersion: 2, sourceId: source.id, collectionStatus: feed.collectionStatus,
    lastAttemptAt: feed.lastAttemptAt, fetchedAt: feed.fetchedAt, notices }
}
