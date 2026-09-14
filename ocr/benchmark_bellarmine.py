"""Explicit local-image benchmark. Never downloads images or publishes results."""

import argparse
import json
from pathlib import Path
import time

from extract_bellarmine import Rejected, create_ocr, inspect_image

# Public post IDs and independently inspected title dates, not OCR corrections.
CASES = (
    ("940528.jpg", "2026-09-14", "2026-09-20"),
    ("940139.jpg", "2026-09-07", "2026-09-13"),
    ("939460.png", "2026-08-31", "2026-09-06"),
    ("939194.png", "2026-08-27", "2026-08-30"),
    ("938936.jpg", "2026-08-10", "2026-08-16"),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", required=True, type=Path)
    parser.add_argument("--models", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    ocr = create_ocr(args.models)
    results = []
    for filename, start, end in CASES:
        before = time.perf_counter()
        try:
            result = inspect_image(ocr, args.images / filename, start, end)
        except Rejected as error:
            result = {"publicationReady": False,
                      "rejections": [{"code": error.code, "region": error.region}]}
        result["image"] = filename
        result["seconds"] = time.perf_counter() - before
        results.append(result)
        print(filename, result["rejections"], flush=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, allow_nan=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
