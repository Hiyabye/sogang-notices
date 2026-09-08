# Sogang notices

A dependency-free Node collector for public Sogang University undergraduate academic notice metadata, consumed by [Rill](https://hiyabye.github.io/Rill/).

## Run locally

Use Node 22.18+ on the 22.x line, or Node 24+, and npm.

```sh
npm ci
npm test
npm run collect
```

Successful collection writes `public/notices.json`. Output is validated before replacing that file. Network errors, invalid JSON, malformed metadata, and changed source assumptions fail the command without replacing prior output. HTTP fetching has a 20-second timeout and does not bypass TLS or access restrictions. Only the list endpoint is requested; articles and attachments are not fetched.

## TLS certificate chain

Sogang currently sends only its leaf certificate, omitting the Sectigo OV R36 intermediate. Plain Node fetching fails with `unable to verify the first certificate`. `npm run collect` supplies `certificates/sectigo-ov-r36.pem` through `NODE_EXTRA_CA_CERTS` for that command only. This uses POSIX shell syntax, supported by macOS and the Ubuntu workflow. Direct `node collect.mjs` does not apply this setting.

Normal trusted roots, certificate validation, and hostname checks remain enabled. No system trust settings are changed. The workflow uses the same npm command; it needs no separate trust configuration.

Certificate provenance:

- Official issuer URL, taken from the source leaf certificate: http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt
- Subject: Sectigo Public Server Authentication CA OV R36
- Issuer: Sectigo Public Server Authentication Root R46, already trusted by Node
- Valid until: March 21, 2036, 23:59:59 UTC
- SHA-256: `65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30`

The downloaded certificate and Sogang's leaf were verified against Node's existing trusted roots before bundling. Tests check the bundled intermediate's fingerprint, CA status, signature against an existing trusted root, and validity period. It contains no private key. If the source changes issuer or this certificate expires, inspect and verify the new chain rather than disabling TLS checks. Remove the workaround once a plain Node fetch succeeds with a complete server-supplied chain.

## Source and selection

Board: https://www.sogang.ac.kr/ko/academic-support/notices

Public JSON endpoint:

```text
https://www.sogang.ac.kr/api/api/v1/mainKo/BbsData/boardList?pageNum=1&pageSize=50&bbsConfigFk=2&category=&introPkId=&title=&content=&username=
```

The observed first 50 entries include 17 pinned and 33 regular notices, each group in descending `regDate` order. The first regular notice is newer than every pin. The collector validates this within-group ordering, deduplicates `pkId`, sorts both groups together by `regDate` descending (then ID descending), and publishes five. Pin status alone must not determine recency.

One first-page request is intentionally bounded. If fewer than five distinct regular entries are returned while more pages exist, collection fails rather than publishing a potentially misleading selection. Add bounded pagination if this guard starts failing. A confirmed zero-total, empty list is allowed; missing data is not.

`regDate` is a 14-digit registration date/time. It is validated as a calendar value and used for ordering without interpreting its timezone. The feed exposes only its `YYYY-MM-DD` date. Missing or invalid dates fail collection. Article URLs reproduce the user-confirmed public navigation query, resolving the relative detail path against Sogang's origin. The source's `secret: "Y"` does not establish access semantics: the user confirmed these notices open while logged out. Do not infer private access or attempt to bypass login based on this field.

## Feed contract

Target: https://hiyabye.github.io/sogang-notices/notices.json

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

The example illustrates the schema, not a live feed snapshot. Output contains at most five unique notices, newest first. URLs are public HTTPS article links. `fetchedAt` is the successful fetch time, updated even if titles have not changed. Rill fetches once per page load and marks data older than 24 hours as potentially delayed.

## GitHub Pages publication

Repository: https://github.com/Hiyabye/sogang-notices

**Publish Sogang notices** runs on GitHub's Ubuntu runner using Node 24. It installs, tests, collects once from the public source, and uses GitHub's official Pages actions to upload and deploy only `public/`. Collection or validation failure stops the job before deployment, leaving the previous feed available. Pages uses **Settings > Pages > Build and deployment > Source > GitHub Actions**.

The first deployment is manual. After verifying the feed's content type, cache behavior, and Firefox access, the intended schedule is 00:17, 06:17, 12:17, and 18:17 UTC (`17 */6 * * *`). Schedules are best-effort and may be delayed or disabled by GitHub. No tokens belong in the public JSON or Rill.

Source guidance was checked live on September 8, 2026: `robots.txt` allows crawling. The board footer carries a general copyright statement but links no notice-specific usage terms; an explicit reuse license was not established. Publication is limited to five public titles, dates, and source links, without article bodies or attachments. Robots guidance is not a content license.

## Verification limits

The fixture was reduced from a user-supplied public 50-item response to relevant metadata, retaining pinned/regular ordering and Korean titles. Tests cover mixed recency, duplicates, tie-breaking, malformed dates/metadata, confirmed empty responses, saturation, source errors, and preservation of prior output. No article content or attachments are retained.

Live collection succeeded on September 8, 2026, using Node 26.8.1 and Node 24.20.0 on macOS with the bundled intermediate. Both runtimes passed all six tests. The live 50-record response produced five validated notices, with the newest regular notice ahead of the pins.

[GitHub Actions verification run 34239887756](https://github.com/Hiyabye/sogang-notices/actions/runs/34239887756) also passed on Ubuntu 24.04 with Node 24.20.0: six tests passed, and five notices were collected at `2026-09-08T14:41:41.975Z`. This verifies the actual GitHub-hosted runner path, not just local fixtures. Future source availability is not guaranteed.

Site terms beyond supplied robots guidance, Pages publication, deployed content type/cache behavior, and browser access to the deployed feed remain unverified. macOS curl still returned HTML during diagnosis; the collector uses native Node fetch and required no request-header spoofing.
