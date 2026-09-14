import { parse } from 'parse5'
import { createHash } from 'node:crypto'
import { parseCmsPage } from '../cms.mjs'
import { boardUrl } from '../sources.mjs'
import { descendants, attr, hasClass, text, clean, one } from '../html.mjs'
import { SourceError } from '../feed.mjs'
import { paceRequests } from '../pacing.mjs'
import { addMealDays, mealDate, seoulDate } from './schema.mjs'

export const bellarmineSource = {
  id: 'bellarmine',
  host: 'scc',
  site: 'dormitory',
  board: 1185,
  pageSize: 7,
}
export class MealSourceError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}
const fail = (code = 'source') => {
  throw new MealSourceError(code)
}

export async function requestBytes(url, type, limit, fetcher = fetch) {
  let response
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
      cache: 'no-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: type },
    })
  } catch (error) {
    if (
      error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error.cause
    )
      fail()
    throw error
  }
  if (
    !response.ok ||
    !response.body ||
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      type
  ) {
    await response.body?.cancel()
    fail()
  }
  let bytes = 0
  const chunks = []
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        fail()
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof MealSourceError) throw error
    fail()
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
export function titlePeriod(title, publishedDate) {
  const match =
    /^(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*[~～-]\s*(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*식단$/.exec(
      title,
    )
  if (!match) fail('date-mismatch')
  const [, explicit, month, day, explicitEnd, endMonth, endDay] = match
  const publication = Date.parse(`${mealDate(publishedDate)}T00:00:00Z`)
  const year = Number(publishedDate.slice(0, 4))
  const candidates = []
  for (const startYear of explicit
    ? [Number(explicit)]
    : [year - 1, year, year + 1]) {
    const endYear = explicitEnd
      ? Number(explicitEnd)
      : startYear + (Number(endMonth) < Number(month) ? 1 : 0)
    const start = `${startYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const end = `${endYear}-${endMonth.padStart(2, '0')}-${endDay.padStart(2, '0')}`
    try {
      mealDate(start)
      mealDate(end)
    } catch {
      continue
    }
    const delta = Date.parse(`${start}T00:00:00Z`) - publication
    if (
      Math.abs(delta) <= 45 * 86400000 &&
      end >= start &&
      end <= addMealDays(start, 6)
    )
      candidates.push({ start, end })
  }
  if (candidates.length !== 1) fail('date-mismatch')
  return candidates[0]
}
export function imageReference(input) {
  if (typeof input !== 'string') fail()
  if (input.startsWith('data:')) {
    const prefix = 'data:image/png;base64,'
    if (
      !input.startsWith(prefix) ||
      input.length > prefix.length + 4 * Math.ceil((5 * 1024 * 1024) / 3)
    )
      fail()
    const encoded = input.slice(prefix.length)
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      fail()
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.toString('base64') !== encoded) fail()
    checkImage(bytes, 'image/png')
    return { imageUrl: null, bytes, type: 'image/png' }
  }
  let url
  try {
    url = new URL(input)
  } catch {
    fail()
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== 'scc.sogang.ac.kr' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/dataview\/board\/1185\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png)$/i.test(
      url.pathname,
    )
  )
    fail()
  url.protocol = 'https:'
  return {
    imageUrl: url.href,
    bytes: null,
    type: /\.png$/i.test(url.pathname) ? 'image/png' : 'image/jpeg',
  }
}
export function checkImage(bytes, type) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) fail()
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  if (type === 'image/png' ? !png : type === 'image/jpeg' ? !jpeg : true) fail()
}
export function parseArticle(html, candidate) {
  try {
    const doc = parse(html)
    const inputs = descendants(doc, (node) => node.tagName === 'input')
    for (const [name, expected] of [
      ['bbsConfigFK', '1185'],
      ['siteId', 'dormitory'],
      ['pkid', String(candidate.id)],
    ]) {
      const values = inputs
        .filter((node) => attr(node, 'name') === name)
        .map((node) => attr(node, 'value'))
      if (!values.length || values.some((value) => value !== expected)) fail()
    }
    const info = one(
      descendants(doc, (node) => hasClass(node, 'post_info')),
      'article information',
    )
    const title = clean(
      text(
        one(
          descendants(info, (node) => hasClass(node, 'title')),
          'article title',
        ),
      ),
    )
    if (title !== candidate.title) fail('date-mismatch')
    const body = one(
      descendants(doc, (node) => hasClass(node, 'post_cont')),
      'article body',
    )
    const image = one(
      descendants(body, (node) => node.tagName === 'img'),
      'menu image',
    )
    return imageReference(attr(image, 'src'))
  } catch (error) {
    if (error instanceof SourceError) fail()
    throw error
  }
}
export async function discoverMeals(
  fetcher = fetch,
  now = Date.now(),
  spacingMs = 1000,
) {
  const paced = paceRequests(fetcher, spacingMs)
  const today = seoulDate(now)
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const monday = addMealDays(today, -(weekday + 6) % 7)
  const lastDay = addMealDays(monday, 13)
  const rows = []
  let first
  let complete = false
  for (let page = 1; page <= 2; page++) {
    let parsed
    try {
      parsed = parseCmsPage(
        (
          await requestBytes(
            boardUrl(bellarmineSource, page),
            'text/html',
            2 * 1024 * 1024,
            paced,
          )
        ).toString('utf8'),
        bellarmineSource,
        page,
      )
    } catch (error) {
      if (error instanceof SourceError) fail()
      throw error
    }
    if (first && (first.total !== parsed.total || first.pages !== parsed.pages))
      fail()
    first ??= parsed
    for (const row of parsed.rows) {
      if (row.pinned) {
        // Only the observed operating-hours notice is outside weekly selection.
        if (row.title !== '식당 이용 시간 안내') fail()
        continue
      }
      if (
        rows.some((entry) => entry.id === row.id) ||
        (rows.length && row.publishedDate > rows.at(-1).publishedDate)
      )
        fail()
      const period = titlePeriod(row.title, row.publishedDate)
      rows.push({ ...row, ...period })
      if (row.publishedDate < addMealDays(monday, -45)) complete = true
    }
    if (page === parsed.pages) complete = true
    if (complete) break
  }
  if (!complete) fail()
  const candidates = rows.filter(
    (row) => row.end >= monday && row.start <= lastDay,
  )
  if (candidates.length > 4) fail()
  const selected = []
  for (const candidate of candidates) {
    if (
      candidate.title.length > 200 ||
      ![monday, addMealDays(monday, 7)].includes(candidate.start) ||
      candidate.end !== addMealDays(candidate.start, 6)
    )
      fail('date-mismatch')
    const earlier = selected.find((row) => row.start === candidate.start)
    if (earlier) {
      if (earlier.publishedDate === candidate.publishedDate)
        fail('date-mismatch')
      continue // First (newest) revision wins. Never use an older revision after its failure.
    }
    selected.push(candidate)
  }
  if (!selected.length) fail()
  const result = []
  for (const candidate of selected) {
    const html = (
      await requestBytes(candidate.url, 'text/html', 2 * 1024 * 1024, paced)
    ).toString('utf8')
    const image = parseArticle(html, candidate)
    const bytes =
      image.bytes ??
      (await requestBytes(image.imageUrl, image.type, 5 * 1024 * 1024, paced))
    checkImage(bytes, image.type)
    result.push({
      weekStart: candidate.start,
      weekEnd: candidate.end,
      source: {
        postId: String(candidate.id),
        title: candidate.title,
        postUrl: candidate.url,
        imageUrl: image.imageUrl,
        imageSha256: createHash('sha256').update(bytes).digest('hex'),
      },
      bytes,
    })
  }
  return result.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}
