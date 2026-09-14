// Generated from Rill by scripts/generate-meal-schema.mjs. Do not edit.

import { addMealDays } from '../../meal/schema.mjs'

export function makeMeals(
  start = '2026-09-07',
  verifiedAt = '2026-09-08T12:00:00.000Z',
)           {
  const blank = ()           => ({
    status: 'unlisted',
    items: [],
    serviceTime: null,
  })
  return {
    schemaVersion: 1,
    sourceId: 'bellarmine',
    timezone: 'Asia/Seoul',
    collectionStatus: 'ok',
    fetchedAt: verifiedAt,
    lastAttemptAt: verifiedAt,
    errorCode: null,
    weeks: [
      {
        weekStart: start,
        weekEnd: addMealDays(start, 6),
        pipelineId: 'a'.repeat(64),
        extractedAt: verifiedAt,
        verifiedAt,
        source: {
          postId: '1',
          title: '테스트 식단',
          postUrl:
            'https://scc.sogang.ac.kr/front/cmsboardview.do?bbsConfigFK=1185&siteId=dormitory&pkid=1',
          imageUrl: null,
          imageSha256: 'b'.repeat(64),
        },
        days: Array.from({ length: 7 }, (_, index) => ({
          date: addMealDays(start, index),
          breakfast: {
            korean: {
              status: 'available',
              items: ['쌀밥', '된장국'],
              serviceTime: null,
            },
            western: blank(),
            common: blank(),
          },
          cupRice:
            index === 1
              ? { status: 'available', items: ['컵밥'], serviceTime: '11:40' }
              : blank(),
          dinner:
            index === 5
              ? { status: 'closed', items: [], serviceTime: null }
              : { status: 'available', items: ['비빔밥'], serviceTime: null },
          drink: blank(),
        })),
      },
    ],
  }
}
