# Sogang notices development guide

## Scope and conventions

- Keep this collector separate from [Rill](https://github.com/Hiyabye/Rill). It publishes public notice-list metadata for the 13 boards in `sources.mjs`, not a runtime backend.
- Use npm, the lockfile, native Node fetch, and the built-in test runner. parse5 is the approved HTML parser; do not execute source JavaScript or add browser automation. Rill itself remains free of runtime dependencies.
- Support Node 22.18+ on 22.x, or Node 24+; GitHub Actions uses Node 24. Use two-space indentation, single-quoted JavaScript strings, and semicolon-free style.
- Ask before dependencies, other boards, articles, attachments, login-only material, or persistent services. No RSS, arbitrary URL registry, plugin framework, database, or custom recovery service.
- `README.md` is for users/operators: feed behavior, commands, publication, certificate provenance, and troubleshooting. This file owns engineering invariants and verification.
- Preserve unrelated changes. Never manually edit the lockfile or generated `public/`. Do not commit output, cookies, private keys, credentials, or private source data.
- Commits, pushes, deployment, and live scheduling changes require explicit authorization. Commit format is `label: concise title`, followed by a short body. No agent attribution.

## Responsibilities and data flow

`Main-site public JSON / department CMS HTML -> validated source selection -> per-board feeds -> staged public/feeds -> GitHub Pages -> Rill`

- `sources.mjs`: explicit source IDs, CMS site/board/host tuples, board pagination URLs, and fixed published recovery URLs. No user configuration.
- `collect.mjs`: main-site `buildFeed`, bounded request I/O, `collectSource`, two-source concurrency, recovery, final validation, staging, and workflow summary. Expected source failures use `SourceError`; programming and infrastructure faults propagate and stop publication.
- `cms.mjs`: parse5-based pure CMS list parsing and selection. Never execute scripts or fetch article content.
- `feed.mjs`: strict schema-2 recovery/final-output validation and the explicit source-failure error type. Do not catch final validation as recoverable source failure.
- `certificates/sectigo-ov-r36.pem`: verified public intermediate omitted by Sogang's TLS server. `package.json` supplies it only to `npm run collect` via `NODE_EXTRA_CA_CERTS`.
- `test/collect.test.mjs`: main-site validation, sampling, recovery/bootstrap, all-board output, and persistence failure checks with local responses/temp directories.
- `test/cms.test.mjs`, `test/fixtures/cms-list.html`, `test/fixtures/cms-empty.html`: full comment titles, pins, sparse lists, identity, ordering, malformed input, and incomplete sampling. Fixtures retain public list metadata and remove authors; no article bodies/attachments.
- `test/fixtures/board-list.json`: reduced main-site metadata with Korean titles and pinned/regular ordering.
- `test/certificate.test.mjs`: intermediate fingerprint, CA status, validity, and signature against a Node-trusted root.
- `.github/workflows/publish.yml`: tests, collection/staging, then official Pages upload/deployment. Only ignored `public/` is published.

## Source and output contracts

### Catalog and access

The 13 IDs must agree with Rill's `src/notice-sources.ts`. Group order: University-wide, Computer Science, AI, AI-Based Liberal Studies.

| Source ID | Site | Board | Host prefix |
| --- | --- | --- | --- |
| sogang-academic | main API | 2 | www |
| cs-main | cs | 1905 | cs |
| cs-undergraduate | cs | 1745 | cs |
| cs-graduate | cs | 1747 | cs |
| cs-general | cs | 1746 | cs |
| cs-careers | cs | 1748 | cs |
| cs-news | cs | 1749 | cs |
| ai-academic | ai | 5110 | ai |
| ai-news | ai | 5130 | ai |
| ai-general | ai | 6330 | ai |
| ai-careers | ai | 5131 | ai |
| aibased-notices | aibased | 7510 | scc |
| aibased-news | aibased | 7530 | scc |

- CMS list: `https://<host>.sogang.ac.kr/front/cmsboardlist.do?bbsConfigFK=<board>&siteId=<site>&currentPage=<page>`. Menu scripts and forms confirm these mappings. Board 7510 is labeled 공지사항 in Rill by owner decision, despite its page title 게시판.
- All 12 department boards returned server-rendered HTML during investigation. Inspected board/common scripts exposed no structured list API. Full regular titles are in anchor comments where visible text can be truncated. Pinned titles on AI news/careers are direct anchor text without comments; other pinned templates use comments. Treat these as observed explicit templates, not a generic fallback scraper.
- Parse HTML with parse5. Decode comment entities as RCDATA without interpreting title markup. Exclude the pin badge, authors, views, attachments, and scripts. Validate board/site hidden inputs, current page, page count, title link identity, dates, regular ordinal continuity, expected page size, and cross-page total consistency. A malformed/error page is never a successful empty source.
- CMS returns ten regular rows plus pins. Read up to three pages, or all pages if fewer. Require 30 distinct regular records while additional pages exist, validate within-group/cross-page date ordering, and fail rather than weakening sampling. Mix pins and regular rows by date descending, then descending ID; retain 30 unique entries. A confirmed empty first page uses the observed `li.nothing` message (`검색된 게시물이 없습니다.`) without paging controls. Require the expected board/site and reject unexpected nonempty search filters; absent/malformed list structure is an error.
- Canonical CMS links retain verified origin, `/front/cmsboardview.do`, `bbsConfigFK`, `siteId`, and `pkid`. Drop only list-navigation/search fields. Do not infer global `pkid` uniqueness, collapse different board records, or normalize host aliases without new evidence. Rill merges exact URLs only; similarly titled cross-posts with different IDs remain separate.

### Main university API

- Board: `https://www.sogang.ac.kr/ko/academic-support/notices`. API: `/api/api/v1/mainKo/BbsData/boardList` on that origin, `pageNum=1`, `pageSize=50`, `bbsConfigFk=2`; retain the complete `sourceUrl` query.
- Validate status, complete first-page size, total, pagination flags, IDs, board identity, nonempty titles, dates, and `isTop`. Confirmed zero-total empty is valid; missing/truncated data or HTML is not.
- Pins precede regular notices. Validate descending registration dates within each group, deduplicate by `pkId`, sort by `regDate` descending with descending ID ties, then select 30. Require at least 30 distinct regular rows while more pages exist. Do not just take the first 30 source rows.
- `regDate` is a 14-digit calendar date/time with no established timezone. Use it for selection and expose only its date. Invalid dates fail the source.
- Article URLs retain the verified public detail path/query. The previously observed `secret: "Y"` did not imply login-only notices; never bypass access controls based on that field.

### Feed and recovery

- Output path: `public/feeds/<source-id>.json`. Envelope: `{ schemaVersion: 2, sourceId, collectionStatus: 'ok' | 'error', lastAttemptAt, fetchedAt, notices: { title, url, publishedDate }[] }`.
- `fetchedAt` is last successful source fetch, not newest publication date. `lastAttemptAt` records the completed attempt, must not precede success, and changes on recovery. Both are canonical UTC ISO timestamps with milliseconds, at most five minutes ahead. Dates are valid `YYYY-MM-DD`; titles are nonempty and at most 2000 characters; entries are unique safe HTTP(S) links without credentials, newest first, at most 30. Strip unknown fields from recovery output.
- Each request has a 20-second timeout, a streamed 2 MiB body ceiling, expected JSON/HTML content type, no redirects/cookies/referrer, and cache revalidation. Collect two sources at a time, sequential pages per source. No blind retries or unbounded pagination.
- On an explicitly classified source failure, request that board's previous envelope from `https://hiyabye.github.io/sogang-notices/feeds/<id>.json`, validate it, preserve notices and successful timestamp, and set error status/new attempt time. Never publish raw exceptions or response bodies; diagnostics belong in logs.
- Missing, wrong-source, malformed, future-dated, or otherwise invalid required recovery stops the entire publication. Bootstrap therefore requires all 13 sources to succeed; never fabricate empty fallbacks. Healthy boards can publish with recovered failures only when every recovery is valid.
- Validate all feeds before writing a staged directory. Write failures stop publication. Rename the previous local feeds directory aside, replace it with the complete stage, and restore the old directory on replacement failure. Clean staged paths; do not describe this as crash-proof or CDN-transactional publication. Output/cleanup/workflow-summary failures must produce a failed command, never continue to upload.
- Emit source-specific recovered failures in `GITHUB_STEP_SUMMARY` even when publication is safe. GitHub Pages caching can return older valid recovery data despite revalidation; do not promise perfect last-version knowledge.
- Old schema-1 clients/backups are intentionally unsupported by v0.4. Producer and consumer deploy independently; coordinate tests and live verification before separately authorized publication.

## Development and verification

```sh
npm ci
npm test          # Offline, no source requests or deployment
npm run collect   # Live metadata collection into ignored public/feeds/
```

1. Inspect Git state separately in this repo and Rill. Read relevant source/callers/tests before editing.
2. Reproduce bugs through collection or the closest safe fixture path before editing. Add focused regression tests; never weaken validation to hide a source change.
3. Run `npm test`. After parser/selection/TLS changes, perform one safe live collection and inspect all output. Investigate failed boards rather than blindly retrying.
4. For contract changes, run Rill's `npm test` and `npm run build` too. Keep automated tests independent of deployed feeds and live Sogang.
5. Verify sparse/pin-heavy/empty sources, truncated pages, metadata conflicts, schema/source/date/URL rejection, preserved timestamps, missing/invalid recovery, bootstrap, and output failures. Tests do not prove every possible filesystem crash or remote upload failure.
6. Before an authorized publication, review the complete diff and staged files. After publication, verify all 13 URLs, JSON headers, CORS, timestamps, source IDs, and Firefox integration from local and deployed Rill. Local output and fixture interception do not prove deployment/CORS.

## TLS maintenance

- Use `npm run collect`, not plain `node collect.mjs`, to apply the command-scoped intermediate. Never change system trust or disable certificate/hostname checks. The existing certificate also allowed the inspected CMS requests with normal verification.
- The PEM is a public CA certificate, not a secret. README records provenance/fingerprint. If issuer changes or expiry approaches, inspect the chain, obtain the intermediate from the official issuer, verify against Node-trusted roots, and update tests/documentation together.
- No runtime certificate download or insecure fallback. Remove the workaround only after plain Node fetch verifies the server-supplied chain.

## Publishing and scheduling

- Public repository: `Hiyabye/sogang-notices`. Pages source is GitHub Actions, Node 24 on Ubuntu, `contents: read`, `pages: write`, `id-token: write`, `github-pages` environment, serialized runs.
- Preserve `0 */6 * * *` UTC plus manual dispatch. Scheduled starts are 00:00/06:00/12:00/18:00 UTC (03:00/09:00/15:00/21:00 KST), not guaranteed completion times. Pushing does not itself trigger publication, but the next scheduled run uses default-branch code.
- Tests, collection, recovery, and staging must all pass before upload/deployment. Any failure stops upload, retaining the previous published directory. Rill warns after 24 hours of source staleness; observed historical CDN lifetime is ten minutes.
- Source reuse licensing remains unestablished. Earlier main-site robots guidance allowed crawling; current CMS responses contain malformed server-template text or unavailable HTML. This is not reliable permission or a license. Limit collection to public list titles, dates, and links; recheck guidance before expansion.

## Verification baseline

Historical schema-1 collection, certificate tests, and deployment were verified on Node 26.8.1 and 24.20.0, including [initial CI](https://github.com/Hiyabye/sogang-notices/actions/runs/34239887756) and [first Pages deployment](https://github.com/Hiyabye/sogang-notices/actions/runs/34240766413). These do not prove the new schema-2 deployment, future source availability, or scheduled execution.

During v0.4 implementation, all 13 boards collected locally with normal TLS verification on Node 26.8.1: twelve feeds contained 30 entries and AI-Based Liberal Studies news contained seven. Canonical URLs for one retained article per board returned HTTP 200 to HEAD requests, without downloading article bodies. Rill validated and rendered all 367 locally collected entries in Firefox 155.0 using intercepted feed URLs; this is local producer/consumer integration, not deployed CORS verification. The final 12 collector tests passed and `npm audit` reported zero vulnerabilities. Rill's 12 unit tests, 79 Firefox tests, and production build also passed. This local evidence is separate from the subsequent authorized publication below.

On September 9, 2026, [schema-2 publication](https://github.com/Hiyabye/sogang-notices/actions/runs/34305920213) at `c188d12` passed 12 tests and collected all 13 sources with zero recovered failures on Node 24.20.0. All 13 live URLs returned HTTP 200, `application/json; charset=utf-8`, CORS `*`, and `max-age=600`, with valid identities/timestamps and only title/date/link notice fields. Firefox 155.0 rendered all 367 live notices from `http://127.0.0.1:4176/Rill/` (cross-origin) and `https://hiyabye.github.io/Rill/` (same-origin), without mocked responses. Subscription saving, all board filters, pagination, source status, reload persistence, and schema-2 export passed; light/dark desktop screenshots were reviewed. HTTP 304 on browser reload was normal cache revalidation, not a feed failure.

[Scheduled execution](https://github.com/Hiyabye/sogang-notices/actions/runs/34303916001) succeeded for the previous schema-1 revision. The schema-2 publication above was manual, so scheduled execution of that revision has not yet been observed. Source reuse permission and future source/CDN/scheduler availability remain unestablished; these successful checks do not guarantee them.
