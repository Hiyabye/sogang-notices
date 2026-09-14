import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { paceRequests } from '../pacing.mjs'

// A synthetic monotonic clock keeps timing assertions exact, without sleeping.
test('request starts are globally spaced even across hosts and while prior requests remain in flight', async () => {
  let clock = 0
  const starts = [], releases = [], waits = []
  const fetcher = paceRequests((url, options) => {
    starts.push([clock, url, options])
    return new Promise(resolve => releases.push(resolve))
  }, 1000, () => clock, async delay => { waits.push(delay); clock += delay })
  const options = { credentials: 'omit' }
  const pending = ['https://cs.sogang.ac.kr/', 'https://ee.sogang.ac.kr/', 'https://cs.sogang.ac.kr/next'].map(url => fetcher(url, options))
  await setImmediate()
  assert.deepEqual(starts.map(([time]) => time), [0, 1000, 2000])
  assert.deepEqual(waits, [1000, 1000])
  assert.ok(starts.every(([, , actual]) => actual === options))
  releases.forEach(resolve => resolve('done'))
  assert.deepEqual(await Promise.all(pending), ['done', 'done', 'done'])
})

test('an early timer wake cannot start the next request before its deadline', async () => {
  let clock = 0
  let early = true
  const starts = []
  const fetcher = paceRequests(() => { starts.push(clock) }, 1000, () => clock, async delay => {
    clock += early ? delay - 1 : delay
    early = false
  })
  await fetcher('first')
  await fetcher('second')
  assert.deepEqual(starts, [0, 1000])
})

test('network failures and cancelled starts do not poison later starts or cause extra fetches', async () => {
  let clock = 0
  const starts = []
  const fetcher = paceRequests(url => {
    starts.push([clock, url])
    if (url === 'failed') throw new Error('Network failure')
    if (url === 'async failure') return Promise.reject(new Error('Async network failure'))
    return 'ok'
  }, 1000, () => clock, async delay => { clock += delay })
  await assert.rejects(fetcher('failed'), /Network failure/)
  await assert.rejects(fetcher('cancelled', { signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.equal(await fetcher('healthy'), 'ok')
  assert.deepEqual(starts, [[0, 'failed'], [1000, 'healthy']])
  await assert.rejects(fetcher('async failure'), /Async network failure/)
  assert.equal(await fetcher('after failure'), 'ok')
  assert.deepEqual(starts.slice(2), [[2000, 'async failure'], [3000, 'after failure']])
  clock = 5000
  assert.equal(await fetcher('after idle'), 'ok')
  assert.deepEqual(starts.at(-1), [5000, 'after idle'])
})
