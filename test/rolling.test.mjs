import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sources, feedUrl, boardUrl } from '../sources.mjs'
import { batches, validateBatches, selectBatch } from '../batches.mjs'
import { collect, sourceUrl } from '../collect.mjs'
import { healthy } from './responses.mjs'

const options = { spacingMs: 0, summaryFile: null }
function baseline(age = 12 * 60 * 60 * 1000) {
  const stamp = new Date(Date.now() - age).toISOString()
  return new Map(sources.map(source => [source.id, {
    schemaVersion: 2, sourceId: source.id, collectionStatus: 'ok', fetchedAt: stamp, lastAttemptAt: stamp,
    notices: [{ title: `Retained ${source.id}`, url: `https://example.org/${source.id}`, publishedDate: '2026-09-01' }],
  }]))
}
const recoveryId = url => sources.find(source => feedUrl(source) === url)?.id
const sourceId = url => url === sourceUrl ? 'sogang-academic' : sources.find(source => boardUrl(source) === url)?.id
async function bytes(directory) {
  return Promise.all(sources.map(source => readFile(join(directory, 'feeds', `${source.id}.json`), 'utf8')))
}

test('six stable batches cover the complete catalog with balanced request estimates', () => {
  validateBatches()
  assert.deepEqual(batches.map(batch => batch.reduce((sum, [, cost]) => sum + cost, 0)), [18, 17, 18, 17, 18, 17])
  assert.deepEqual(batches.map(batch => batch.map(([id]) => id)), [
    ['ee-academic', 'cs-news', 'eng-research', 'me-general', 'me-events', 'aibased-news', 'se-graduate'],
    ['sse-notices', 'ai-academic', 'eng-general', 'computing-notices', 'me-academic', 'se-notices'],
    ['ee-general', 'cs-graduate', 'ai-general', 'ee-seminars', 'eng-careers', 'me-alumni', 'se-careers'],
    ['ee-employment', 'cs-general', 'ai-careers', 'ee-recruit', 'me-research', 'se-news'],
    ['sse-news', 'cs-careers', 'aibased-notices', 'ee-news', 'me-awards', 'sogang-academic', 'eng-academic', 'se-industry'],
    ['cs-main', 'cs-undergraduate', 'ai-news', 'eng-newsletter', 'computing-news', 'me-careers', 'sse-seminars'],
  ])
  assert.throws(() => validateBatches([...sources, { id: 'future-board' }]), /Every source/)
  assert.throws(() => validateBatches(sources.slice(1)), /membership/)
})

test('six completed rolling runs refresh every batch once and publish all carried feeds unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rolling-feeds-'))
  try {
    let previous = baseline()
    for (let index = 0; index < 6; index++) {
      const selected = batches[index].map(([id]) => id)
      const github = [], university = []
      const feeds = await collect(directory, async url => {
        const id = recoveryId(url)
        if (id) { github.push(id); return Response.json(previous.get(id)) }
        assert.equal(github.length, sources.length, 'Read every validated prior feed before contacting Sogang.')
        university.push(sourceId(url))
        return healthy(url)
      }, options)
      assert.deepEqual(github.toSorted(), sources.map(source => source.id).toSorted())
      assert.deepEqual(university.toSorted(), selected.toSorted())
      assert.deepEqual((await readdir(join(directory, 'feeds'))).toSorted(), sources.map(source => `${source.id}.json`).toSorted())
      for (const feed of feeds) {
        if (!selected.includes(feed.sourceId)) assert.deepEqual(feed, previous.get(feed.sourceId))
        else assert.ok(feed.lastAttemptAt > previous.get(feed.sourceId).lastAttemptAt)
      }
      assert.deepEqual((await bytes(directory)).map(value => JSON.parse(value)), feeds)
      previous = new Map(feeds.map(feed => [feed.sourceId, feed]))
    }
    assert.equal(selectBatch(previous), 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('missed runs select the oldest attempted batch, not the wall-clock hour or oldest success', () => {
  const previous = baseline()
  for (const [id] of batches[3]) {
    previous.get(id).fetchedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    previous.get(id).lastAttemptAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  }
  assert.equal(selectBatch(previous), 3)
  for (const [id] of batches[3]) {
    previous.get(id).collectionStatus = 'error'
    previous.get(id).lastAttemptAt = new Date().toISOString()
  }
  assert.equal(selectBatch(previous), 0, 'A failing batch must not starve the others.')
})

test('invalid or unavailable carry-forward blocks all university requests and preserves the complete old output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rolling-invalid-'))
  try {
    const previous = baseline()
    await collect(directory, async url => recoveryId(url) ? Response.json(previous.get(recoveryId(url))) : healthy(url), options)
    const before = await bytes(directory)
    const source = sources.at(-1)
    for (const broken of [
      () => new Response('', { status: 404 }),
      () => new Response('', { status: 503 }),
      () => Response.json({ ...previous.get(source.id), sourceId: 'cs-main' }),
      () => Response.json({ ...previous.get(source.id), fetchedAt: '2999-01-01T00:00:00.000Z' }),
      () => Response.json({ ...previous.get(source.id), schemaVersion: 1 }),
      () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
      () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    ]) {
      let university = 0
      await assert.rejects(collect(directory, async url => {
        if (url === feedUrl(source)) return broken()
        const id = recoveryId(url)
        if (id) return Response.json(previous.get(id))
        university++
        return healthy(url)
      }, options), /valid published feed/)
      assert.equal(university, 0)
      assert.deepEqual(await bytes(directory), before)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rolling failures reuse the validated baseline and summaries distinguish held errors and stale successes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rolling-failure-'))
  try {
    const previous = baseline(48 * 60 * 60 * 1000)
    previous.get('cs-main').collectionStatus = 'error' // Batch 6 is carried, not attempted.
    const summaryFile = join(directory, 'summary.md')
    let github = 0
    const feeds = await collect(directory, async url => {
      const id = recoveryId(url)
      if (id) { github++; return Response.json(previous.get(id)) }
      return new Response('Unavailable', { status: 503 })
    }, { ...options, summaryFile })
    assert.equal(github, 41, 'Recovery must reuse the already validated baseline.')
    for (const feed of feeds) {
      const before = previous.get(feed.sourceId)
      if (batches[0].some(([id]) => id === feed.sourceId)) {
        assert.equal(feed.collectionStatus, 'error')
        assert.equal(feed.fetchedAt, before.fetchedAt)
        assert.deepEqual(feed.notices, before.notices)
        assert.ok(feed.lastAttemptAt > before.lastAttemptAt)
      } else assert.deepEqual(feed, before)
    }
    assert.equal(selectBatch(new Map(feeds.map(feed => [feed.sourceId, feed]))), 1)
    const summary = await readFile(summaryFile, 'utf8')
    assert.match(summary, /Batch 1\/6/)
    assert.match(summary, /41 feeds without a successful fetch within 24 hours/)
    assert.match(summary, /cs-main: carried \(previous attempt failed\)/)
    assert.match(summary, /ee-academic: FAILED, retained last good data/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('carry-forward and university collection retain the two-request concurrency bound', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rolling-concurrency-'))
  try {
    const previous = baseline()
    const active = { github: 0, university: 0 }, maximum = { github: 0, university: 0 }
    await collect(directory, async url => {
      const id = recoveryId(url)
      const kind = id ? 'github' : 'university'
      active[kind]++
      maximum[kind] = Math.max(maximum[kind], active[kind])
      await setImmediate()
      active[kind]--
      return id ? Response.json(previous.get(id)) : healthy(url)
    }, options)
    assert.deepEqual(maximum, { github: 2, university: 2 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('workflow uses hourly minute-17 runs and a safely passed explicit full-refresh choice', async () => {
  const yaml = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  assert.match(yaml, /cron: '17 \* \* \* \*'/)
  assert.match(yaml, /default: rolling/)
  assert.match(yaml, /options: \[rolling, full\]/)
  assert.match(yaml, /COLLECTION_MODE: \$\{\{ inputs\.mode \|\| 'rolling' \}\}/)
  assert.match(yaml, /run: npm run meals:prepare -- "--notice-mode=\$COLLECTION_MODE" "--meal-mode=\$MEAL_MODE"/)
  assert.match(yaml, /cancel-in-progress: false/)
  assert.match(yaml, /path: meal-site/)
  const directory = await mkdtemp(join(tmpdir(), 'rolling-cli-'))
  try {
    for (const args of [['--mode=invalid'], ['--mode=full', '--unknown']]) {
      assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../collect.mjs', import.meta.url)), ...args], { cwd: directory, stdio: 'pipe' }), error => {
        assert.match(error.stderr.toString(), /Usage:/)
        return error.status === 1
      })
    }
    assert.deepEqual(await readdir(directory), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('only explicit full mode bootstraps without published feeds, and invalid options fail before I/O', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rolling-bootstrap-'))
  try {
    const calls = []
    const feeds = await collect(directory, async url => { calls.push(url); return healthy(url) }, { ...options, mode: 'full' })
    assert.equal(feeds.length, 41)
    assert.equal(calls.length, 41)
    assert.ok(calls.every(url => !recoveryId(url)))
    for (const invalid of [{ mode: 'automatic' }, { spacingMs: -1 }, { spacingMs: NaN }]) {
      await assert.rejects(collect(directory, () => { throw new Error('Must not fetch') }, { ...options, ...invalid }), /mode|spacing/)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
