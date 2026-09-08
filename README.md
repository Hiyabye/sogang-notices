# Sogang notices

A small, dependency-free collector for public Sogang University undergraduate academic notices, used by [Rill](https://hiyabye.github.io/Rill/).

- **Source board:** https://www.sogang.ac.kr/ko/academic-support/notices
- **Live JSON feed:** https://hiyabye.github.io/sogang-notices/notices.json
- **Workflow and run history:** https://github.com/Hiyabye/sogang-notices/actions/workflows/publish.yml

## What the feed contains

Five recent notices with their original titles, publication dates, and source links. Pinned and regular notices are combined and ordered by registration date, not pin position. No article bodies, attachments, or login data are collected.

The collector reads the first 50 source records. If pins crowd out enough regular entries to make selection unreliable, it fails rather than publishing a misleading list. Source errors or invalid data leave the previous published feed available. An explicitly empty board can produce an empty list.

## Update times and freshness

Updates are scheduled for **00:00, 06:00, 12:00, and 18:00 UTC**, or **03:00, 09:00, 15:00, and 21:00 Korea Standard Time**. Manual runs are also available.

These are scheduled start times, not guaranteed completion times. [GitHub Actions can delay or drop scheduled runs during high load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), particularly at the start of an hour, and can disable inactive public-repository schedules.

`fetchedAt` records the last successful source fetch, even when the notices have not changed. GitHub Pages currently serves the feed with a ten-minute cache lifetime. Rill fetches once when opened or reloaded and warns when the source was last checked more than 24 hours ago. Always consult the university board for authoritative information.

## Run locally

Use Node 22.18+ on the 22.x line, or Node 24+, with npm. The collection command uses POSIX shell syntax, supported on macOS and the Ubuntu workflow.

```sh
npm ci
npm test
npm run collect
```

- `npm test` is offline and does not deploy or contact Sogang.
- `npm run collect` makes one live public request with a 20-second timeout and writes `public/notices.json` only after validation succeeds.
- Local collection does **not** publish anything or change the feed Rill uses. The generated `public/` directory is intentionally ignored by Git.

For architecture, source-field assumptions, testing requirements, and changes coordinated with Rill, see [AGENTS.md](AGENTS.md).

## Feed format

```json
{
  "schemaVersion": 1,
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

This example illustrates the format, not the current live data. `notices` contains at most five unique entries, newest first. `publishedDate` is a source calendar date with no invented timezone; `fetchedAt` is a UTC timestamp.

Observed response headers are `Content-Type: application/json; charset=utf-8`, `Access-Control-Allow-Origin: *`, and `Cache-Control: max-age=600`. No token is required to read the feed.

## Publish or inspect an update

Pages uses **Settings > Pages > Build and deployment > Source > GitHub Actions**. The **Publish Sogang notices** workflow tests, collects, and deploys only the validated `public/` output using GitHub's official Pages actions.

To publish immediately, open the workflow's **Run workflow** menu and select `main`. This performs a real source fetch and deployment. Inspect all steps, then check the live feed's `fetchedAt`. Failed tests, collection, or validation stop publication before deployment.

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

On September 8, 2026, live `robots.txt` allowed crawling. The board footer carried a general copyright statement but no linked notice-specific usage terms; an explicit reuse license was not established. Robots guidance is not a content license. Publication stays limited to five public titles, dates, and source links.

Live collection, GitHub Pages deployment, and Firefox access from local and deployed Rill origins have been verified. This does not guarantee future source availability, unchanged response structure, or exact scheduled execution. Development verification details are in AGENTS.md.
