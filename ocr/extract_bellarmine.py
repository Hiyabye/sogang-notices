"""Local-file Bellarmine extraction feasibility gate, not a publication command.

No Paddle import/model initialization occurs during geometry or validation tests.
Unknown layouts and uncovered image content must not become published meals.
"""

import argparse
from dataclasses import dataclass
from datetime import date, timedelta
import hashlib
import io
import json
import math
from pathlib import Path
import re
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_RESULT_BYTES = 256 * 1024
WEEKDAYS = "월화수목금토일"
# Measured relative row boundaries across the five research images. The largest
# observed spread is <0.004; 0.008 permits rasterization, not extra/moved rows.
ROW_POSITIONS = (0, .062, .322, .356, .550, .583, .617, .703, .931, .965, 1)


class Rejected(ValueError):
    def __init__(self, code, region):
        super().__init__(f"{code}: {region}")
        self.code = code
        self.region = region


def require(condition, code, region):
    if not condition:
        raise Rejected(code, region)


def load_image(path):
    # Read at most the byte bound plus one, including files that grow after stat.
    with Path(path).open("rb") as stream:
        raw = stream.read(MAX_IMAGE_BYTES + 1)
    require(0 < len(raw) <= MAX_IMAGE_BYTES, "source", "image-bytes")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                require(image.format in ("JPEG", "PNG"), "source", "image-format")
                require(image.mode == "RGB" and "transparency" not in image.info,
                        "source", "image-color-mode")
                require(getattr(image, "n_frames", 1) == 1, "source", "image-frames")
                require(image.width * image.height <= MAX_PIXELS,
                        "source", "image-pixels")
                require(image.getexif().get(274, 1) == 1,
                        "layout", "image-orientation")
                image.load()
                return np.asarray(image.convert("RGB")), hashlib.sha256(raw).hexdigest()
    except (OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise Rejected("source", "image-decode") from error


def runs(indices):
    return [part for part in np.split(indices, np.where(np.diff(indices) > 1)[0] + 1)
            if len(part)]


@dataclass(frozen=True)
class Grid:
    rows: tuple
    columns: tuple

    def box(self, column, first_row, last_row):
        return (self.columns[column], self.rows[first_row],
                self.columns[column + 1], self.rows[last_row])


def detect_grid(rgb):
    height, width = rgb.shape[:2]
    require(width >= 1000 and height >= 700 and width * height <= MAX_PIXELS,
            "layout", "resolution")
    ink = (np.min(rgb, axis=2) < 180).astype(np.uint8)
    horizontal = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, np.ones((1, round(width * .35)), np.uint8))
    row_runs = runs(np.flatnonzero(horizontal.sum(axis=1) > width * .55))
    require(len(row_runs) == 11, "layout", "row-count")
    rows = tuple(round(float(part.mean())) for part in row_runs)
    span = rows[-1] - rows[0]
    require(.72 * height < span < .86 * height, "layout", "table-height")
    require(all(abs((row - rows[0]) / span - expected) <= .008
                for row, expected in zip(rows, ROW_POSITIONS)),
            "layout", "row-positions")
    # The first food row has all seven explicit column borders even on blank days.
    top, bottom = row_runs[1][-1] + 4, row_runs[2][0] - 4
    vertical = cv2.morphologyEx(
        ink[top:bottom], cv2.MORPH_OPEN,
        np.ones((round((bottom - top) * .85), 1), np.uint8))
    column_runs = runs(np.flatnonzero(vertical.sum(axis=0) > (bottom - top) * .9))
    require(len(column_runs) == 10, "layout", "column-count")
    columns = tuple(round(float(part.mean())) for part in column_runs)
    table_width = columns[-1] - columns[0]
    require(.85 * width < table_width < .96 * width, "layout", "table-width")
    require(1.55 < table_width / span < 1.65, "layout", "aspect")
    widths = np.diff(columns)
    require(all(.035 < value / table_width < .045 for value in widths[:2]),
            "layout", "label-columns")
    require(all(.12 < value / table_width < .15 for value in widths[2:]),
            "layout", "day-columns")
    # Verify each region rather than trusting borders in the first food row.
    # Shared breakfast/drink rows intentionally have no internal day separators.
    margin = max(2, round(width / 1000))
    for start, end in ((3, 4), (6, 7), (7, 8)):
        for x in columns[2:]:
            strip = ink[rows[start] + margin:rows[end] - margin,
                        x - margin:x + margin + 1]
            require(float(np.max(strip.mean(axis=0))) > .95,
                    "layout", "missing-cell-border")
    for start, end in ((5, 6), (9, 10)):
        for x in columns[3:-1]:
            strip = ink[rows[start] + margin:rows[end] - margin,
                        x - margin:x + margin + 1]
            require(float(np.max(strip.mean(axis=0))) < .95,
                    "layout", "unexpected-shared-border")
    return Grid(rows, columns)


def crop_regions(rgb, grid):
    rows, columns = grid.rows, grid.columns
    span = rows[-1] - rows[0]
    width = columns[-1] - columns[0]
    # Only the central date heading, never the logo/contact header or footer.
    boxes = {
        "period": (round(columns[0] + width * .40), round(rows[0] - span * .068),
                   round(columns[0] + width * .64), round(rows[0] - span * .029)),
        "year": (columns[0], rows[0], columns[2], rows[1]),
        "label.breakfast": (columns[0], rows[1], columns[1], rows[6]),
        "label.korean": (columns[1], rows[1], columns[2], rows[2]),
        "label.common": (columns[1], rows[5], columns[2], rows[6]),
        "label.cupRice": (columns[0], rows[6], columns[1], rows[7]),
        "label.dinner": (columns[0], rows[7], columns[1], rows[10]),
        "label.drink": (columns[1], rows[9], columns[2], rows[10]),
        "common": (columns[2], rows[5], columns[-1], rows[6]),
        "drink": (columns[2], rows[9], columns[-1], rows[10]),
    }
    for day in range(7):
        column = day + 2
        for name, start, end in (("date", 0, 1), ("korean", 1, 2),
                                 ("western", 3, 4), ("cupRice", 6, 7),
                                 ("dinner", 7, 8)):
            boxes[f"{day}.{name}"] = grid.box(column, start, end)
    margin = max(2, round(rgb.shape[1] / 700))
    result = {}
    for name, (left, top, right, bottom) in boxes.items():
        require(0 <= left < right <= rgb.shape[1] and
                0 <= top < bottom <= rgb.shape[0], "layout", name)
        # Heading/date crops contain no outer grid line in their central inset.
        result[name] = rgb[top + margin:bottom - margin, left + margin:right - margin]
    return result


def prepare_crop(rgb, name):
    image = Image.fromarray(rgb)
    # Preserve the full width of shared rows; shrinking them to one cell loses text.
    target = (180 if name.startswith("label.") else 1600 if name in ("common", "drink")
              else 900 if name == "period" else 600)
    height = round(image.height * target / image.width)
    require(height <= 4000, "layout", name)
    image = image.resize((target, height), Image.Resampling.LANCZOS)
    return np.asarray(ImageOps.expand(image, border=16, fill="white"))


def compact(text):
    return re.sub(r"\s+", "", text)


def validate_dates(texts, expected_start, expected_end):
    try:
        start, end = date.fromisoformat(expected_start), date.fromisoformat(expected_end)
    except (ValueError, TypeError) as error:
        raise Rejected("date-mismatch", "title-period") from error
    require(start.isoformat() == expected_start and end.isoformat() == expected_end and
            start.weekday() == 0 and end == start + timedelta(days=6),
            "date-mismatch", "title-period")
    heading = compact(" ".join(texts["period"]))
    # Paddle often omits the tilde. Two independently read date tokens are still
    # mandatory, with at most a tilde/dash between them and no trailing content.
    match = re.fullmatch(r"(\d{4})\.(\d{2})\.(\d{2})(?:~|-)?(?:(\d{4})\.)?(\d{2})\.(\d{2})", heading)
    require(match is not None, "date-mismatch", "period")
    year, month, day, end_year, end_month, end_day = match.groups()
    first = f"{year}-{month}-{day}"
    # Abbreviated January belongs to the next year only for a December start.
    last_year = int(end_year) if end_year else int(year) + (month == "12" and end_month == "01")
    last = f"{last_year:04}-{end_month}-{end_day}"
    require(first == expected_start and last == expected_end, "date-mismatch", "period")
    require(compact(" ".join(texts["year"])) == f"{start.year}년",
            "date-mismatch", "year")
    for index in range(7):
        day = start + timedelta(days=index)
        require(compact(" ".join(texts[f"{index}.date"])) ==
                f"{day.month:02}월{day.day:02}일{WEEKDAYS[index]}요일",
                "date-mismatch", f"{index}.date")


def validate_anchors(texts):
    for name, expected in (("breakfast", "정성이가득한조식"), ("korean", "한식"),
                           ("common", "공통"), ("cupRice", "컵밥"),
                           ("dinner", "행복을주는석식"), ("drink", "음료")):
        require(compact(" ".join(texts[f"label.{name}"])) == expected,
                "layout", f"label.{name}")


def read_region(ocr, rgb, name):
    image = prepare_crop(rgb, name)
    result = list(ocr.predict(image))[0].json["res"]
    texts, scores, boxes = result["rec_texts"], result["rec_scores"], result["rec_boxes"]
    require(len(texts) == len(scores) == len(boxes) <= 24, "ocr-quality", name)
    height, width = image.shape[:2]
    covered = np.zeros((height, width), dtype=np.uint8)
    lines = []
    for text, score, box in zip(texts, scores, boxes):
        require(isinstance(text, str) and 0 < len(text.strip()) <= 120 and
                math.isfinite(score) and 0 <= score <= 1 and len(box) == 4,
                "ocr-quality", name)
        left, top, right, bottom = map(int, box)
        require(0 <= left < right <= width and 0 <= top < bottom <= height,
                "ocr-quality", name)
        covered[max(0, top - 3):min(height, bottom + 3),
                max(0, left - 3):min(width, right + 3)] = 1
        lines.append((top, bottom, left, right, text.strip()))
    lines.sort()
    ordered = []
    line = []
    for box in lines:
        if line:
            shared = min(box[1], min(item[1] for item in line)) - max(box[0], max(item[0] for item in line))
            if shared < min(box[1] - box[0], min(item[1] - item[0] for item in line)) / 2:
                ordered.append(" ".join(item[4] for item in sorted(line, key=lambda item: item[2])))
                line = []
        line.append(box)
    if line:
        ordered.append(" ".join(item[4] for item in sorted(line, key=lambda item: item[2])))
    require(all(len(text) <= 120 for text in ordered), "ocr-quality", name)
    # Diagnostic, deliberately not an accepted confidence threshold. Date/label
    # regions have colored/gray backgrounds; coverage only measures white cells.
    uncovered = 0
    clipped = False
    if name in ("period", "common", "drink") or name.split(".")[-1] in (
            "korean", "western", "cupRice", "dinner") and not name.startswith("label."):
        original_ink = np.min(rgb, axis=2) < 180
        # Check before white padding/resampling; padding must not hide clipped
        # content from a neighboring offering or an overlapping badge.
        clipped = bool(np.any(original_ink[[0, -1], :]) or np.any(original_ink[:, [0, -1]]))
        ink = (np.min(image, axis=2) < 180).astype(np.uint8)
        count, _, stats, _ = cv2.connectedComponentsWithStats(ink * (1 - covered), 8)
        # Ignore isolated raster specks only. Decorations remain visible failures,
        # not arbitrary masks that could erase a dish.
        uncovered = sum(int(area) for _, _, w, h, area in stats[1:count]
                        if area >= 9 and w >= 2 and h >= 2)
    return {"texts": ordered,
            "minimumScore": min(scores) if scores else None,
            "uncoveredPixels": uncovered, "clipped": clipped}


def validate_menu_regions(regions):
    """Conservative quality gate for the observed template, not a spelling guarantee.

    Return no partially accepted week. These rules intentionally reject the
    currently unresolved decorative templates instead of dropping their pixels.
    """
    for name, region in regions.items():
        if name.startswith("label.") or name in ("period", "year") or name.endswith(".date"):
            continue
        require(not region["clipped"], "layout", name)
        require(region["uncoveredPixels"] == 0, "ocr-quality", name)
        texts = region["texts"]
        require(len(texts) <= 12, "ocr-quality", name)
        if not texts:
            require(region["minimumScore"] is None, "ocr-quality", name)
            continue
        # Provisional rejection floor, not calibrated acceptance probability.
        # The full-layout gate remains open even when all scores exceed it.
        require(region["minimumScore"] is not None and region["minimumScore"] >= .90,
                "ocr-quality", name)
        if name.endswith(".cupRice"):
            # Every observed populated cup-rice cell starts with an explicit
            # service time. A recommendation badge alone is not a meal.
            require(len(texts) >= 2 and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", texts[0]) is not None,
                    "layout", name)
            require(not any(re.search(r"\d{1,2}:\d{2}", text) for text in texts[1:]),
                    "layout", name)
        if any("미운영" in text for text in texts):
            require(name == "5.dinner" and len(texts) == 1 and
                    compact(texts[0]) == "토요일석식미운영", "layout", name)


def model_directories(root):
    manifest = json.loads(Path(__file__).with_name("models.json").read_text())
    directories = {}
    for model in manifest["models"]:
        directory = Path(root) / model["name"]
        for filename, expected in model["files"].items():
            actual = hashlib.sha256((directory / filename).read_bytes()).hexdigest()
            if actual != expected:
                # Bad installation/cache is infrastructure failure, not source rejection.
                raise RuntimeError("Model asset hash mismatch")
        directories[model["name"]] = str(directory)
    return directories


def create_ocr(root):
    directories = model_directories(root)
    from paddleocr import PaddleOCR
    return PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=directories["PP-OCRv5_mobile_det"],
        text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
        text_recognition_model_dir=directories["korean_PP-OCRv5_mobile_rec"],
        use_doc_orientation_classify=False, use_doc_unwarping=False,
        use_textline_orientation=False, device="cpu", enable_mkldnn=False,
        cpu_threads=4, text_rec_score_thresh=0)


def inspect_image(ocr, path, start, end):
    rgb, digest = load_image(path)
    grid = detect_grid(rgb)
    regions = {name: read_region(ocr, crop, name)
               for name, crop in crop_regions(rgb, grid).items()}
    texts = {name: result["texts"] for name, result in regions.items()}
    rejections = []
    for validate in (lambda: validate_dates(texts, start, end), lambda: validate_anchors(texts),
                     lambda: validate_menu_regions(regions)):
        try:
            validate()
        except Rejected as error:
            rejections.append({"code": error.code, "region": error.region})
    # This is evidence for calibration, not a meal-schema result. Never attach an
    # 'accepted' status before full-cell ground truth and coverage are reviewed.
    return {"imageSha256": digest, "publicationReady": False,
            "rejections": rejections, "regions": regions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--models", required=True, type=Path)
    parser.add_argument("--week-start", required=True)
    parser.add_argument("--week-end", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        # Reject malformed input/layout before model setup.
        rgb, _ = load_image(args.image)
        detect_grid(rgb)
        result = inspect_image(create_ocr(args.models), args.image, args.week_start, args.week_end)
    except Rejected as error:
        result = {"publicationReady": False,
                  "rejections": [{"code": error.code, "region": error.region}]}
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
    if len(encoded) > MAX_RESULT_BYTES:
        raise RuntimeError("OCR diagnostic exceeds output limit")
    args.output.write_bytes(encoded)


if __name__ == "__main__":
    main()
