import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMealWeek } from '../../meal/schema.mjs'
import { assembleMeals, recoverMeals } from '../../meal/publish.mjs'
import reviews from '../../meal/reviewed.json' with { type: 'json' }

const id = 'a'.repeat(64)
const verifiedAt = '2026-09-14T13:00:00.000Z'
const now = Date.parse(verifiedAt)
function input() {
  const review = reviews[0]
  const week = parseMealWeek(
    { ...review, pipelineId: id, extractedAt: review.reviewedAt, verifiedAt },
    now,
  )
  return {
    pipelineId: id,
    lastAttemptAt: verifiedAt,
    baseline: null,
    errorCode: null,
    candidates: [
      {
        weekStart: review.weekStart,
        weekEnd: review.weekEnd,
        source: structuredClone(review.source),
        image: `${review.source.postId}.image`,
        reused: week,
      },
    ],
  }
}

test('reviewed September 14-20 menu preserves actual dishes, blank cup-rice cells and Saturday closure', () => {
  assert.equal(
    new Set(reviews.map((review) => review.source.imageSha256)).size,
    reviews.length,
  )
  const result = assembleMeals(input(), [], id, now)
  assert.equal(result.collectionStatus, 'ok')
  assert.equal(result.errorCode, null)
  const week = result.weeks[0]
  assert.equal(week.source.postId, '940528')
  assert.equal(
    week.source.imageSha256,
    '31a745b1e1e63efb0dbfe491313ed163738f3c9021bee4d4cdad3dcc74cb8da0',
  )
  assert.deepEqual(
    week.days.map((day) => day.date),
    [
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ],
  )
  assert.deepEqual(week.days[0].breakfast.korean.items, [
    '참치두부김치찌개',
    '쌀밥',
    '떡갈비조림',
    '메추리알조림',
    '도시락김구이',
    '열무김치',
    '바나나/우유',
  ])
  assert.deepEqual(week.days[0].dinner.items, [
    '소고기볶음밥',
    '맑은우동국물',
    '스프링롤&스윗칠리소스',
    '단무지',
    '열무김치',
    '마카로니샐러드',
  ])
  assert.deepEqual(
    week.days.map((day) => day.breakfast.korean.items[0]),
    [
      '참치두부김치찌개',
      '흑미건강닭죽',
      '고추장불고기',
      '사골우거지국',
      '가자미구이',
      '닭곰탕&당면사리',
      '소고기두부탕국',
    ],
  )
  assert.deepEqual(
    week.days.map((day) => day.breakfast.western.items[0]),
    [
      '이천쌀크림빵',
      '호두바게트&버터',
      '갈릭스윗치즈피자',
      '못난이감자츠지빵',
      '유자파이',
      '토스트빵&버터&딸기잼',
      '단팥빵',
    ],
  )
  assert.deepEqual(week.days[1].cupRice, {
    status: 'available',
    items: ['새우까스덮밥&타르타르'],
    serviceTime: '11:40',
  })
  assert.ok(
    week.days
      .filter((_, index) => index !== 1)
      .every((day) => day.cupRice.status === 'unlisted'),
  )
  assert.equal(week.days[4].dinner.items[0], '놀부부대찌개')
  assert.equal(week.days[5].dinner.status, 'closed')
  assert.equal(week.days[5].drink.status, 'unlisted')
  assert.equal(week.days[6].dinner.items[0], '전주비빔밥&후라이')
  assert.ok(
    week.days.every(
      (day) =>
        day.breakfast.common.items[0] ===
        '그린샐러드 & 드레싱 & 셀프계란후라이',
    ),
  )
  assert.ok(!JSON.stringify(result).includes('reviewNote'))
  assert.ok(!JSON.stringify(result).includes('Kcal'))
})

test('review cannot be attached to changed bytes, posts, URLs, titles, periods or tampered dishes', () => {
  for (const change of [
    (candidate) => {
      candidate.source.imageSha256 = 'b'.repeat(64)
    },
    (candidate) => {
      candidate.source.postId = '940529'
      candidate.image = '940529.image'
    },
    (candidate) => {
      candidate.source.title = '2026년 9월 14일 ~ 9월 20일 식단'
    },
    (candidate) => {
      candidate.source.postUrl += '&currentPage=1'
    },
    (candidate) => {
      candidate.source.imageUrl = candidate.source.imageUrl.replace(
        '.jpg',
        '.png',
      )
    },
    (candidate) => {
      candidate.weekStart = '2026-09-21'
      candidate.weekEnd = '2026-09-27'
    },
    (candidate) => {
      candidate.reused.days[0].dinner.items = ['Unreviewed replacement']
    },
    (candidate) => {
      candidate.reused.extractedAt = verifiedAt
    },
  ]) {
    const manifest = input()
    change(manifest.candidates[0])
    assert.throws(() => assembleMeals(manifest, [], id, now))
  }
  assert.throws(() => assembleMeals(input(), [], 'c'.repeat(64), now))
})

test('ordinary baseline reuse cannot launder a reviewed image onto a different source', () => {
  const manifest = input()
  manifest.baseline = assembleMeals(manifest, [], id, now)
  const candidate = manifest.candidates[0]
  candidate.source.title = '2026년 9월 14일 ~ 9월 20일 식단'
  candidate.reused.source.title = candidate.source.title
  assert.throws(() => assembleMeals(manifest, [], id, now))
})

test('source rechecks advance verification, not the review time; failure retains dated reviewed meals', (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-14T14:00:00.000Z'),
  })
  const manifest = input()
  const initial = assembleMeals(manifest, [], id, now)
  const later = '2026-09-14T14:00:00.000Z'
  manifest.lastAttemptAt = later
  manifest.candidates[0].reused.verifiedAt = later
  const rechecked = assembleMeals(manifest, [], id, Date.parse(later))
  assert.equal(rechecked.weeks[0].extractedAt, initial.weeks[0].extractedAt)
  assert.equal(rechecked.weeks[0].verifiedAt, later)
  const failure = recoverMeals(rechecked, 'date-mismatch', later)
  assert.deepEqual(failure.weeks, rechecked.weeks)
  assert.equal(failure.collectionStatus, 'error')
})
