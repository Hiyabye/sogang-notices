# Bellarmine OCR feasibility gate

This directory contains the local diagnostic and the conditional publication worker. The full-layout release gate in Rill's `PLAN.md` has not passed: no real full-week benchmark is accepted yet. The owner approved implementing the complete downstream pipeline while retaining that release gate. Ordinary `npm test` and `npm run collect` remain Python-free; the expanded Pages workflow invokes `run_bellarmine.py` only for images without reusable validated results. No Python runs in Rill.

## Run

Use an isolated Python 3.13 environment. The generated lock pins packages and hashes, with Linux x86-64 wheel resolution; actual inference has only been exercised on macOS ARM64 so far.

```sh
python3.13 -m venv .venv-ocr
.venv-ocr/bin/python -m pip install --require-hashes --only-binary=:all: -r ocr/requirements.lock
.venv-ocr/bin/python -m unittest discover -s ocr -p 'test_*.py' -v
```

Tests use synthetic RGB tables and fake OCR responses, never source images, models, university requests, or Python installation from npm. Importing the extraction module does not import Paddle or initialize an OCR engine.

Place the four assets listed for each model in `ocr/models.json` under a local directory with these children:

```text
models/
  PP-OCRv5_mobile_det/
    config.json
    inference.json
    inference.yml
    inference.pdiparams
  korean_PP-OCRv5_mobile_rec/
    config.json
    inference.json
    inference.yml
    inference.pdiparams
```

Each asset's pinned download URL is `<source>/resolve/<revision>/<filename>`, using the manifest fields. Download/setup is a separate operator step: `.venv-ocr/bin/python ocr/download_models.py --output ocr/models`. Downloads and cache reads have a 32-MiB per-asset ceiling and must match the pinned hashes; corrupt caches require explicit repair. The diagnostic requires existing local directories and verifies every asset's SHA-256 before constructing PaddleOCR. Missing/corrupt model assets are infrastructure errors, not recoverable source failures. All eight hashes were independently checked against the pinned public model revisions. Neither downloaded models nor source images belong in Git or the Pages artifact.

```sh
.venv-ocr/bin/python ocr/extract_bellarmine.py /absolute/path/940139.jpg \
  --models /absolute/path/models \
  --week-start 2026-09-07 --week-end 2026-09-13 \
  --output /absolute/path/diagnostic.json

.venv-ocr/bin/python ocr/benchmark_bellarmine.py \
  --images /absolute/path/five-research-images \
  --models /absolute/path/models \
  --output /absolute/path/benchmark.json
```

The benchmark expects the five filenames and independently inspected title periods in `CASES`. It does not download images. Keep local source images and diagnostic outputs outside Git. Permission to redistribute source images or extracted menus remains a release gate; no real image fixture is committed.

A source/layout rejection produces diagnostic JSON. Unexpected model/engine/filesystem failures exit unsuccessfully. **A successful process exit is not an accepted meal.** Diagnostic outputs explicitly set `publicationReady: false` and are not meal feeds. The operator owns the explicit diagnostic output path.

The separate worker runs as `.venv-ocr/bin/python ocr/run_bellarmine.py --work work --models ocr/models`. It bounds/validates preparation and image identity, checks image/layout before initializing an engine, and requires every date/anchor/quality check to pass before converting source lines into structured days. Blank days do not inherit invented shared service; cup rice keeps its observed time, and explicit closure stays separate from unlisted data. The worker binds each `ok` or typed `rejected` result to the exact image hash and pipeline ID. Node assembly independently validates all output, so diagnostic files cannot be substituted for worker results. Infrastructure errors and the workflow's 300-second process timeout fail the job. Only the expanded read-only OCR job runs this worker; deployment is on a separate runner.

## Implemented checks

- Bounded image read before decode: 5 MiB, JPEG or PNG, RGB only, no transparency, one frame, upright EXIF, at most 12 megapixels. Geometry additionally requires at least 1000x700 pixels.
- Measured line projections identify eleven row boundaries, two label columns and seven day columns. Relative row positions, aspect, widths, ordinary cell separators and shared-row merges are checked before assigning crops. This is one observed template family, not a general table parser.
- Forty-five regions per image: independent heading/year, all seven dates/weekdays, six label anchors, Korean/Western breakfast, cup rice, dinner and two shared rows. Header logos/contact information, footer and calorie rows are not OCR inputs.
- The title period, image heading, image year and every date/weekday must agree. Abbreviated end years support the explicit December/January case. Both observed title/image mismatches remain rejections.
- OCR boxes must remain within the crop. Overlapping line fragments are ordered horizontally rather than by one-pixel top-coordinate jitter. Padding cannot hide content clipped by a cell boundary.
- Blank pixels differ from nonblank regions that OCR missed. Uncovered connected image content rejects a candidate, including unresolved decorations. A provisional 0.90 confidence floor rejects uncertain regions but is not an accuracy guarantee or completed calibration.
- A populated cup-rice cell must have the observed leading `HH:mm` plus menu text. A recommendation badge is not an offering. Only the observed Saturday-dinner closure phrase is recognized as that closure; blanks are not closures. No dictionary corrections, guessed service times, or per-cell partial-week publication.

## Full-layout result and remaining work

Both benchmark passes processed **225 regions across five images**, including Western/common/cup-rice/drink rows omitted from the earlier 22-crop comparison. Initial inference took roughly 16-25 seconds per image on the existing macOS CPU environment, excluding model initialization. This is not a Linux/Actions measurement.

- `940528`: the heading contradicts the September 14-20 title/date columns; date rejection is preserved.
- `939194`: August 27-30 is not the full August 24-30 image week; date rejection is preserved.
- `940139`: a decorative star was recognized as an extra `1` at low confidence, and recommendation text was mixed with dinner dishes. The quality gate rejects it.
- `939460`: the low-resolution cup-rice label was read as `겁밥`. A dinner badge crossing the border also became cup-rice text; anchor/boundary/offer-shape checks reject it.
- `938936`: the repeated strawberry bakery artwork touches the crop boundary and leaves uncovered non-text pixels; it is rejected rather than erased.

All five currently fail at least one gate. **There is still no accepted real full-week benchmark.** This conservative rejection result does not establish useful production availability. The owner explicitly chose continued automatic-extraction hardening, not an image widget or mandatory manual publication.

Do not fix this by trimming a fixed strip from every Western cell: enlarged inspection showed that the strawberry/banner area reaches the first dish's pixels. Next work needs reviewed decoration/template handling that retains every dish, durable permitted image fixtures, full-cell human ground truth and an unseen normal week. Finish that feasibility work before release. The publisher/workflow and Rill widget are now implemented with strict failure/recovery behavior; this does not make OCR production-ready. No confidence cutoff establishes correct spelling, and synthetic tests do not establish arbitrary-layout safety.

## Dependency maintenance

The lock is generated, never hand edited. With `uv` available as a development resolver, run from the collector root:

```sh
uv pip compile ocr/requirements.in --python-version 3.13 \
  --python-platform x86_64-manylinux_2_28 --only-binary :all: \
  --generate-hashes --output-file ocr/requirements.lock
```

The direct packages are the exact PaddleOCR/PaddlePaddle/PaddleX/Pillow/OpenCV/NumPy versions used during research. Resolution contains only pinned registry dependencies, no VCS/local packages; install wheels with hash checking, never source build hooks. Linux-target hash-locked dry-run resolution succeeded, but Linux installation and inference remain unverified. The original benchmark reused the research environment. The complete worker was subsequently exercised in a clean hash-locked macOS Python 3.13.13 environment, with live Bellarmine inputs and a Python socket-connect guard. That run rejected post 940528 for its conflicting dates and produced typed unavailable output through Node assembly. It does not establish Linux execution or real full-week acceptance.

Installed direct-package metadata identifies Paddle and OpenCV as Apache-2.0, Pillow as MIT-CMU and NumPy as BSD with bundled-library notices. Both pinned model cards declare Apache-2.0. This is metadata review, not complete transitive license/provenance certification; source reuse permission is separate. `npm audit` and a no-install `pip-audit` of the complete locked package list reported no known vulnerabilities during this checkpoint. Recheck advisories and platform-specific wheels before CI integration. A Python socket-connect audit guard passed during the hardened local benchmark; this is not an OS/native-library network sandbox.
