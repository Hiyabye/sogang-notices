import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  mkdtemp,
  rename,
  rm,
  appendFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { collect } from '../collect.mjs'
import { sources } from '../sources.mjs'
import { validateFeed } from '../feed.mjs'
import {
  parseMealFeed,
  parseMealWeek,
  mealFeedUrl,
  maxMealBytes,
} from './schema.mjs'
import { discoverMeals, requestBytes, MealSourceError } from './bellarmine.mjs'

const root = new URL('../', import.meta.url)
const errorCodes = ['source', 'date-mismatch', 'layout', 'ocr-quality']
export async function pipelineId() {
  const hash = createHash('sha256')
  for (const name of [
    'ocr/extract_bellarmine.py',
    'ocr/run_bellarmine.py',
    'ocr/requirements.lock',
    'ocr/models.json',
    'meal/schema.mjs',
    'meal/bellarmine.mjs',
    'meal/publish.mjs',
  ]) {
    hash
      .update(name)
      .update('\0')
      .update(
        createHash('sha256')
          .update(await readFile(new URL(name, root)))
          .digest(),
      )
  }
  return hash.digest('hex')
}
export function recoverMeals(baseline, code, attemptedAt) {
  if (!errorCodes.includes(code))
    throw new Error('Unknown meal failure category.')
  return parseMealFeed(
    baseline?.weeks.length
      ? {
          ...baseline,
          collectionStatus: 'error',
          errorCode: code,
          lastAttemptAt: attemptedAt,
        }
      : {
          schemaVersion: 1,
          sourceId: 'bellarmine',
          timezone: 'Asia/Seoul',
          collectionStatus: 'unavailable',
          errorCode: code,
          lastAttemptAt: attemptedAt,
          fetchedAt: null,
          weeks: [],
        },
  )
}
async function boundedJson(path, max = maxMealBytes) {
  const { open } = await import('node:fs/promises')
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(max + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
      )
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > max) throw new Error('Artifact exceeds byte limit.')
    return JSON.parse(buffer.subarray(0, length).toString('utf8'))
  } finally {
    await file.close()
  }
}
export async function prepare(
  work,
  {
    mealMode = 'rolling',
    noticeMode = 'rolling',
    fetcher = fetch,
    spacingMs = 1000,
    summaryFile = null,
    outputFile = null,
  } = {},
) {
  if (
    !['rolling', 'bootstrap'].includes(mealMode) ||
    !['rolling', 'full'].includes(noticeMode)
  )
    throw new Error('Invalid collection mode.')
  await mkdir(work, { recursive: true })
  if ((await readdir(work)).length)
    throw new Error(
      'Meal preparation requires an empty work directory; preserve or move the previous work aside.',
    )
  // Required meal baseline is checked before the notice collector contacts Sogang.
  const baseline =
    mealMode === 'bootstrap'
      ? null
      : parseMealFeed(
          JSON.parse(
            (
              await requestBytes(
                mealFeedUrl,
                'application/json',
                maxMealBytes,
                fetcher,
              )
            ).toString('utf8'),
          ),
        )
  await collect(join(work, 'site'), fetcher, {
    mode: noticeMode,
    spacingMs,
    summaryFile,
  })
  await delay(spacingMs)
  const id = await pipelineId()
  let candidates = []
  let errorCode = null
  try {
    candidates = await discoverMeals(fetcher, Date.now(), spacingMs)
  } catch (error) {
    if (!(error instanceof MealSourceError)) throw error
    errorCode = error.code
  }
  const lastAttemptAt = new Date().toISOString()
  const inputs = []
  for (const candidate of candidates) {
    const reusable = baseline?.weeks.find(
      (week) =>
        week.source.imageSha256 === candidate.source.imageSha256 &&
        week.pipelineId === id &&
        week.weekStart === candidate.weekStart &&
        week.weekEnd === candidate.weekEnd,
    )
    const { bytes, ...metadata } = candidate
    const image = `${candidate.source.postId}.image`
    if (!reusable) await writeFile(join(work, image), bytes)
    inputs.push({
      ...metadata,
      image,
      reused: reusable
        ? { ...reusable, source: candidate.source, verifiedAt: lastAttemptAt }
        : null,
    })
  }
  const manifest = {
    pipelineId: id,
    lastAttemptAt,
    baseline,
    errorCode,
    candidates: inputs,
  }
  const encoded = JSON.stringify(manifest)
  if (Buffer.byteLength(encoded) > 3 * maxMealBytes)
    throw new Error('Preparation artifact exceeds limit.')
  await writeFile(join(work, 'prepared.json'), encoded)
  const needsOcr = inputs.some((candidate) => !candidate.reused)
  if (!needsOcr) await writeFile(join(work, 'ocr-results.json'), '[]')
  if (outputFile) await appendFile(outputFile, `needsOcr=${needsOcr}\n`)
  return manifest
}
export function assembleMeals(manifest, results, id, now = Date.now()) {
  if (
    !manifest ||
    manifest.pipelineId !== id ||
    !Array.isArray(manifest.candidates) ||
    manifest.candidates.length > 2 ||
    !Array.isArray(results)
  )
    throw new Error('Invalid prepared meal artifact.')
  const baseline =
    manifest.baseline === null ? null : parseMealFeed(manifest.baseline, now)
  if (manifest.errorCode !== null) {
    if (manifest.candidates.length || results.length)
      throw new Error('Partial source preparation is forbidden.')
    return recoverMeals(baseline, manifest.errorCode, manifest.lastAttemptAt)
  }
  if (
    !manifest.candidates.length ||
    results.length !==
      manifest.candidates.filter((candidate) => !candidate.reused).length
  )
    throw new Error('Missing or extra OCR results.')
  const weeks = []
  let failure = null
  for (const candidate of manifest.candidates) {
    if (
      !/^[1-9]\d{0,15}$/.test(candidate.source?.postId) ||
      candidate.image !== `${candidate.source.postId}.image`
    )
      throw new Error('Invalid prepared image identity.')
    if (candidate.reused) {
      const old = baseline?.weeks.find(
        (week) =>
          week.source.imageSha256 === candidate.source.imageSha256 &&
          week.pipelineId === id &&
          week.weekStart === candidate.weekStart &&
          week.weekEnd === candidate.weekEnd,
      )
      const reused = parseMealWeek(candidate.reused, now)
      if (
        !old ||
        JSON.stringify(reused) !==
          JSON.stringify(
            parseMealWeek(
              {
                ...old,
                source: candidate.source,
                verifiedAt: manifest.lastAttemptAt,
              },
              now,
            ),
          )
      )
        throw new Error('Invalid reused OCR result.')
      weeks.push(reused)
      continue
    }
    const matches = results.filter(
      (result) => result.postId === candidate.source.postId,
    )
    if (matches.length !== 1) throw new Error('OCR result identity mismatch.')
    const result = matches[0]
    if (
      result.imageSha256 !== candidate.source.imageSha256 ||
      result.pipelineId !== id
    )
      throw new Error('OCR image or pipeline mismatch.')
    if (result.status === 'rejected') {
      if (!errorCodes.includes(result.errorCode))
        throw new Error('Unknown OCR rejection.')
      failure ??= result.errorCode
    } else if (result.status === 'ok' && result.errorCode === null) {
      weeks.push(
        parseMealWeek(
          {
            ...candidate,
            source: candidate.source,
            pipelineId: id,
            extractedAt: result.extractedAt,
            verifiedAt: result.extractedAt,
            days: result.days,
          },
          now,
        ),
      )
    } else throw new Error('Invalid OCR result status.')
  }
  const attemptedAt = new Date(now).toISOString()
  if (failure) return recoverMeals(baseline, failure, attemptedAt)
  return parseMealFeed(
    {
      schemaVersion: 1,
      sourceId: 'bellarmine',
      timezone: 'Asia/Seoul',
      collectionStatus: 'ok',
      lastAttemptAt: attemptedAt,
      fetchedAt: weeks
        .map((week) => week.verifiedAt)
        .sort()
        .at(-1),
      errorCode: null,
      weeks,
    },
    now,
  )
}
export async function assemble(work, destination) {
  const manifest = await boundedJson(
    join(work, 'prepared.json'),
    3 * maxMealBytes,
  )
  const results = await boundedJson(join(work, 'ocr-results.json'))
  const feed = assembleMeals(manifest, results, await pipelineId())
  const files = await readdir(join(work, 'site/feeds'))
  const expected = sources.map((source) => `${source.id}.json`)
  if (
    files.length !== expected.length ||
    files.some((file) => !expected.includes(file))
  )
    throw new Error('Incomplete notice artifact.')
  const notices = []
  for (const source of sources)
    notices.push(
      validateFeed(
        await boundedJson(
          join(work, 'site/feeds', `${source.id}.json`),
          2 * 1024 * 1024,
        ),
        source,
      ),
    )
  const parent = resolve(destination, '..')
  await mkdir(parent, { recursive: true })
  const stage = await mkdtemp(join(parent, '.meal-site-'))
  try {
    await mkdir(join(stage, 'feeds'))
    await mkdir(join(stage, 'meals'))
    for (const notice of notices)
      await writeFile(
        join(stage, 'feeds', `${notice.sourceId}.json`),
        JSON.stringify(notice) + '\n',
      )
    const encoded = JSON.stringify(feed) + '\n'
    if (Buffer.byteLength(encoded) > maxMealBytes)
      throw new Error('Meal output exceeds byte limit.')
    await writeFile(join(stage, 'meals/bellarmine.json'), encoded)
    // A fresh destination avoids destroying prior local output if staging fails.
    await rename(stage, destination)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  return feed
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, ...args] = process.argv.slice(2)
  if (
    command === 'prepare' &&
    args.every((arg) =>
      /^--(?:meal-mode=(?:rolling|bootstrap)|notice-mode=(?:rolling|full))$/.test(
        arg,
      ),
    ) &&
    new Set(args.map((arg) => arg.split('=')[0])).size === args.length
  ) {
    const options = Object.fromEntries(
      args.map((arg) => {
        const [key, value] = arg.slice(2).split('=')
        return [key === 'meal-mode' ? 'mealMode' : 'noticeMode', value]
      }),
    )
    await prepare('work', {
      ...options,
      summaryFile: process.env.GITHUB_STEP_SUMMARY,
      outputFile: process.env.GITHUB_OUTPUT,
    })
  } else if (command === 'assemble' && !args.length)
    await assemble('work', 'meal-site')
  else
    throw new Error(
      'Usage: node meal/publish.mjs prepare [--meal-mode=rolling|bootstrap] [--notice-mode=rolling|full] | assemble',
    )
}
