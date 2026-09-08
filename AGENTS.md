# Sogang notices development guide

## Scope and conventions

- Keep this collector separate from [Rill](https://github.com/Hiyabye/Rill). It fetches public undergraduate academic notice metadata and publishes static JSON, not a backend for Rill.
- Use npm, the lockfile, native Node fetch/JSON APIs, and the built-in test runner. No runtime dependencies. Support Node 22.18+ on 22.x, or Node 24+; GitHub Actions uses Node 24.
- Use two-space indentation, single-quoted JavaScript strings, and semicolon-free style. Ask before adding dependencies, browser automation, other boards, full articles, or persistent services.
- `README.md` is for users and operators: feed behavior, local commands, publication, certificate provenance, and troubleshooting. This file owns development responsibilities, invariants, and verification.
- Preserve unrelated changes. Never manually edit the npm lockfile or generated `public/` output. Do not commit output, cookies, private keys, credentials, or private source data.
- Get explicit authorization for commits, pushes, deployment, or changes to live scheduling. Commit format: `label: concise title`, followed by a short explanatory body. No agent attribution.

## Responsibilities and data flow

`Sogang public JSON -> collect.mjs -> validated public/notices.json -> GitHub Pages -> Rill browser fetch`

- `collect.mjs`: `sourceUrl` selects the board; `buildFeed` validates and selects records without I/O; `collect` performs one bounded request and replaces output only after validation.
- `certificates/sectigo-ov-r36.pem`: verified public intermediate omitted by Sogang's TLS server. `package.json` supplies it only to `npm run collect` via `NODE_EXTRA_CA_CERTS`.
- `test/collect.test.mjs`: source validation, selection, failure handling, and output preservation using local responses and temporary directories.
- `test/fixtures/board-list.json`: reduced public metadata from a real response, preserving Korean text and pinned/regular ordering. Keep fixtures free of articles, attachments, credentials, and personal data.
- `test/certificate.test.mjs`: intermediate fingerprint, CA status, validity period, and signature against a root already trusted by Node.
- `.github/workflows/publish.yml`: tests, collection, then official Pages upload/deployment actions. Only ignored `public/` is published.

## Source and output contracts

- Board: `https://www.sogang.ac.kr/ko/academic-support/notices`. API: `/api/api/v1/mainKo/BbsData/boardList` on the same origin, with `pageNum=1`, `pageSize=50`, and `bbsConfigFk=2`; retain the complete request in `sourceUrl`.
- Validate status, complete first-page size, total, pagination flags, IDs, board identity, nonempty titles, dates, and `isTop` values. A confirmed zero-total empty board is valid; missing/truncated data or an HTML error page is not.
- The source places pins before regular notices. Validate descending registration dates within each group, deduplicate by `pkId`, sort both groups by `regDate` descending with descending ID as tie-breaker, and select five. Never just take the first five source rows.
- One 50-record request is intentionally bounded. If fewer than five distinct regular records remain while more pages exist, fail and investigate pagination rather than quietly returning a pin-dominated feed. Do not weaken this guard to make a job pass.
- `regDate` is a 14-digit calendar date/time without an established timezone. Use it for ordering and expose its `YYYY-MM-DD` date, not an invented UTC publication timestamp. Invalid or missing dates fail the complete fetch.
- Article URLs use the verified public detail path and query. Source `secret: "Y"` did not mean these notices required login when checked; do not infer access semantics or bypass controls based on that flag.
- Output: `{ schemaVersion: 1, fetchedAt: string, notices: { title: string, url: string, publishedDate: string }[] }`. At most five unique entries, newest first, safe public HTTPS links. `fetchedAt` is the successful fetch time in UTC, even when content is unchanged.
- The request times out after 20 seconds and rejects redirects/non-JSON responses. Validate everything before writing a temporary file and renaming it over `public/notices.json`. Never replace previous output after a failed fetch or validation.
- Schema, count, date, or URL changes affect Rill's `src/notices.ts` and its tests. Coordinate both repositories before publishing incompatible output; do not assume they deploy together.

## Development and verification

Run from the collector root:

```sh
npm ci
npm test          # Offline tests; no source requests or deployments
npm run collect   # One live source request; writes ignored public/notices.json
```

1. Read the relevant code, fixtures, callers, and Rill contract before editing.
2. For a bug, reproduce it through the collector or the closest safe fixture path first. Add a focused regression test without weakening existing checks.
3. Run `npm test`. After fetching/selection/TLS changes, run one safe live collection and inspect output. If live access is unavailable, report that separately from passing fixture tests.
4. For contract changes, run Rill's prescribed checks too. Its isolated E2E tests must not depend on live Sogang.
5. Before an authorized publication, review the diff and ensure only intended source files are staged. A manual workflow run is a real live fetch and deployment, not a dry run.
6. After publication, inspect JSON content type, CORS/cache headers, `fetchedAt`, and Firefox access from both local Rill and its actual deployed origin. A successful local collection does not prove the GitHub runner or browser path.

## TLS maintenance

The PEM contains a public CA certificate, not a private key or user credential. Its issuer, fingerprint, official download URL, and expiry are documented in README.md.

- Use `npm run collect`, not plain `node collect.mjs`, to apply the command-scoped intermediate. Do not change system trust or disable certificate/hostname verification.
- If the source changes issuer or the certificate expires, inspect the server chain, obtain the intermediate from its official issuer, and verify its signature against Node's existing trusted roots before replacing it. Update the fingerprint test and README provenance together.
- Do not add runtime certificate downloading or an insecure fallback. Remove the workaround only after a plain Node fetch verifies the complete server-supplied chain.

## Publishing and scheduling

- Public repository: `Hiyabye/sogang-notices`; live feed: `https://hiyabye.github.io/sogang-notices/notices.json`.
- Pages source is **GitHub Actions**. The workflow uses Node 24 on Ubuntu, `contents: read`, `pages: write`, `id-token: write`, the `github-pages` environment, and serialized Pages runs.
- Schedule: `0 */6 * * *` UTC, plus `workflow_dispatch`. This means 00:00/06:00/12:00/18:00 UTC or 03:00/09:00/15:00/21:00 KST. The live schedule uses the workflow on the default branch. Pushing code does not itself trigger publication.
- GitHub schedules are best-effort, especially at the start of an hour. Check Actions history for delayed, failed, or disabled runs; do not promise exact freshness or add blind retries.
- Tests and collection must pass before upload/deployment. Failures must leave the last published feed available. Rill flags it stale after 24 hours; the CDN's observed cache lifetime is ten minutes.
- Keep source requests modest and metadata-only. Robots guidance allowed crawling when checked; no notice-specific reuse license was established from the board's general copyright statement. Recheck guidance when expanding scope.

## Verification baseline

Initial live collection and six tests passed on Node 26.8.1 and 24.20.0 locally, and on Ubuntu 24.04 / Node 24.20.0 in [GitHub Actions](https://github.com/Hiyabye/sogang-notices/actions/runs/34239887756). The [first Pages deployment](https://github.com/Hiyabye/sogang-notices/actions/runs/34240766413) and Firefox 155.0 live integration also passed. These are historical checks, not guarantees of future availability or exact schedule execution.
