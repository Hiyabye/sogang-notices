"""Bounded local-artifact OCR worker. Source rejections are data; crashes fail the job."""

import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re

from extract_bellarmine import MAX_IMAGE_BYTES, Rejected, compact, create_ocr, detect_grid, inspect_image, load_image


def offering(region, cup_rice=False):
    items = list(region["texts"])
    if not items:
        return {"status": "unlisted", "items": [], "serviceTime": None}
    if len(items) == 1 and compact(items[0]) == "토요일석식미운영":
        return {"status": "closed", "items": [], "serviceTime": None}
    service_time = items.pop(0) if cup_rice else None
    return {"status": "available", "items": items, "serviceTime": service_time}


def menu_days(regions, start):
    result = []
    for index in range(7):
        korean = offering(regions[f"{index}.korean"])
        western = offering(regions[f"{index}.western"])
        dinner = offering(regions[f"{index}.dinner"])
        blank = {"status": "unlisted", "items": [], "serviceTime": None}
        result.append({
            "date": (date.fromisoformat(start) + timedelta(days=index)).isoformat(),
            "breakfast": {"korean": korean, "western": western,
                          "common": offering(regions["common"]) if korean["status"] == "available" or western["status"] == "available" else dict(blank)},
            "cupRice": offering(regions[f"{index}.cupRice"], True),
            "dinner": dinner,
            "drink": offering(regions["drink"]) if dinner["status"] == "available" else dict(blank),
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    args = parser.parse_args()
    with (args.work / "prepared.json").open("rb") as stream:
        data = stream.read(3 * 256 * 1024 + 1)
    if len(data) > 3 * 256 * 1024:
        raise RuntimeError("Preparation exceeds byte limit")
    prepared = json.loads(data)
    candidates = prepared["candidates"]
    pipeline = prepared["pipelineId"]
    if not isinstance(candidates, list) or len(candidates) > 2 or not re.fullmatch(r"[a-f0-9]{64}", pipeline):
        raise RuntimeError("Invalid preparation")
    engine = None
    results = []
    for candidate in candidates:
        if candidate["reused"] is not None:
            continue
        post_id = candidate["source"]["postId"]
        if not re.fullmatch(r"[1-9]\d{0,15}", post_id) or candidate["image"] != f"{post_id}.image":
            raise RuntimeError("Invalid image identity")
        path = args.work / candidate["image"]
        with path.open("rb") as stream:
            raw = stream.read(MAX_IMAGE_BYTES + 1)
        digest = hashlib.sha256(raw).hexdigest()
        if len(raw) > MAX_IMAGE_BYTES or digest != candidate["source"]["imageSha256"]:
            raise RuntimeError("Image artifact hash mismatch")
        base = {"postId": post_id, "imageSha256": digest, "pipelineId": pipeline}
        try:
            if engine is None:
                raster, _ = load_image(path)
                detect_grid(raster)
                del raster
                engine = create_ocr(args.models)
            diagnostic = inspect_image(engine, path, candidate["weekStart"], candidate["weekEnd"])
            if diagnostic["imageSha256"] != digest:
                raise RuntimeError("Image changed during extraction")
            if diagnostic["rejections"]:
                results.append({**base, "status": "rejected", "errorCode": diagnostic["rejections"][0]["code"]})
            else:
                results.append({**base, "status": "ok", "errorCode": None,
                                "extractedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                                "days": menu_days(diagnostic["regions"], candidate["weekStart"])})
        except Rejected as error:
            results.append({**base, "status": "rejected", "errorCode": error.code})
    output = json.dumps(results, ensure_ascii=False, allow_nan=False).encode()
    if len(output) > 256 * 1024:
        raise RuntimeError("OCR result exceeds byte limit")
    (args.work / "ocr-results.json").write_bytes(output)


if __name__ == "__main__":
    main()
