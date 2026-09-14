import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseMealFeed, maxMealBytes, mealFeedUrl } from '../../meal/schema.mjs'
import {
  titlePeriod,
  imageReference,
  parseArticle,
  discoverMeals,
  requestBytes,
  bellarmineSource,
} from '../../meal/bellarmine.mjs'
import {
  prepare,
  assemble,
  assembleMeals,
  recoverMeals,
  pipelineId,
} from '../../meal/publish.mjs'
import { boardUrl, sources } from '../../sources.mjs'
import { makeMeals } from './fixtures.mjs'
import { healthy } from '../responses.mjs'

const stamp = '2026-09-08T12:00:00.000Z'
const now = Date.parse(stamp)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
)
const imageUrl = 'https://scc.sogang.ac.kr/dataview/board/1185/menu.png'
const articleUrl =
  'https://scc.sogang.ac.kr/front/cmsboardview.do?bbsConfigFK=1185&siteId=dormitory&pkid=1'
const article = (src = imageUrl) =>
  `<input name="bbsConfigFK" value="1185"><input name="siteId" value="dormitory"><input name="pkid" value="1"><div class="post_info"><h1 class="title">9월 7일 ~ 9월 13일 식단</h1></div><div class="post_cont"><img src="${src}"></div>`
const list = `<input name="bbsConfigFK" value="1185"><input name="siteId" value="dormitory"><div class="list_box"><ul><li><div><div>1</div><div><a class="title" href="${articleUrl}"><!--9월 7일 ~ 9월 13일 식단-->9월 7일 ~ 9월 13일 식단</a><div class="info"><span></span><span>2026.09.01</span></div></div></div></li></ul></div><div class="board_paging"><span class="on">1</span><span class="total_cnt">/ 1</span></div>`

function manifest(id = 'a'.repeat(64)) {
  const feed = makeMeals()
  const week = feed.weeks[0]
  return {
    pipelineId: id,
    lastAttemptAt: stamp,
    errorCode: null,
    baseline: feed,
    candidates: [
      {
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        source: week.source,
        image: '1.image',
        reused: null,
      },
    ],
  }
}
function result(id = 'a'.repeat(64)) {
  return {
    postId: '1',
    imageSha256: 'b'.repeat(64),
    pipelineId: id,
    status: 'ok',
    errorCode: null,
    extractedAt: stamp,
    days: makeMeals().weeks[0].days,
  }
}

test('producer validates the shared contract corpus and complete seven-day output', async () => {
  const unavailable = JSON.parse(
    await readFile(new URL('./contract.json', import.meta.url), 'utf8'),
  )
  assert.deepEqual(parseMealFeed(unavailable, now), unavailable)
  assert.deepEqual(parseMealFeed(makeMeals(), now), makeMeals())
  for (const patch of [
    { schemaVersion: 2 },
    { timezone: 'UTC' },
    { weeks: [] },
    { fetchedAt: null },
    { errorCode: 'source' },
    { lastAttemptAt: '2026-09-08T11:59:59.999Z' },
  ])
    assert.throws(() => parseMealFeed({ ...makeMeals(), ...patch }, now))
  const incomplete = makeMeals()
  incomplete.weeks[0].days.pop()
  assert.throws(() => parseMealFeed(incomplete, now))
})
test('title dates are independently inferred from publication with calendar/year rollover checks', () => {
  assert.deepEqual(titlePeriod('9월 7일 ~ 9월 13일 식단', '2026-09-01'), {
    start: '2026-09-07',
    end: '2026-09-13',
  })
  assert.deepEqual(titlePeriod('12월 28일 ~ 1월 3일 식단', '2026-12-23'), {
    start: '2026-12-28',
    end: '2027-01-03',
  })
  for (const title of [
    '9월 31일 ~ 10월 6일 식단',
    '9월 7일 ~ 9월 20일 식단',
    '9월 식단',
    '<script>식단</script>',
  ])
    assert.throws(() => titlePeriod(title, '2026-09-01'))
})
test('image URLs, inline bytes and exact article identity are strict', () => {
  assert.equal(
    imageReference(imageUrl.replace('https:', 'http:')).imageUrl,
    imageUrl,
  )
  assert.deepEqual(
    imageReference(`data:image/png;base64,${png.toString('base64')}`).bytes,
    png,
  )
  for (const value of [
    'https://scc.sogang.ac.kr.evil.test/dataview/board/1185/a.png',
    'https://user:pass@scc.sogang.ac.kr/dataview/board/1185/a.png',
    imageUrl + '?x=1',
    imageUrl.replace('1185', '2'),
    'data:image/svg+xml,<svg/>',
    'data:image/png;base64,eA==',
    'data:image/png;base64,!!!!',
  ])
    assert.throws(() => imageReference(value))
  assert.equal(
    parseArticle(article(), { id: 1, title: '9월 7일 ~ 9월 13일 식단' })
      .imageUrl,
    imageUrl,
  )
  for (const html of [
    article().replace('value="1185"', 'value="2"'),
    article().replace('value="1"', 'value="2"'),
    article().replace('9월 7일', '9월 8일'),
  ]) {
    assert.throws(() =>
      parseArticle(html, { id: 1, title: '9월 7일 ~ 9월 13일 식단' }),
    )
  }
  assert.throws(() =>
    parseArticle(article().replace('<img src=', '<img src="x"><img src='), {
      id: 1,
      title: '9월 7일 ~ 9월 13일 식단',
    }),
  )
})
test('bounded discovery follows only the verified list, selected article and image', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push(url)
    assert.equal(options.redirect, 'error')
    if (url === boardUrl(bellarmineSource))
      return new Response(list, { headers: { 'Content-Type': 'text/html' } })
    if (url === articleUrl)
      return new Response(article(), {
        headers: { 'Content-Type': 'text/html' },
      })
    assert.equal(url, imageUrl)
    return new Response(png, { headers: { 'Content-Type': 'image/png' } })
  }
  const candidates = await discoverMeals(fetcher, now, 0)
  assert.deepEqual(calls, [boardUrl(bellarmineSource), articleUrl, imageUrl])
  assert.equal(
    candidates[0].source.imageSha256,
    createHash('sha256').update(png).digest('hex'),
  )
  assert.equal(candidates[0].weekEnd, '2026-09-13')
})
test('network byte ceilings are exact and oversized streams are cancelled', async () => {
  const exact = Buffer.alloc(1024)
  assert.equal(
    (
      await requestBytes(
        imageUrl,
        'image/png',
        1024,
        async () =>
          new Response(exact, { headers: { 'Content-Type': 'image/png' } }),
      )
    ).length,
    1024,
  )
  let cancelled = false
  await assert.rejects(
    requestBytes(
      imageUrl,
      'image/png',
      1024,
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1025))
            },
            cancel() {
              cancelled = true
            },
          }),
          { headers: { 'Content-Type': 'image/png' } },
        ),
    ),
  )
  assert.equal(cancelled, true)
})
test('source or OCR rejection preserves the whole last-good feed and real verification times', () => {
  const input = manifest()
  const rejected = {
    ...result(),
    status: 'rejected',
    errorCode: 'date-mismatch',
  }
  const recovered = assembleMeals(
    input,
    [rejected],
    input.pipelineId,
    now + 1000,
  )
  assert.deepEqual(recovered.weeks, input.baseline.weeks)
  assert.equal(recovered.fetchedAt, input.baseline.fetchedAt)
  assert.equal(recovered.collectionStatus, 'error')
  assert.equal(recovered.lastAttemptAt, '2026-09-08T12:00:01.000Z')
  const unavailable = recoverMeals(null, 'layout', stamp)
  assert.equal(unavailable.collectionStatus, 'unavailable')
  assert.deepEqual(unavailable.weeks, [])
  assert.equal(unavailable.fetchedAt, null)
})
test('OCR success, image/pipeline binding, reuse and missing/crashed results stay distinct', () => {
  const input = manifest()
  assert.deepEqual(
    assembleMeals(input, [result()], input.pipelineId, now),
    makeMeals(),
  )
  for (const results of [
    [],
    [result(), result()],
    [{ ...result(), imageSha256: 'c'.repeat(64) }],
    [{ ...result(), pipelineId: 'c'.repeat(64) }],
    [{ ...result(), status: 'crashed' }],
  ])
    assert.throws(() => assembleMeals(input, results, input.pipelineId, now))
  const reused = {
    ...input,
    candidates: [{ ...input.candidates[0], reused: makeMeals().weeks[0] }],
  }
  assert.deepEqual(
    assembleMeals(reused, [], input.pipelineId, now),
    makeMeals(),
  )
  assert.throws(() => assembleMeals(reused, [], 'c'.repeat(64), now))
  reused.candidates[0].source = {
    ...reused.candidates[0].source,
    imageSha256: 'c'.repeat(64),
  }
  assert.throws(() => assembleMeals(reused, [], input.pipelineId, now))
})
test('missing meal baseline blocks before university I/O, while explicit bootstrap permits unavailable meals', async () => {
  const work = await mkdtemp(join(tmpdir(), 'meal-prepare-'))
  try {
    const calls = []
    await assert.rejects(
      prepare(work, {
        fetcher: async (url) => {
          calls.push(url)
          return new Response('missing', { status: 404 })
        },
        spacingMs: 0,
      }),
    )
    assert.deepEqual(calls, [mealFeedUrl])
    assert.deepEqual(await readdir(work), [])
    const prepared = await prepare(work, {
      mealMode: 'bootstrap',
      noticeMode: 'full',
      spacingMs: 0,
      fetcher: async (url) =>
        url === boardUrl(bellarmineSource)
          ? new Response('missing', { status: 404 })
          : healthy(url),
    })
    assert.equal(prepared.errorCode, 'source')
    assert.equal(prepared.baseline, null)
    assert.equal((await readdir(join(work, 'site/feeds'))).length, 41)
    assert.deepEqual(
      JSON.parse(await readFile(join(work, 'ocr-results.json'), 'utf8')),
      [],
    )
    const output = join(work, 'complete')
    await assemble(work, output)
    assert.deepEqual((await readdir(output)).sort(), ['feeds', 'meals'])
    assert.equal((await readdir(join(output, 'feeds'))).length, 41)
    const feed = parseMealFeed(
      JSON.parse(await readFile(join(output, 'meals/bellarmine.json'), 'utf8')),
    )
    assert.equal(feed.collectionStatus, 'unavailable')
    await assert.rejects(assemble(work, output))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
})
test('preparation skips OCR only for matching validated bytes/pipeline and still rechecks article titles', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(stamp) })
  const root = await mkdtemp(join(tmpdir(), 'meal-reuse-'))
  const id = await pipelineId()
  try {
    for (const variant of ['same', 'bytes', 'pipeline', 'title']) {
      const baseline = makeMeals()
      baseline.weeks[0].pipelineId =
        variant === 'pipeline' ? 'c'.repeat(64) : id
      baseline.weeks[0].source.imageSha256 = createHash('sha256')
        .update(png)
        .digest('hex')
      const work = join(root, variant)
      const flags = join(root, `${variant}.output`)
      const prepared = await prepare(work, {
        noticeMode: 'full',
        spacingMs: 0,
        outputFile: flags,
        fetcher: async (url) => {
          if (url === mealFeedUrl) return Response.json(baseline)
          if (url === boardUrl(bellarmineSource))
            return new Response(list, {
              headers: { 'Content-Type': 'text/html' },
            })
          if (url === articleUrl)
            return new Response(
              variant === 'title'
                ? article().replace('9월 7일', '9월 8일')
                : article(),
              { headers: { 'Content-Type': 'text/html' } },
            )
          if (url === imageUrl)
            return new Response(
              variant === 'bytes'
                ? Buffer.concat([png, Buffer.from([1])])
                : png,
              { headers: { 'Content-Type': 'image/png' } },
            )
          return healthy(url)
        },
      })
      assert.equal(
        await readFile(flags, 'utf8'),
        `needsOcr=${variant === 'bytes' || variant === 'pipeline'}\n`,
      )
      if (variant === 'title') {
        assert.equal(prepared.errorCode, 'date-mismatch')
        assert.deepEqual(prepared.candidates, [])
      } else if (variant === 'same') {
        assert.equal(prepared.candidates[0].reused.extractedAt, stamp)
        assert.equal(
          prepared.candidates[0].reused.source.title,
          '9월 7일 ~ 9월 13일 식단',
        )
        assert.ok(!(await readdir(work)).includes('1.image'))
        assert.deepEqual(
          JSON.parse(await readFile(join(work, 'ocr-results.json'), 'utf8')),
          [],
        )
      } else {
        assert.equal(prepared.candidates[0].reused, null)
        assert.ok((await readdir(work)).includes('1.image'))
        assert.ok(!(await readdir(work)).includes('ocr-results.json'))
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('assembly refuses incomplete notice artifacts without creating a publishable directory', async () => {
  const work = await mkdtemp(join(tmpdir(), 'meal-assemble-'))
  try {
    await mkdir(join(work, 'site/feeds'), { recursive: true })
    const id = await pipelineId()
    await writeFile(join(work, 'prepared.json'), JSON.stringify(manifest(id)))
    await writeFile(
      join(work, 'ocr-results.json'),
      JSON.stringify([result(id)]),
    )
    await assert.rejects(
      assemble(work, join(work, 'output')),
      /Incomplete notice/,
    )
    assert.ok(!(await readdir(work)).includes('output'))
    assert.equal(sources.length, 41)
    assert.equal(maxMealBytes, 256 * 1024)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
})
