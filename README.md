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

Each board feed contains up to 30 recent notices with list titles, publication dates, and source links. Pins and regular notices are ordered by source date, not pin position. Only list pages are requested; article pages, attachments and login-only material are not fetched. Summaries or article bodies bundled in a list response are ignored, and feeds contain no authors or images.

CMS comments supply full titles where available. Some new source lists shorten titles without supplying the full text; the feed preserves the available text rather than fetching articles. Electronic Engineering also emits one Korean job-title shape as unescaped markup; its exact literal text is safely retained. Other missing or malformed titles remain errors.

The main board uses public JSON. CMS, PHP community, Mechanical Engineering's server-rendered tables, and Semiconductor lists are parsed with parse5 without executing scripts. Collection samples 50 main-site records or enough source-specific pages to cover 30 regular records. Pins consume slots on some sites, so those sources allow at most six pages. Collection stops early at the board end. Counts, identities, ordering and pagination are validated; incomplete samples fail rather than publish a misleading list.

A failed board retains validated previously published data with an error status. Healthy boards can still update. If any failed board has no valid recovery feed, publication stops for all boards. A clean bootstrap therefore requires all 41 sources to succeed. Newly added boards must succeed on their first publication because no recovery feed exists yet. A successful empty list is distinct from an unavailable source.

## Update times and freshness

Updates are scheduled for **00:00, 06:00, 12:00, and 18:00 UTC**, or **03:00, 09:00, 15:00, and 21:00 Korea Standard Time**. Manual runs are also available.

These are scheduled start times, not guaranteed completion times. [GitHub Actions can delay or drop scheduled runs during high load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), particularly at the start of an hour, and can disable inactive public-repository schedules.

`fetchedAt` records the last successful source fetch. `lastAttemptAt` records the completed attempt; `collectionStatus: "error"` means retained data is being served after a source failure. Recovery never makes old data appear newly fetched.

Published feeds were observed with a ten-minute cache lifetime. Rill checks subscribed feeds hourly while visible and holds changed content behind **새 공지 반영**. It warns when displayed source data is more than 24 hours old. Always consult university boards for authoritative information.

## Run locally

Use Node 22.18+ on the 22.x line, or Node 24+, with npm. The collection command uses POSIX shell syntax, supported on macOS and the Ubuntu workflow.

```sh
npm ci
npm test
npm run collect
```

- `npm test` is offline and does not deploy or contact Sogang.
- `npm run collect` fetches public lists, two boards at a time, with 20-second per-request timeouts and bounded response sizes. It stages 41 JSON files under `public/feeds/` after collection/recovery validation succeeds.
- Local collection does **not** publish anything or change the feed Rill uses. The generated `public/` directory is intentionally ignored by Git.

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

Publish new collector paths before publishing the matching Rill catalog: clients cannot load unpublished feeds. The college additions retain feed schema 2 and all existing IDs. Older Rill versions do not recognize the new subscription IDs, so use an updated version when transferring backups containing them. A clean bootstrap needs all 41 successful collections; existing boards may recover from valid prior feeds.

Pages uses **Settings > Pages > Build and deployment > Source > GitHub Actions**. The **Publish Sogang notices** workflow tests, collects, and deploys only the validated `public/` output using GitHub's official Pages actions.

To publish immediately, open the workflow's **Run workflow** menu and select `main`. This performs a real source fetch and deployment. Inspect all steps, then check the live feed's `fetchedAt`. Failed tests, unrecoverable source failures, invalid output, or write failures stop publication. Recovered failures appear in the workflow summary even when publication succeeds.

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
| Feed time is old | Check Actions history for a failed, delayed, or disabled workflow. Old publication is deliberately preserved on collection failure. |
| Local collection succeeds but the website is unchanged | Local output is not uploaded automatically. Check the deployment run, allow for the CDN cache, and reload Rill. |
| Rill reports unavailable but the feed opens directly | Inspect the browser's Network panel for the feed response, CORS, and JSON validation errors. A successful terminal request alone does not prove browser access. |

## Source guidance and limitations

On September 8, 2026, live `robots.txt` allowed crawling. The board footer carried a general copyright statement but no linked notice-specific usage terms; an explicit reuse license was not established. Robots guidance is not a content license. Publication stays limited to public titles, dates, and links, at most 30 per board. Department robots responses contained malformed server-template text or unavailable HTML. The Computing and Engineering college hosts returned 404 HTML for robots.txt, so their current guidance could not be reliably confirmed. Electronic and System Semiconductor Engineering disallow internal/admin directories but not the selected `/kor/` lists. Mechanical Engineering permits pages but disallows `/api`, `/admin` and `/adm`; the collector uses only the public `/ko/board/` HTML. Semiconductor Engineering permits crawling. These observations do not establish reuse licensing.

All 13 schema-2 feeds were published and verified from local and deployed Rill in Firefox on September 9, 2026, with TLS verification enabled. Source availability, response structure, reuse permission, CDN freshness, and exact scheduling remain limitations. Development details are in AGENTS.md.
