import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  imageMimeType,
  buildPrompt,
  parseModelJson,
  normalizeMenuDays,
  callOpenRouter,
  extractMeals,
  DEFAULT_MODEL,
} from '../../meal/extract.mjs'
import { parseMealWeek, addMealDays } from '../../meal/schema.mjs'
import { assembleMeals } from '../../meal/publish.mjs'

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
)
const jpegBytes = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70])
const weekStart = '2026-09-07'
const weekEnd = '2026-09-13'

const sampleModelOutput = {
  commonBreakfast: ['그린샐러드 & 드레싱 & 셀프계란후라이'],
  commonDrink: ['디톡스워터'],
  days: [
    {
      dayOfWeek: '월',
      korean: ['참치두부김치찌개', '쌀밥', '떡갈비조림'],
      western: ['이천쌀크림빵', '미니돈까스'],
      cupRice: null,
      dinner: {
        closed: false,
        menu: ['소고기볶음밥', '맑은우동국물'],
      },
    },
    {
      dayOfWeek: '화',
      korean: ['흑미건강닭죽', '동치미'],
      western: ['호두바게트&버터'],
      cupRice: { time: '11:40', menu: ['새우까스덮밥&타르타르'] },
      dinner: { closed: false, menu: ['제육김치볶음', '쌀밥'] },
    },
    {
      dayOfWeek: '수',
      korean: ['고추장불고기', '잡곡밥'],
      western: ['갈릭스윗치즈피자'],
      cupRice: null,
      dinner: { closed: false, menu: ['치즈치킨까스'] },
    },
    {
      dayOfWeek: '목',
      korean: ['사골우거지국', '쌀밥'],
      western: ['못난이감자츠지빵'],
      cupRice: null,
      dinner: { closed: false, menu: ['충무식오징어무침', '쌀밥'] },
    },
    {
      dayOfWeek: '금',
      korean: ['가자미구이', '잡곡밥'],
      western: ['유자파이'],
      cupRice: null,
      dinner: { closed: false, menu: ['놀부부대찌개', '쌀밥'] },
    },
    {
      dayOfWeek: '토',
      korean: ['닭곰탕&당면사리', '쌀밥'],
      western: ['토스트빵&버터'],
      cupRice: null,
      dinner: { closed: true, menu: ['토요일석식미운영'] },
    },
    {
      dayOfWeek: '일',
      korean: ['소고기두부탕국', '잡곡밥'],
      western: ['단팥빵'],
      cupRice: null,
      dinner: { closed: false, menu: ['카레라이스'] },
    },
  ],
}

test('imageMimeType correctly recognizes PNG and JPEG and rejects invalid types', () => {
  assert.equal(imageMimeType(pngBytes), 'image/png')
  assert.equal(imageMimeType(jpegBytes), 'image/jpeg')
  assert.throws(() => imageMimeType(Buffer.from('not an image')), /Unsupported/)
})

test('buildPrompt includes date range and structural requirements', () => {
  const prompt = buildPrompt(weekStart, weekEnd)
  assert.ok(prompt.includes(weekStart))
  assert.ok(prompt.includes(weekEnd))
  assert.ok(prompt.includes('조식 한식'))
  assert.ok(prompt.includes('컵밥'))
  assert.ok(prompt.includes('석식'))
  assert.ok(prompt.includes('commonBreakfast'))
})

test('parseModelJson handles plain JSON, markdown fences, and text wraps', () => {
  const obj = { test: 123 }
  assert.deepEqual(parseModelJson('{"test": 123}'), obj)
  assert.deepEqual(parseModelJson('```json\n{"test": 123}\n```'), obj)
  assert.deepEqual(parseModelJson('```\n{"test": 123}\n```'), obj)
  assert.deepEqual(
    parseModelJson('Here is the JSON:\n{"test": 123}\nHope this helps!'),
    obj,
  )
  assert.throws(() => parseModelJson('not json at all'), /Failed to parse JSON/)
})

test('normalizeMenuDays produces schema-compliant days array and enforces all business rules', () => {
  const days = normalizeMenuDays(sampleModelOutput, weekStart)
  assert.equal(days.length, 7)

  // Dates match weekStart + index
  for (let i = 0; i < 7; i++) {
    assert.equal(days[i].date, addMealDays(weekStart, i))
  }

  // Monday: common breakfast and drink available
  assert.equal(days[0].breakfast.korean.status, 'available')
  assert.deepEqual(days[0].breakfast.korean.items, [
    '참치두부김치찌개',
    '쌀밥',
    '떡갈비조림',
  ])
  assert.equal(days[0].breakfast.common.status, 'available')
  assert.deepEqual(days[0].breakfast.common.items, [
    '그린샐러드 & 드레싱 & 셀프계란후라이',
  ])
  assert.equal(days[0].cupRice.status, 'unlisted')
  assert.equal(days[0].dinner.status, 'available')
  assert.equal(days[0].drink.status, 'available')
  assert.deepEqual(days[0].drink.items, ['디톡스워터'])

  // Tuesday: cup rice with time
  assert.equal(days[1].cupRice.status, 'available')
  assert.equal(days[1].cupRice.serviceTime, '11:40')
  assert.deepEqual(days[1].cupRice.items, ['새우까스덮밥&타르타르'])

  // Saturday: dinner closed, drink unlisted
  assert.equal(days[5].dinner.status, 'closed')
  assert.deepEqual(days[5].dinner.items, [])
  assert.equal(days[5].drink.status, 'unlisted')
  assert.deepEqual(days[5].drink.items, [])

  // Validate complete week using parseMealWeek
  const validated = parseMealWeek(
    {
      weekStart,
      weekEnd,
      source: {
        postId: '1',
        title: '9월 7일 ~ 9월 13일 식단',
        postUrl:
          'https://scc.sogang.ac.kr/front/cmsboardview.do?bbsConfigFK=1185&siteId=dormitory&pkid=1',
        imageUrl: null,
        imageSha256: 'a'.repeat(64),
      },
      pipelineId: 'b'.repeat(64),
      extractedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      days,
    },
    Date.now(),
  )
  assert.equal(validated.days.length, 7)
})

test('normalizeMenuDays rejects invalid day count', () => {
  assert.throws(
    () => normalizeMenuDays({ days: [] }, weekStart),
    /Expected 7 days/,
  )
  assert.throws(
    () => normalizeMenuDays({ days: [{}, {}] }, weekStart),
    /Expected 7 days/,
  )
})

test('callOpenRouter makes authenticated request with image data and retries transient failures with backoff', async () => {
  let callCount = 0
  const waits = []
  const fetcher = async (url, options) => {
    callCount++
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(options.headers.Authorization, 'Bearer test-key')
    const body = JSON.parse(options.body)
    assert.equal(body.model, DEFAULT_MODEL)
    assert.equal(body.messages[0].content[1].type, 'image_url')
    assert.ok(
      body.messages[0].content[1].image_url.url.startsWith(
        'data:image/png;base64,',
      ),
    )

    if (callCount === 1) {
      return new Response('server error', { status: 500 })
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(sampleModelOutput) } }],
    })
  }

  const result = await callOpenRouter({
    imageBytes: pngBytes,
    mimeType: 'image/png',
    weekStart,
    weekEnd,
    apiKey: 'test-key',
    fetcher,
    sleep: (ms) => {
      waits.push(ms)
    },
  })

  assert.equal(callCount, 2)
  assert.deepEqual(waits, [5000])
  assert.deepEqual(JSON.parse(result), sampleModelOutput)
})

test('callOpenRouter retries upstream throttling and honors Retry-After', async () => {
  let callCount = 0
  const waits = []
  const fetcher = async () => {
    callCount++
    if (callCount === 1) {
      return new Response(
        JSON.stringify({ error: { code: 124, message: 'Upstream Throttling' } }),
        { status: 429, headers: { 'Retry-After': '7' } },
      )
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(sampleModelOutput) } }],
    })
  }

  const result = await callOpenRouter({
    imageBytes: pngBytes,
    mimeType: 'image/png',
    weekStart,
    weekEnd,
    apiKey: 'test-key',
    fetcher,
    sleep: (ms) => {
      waits.push(ms)
    },
  })

  assert.equal(callCount, 2)
  assert.deepEqual(waits, [7000])
  assert.deepEqual(JSON.parse(result), sampleModelOutput)
})

test('callOpenRouter retries throttling carried in a 200 error payload', async () => {
  let callCount = 0
  const waits = []
  const fetcher = async () => {
    callCount++
    if (callCount === 1) {
      return Response.json({
        error: { code: 124, message: 'Upstream Throttling' },
      })
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(sampleModelOutput) } }],
    })
  }

  const result = await callOpenRouter({
    imageBytes: pngBytes,
    mimeType: 'image/png',
    weekStart,
    weekEnd,
    apiKey: 'test-key',
    fetcher,
    sleep: (ms) => {
      waits.push(ms)
    },
  })

  assert.equal(callCount, 2)
  assert.deepEqual(waits, [5000])
  assert.deepEqual(JSON.parse(result), sampleModelOutput)
})

test('callOpenRouter exhausts bounded retries on persistent throttling', async () => {
  let callCount = 0
  const waits = []
  const fetcher = async () => {
    callCount++
    return new Response(
      JSON.stringify({ error: { code: 124, message: 'Upstream Throttling' } }),
      { status: 429 },
    )
  }

  await assert.rejects(
    callOpenRouter({
      imageBytes: pngBytes,
      mimeType: 'image/png',
      weekStart,
      weekEnd,
      apiKey: 'test-key',
      fetcher,
      retries: 2,
      sleep: (ms) => {
        waits.push(ms)
      },
    }),
    /OpenRouter API error 429/,
  )
  assert.equal(callCount, 3)
  assert.deepEqual(waits, [5000, 10000])
})

test('callOpenRouter fails fast on non-retryable errors', async () => {
  let callCount = 0
  const waits = []
  const fetcher = async () => {
    callCount++
    return new Response(
      JSON.stringify({ error: { code: 401, message: 'Bad API key' } }),
      { status: 401 },
    )
  }

  await assert.rejects(
    callOpenRouter({
      imageBytes: pngBytes,
      mimeType: 'image/png',
      weekStart,
      weekEnd,
      apiKey: 'test-key',
      fetcher,
      sleep: (ms) => {
        waits.push(ms)
      },
    }),
    /OpenRouter API error 401/,
  )
  assert.equal(callCount, 1)
  assert.deepEqual(waits, [])
})

test('extractMeals orchestrates end-to-end extraction and writes valid results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-test-'))
  try {
    const pipelineId = 'c'.repeat(64)
    const imageSha256 = createHash('sha256').update(pngBytes).digest('hex')
    const manifest = {
      pipelineId,
      lastAttemptAt: new Date().toISOString(),
      baseline: null,
      errorCode: null,
      candidates: [
        {
          weekStart,
          weekEnd,
          source: {
            postId: '99',
            title: '9월 7일 ~ 9월 13일 식단',
            postUrl:
              'https://scc.sogang.ac.kr/front/cmsboardview.do?bbsConfigFK=1185&siteId=dormitory&pkid=99',
            imageUrl: null,
            imageSha256,
          },
          image: '99.image',
          reused: null,
        },
      ],
    }

    await writeFile(join(dir, 'prepared.json'), JSON.stringify(manifest))
    await writeFile(join(dir, '99.image'), pngBytes)

    const fetcher = async () =>
      Response.json({
        choices: [
          { message: { content: JSON.stringify(sampleModelOutput) } },
        ],
      })

    const results = await extractMeals(dir, {
      apiKey: 'dummy-key',
      fetcher,
    })

    assert.equal(results.length, 1)
    assert.equal(results[0].status, 'ok')
    assert.equal(results[0].postId, '99')
    assert.equal(results[0].imageSha256, imageSha256)
    assert.equal(results[0].pipelineId, pipelineId)

    const written = JSON.parse(
      await readFile(join(dir, 'ocr-results.json'), 'utf8'),
    )
    assert.equal(written.length, 1)
    assert.equal(written[0].status, 'ok')

    // Verify assembleMeals can successfully assemble this result!
    const feed = assembleMeals(manifest, written, pipelineId)
    assert.equal(feed.collectionStatus, 'ok')
    assert.equal(feed.weeks.length, 1)
    assert.equal(feed.weeks[0].days.length, 7)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('extractMeals rejects on model failure without crashing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-fail-test-'))
  try {
    const pipelineId = 'd'.repeat(64)
    const imageSha256 = createHash('sha256').update(pngBytes).digest('hex')
    const manifest = {
      pipelineId,
      lastAttemptAt: new Date().toISOString(),
      baseline: null,
      errorCode: null,
      candidates: [
        {
          weekStart,
          weekEnd,
          source: {
            postId: '100',
            title: '9월 7일 ~ 9월 13일 식단',
            postUrl:
              'https://scc.sogang.ac.kr/front/cmsboardview.do?bbsConfigFK=1185&siteId=dormitory&pkid=100',
            imageUrl: null,
            imageSha256,
          },
          image: '100.image',
          reused: null,
        },
      ],
    }

    await writeFile(join(dir, 'prepared.json'), JSON.stringify(manifest))
    await writeFile(join(dir, '100.image'), pngBytes)

    // Return completely invalid model content
    const fetcher = async () =>
      Response.json({
        choices: [{ message: { content: 'Sorry, I cannot read this image.' } }],
      })

    const results = await extractMeals(dir, {
      apiKey: 'dummy-key',
      fetcher,
    })

    assert.equal(results.length, 1)
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[0].errorCode, 'ocr-quality')
    assert.equal(results[0].postId, '100')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('extractMeals spaces OpenRouter requests across candidates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-gap-test-'))
  try {
    const pipelineId = 'f'.repeat(64)
    const imageSha256 = createHash('sha256').update(pngBytes).digest('hex')
    const candidate = (postId) => ({
      weekStart,
      weekEnd,
      source: {
        postId,
        title: '9월 7일 ~ 9월 13일 식단',
        postUrl: `https://scc.sogang.ac.kr/front/cmsboardview.do?bbsConfigFK=1185&siteId=dormitory&pkid=${postId}`,
        imageUrl: null,
        imageSha256,
      },
      image: `${postId}.image`,
      reused: null,
    })
    const manifest = {
      pipelineId,
      lastAttemptAt: new Date().toISOString(),
      baseline: null,
      errorCode: null,
      candidates: [candidate('101'), candidate('102')],
    }

    await writeFile(join(dir, 'prepared.json'), JSON.stringify(manifest))
    await writeFile(join(dir, '101.image'), pngBytes)
    await writeFile(join(dir, '102.image'), pngBytes)

    let callCount = 0
    const waits = []
    const fetcher = async () => {
      callCount++
      return Response.json({
        choices: [{ message: { content: JSON.stringify(sampleModelOutput) } }],
      })
    }

    const results = await extractMeals(dir, {
      apiKey: 'dummy-key',
      fetcher,
      requestGapMs: 1234,
      sleep: (ms) => {
        waits.push(ms)
      },
    })

    assert.equal(callCount, 2)
    assert.deepEqual(waits, [1234])
    assert.deepEqual(
      results.map((result) => result.status),
      ['ok', 'ok'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('extractMeals requires API key when extraction is needed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-key-test-'))
  try {
    const pipelineId = 'e'.repeat(64)
    const manifest = {
      pipelineId,
      lastAttemptAt: new Date().toISOString(),
      baseline: null,
      errorCode: null,
      candidates: [
        {
          weekStart,
          weekEnd,
          source: { postId: '1' },
          image: '1.image',
          reused: null,
        },
      ],
    }

    await writeFile(join(dir, 'prepared.json'), JSON.stringify(manifest))

    await assert.rejects(
      extractMeals(dir, { apiKey: undefined }),
      /Missing OPENROUTER_API_KEY/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
