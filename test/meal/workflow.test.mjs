import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('one Pages publisher separates preparation, optional OCR, strict assembly and deployment credentials', async () => {
  const yaml = await readFile(
    new URL('../../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  )
  assert.match(yaml, /^permissions: \{\}$/m)
  assert.match(yaml, /group: pages\n  cancel-in-progress: false/)
  const names = ['prepare', 'ocr', 'assemble', 'deploy']
  const jobs = Object.fromEntries(
    names.map((name, index) => [
      name,
      yaml.slice(
        yaml.indexOf(`\n  ${name}:`),
        index === names.length - 1
          ? undefined
          : yaml.indexOf(`\n  ${names[index + 1]}:`),
      ),
    ]),
  )
  for (const name of names.slice(0, 3)) {
    assert.match(jobs[name], /contents: read/)
    assert.match(jobs[name], /persist-credentials: false/)
    assert.doesNotMatch(jobs[name], /pages: write|id-token: write|environment:/)
  }
  assert.match(jobs.ocr, /needs\.prepare\.outputs\.needsOcr == 'true'/)
  assert.match(jobs.ocr, /--require-hashes --only-binary=:all:/)
  // The colon-space in :all: needs a YAML block scalar, not an unquoted mapping value.
  assert.match(jobs.ocr, /run: >-\n\s+python -m pip install/)
  assert.match(jobs.ocr, /timeout 300s python ocr\/run_bellarmine.py/)
  assert.match(
    jobs.assemble,
    /always\(\) && needs\.prepare\.result == 'success'/,
  )
  assert.match(
    jobs.assemble,
    /needs\.prepare\.outputs\.needsOcr == 'true' && needs\.ocr\.result == 'success'/,
  )
  assert.match(
    jobs.assemble,
    /needs\.prepare\.outputs\.needsOcr == 'false' && needs\.ocr\.result == 'skipped'/,
  )
  assert.match(jobs.deploy, /needs: assemble/)
  assert.match(
    jobs.deploy,
    /if: \$\{\{ !cancelled\(\) && needs\.assemble\.result == 'success' \}\}/,
  )
  assert.match(jobs.deploy, /pages: write\n      id-token: write/)
  assert.match(jobs.deploy, /name: github-pages/)
  assert.doesNotMatch(jobs.deploy, /checkout|setup-node|setup-python|run:/)
  assert.doesNotMatch(
    yaml,
    /continue-on-error|run-id:|github-token:|pull_request_target|workflow_run/,
  )
  for (const line of yaml.split('\n').filter((line) => line.includes('uses:')))
    assert.match(line, /uses: actions\/[a-z-]+@[a-f0-9]{40}(?:\s|$)/)
  for (const line of yaml.split('\n').filter((line) => /\brun:/.test(line)))
    assert.ok(!line.includes('${{'))
})
