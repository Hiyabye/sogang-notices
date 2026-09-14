"""Offline synthetic tests. No source images, model loading, or downloads."""

from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from extract_bellarmine import (
    MAX_IMAGE_BYTES, ROW_POSITIONS, Rejected, WEEKDAYS, crop_regions,
    detect_grid, load_image, model_directories, prepare_crop, read_region,
    validate_anchors, validate_dates, validate_menu_regions,
)


def table():
    # Synthetic independent geometry, no university pixels or employee data.
    image = np.full((800, 1120, 3), 255, dtype=np.uint8)
    columns = (50, 90, 130, 255, 385, 515, 645, 775, 910, 1050)
    rows = (100, 139, 301, 322, 444, 465, 486, 541, 684, 705, 730)
    for y in rows:
        cv2.line(image, (50, y), (1050, y), (0, 0, 0), 1)
    for x in columns:
        cv2.line(image, (x, 100), (x, 730), (0, 0, 0), 1)
    for start, end in ((5, 6), (9, 10)):
        for x in columns[3:-1]:
            image[rows[start] + 1:rows[end], x] = 255
    return image, columns, rows


def date_texts(start="2026-09-07"):
    first = date.fromisoformat(start)
    last = first + timedelta(days=6)
    result = {"period": [f"{first:%Y.%m.%d} ~ {last:%Y.%m.%d}"],
              "year": [f"{first.year}년"]}
    for index in range(7):
        day = first + timedelta(days=index)
        result[f"{index}.date"] = [f"{day.month:02}월 {day.day:02}일", f"{WEEKDAYS[index]}요일"]
    return result


class GridTests(unittest.TestCase):
    def test_measured_row_spread(self):
        observed = (
            (314, 433, 942, 1007, 1387, 1452, 1516, 1686, 2131, 2196, 2261),
            (98, 140, 322, 346, 481, 504, 527, 588, 746, 770, 792),
            (88, 126, 289, 310, 431, 452, 473, 527, 669, 690, 711),
        )
        for rows in observed:
            for row, expected in zip(rows, ROW_POSITIONS):
                self.assertLess(abs((row - rows[0]) / (rows[-1] - rows[0]) - expected), .004)

    def test_synthetic_grid_and_all_regions(self):
        image, columns, rows = table()
        grid = detect_grid(image)
        self.assertEqual(grid.rows, rows)
        self.assertEqual(grid.columns, columns)
        crops = crop_regions(image, grid)
        self.assertEqual(len(crops), 45)
        self.assertEqual(set(crops) - {f"{i}.{name}" for i in range(7)
                                     for name in ("date", "korean", "western", "cupRice", "dinner")},
                         {"period", "year", "label.breakfast", "label.korean", "label.common",
                          "label.cupRice", "label.dinner", "label.drink", "common", "drink"})
        for name, crop in crops.items():
            resized = prepare_crop(crop, name)
            self.assertGreater(resized.shape[0], 32)
            self.assertGreater(resized.shape[1], 32)

    def test_ordinary_uniform_scaling_preserves_grid(self):
        image, columns, rows = table()
        scaled = cv2.resize(image, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        grid = detect_grid(scaled)
        self.assertEqual(grid.rows, tuple(y * 2 for y in rows))
        self.assertEqual(grid.columns, tuple(x * 2 for x in columns))

    def test_missing_extra_or_shifted_rows(self):
        for change in ("missing", "extra", "shifted"):
            with self.subTest(change=change):
                image, _, rows = table()
                if change == "extra":
                    image[200, 50:1051] = 0
                else:
                    image[rows[2], 50:1051] = 255
                    if change == "shifted":
                        image[rows[2] + 15, 50:1051] = 0
                with self.assertRaisesRegex(Rejected, "layout: row-"):
                    detect_grid(image)

    def test_missing_extra_and_merged_columns(self):
        for change in ("missing", "extra", "merged", "shared"):
            with self.subTest(change=change):
                image, columns, rows = table()
                if change == "missing":
                    image[rows[1] + 1:rows[2], columns[3]] = 255
                elif change == "extra":
                    image[rows[1] + 1:rows[2], 180] = 0
                elif change == "merged":
                    image[rows[3] + 1:rows[4], columns[3]] = 255
                else:
                    image[rows[5] + 1:rows[6], columns[3]] = 0
                with self.assertRaisesRegex(Rejected, "layout:"):
                    detect_grid(image)

    def test_unreadable_resolution(self):
        with self.assertRaisesRegex(Rejected, "layout: resolution"):
            detect_grid(np.full((600, 900, 3), 255, dtype=np.uint8))

    def test_header_and_footer_are_not_food_crops(self):
        image, _, rows = table()
        # Synthetic private zones use a sentinel absent from all extracted crops.
        image[:65, :350] = (17, 23, 31)
        image[rows[-1] + 1:, :350] = (17, 23, 31)
        for crop in crop_regions(image, detect_grid(image)).values():
            self.assertFalse(np.any(np.all(crop == (17, 23, 31), axis=2)))


class DateTests(unittest.TestCase):
    def test_exact_dates_with_optional_separator_and_year(self):
        for heading in ("2026.09.07 ~ 2026.09.13", "2026.09.072026.09.13",
                        "2026.09.07~09.13", "2026.09.0709.13"):
            with self.subTest(heading=heading):
                texts = date_texts()
                texts["period"] = [heading]
                validate_dates(texts, "2026-09-07", "2026-09-13")

    def test_december_january_rollover(self):
        texts = date_texts("2026-12-28")
        texts["period"] = ["2026.12.28 ~ 01.03"]
        validate_dates(texts, "2026-12-28", "2027-01-03")

    def test_real_disagreeing_articles(self):
        with self.assertRaisesRegex(Rejected, "date-mismatch: period"):
            texts = date_texts("2026-09-14")
            texts["period"] = ["2026.09.07 ~ 2026.09.13"]
            validate_dates(texts, "2026-09-14", "2026-09-20")
        with self.assertRaisesRegex(Rejected, "date-mismatch: title-period"):
            validate_dates(date_texts("2026-08-24"), "2026-08-27", "2026-08-30")

    def test_every_day_and_weekday_is_independent(self):
        for index in range(7):
            for replacement in ([], ["09월 07일"], ["09월 09일 목요일"]):
                with self.subTest(index=index, replacement=replacement):
                    texts = date_texts()
                    texts[f"{index}.date"] = replacement
                    with self.assertRaisesRegex(Rejected, f"date-mismatch: {index}.date"):
                        validate_dates(texts, "2026-09-07", "2026-09-13")

    def test_unreadable_year_and_heading(self):
        for key, replacement in (("year", ["2025년"]), ("period", []),
                                 ("period", ["2026.09.07"]),
                                 ("period", ["2026.09.07 ~ 2026.09.13extra"])):
            texts = date_texts()
            texts[key] = replacement
            with self.assertRaises(Rejected):
                validate_dates(texts, "2026-09-07", "2026-09-13")

    def test_invalid_calendar_and_partial_weeks(self):
        for start, end in (("2026-02-30", "2026-03-08"), ("2026-09-08", "2026-09-14"),
                           ("2026-09-07", "2026-09-14"), ("20260907", "2026-09-13")):
            with self.assertRaisesRegex(Rejected, "date-mismatch: title-period"):
                validate_dates(date_texts(), start, end)

    def test_anchors_do_not_dictionary_correct_unreadable_labels(self):
        texts = {"label.breakfast": ["정성이", "가득한", "조식"], "label.korean": ["한", "식"],
                 "label.common": ["공통"], "label.cupRice": ["컵밥"],
                 "label.dinner": ["행복을", "주는", "석식"], "label.drink": ["음료"]}
        validate_anchors(texts)
        texts["label.cupRice"] = ["겁밥"]
        with self.assertRaisesRegex(Rejected, "layout: label.cupRice"):
            validate_anchors(texts)


class ImageAndOCRTests(unittest.TestCase):
    def test_jpeg_png_digest_and_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            for extension in ("png", "jpg"):
                path = Path(directory) / f"image.{extension}"
                Image.new("RGB", (1000, 700), "white").save(path)
                rgb, digest = load_image(path)
                self.assertEqual(rgb.shape, (700, 1000, 3))
                self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())

    def test_invalid_format_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image"
            for data in (b"", b"not an image", b"x" * (MAX_IMAGE_BYTES + 1)):
                path.write_bytes(data)
                with self.assertRaisesRegex(Rejected, "source: image-"):
                    load_image(path)
            Image.new("RGB", (10, 10)).save(path, format="GIF")
            with self.assertRaisesRegex(Rejected, "source: image-format"):
                load_image(path)

    def test_pixel_bound_precedes_decode(self):
        fake = SimpleNamespace(format="PNG", mode="RGB", info={}, width=4001, height=3000, n_frames=1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image"
            path.write_bytes(b"not decoded")
            with patch("extract_bellarmine.Image.open") as opened:
                opened.return_value.__enter__.return_value = fake
                with self.assertRaisesRegex(Rejected, "source: image-pixels"):
                    load_image(path)

    def test_animated_png_and_rotated_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            Image.new("RGB", (10, 10), "white").save(
                path, save_all=True, append_images=[Image.new("RGB", (10, 10), "black")])
            with self.assertRaisesRegex(Rejected, "source: image-frames"):
                load_image(path)
            exif = Image.Exif()
            exif[274] = 6
            Image.new("RGB", (10, 10)).save(path, exif=exif)
            with self.assertRaisesRegex(Rejected, "layout: image-orientation"):
                load_image(path)

    def fake_ocr(self, texts, scores, boxes):
        return SimpleNamespace(predict=lambda _: [SimpleNamespace(json={"res": {
            "rec_texts": texts, "rec_scores": scores, "rec_boxes": boxes}})])

    def test_blank_differs_from_unread_content(self):
        blank = np.full((100, 200, 3), 255, dtype=np.uint8)
        ocr = self.fake_ocr([], [], [])
        result = read_region(ocr, blank, "0.cupRice")
        self.assertEqual(result, {"texts": [], "minimumScore": None, "uncoveredPixels": 0, "clipped": False})
        blank[30:50, 50:100] = 0
        unread = read_region(ocr, blank, "0.cupRice")
        self.assertGreater(unread["uncoveredPixels"], 0)
        self.assertEqual(unread["texts"], [])

    def test_padding_does_not_hide_content_crossing_cell_borders(self):
        rgb = np.full((100, 200, 3), 255, dtype=np.uint8)
        rgb[-1, 40:70] = 0
        result = read_region(self.fake_ocr([], [], []), rgb, "0.cupRice")
        self.assertTrue(result["clipped"])
        with self.assertRaisesRegex(Rejected, "layout: 0.cupRice"):
            validate_menu_regions({"0.cupRice": result})

    def test_badge_is_not_a_cup_rice_offering_even_with_high_confidence(self):
        for texts in (["추천"], ["오늘의 맛집", "밥"], ["25:00", "밥"],
                      ["12:00"], ["12:00", "밥", "13:00"]):
            with self.assertRaisesRegex(Rejected, "layout: 0.cupRice"):
                validate_menu_regions({"0.cupRice": {
                    "texts": texts, "minimumScore": 1, "uncoveredPixels": 0, "clipped": False}})
        validate_menu_regions({"1.cupRice": {
            "texts": ["11:40", "밥"], "minimumScore": 1, "uncoveredPixels": 0, "clipped": False}})

    def test_unknown_graphics_missed_text_and_low_confidence_fail_closed(self):
        for field, value in (("uncoveredPixels", 20), ("minimumScore", .25), ("clipped", True)):
            region = {"texts": ["밥"], "minimumScore": 1, "uncoveredPixels": 0, "clipped": False}
            region[field] = value
            with self.assertRaises(Rejected):
                validate_menu_regions({"2.dinner": region})
        with self.assertRaisesRegex(Rejected, "ocr-quality: 0.korean"):
            validate_menu_regions({"0.korean": {
                "texts": [], "minimumScore": None, "uncoveredPixels": 25, "clipped": False}})

    def test_closure_is_not_inferred_from_blanks_or_other_meals(self):
        region = {"texts": ["토요일석식미운영"], "minimumScore": 1,
                  "uncoveredPixels": 0, "clipped": False}
        validate_menu_regions({"5.dinner": region})
        for name in ("0.dinner", "5.korean"):
            with self.assertRaisesRegex(Rejected, "layout:"):
                validate_menu_regions({name: region})
        validate_menu_regions({"5.dinner": {
            "texts": [], "minimumScore": None, "uncoveredPixels": 0, "clipped": False}})

    def test_boxes_and_confidence_are_bounded(self):
        blank = np.full((100, 200, 3), 255, dtype=np.uint8)
        for scores, boxes in (([float("nan")], [[10, 10, 20, 20]]),
                              ([1.1], [[10, 10, 20, 20]]), ([1], [[-1, 10, 20, 20]]),
                              ([1], [[10, 10, 10000, 20]]), ([1], [])):
            with self.assertRaisesRegex(Rejected, "ocr-quality:"):
                read_region(self.fake_ocr(["밥"], scores, boxes), blank, "0.dinner")

    def test_split_line_fragments_use_horizontal_not_top_pixel_order(self):
        blank = np.full((100, 200, 3), 255, dtype=np.uint8)
        ocr = self.fake_ocr(["오므라이스", "치킨너겟", "쌀밥"], [1, 1, 1],
                            [[220, 29, 400, 61], [20, 30, 190, 62], [30, 80, 150, 110]])
        result = read_region(ocr, blank, "0.dinner")
        self.assertEqual(result["texts"], ["치킨너겟 오므라이스", "쌀밥"])

    def test_alpha_and_palette_inputs_are_not_silently_reinterpreted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            for mode in ("RGBA", "P"):
                Image.new(mode, (10, 10)).save(path)
                with self.assertRaisesRegex(Rejected, "source: image-color-mode"):
                    load_image(path)

    def test_model_cache_corruption_is_not_source_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                model_directories(directory)
            root = Path(directory) / "PP-OCRv5_mobile_det"
            root.mkdir()
            (root / "config.json").write_text("{}")
            with self.assertRaisesRegex(RuntimeError, "Model asset hash mismatch"):
                model_directories(directory)

    def test_cli_rejects_invalid_images_before_accessing_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "invalid.png"
            image.write_bytes(b"not an image")
            output = root / "result.json"
            result = subprocess.run([
                sys.executable, str(Path(__file__).with_name("extract_bellarmine.py")),
                str(image), "--models", str(root / "absent-models"),
                "--week-start", "2026-09-07", "--week-end", "2026-09-13",
                "--output", str(output)], capture_output=True, timeout=30, check=False)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(json.loads(output.read_text()), {
                "publicationReady": False,
                "rejections": [{"code": "source", "region": "image-decode"}]})

    def test_import_does_not_initialize_paddle(self):
        self.assertNotIn("paddleocr", sys.modules)
        self.assertNotIn("paddle", sys.modules)


if __name__ == "__main__":
    unittest.main()
