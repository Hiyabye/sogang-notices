import { mkdir, writeFile, rename } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const sourceUrl = 'https://www.sogang.ac.kr/api/api/v1/mainKo/BbsData/boardList?pageNum=1&pageSize=50&bbsConfigFk=2&category=&introPkId=&title=&content=&username='
const noticeCount = 5

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
    throw new Error('Unexpected board response or pagination; refusing to publish.')
  }
  const unique = new Map()
  const lastDate = { Y: null, N: null }
  for (const row of data.list) {
    if (!row || !Number.isSafeInteger(row.pkId) || row.pkId <= 0 || row.configId !== 2 ||
        typeof row.title !== 'string' || !row.title.trim() || row.title.length > 2000 ||
        !validRegistrationDate(row.regDate) || !['Y', 'N'].includes(row.isTop)) {
      throw new Error('Invalid notice metadata; refusing to publish.')
    }
    if (lastDate[row.isTop] !== null && row.regDate > lastDate[row.isTop]) {
      throw new Error('Source date ordering changed; refusing to select an incomplete newest list.')
    }
    lastDate[row.isTop] = row.regDate
    const existing = unique.get(row.pkId)
    if (existing && (existing.title !== row.title || existing.regDate !== row.regDate)) {
      throw new Error(`Conflicting duplicate notice ${row.pkId}.`)
    }
    unique.set(row.pkId, row)
  }
  // ponytail: one 50-row page; fetch further pages if pins crowd out five regular notices.
  if (data.hasNextPage && [...unique.values()].filter(row => row.isTop === 'N').length < noticeCount) {
    throw new Error('Too few regular notices in the first 50 rows; pagination needs review.')
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
  return { schemaVersion: 1, fetchedAt: fetchedAt.toISOString(), notices }
}

export async function collect(outputDirectory = 'public', fetcher = fetch) {
  const response = await fetcher(sourceUrl, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`)
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('Source did not return JSON; it may be an error page.')
  }
  const feed = buildFeed(await response.json())
  await mkdir(outputDirectory, { recursive: true })
  const target = `${outputDirectory}/notices.json`
  await writeFile(`${target}.tmp`, `${JSON.stringify(feed, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
  return feed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const feed = await collect()
    console.log(`Collected ${feed.notices.length} notices at ${feed.fetchedAt}.`)
  } catch (error) {
    console.error(`Collection failed: ${error.message}${error.cause ? ` (${error.cause.message})` : ''}`)
    process.exitCode = 1
  }
}
