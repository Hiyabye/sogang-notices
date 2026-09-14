# Sogang notices

A small collector for 41 public Sogang University notice boards, used by [Rill](https://hiyabye.github.io/Rill/): university academic notices, the College of Computing and its three departments, and the College of Engineering with Electronic, Mechanical, System Semiconductor and Semiconductor Engineering.

- **University source board:** https://www.sogang.ac.kr/ko/academic-support/notices
- **Computing college:** https://computing.sogang.ac.kr/computing/index.html
- **Engineering college:** https://eng.sogang.ac.kr/eng/index_new.html
- Dean's List, resource archives, galleries and unlisted departments are not collected.
- **Feed addresses:** `https://hiyabye.github.io/sogang-notices/feeds/<source-id>.json`
- **Board IDs and URLs:** see `sources.mjs` and [AGENTS.md](AGENTS.md). Published feeds may lag this catalog; new paths require a successful deployment. Local collection does not update them.
- **Workflow and run history:** https://github.com/Hiyabye/sogang-notices/actions/workflows/publish.yml

## What the feed contains

Each board feed contains up to 30 recent notices with list titles, publication dates, and source links. Pins and regular notices are ordered by source date, not pin position. Notice collection requests only list pages, not articles, attachments or login-only material. The separate Bellarmine meal path below has a narrow public menu-article/image exception. Summaries or article bodies bundled in a list response are ignored, and feeds contain no authors or images.

CMS comments supply full titles where available. Some new source lists shorten titles without supplying the full text; the feed preserves the available text rather than fetching articles. Electronic Engineering also emits one Korean job-title shape as unescaped markup; its exact literal text is safely retained. Other missing or malformed titles remain errors.

The main board uses public JSON. CMS, PHP community, Mechanical Engineering's server-rendered tables, and Semiconductor lists are parsed with parse5 without executing scripts. Collection samples 50 main-site records or enough source-specific pages to cover 30 regular records. Pins consume slots on some sites, so those sources allow at most six pages. Collection stops early at the board end. Counts, identities, ordering and pagination are validated; incomplete samples fail rather than publish a misleading list.

An attempted board that fails retains validated previously published data with an error status. Boards outside the selected batch are carried forward without changing their notices, status or timestamps. Every deployment contains all 41 feeds, never just the refreshed batch. A successful empty list is distinct from an unavailable source.

Rolling runs require a complete, valid published baseline. If any prior feed is missing, unavailable or invalid, the run stops before contacting Sogang and leaves the published site unchanged. It never silently falls back to a full crawl. An explicit full bootstrap/repair can rebuild the set; a failed board still needs valid published recovery data, so newly added boards must succeed on their first publication.

## Update times and freshness

Updates are scheduled **hourly at minute 17** (`17 * * * *`, UTC). Each run refreshes one of six stable batches, balanced at roughly 17-18 expected university list requests per batch rather than equal board counts. With normal hourly execution, each board is attempted about every six hours. Manual rolling and full-refresh runs are also available.

The least-recently attempted batch runs next, using the existing published attempt timestamps rather than the wall-clock hour. Missed runs therefore do not permanently skip a batch, and recovery resumes one batch at a time without a catch-up request spike. Failed attempts also advance that batch's turn so an unavailable board cannot starve the others. Successful freshness is not guaranteed during source or workflow outages; console output and the run summary flag feeds without a successful fetch in 24 hours.

These are scheduled start times, not guaranteed completion times. [GitHub Actions can delay or drop scheduled runs during high load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), particularly at the start of an hour, and can disable inactive public-repository schedules.

`fetchedAt` records the last successful source fetch. `lastAttemptAt` records the completed attempt; `collectionStatus: "error"` means retained data is being served after a source failure. Recovery never makes old data appear newly fetched.

Published feeds were observed with a ten-minute cache lifetime. Rill checks subscribed feeds hourly while visible and holds changed content behind **새 공지 반영**. It warns when displayed source data is more than 24 hours old. Always consult university boards for authoritative information.

## Bellarmine meal work

Bellarmine bootstrap was [published on September 14, 2026](https://github.com/Hiyabye/sogang-notices/actions/runs/34839647879), after the owner confirmed source-use permission. Linux installation, tests and OCR execution succeeded. **The published meal feed currently contains no dishes:** validation rejected the source's conflicting dates and published `unavailable` / `date-mismatch`. Successful real full-week extraction is still unverified. Existing `npm run collect` notice-only behavior and all 41 notice schemas are unchanged.

The single publication workflow now prepares notices and bounded meal inputs, conditionally runs isolated CPU OCR, validates/stages the whole site, then deploys on a separate credentialed runner. The meal path is `https://hiyabye.github.io/sogang-notices/meals/bellarmine.json`, independent schema 1. It contains up to two dated weeks, structured offerings and original-post provenance, not source images, contact information or raw OCR boxes. Cup rice is separate from dinner/breakfast, not an inferred daily lunch service.

Bad source dates, unknown layouts and uncertain/clipped extraction are rejected. A failed attempt preserves complete last-good weeks and their real verification/extraction times. Explicit first-time bootstrap can produce `unavailable` with no weeks; this is not an empty successful menu. An unavailable/corrupt required baseline stops subsequent rolling preparation before university requests. Unchanged validated image bytes plus the same pipeline fingerprint skip OCR; changed bytes or processing rules require it again.

After separate release approval, the **first meal publication must use `meal_mode: bootstrap`**. Use notice `mode: rolling` if all 41 published notice feeds already exist, or `full` only for intentional notice bootstrap/repair. Do not push this workflow expecting unattended rolling runs to initialize a missing meal baseline. Run/deployment scheduling and actual CORS still require live verification. See [ocr/README.md](ocr/README.md) for setup and unresolved source-image failures.

## Run locally

Use Node 22.18+ on the 22.x line, or Node 24+, with npm. The collection command uses POSIX shell syntax, supported on macOS and the Ubuntu workflow.

```sh
npm ci
npm test
npm run collect                      # One rolling batch, using published prior feeds
npm run collect -- --mode=full        # Explicit full bootstrap/repair
```

- `npm test` is offline and does not deploy or contact Sogang.
- `npm run collect` first downloads and validates all prior feeds from GitHub Pages, then refreshes only the oldest batch. GitHub reads do not contact the university. At most two boards are collected at once; university request starts are globally spaced by at least one second, even across hostnames. Both modes retain 20-second request timeouts, byte limits and bounded pagination.
- Both modes stage the complete 41-file set under `public/feeds/` only after validation succeeds. Carried feeds keep their original timestamps and error status. A local full run does not initialize the published baseline: its output must be published before rolling runs can use it.
- Local collection does **not** publish anything or change the feed Rill uses. Generated output is ignored by Git.

For the complete, explicitly initialized meal pipeline, after installing the isolated Python environment and pinned model assets described in `ocr/README.md`:

```sh
npm run meals:prepare -- --meal-mode=bootstrap --notice-mode=rolling
# Run only when prepared.json has candidates without a reused result:
.venv-ocr/bin/python ocr/run_bellarmine.py --work work --models ocr/models
npm run meals:assemble
```

Use `--meal-mode=rolling` after publication; bootstrap intentionally does not use a previous meal baseline. `work/` must be empty before preparation. Preserve or move old work aside rather than mixing runs. Preparation writes an empty OCR result file when no OCR is needed. Assembly revalidates the prepared data, source/image/pipeline identities and all 41 notice feeds, and creates a fresh `meal-site/` containing only `feeds/` and `meals/`. It refuses replacing an existing complete site. Move that output aside before another assembly. No source images, models or diagnostic crops belong in the Pages artifact. These commands do not deploy.

For architecture, source-field assumptions, testing requirements, and changes coordinated with Rill, see [AGENTS.md](AGENTS.md).

## Feed format

```json
{
  "schemaVersion": 2,
  "sourceId": "sogang-academic",
  "collectionStatus": "ok",
  "lastAttemptAt": "2026-09-08T12:00:00.000Z",
  "fetchedAt": "2026-09-08T12:00:00.000Z",
  "notices": [
    {
      "title": "Example notice",
      "url": "https://www.sogang.ac.kr/ko/detail/551152?bbsConfigFk=2",
      "publishedDate": "2026-09-04"
    }
  ]
}
```

This example illustrates the format, not the current live data. `notices` contains at most 30 unique entries, newest first. `publishedDate` is a source calendar date with no invented timezone; `fetchedAt` is a UTC timestamp.

Verified schema-2 response headers are `Content-Type: application/json; charset=utf-8`, `Access-Control-Allow-Origin: *`, and `Cache-Control: max-age=600`. No token is required to read the feed.

## Publish or inspect an update

Publish new collector paths before publishing the matching Rill catalog: clients cannot load unpublished feeds. The college additions retain feed schema 2 and all existing IDs. Older Rill versions do not recognize the new subscription IDs, so use an updated version when transferring backups containing them. Use explicit full mode for first publication or after adding boards. A clean bootstrap needs all 41 successful collections; existing boards may recover from valid prior feeds.

Pages uses **Settings > Pages > Build and deployment > Source > GitHub Actions**. The **Publish Sogang notices** workflow tests, collects, and deploys only the validated `meal-site/` output using GitHub's official Pages actions. Preparation, conditional OCR and assembly have read-only repository permissions; only the separate deploy job has Pages/OIDC write permissions. An OCR crash, timeout or installation failure blocks assembly rather than masquerading as a skipped/rejected source.

To publish immediately, open the workflow's **Run workflow** menu and select `main`. Choose **rolling** for one batch, or **full** for an intentional bootstrap/repair that contacts every board. The scheduled path always uses rolling mode. This performs a real source fetch and deployment. Inspect all steps, then check the live feed's `fetchedAt`. Failed tests, unrecoverable source failures, invalid output, or write failures stop publication. Recovered failures appear in the workflow summary even when publication succeeds.

Pushing a commit does not immediately publish a feed. The next scheduled run uses the latest code on the default branch, or you can run the workflow manually. Schedule changes take effect only after the workflow change is pushed to that branch. Deploying this repository does not deploy Rill.

## Why a certificate bundle is included

Some Sogang servers omit their issuer certificate. `npm run collect` supplies `certificates/sogang-intermediates.pem` through `NODE_EXTRA_CA_CERTS` for that command only. It contains the original Sectigo OV R36 intermediate and the GoGetSSL RSA DV SSL CA 2 intermediate required by 시스템반도체공학과.

**This bundle is safe to publish:** it contains two public CA certificates, not private keys, passwords, tokens or personal information. Both signatures are verified against a root already trusted by Node. Normal certificate and hostname verification remain enabled; system trust is unchanged.

Certificate provenance:

- Official issuer URL from the source certificate: http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt
- Subject: Sectigo Public Server Authentication CA OV R36
- Issuer: Sectigo Public Server Authentication Root R46, already trusted by Node
- Valid until: March 21, 2036, 23:59:59 UTC
- SHA-256: `65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30`

Additional GoGetSSL issuer provenance:

- Source leaf's advertised issuer URL: http://crt.sectigo.com/GoGetSSLRSADVSSLCA2.crt
- Subject: GoGetSSL RSA DV SSL CA 2; issuer: Sectigo Public Server Authentication Root R46.
- Valid until: August 19, 2035, 23:59:59 UTC.
- SHA-256: `B5:28:67:96:DA:DF:16:52:1D:E4:17:72:AB:2F:DB:58:18:72:99:71:B5:27:47:21:14:6C:6E:81:72:BE:FE:07`.
- The issuer server's HTTPS handshake failed; the advertised public HTTP download was accepted only after cryptographic verification against Node's trusted root. This is not a TLS bypass for source requests.

Tests verify both fingerprints, CA flags, signatures, validity periods, and the command-scoped bundle path. A future issuer change or expiry may require maintenance; never disable TLS verification to work around it.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Certificate verification fails | Use `npm run collect`, not plain `node collect.mjs`. If it still fails, inspect the source chain and follow the certificate maintenance instructions in AGENTS.md. |
| Unexpected response, ordering error, or too few regular notices | The source may have changed or pins may have crowded the first page. Inspect a fresh public response and update the collector with a regression test; do not bypass validation. |
| Feed time is old | Check Actions history and the stale-feed summary. Rolling runs resume the oldest attempted batch first, but cannot guarantee freshness during outages. Carried feeds correctly retain their old timestamps. |
| Rolling collection needs a valid published feed | Check GitHub Pages availability and the named feed first. For a genuinely missing/new or damaged baseline, explicitly run and publish full mode. Do not use a full crawl to hide a transient GitHub outage. |
| Local collection succeeds but the website is unchanged | Local output is not uploaded automatically. Check the deployment run, allow for the CDN cache, and reload Rill. |
| Rill reports unavailable but the feed opens directly | Inspect the browser's Network panel for the feed response, CORS, and JSON validation errors. A successful terminal request alone does not prove browser access. |

## Source guidance and limitations

On September 8, 2026, live `robots.txt` allowed crawling. The board footer carried a general copyright statement but no linked notice-specific usage terms; an explicit reuse license was not established. Robots guidance is not a content license. Notice publication stays limited to public titles, dates, and links, at most 30 per board. Bellarmine extraction/publication and image-fixture redistribution require their separate source-use review before release. Department robots responses contained malformed server-template text or unavailable HTML. The Computing and Engineering college hosts returned 404 HTML for robots.txt, so their current guidance could not be reliably confirmed. Electronic and System Semiconductor Engineering disallow internal/admin directories but not the selected `/kor/` lists. Mechanical Engineering permits pages but disallows `/api`, `/admin` and `/adm`; the collector uses only the public `/ko/board/` HTML. Semiconductor Engineering permits crawling. These observations do not establish reuse licensing.

All 13 schema-2 feeds were published and verified from local and deployed Rill in Firefox on September 9, 2026, with TLS verification enabled. Source availability, response structure, reuse permission, CDN freshness, and exact scheduling remain limitations. Development details are in AGENTS.md.
