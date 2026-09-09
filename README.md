# Sogang notices

A small collector for 13 public Sogang University notice boards, used by [Rill](https://hiyabye.github.io/Rill/): undergraduate academic notices and selected Computer Science, AI, and AI-Based Liberal Studies boards.

- **Source board:** https://www.sogang.ac.kr/ko/academic-support/notices
- **Feed addresses:** `https://hiyabye.github.io/sogang-notices/feeds/<source-id>.json`
- **Board IDs and URLs:** see `sources.mjs` and [AGENTS.md](AGENTS.md). The schema-2 feeds are published; local collection does not update them.
- **Workflow and run history:** https://github.com/Hiyabye/sogang-notices/actions/workflows/publish.yml

## What the feed contains

Each board feed contains up to 30 recent notices with full titles, publication dates, and source links. Pins and regular notices are ordered by source date, not pin position. No article bodies, attachments, authors, or login data are collected.

The main board uses public JSON; departments use HTML list metadata parsed with parse5, without executing source scripts. Collection samples 50 main-site records or up to three department pages. Incomplete or inconsistent samples fail rather than publish a misleading list.

A failed board retains validated previously published data with an error status. Healthy boards can still update. If any failed board has no valid recovery feed, publication stops for all boards. The first schema-2 publication therefore requires all 13 sources to succeed. A successful empty list is distinct from an unavailable source.

## Update times and freshness

Updates are scheduled for **00:00, 06:00, 12:00, and 18:00 UTC**, or **03:00, 09:00, 15:00, and 21:00 Korea Standard Time**. Manual runs are also available.

These are scheduled start times, not guaranteed completion times. [GitHub Actions can delay or drop scheduled runs during high load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), particularly at the start of an hour, and can disable inactive public-repository schedules.

`fetchedAt` records the last successful source fetch. `lastAttemptAt` records the completed attempt; `collectionStatus: "error"` means retained data is being served after a source failure. Recovery never makes old data appear newly fetched.

Published feeds have a ten-minute cache lifetime. Rill v0.4 checks subscribed feeds hourly while visible and holds changed content behind **Updates available**. It warns when displayed source data is more than 24 hours old. Always consult university boards for authoritative information.

## Run locally

Use Node 22.18+ on the 22.x line, or Node 24+, with npm. The collection command uses POSIX shell syntax, supported on macOS and the Ubuntu workflow.

```sh
npm ci
npm test
npm run collect
```

- `npm test` is offline and does not deploy or contact Sogang.
- `npm run collect` fetches public lists, two boards at a time, with 20-second per-request timeouts and bounded response sizes. It stages 13 JSON files under `public/feeds/` after collection/recovery validation succeeds.
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

Coordinate the schema-2 collector and Rill v0.4 before publication. Old clients do not understand subscription feeds; new clients cannot load unpublished paths. No compatibility layer is included. The first publication needs all 13 successful source collections.

Pages uses **Settings > Pages > Build and deployment > Source > GitHub Actions**. The **Publish Sogang notices** workflow tests, collects, and deploys only the validated `public/` output using GitHub's official Pages actions.

To publish immediately, open the workflow's **Run workflow** menu and select `main`. This performs a real source fetch and deployment. Inspect all steps, then check the live feed's `fetchedAt`. Failed tests, unrecoverable source failures, invalid output, or write failures stop publication. Recovered failures appear in the workflow summary even when publication succeeds.

Pushing a commit does not immediately publish a feed. The next scheduled run uses the latest code on the default branch, or you can run the workflow manually. Schedule changes take effect only after the workflow change is pushed to that branch. Deploying this repository does not deploy Rill.

## Why a certificate is included

Sogang was observed sending its leaf TLS certificate without the Sectigo OV R36 intermediate, causing plain Node fetching to fail with `unable to verify the first certificate`. `npm run collect` supplies `certificates/sectigo-ov-r36.pem` through `NODE_EXTRA_CA_CERTS` for that command only.

**This PEM is safe to publish:** it contains Sectigo's public CA certificate, not a private key, password, token, or personal information. Normal certificate and hostname verification remain enabled, and no system trust settings are changed. A PEM file can contain secrets in general; this particular file does not.

Certificate provenance:

- Official issuer URL from the source certificate: http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt
- Subject: Sectigo Public Server Authentication CA OV R36
- Issuer: Sectigo Public Server Authentication Root R46, already trusted by Node
- Valid until: March 21, 2036, 23:59:59 UTC
- SHA-256: `65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30`

The intermediate and source leaf were verified against Node's trusted roots before bundling. Tests check the intermediate's fingerprint, CA status, signature, and validity period. A future issuer change or expiry may require maintenance; never disable TLS verification to work around it.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Certificate verification fails | Use `npm run collect`, not plain `node collect.mjs`. If it still fails, inspect the source chain and follow the certificate maintenance instructions in AGENTS.md. |
| Unexpected response, ordering error, or too few regular notices | The source may have changed or pins may have crowded the first page. Inspect a fresh public response and update the collector with a regression test; do not bypass validation. |
| Feed time is old | Check Actions history for a failed, delayed, or disabled workflow. Old publication is deliberately preserved on collection failure. |
| Local collection succeeds but the website is unchanged | Local output is not uploaded automatically. Check the deployment run, allow for the CDN cache, and reload Rill. |
| Rill reports unavailable but the feed opens directly | Inspect the browser's Network panel for the feed response, CORS, and JSON validation errors. A successful terminal request alone does not prove browser access. |

## Source guidance and limitations

On September 8, 2026, live `robots.txt` allowed crawling. The board footer carried a general copyright statement but no linked notice-specific usage terms; an explicit reuse license was not established. Robots guidance is not a content license. Publication stays limited to public titles, dates, and links, at most 30 per board. Department robots responses contained malformed server-template text or unavailable HTML, so current crawling guidance could not be reliably confirmed.

All 13 schema-2 feeds were published and verified from local and deployed Rill in Firefox on September 9, 2026, with TLS verification enabled. Source availability, response structure, reuse permission, CDN freshness, and exact scheduling remain limitations. Development details are in AGENTS.md.
