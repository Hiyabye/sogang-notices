import { sources } from './sources.mjs'

// Stable membership, with estimated university list requests per board.
// Estimates include observed pins/small boards, not GitHub carry-forward reads.
// Assign additions deliberately; never reshuffle existing boards at runtime.
export const batches = [
  [['ee-academic', 5], ['cs-news', 3], ['eng-research', 3], ['me-general', 3], ['me-events', 2], ['aibased-news', 1], ['se-graduate', 1]],
  [['sse-notices', 5], ['ai-academic', 3], ['eng-general', 3], ['computing-notices', 2], ['me-academic', 2], ['se-notices', 2]],
  [['ee-general', 4], ['cs-graduate', 3], ['ai-general', 3], ['ee-seminars', 3], ['eng-careers', 2], ['me-alumni', 2], ['se-careers', 1]],
  [['ee-employment', 4], ['cs-general', 3], ['ai-careers', 3], ['ee-recruit', 3], ['me-research', 2], ['se-news', 2]],
  [['sse-news', 4], ['cs-careers', 3], ['aibased-notices', 3], ['ee-news', 3], ['me-awards', 2], ['sogang-academic', 1], ['eng-academic', 1], ['se-industry', 1]],
  [['cs-main', 3], ['cs-undergraduate', 3], ['ai-news', 3], ['eng-newsletter', 3], ['computing-news', 2], ['me-careers', 2], ['sse-seminars', 1]],
]

export function validateBatches(catalog = sources) {
  const ids = new Set()
  if (batches.length !== 6 || batches.some(batch => !batch.length)) throw new Error('Six nonempty batches are required.')
  for (const [id, estimate] of batches.flat()) {
    if (ids.has(id) || !catalog.some(source => source.id === id) || !Number.isSafeInteger(estimate) || estimate < 1) throw new Error('Invalid batch membership or request estimate.')
    ids.add(id)
  }
  if (catalog.length !== ids.size || catalog.some(source => !ids.has(source.id))) throw new Error('Every source must belong to exactly one batch.')
}

export function selectBatch(previous) {
  // A completed batch updates every attempt, including recovered failures.
  // Using attempts rather than successes prevents an unavailable board starving others.
  // The latest member attempt represents the batch; ties retain the fixed batch order.
  const attempts = batches.map(batch => Math.max(...batch.map(([id]) => Date.parse(previous.get(id).lastAttemptAt))))
  return attempts.indexOf(Math.min(...attempts))
}
