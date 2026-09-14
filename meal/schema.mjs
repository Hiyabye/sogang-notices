// Generated from Rill by scripts/generate-meal-schema.mjs. Do not edit.
export const mealFeedUrl =
  'https://hiyabye.github.io/sogang-notices/meals/bellarmine.json'
export const mealBoardUrl =
  'https://scc.sogang.ac.kr/front/cmsboardlist.do?bbsConfigFK=1185&siteId=dormitory'
export const maxMealBytes = 256 * 1024





































function check(condition         )                    {
  if (!condition) throw new Error('식단 데이터가 올바르지 않습니다.')
}
function record(value         )                          {
  check(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value
}
function text(value         , limit        )         {
  check(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= limit &&
      value.trim() === value &&
      !/\p{Cc}/u.test(value),
  )
  return value
}
export function mealDate(value         )         {
  const date = text(value, 10)
  check(/^\d{4}-\d{2}-\d{2}$/.test(date))
  const parsed = new Date(`${date}T00:00:00.000Z`)
  check(
    Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === date,
  )
  return date
}
export function addMealDays(date        , days        )         {
  return new Date(
    Date.parse(`${mealDate(date)}T00:00:00.000Z`) + days * 86400000,
  )
    .toISOString()
    .slice(0, 10)
}
export function seoulDate(now = Date.now())         {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type) .value)
    .join('-')
}
function time(value         , now        )         {
  const stamp = text(value, 24)
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp))
  const parsed = new Date(stamp)
  check(
    Number.isFinite(parsed.getTime()) &&
      parsed.toISOString() === stamp &&
      parsed.getTime() <= now + 300000,
  )
  return stamp
}
function hash(value         )         {
  const result = text(value, 64)
  check(/^[a-f0-9]{64}$/.test(result))
  return result
}
function sourceUrl(value         , postId         )         {
  const input = text(value, 2048)
  const url = new URL(input)
  check(
    url.origin === 'https://scc.sogang.ac.kr' &&
      !url.username &&
      !url.password &&
      !url.hash,
  )
  if (postId) {
    check(
      url.pathname === '/front/cmsboardview.do' &&
        url.searchParams.size === 3 &&
        url.searchParams.get('bbsConfigFK') === '1185' &&
        url.searchParams.get('siteId') === 'dormitory' &&
        url.searchParams.get('pkid') === postId,
    )
  } else
    check(
      /^\/dataview\/board\/1185\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png)$/i.test(
        url.pathname,
      ) && !url.search,
    )
  return url.href
}
function offering(value         )           {
  const row = record(value)
  check(
    row.status === 'available' ||
      row.status === 'closed' ||
      row.status === 'unlisted',
  )
  check(Array.isArray(row.items) && row.items.length <= 12)
  const items = Array.from(row.items, (item         ) => text(item, 120))
  const serviceTime = row.serviceTime === null ? null : text(row.serviceTime, 5)
  check(serviceTime === null || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(serviceTime))
  check(
    row.status === 'available'
      ? items.length > 0
      : items.length === 0 && serviceTime === null,
  )
  return { status: row.status, items, serviceTime }
}
export function parseMealWeek(value         , now = Date.now())           {
  const row = record(value)
  const weekStart = mealDate(row.weekStart)
  const weekEnd = mealDate(row.weekEnd)
  check(
    new Date(`${weekStart}T00:00:00Z`).getUTCDay() === 1 &&
      addMealDays(weekStart, 6) === weekEnd,
  )
  const source = record(row.source)
  const postId = text(source.postId, 16)
  check(/^[1-9]\d*$/.test(postId) && Number.isSafeInteger(Number(postId)))
  const extractedAt = time(row.extractedAt, now)
  const verifiedAt = time(row.verifiedAt, now)
  check(
    extractedAt <= verifiedAt &&
      Array.isArray(row.days) &&
      row.days.length === 7,
  )
  const days = Array.from(
    row.days,
    (value         , index        )          => {
      const day = record(value)
      const breakfast = record(day.breakfast)
      const date = mealDate(day.date)
      check(date === addMealDays(weekStart, index))
      return {
        date,
        breakfast: {
          korean: offering(breakfast.korean),
          western: offering(breakfast.western),
          common: offering(breakfast.common),
        },
        cupRice: offering(day.cupRice),
        dinner: offering(day.dinner),
        drink: offering(day.drink),
      }
    },
  )
  return {
    weekStart,
    weekEnd,
    source: {
      postId,
      title: text(source.title, 200),
      postUrl: sourceUrl(source.postUrl, postId),
      imageUrl: source.imageUrl === null ? null : sourceUrl(source.imageUrl),
      imageSha256: hash(source.imageSha256),
    },
    pipelineId: hash(row.pipelineId),
    extractedAt,
    verifiedAt,
    days,
  }
}
export function parseMealFeed(value         , now = Date.now())           {
  const row = record(value)
  check(
    row.schemaVersion === 1 &&
      row.sourceId === 'bellarmine' &&
      row.timezone === 'Asia/Seoul',
  )
  check(
    row.collectionStatus === 'ok' ||
      row.collectionStatus === 'error' ||
      row.collectionStatus === 'unavailable',
  )
  check(
    row.errorCode === null ||
      row.errorCode === 'source' ||
      row.errorCode === 'date-mismatch' ||
      row.errorCode === 'layout' ||
      row.errorCode === 'ocr-quality',
  )
  const lastAttemptAt = time(row.lastAttemptAt, now)
  const fetchedAt = row.fetchedAt === null ? null : time(row.fetchedAt, now)
  check(fetchedAt === null || fetchedAt <= lastAttemptAt)
  check(Array.isArray(row.weeks) && row.weeks.length <= 2)
  const weeks = Array.from(row.weeks, (week         ) =>
    parseMealWeek(week, now),
  )
  check(
    weeks.every(
      (week, index) =>
        fetchedAt !== null &&
        week.verifiedAt <= fetchedAt &&
        (index === 0 || weeks[index - 1] .weekEnd < week.weekStart),
    ),
  )
  if (row.collectionStatus === 'unavailable')
    check(fetchedAt === null && weeks.length === 0 && row.errorCode !== null)
  else
    check(
      fetchedAt !== null &&
        weeks.length > 0 &&
        (row.collectionStatus === 'ok'
          ? row.errorCode === null
          : row.errorCode !== null),
    )
  return {
    schemaVersion: 1,
    sourceId: 'bellarmine',
    timezone: 'Asia/Seoul',
    collectionStatus: row.collectionStatus,
    lastAttemptAt,
    fetchedAt,
    errorCode: row.errorCode,
    weeks,
  }
}
export async function readMealFeed(response          )                    {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('식단을 불러오지 못했습니다.')
  }
  let bytes = 0
  const bounded = response.body.pipeThrough(
    new TransformStream                        ({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        check(bytes <= maxMealBytes)
        controller.enqueue(chunk)
      },
    }),
  )
  return parseMealFeed(await new Response(bounded).json())
}
