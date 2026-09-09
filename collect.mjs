import { mkdir, writeFile, rename, mkdtemp, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sources, boardUrl, feedUrl } from './sources.mjs'
import { parseCmsPage, selectCmsNotices } from './cms.mjs'
import { validateFeed, SourceError } from './feed.mjs'
import { pathToFileURL } from 'node:url'

export const sourceUrl = 'https://www.sogang.ac.kr/api/api/v1/mainKo/BbsData/boardList?pageNum=1&pageSize=50&bbsConfigFk=2&category=&introPkId=&title=&content=&username='
const noticeCount = 30

function validRegistrationDate(value) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return false
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}.000Z`
  const date = new Date(iso)
  // UTC is used only for calendar validation, not to infer the source timezone.
  return Number.isFinite(date.getTime()) && date.toISOString() === iso
}

export function buildFeed(value, fetchedAt = new Date()) {
  const data = value?.data
  if (value?.statusCode !== 200 || !data || !Array.isArray(data.list) ||
      !Number.isSafeInteger(data.total) || data.total < 0 || data.pageNum !== 1 ||
      data.pageSize !== 50 || data.size !== data.list.length || data.size !== Math.min(data.total, 50) ||
      data.total < data.size || typeof data.hasNextPage !== 'boolean' ||
      data.hasNextPage !== (data.total > data.size) ||
      (data.size === 0 && data.total !== 0)) {
    throw new SourceError('Unexpected board response or pagination; refusing to publish.')
  }
  const unique = new Map()
  const lastDate = { Y: null, N: null }
  for (const row of data.list) {
    if (!row || !Number.isSafeInteger(row.pkId) || row.pkId <= 0 || row.configId !== 2 ||
        typeof row.title !== 'string' || !row.title.trim() || row.title.length > 2000 ||
        !validRegistrationDate(row.regDate) || !['Y', 'N'].includes(row.isTop)) {
      throw new SourceError('Invalid notice metadata; refusing to publish.')
    }
    if (lastDate[row.isTop] !== null && row.regDate > lastDate[row.isTop]) {
      throw new SourceError('Source date ordering changed; refusing to select an incomplete newest list.')
    }
    lastDate[row.isTop] = row.regDate
    const existing = unique.get(row.pkId)
    if (existing && (existing.title !== row.title || existing.regDate !== row.regDate)) {
      throw new SourceError(`Conflicting duplicate notice ${row.pkId}.`)
    }
    unique.set(row.pkId, row)
  }
  // ponytail: one 50-row page; fetch further pages if pins crowd out 30 regular notices.
  if (data.hasNextPage && [...unique.values()].filter(row => row.isTop === 'N').length < noticeCount) {
    throw new SourceError('Too few regular notices in the first 50 rows; pagination needs review.')
  }
  const notices = [...unique.values()]
    .sort((a, b) => b.regDate.localeCompare(a.regDate) || b.pkId - a.pkId)
    .slice(0, noticeCount)
    .map(row => {
      const url = new URL(`/ko/detail/${row.pkId}`, 'https://www.sogang.ac.kr')
      url.search = new URLSearchParams({
        bbsConfigFk: '2', namepage: 'AcademicNotice', text: '학사 지원',
        data: '%5B%5D', title: '학부 학사공지', redirect: '/ko/academic-support/notices',
      }).toString()
      return {
        title: row.title.trim(), url: url.href,
        publishedDate: `${row.regDate.slice(0, 4)}-${row.regDate.slice(4, 6)}-${row.regDate.slice(6, 8)}`,
      }
    })
  return { schemaVersion: 2, sourceId: 'sogang-academic', collectionStatus: 'ok',
    lastAttemptAt: fetchedAt.toISOString(), fetchedAt: fetchedAt.toISOString(), notices }
}

async function request(url, type, fetcher) {
  let response
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(20000), headers: { Accept: type, 'Cache-Control': 'no-cache' },
      redirect: 'error', cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    // Native fetch network errors carry a cause; arbitrary programming errors propagate.
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.cause) throw new SourceError('Source request failed.', { cause: error })
    throw error
  }
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes(type) || !response.body) {
    await response.body?.cancel()
    throw new SourceError(`Unexpected source response: HTTP ${response.status}.`)
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new SourceError('Source response exceeds 2 MiB.') }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof SourceError) throw error
    throw new SourceError('Source response could not be read.', { cause: error })
  } finally { reader.releaseLock() }
  const text = Buffer.concat(chunks).toString('utf8')
  if (type !== 'application/json') return text
  try { return JSON.parse(text) } catch { throw new SourceError('Source returned invalid JSON.') }
}

export async function collectSource(source, fetcher = fetch) {
  if (!source.site) return buildFeed(await request(sourceUrl, 'application/json', fetcher))
  const pages = []
  for (let page = 1; page <= 3; page++) {
    const html = await request(boardUrl(source, page), 'text/html', fetcher)
    pages.push(parseCmsPage(html, source, page))
    if (page === pages[0].pages) break
  }
  const notices = selectCmsNotices(pages)
  const fetchedAt = new Date().toISOString()
  return { schemaVersion: 2, sourceId: source.id, collectionStatus: 'ok', lastAttemptAt: fetchedAt, fetchedAt, notices }
}

export async function collect(outputDirectory = 'public', fetcher = fetch) {
  const feeds = []
  // Two sources at a time, with sequential pagination within each board.
  for (let offset = 0; offset < sources.length; offset += 2) {
    const batch = await Promise.all(sources.slice(offset, offset + 2).map(async source => {
      let feed
      try {
        feed = await collectSource(source, fetcher)
      } catch (error) {
        // Programming faults must not masquerade as a recoverable source outage.
        if (!(error instanceof SourceError)) throw error
        console.error(`${source.id}: ${error.message}`)
        const previous = validateFeed(await request(feedUrl(source), 'application/json', fetcher), source)
        feed = { ...previous, collectionStatus: 'error', lastAttemptAt: new Date().toISOString() }
      }
      return validateFeed(feed, source)
    }))
    feeds.push(...batch)
  }
  // All recovery and final validation must succeed before replacing any output.
  await mkdir(outputDirectory, { recursive: true })
  const stage = await mkdtemp(join(outputDirectory, '.feeds-'))
  try {
    for (const feed of feeds) await writeFile(join(stage, `${feed.sourceId}.json`), `${JSON.stringify(feed, null, 2)}\n`)
    const target = join(outputDirectory, 'feeds')
    const previous = `${stage}-previous`
    let moved = false
    try { await rename(target, previous); moved = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    try { await rename(stage, target) } catch (error) {
      if (moved) await rename(previous, target)
      throw error
    }
    if (moved) await rm(previous, { recursive: true })
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, feeds.map(feed =>
      `- ${feed.sourceId}: ${feed.collectionStatus === 'ok' ? 'collected' : 'FAILED, retained last good data'} (${feed.fetchedAt})`).join('\n') + '\n')
  }
  return feeds
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const feeds = await collect()
    console.log(`Prepared ${feeds.length} board feeds (${feeds.filter(feed => feed.collectionStatus === 'error').length} recovered failures).`)
  } catch (error) {
    console.error(`Collection failed: ${error.message}${error.cause ? ` (${error.cause.message})` : ''}`)
    process.exitCode = 1
  }
}
