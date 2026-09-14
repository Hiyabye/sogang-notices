import { setTimeout as sleep } from 'node:timers/promises'

// Serialize starts, not whole requests. The collector still owns its two-board
// concurrency limit; a failed network request must not poison the pacing queue.
export function paceRequests(fetcher, spacingMs = 1000, now = () => performance.now(), wait = sleep) {
  if (!Number.isSafeInteger(spacingMs) || spacingMs < 0 || spacingMs > 10000) throw new Error('Request spacing must be 0-10000 milliseconds.')
  let nextStart = 0
  let queue = Promise.resolve()
  return async (url, options) => {
    let response
    const ready = queue.then(async () => {
      options?.signal?.throwIfAborted()
      while (nextStart > now()) await wait(Math.ceil(nextStart - now()))
      options?.signal?.throwIfAborted()
      nextStart = now() + spacingMs
      response = fetcher(url, options)
    })
    // Abort failures concern one request, not every later request's start gate.
    queue = ready.catch(() => {})
    await ready
    return response
  }
}
