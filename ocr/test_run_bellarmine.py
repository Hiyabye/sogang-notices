import unittest

import numpy as np

from extract_bellarmine import Rejected, read_region, validate_menu_regions
from run_bellarmine import menu_days


def regions():
    result = {f"{day}.{name}": {"texts": []} for day in range(7)
              for name in ("korean", "western", "cupRice", "dinner")}
    result["common"] = {"texts": ["샐러드"]}
    result["drink"] = {"texts": ["물"]}
    return result


class WorkerTests(unittest.TestCase):
    def test_shared_rows_do_not_invent_service_on_blank_or_closed_days(self):
        data = regions()
        data["0.korean"]["texts"] = ["쌀밥"]
        data["1.western"]["texts"] = ["빵"]
        data["0.dinner"]["texts"] = ["볶음밥"]
        data["5.dinner"]["texts"] = ["토요일 석식 미운영"]
        days = menu_days(data, "2026-09-07")
        self.assertEqual(days[0]["breakfast"]["common"]["items"], ["샐러드"])
        self.assertEqual(days[1]["breakfast"]["common"]["items"], ["샐러드"])
        self.assertEqual(days[2]["breakfast"]["common"]["status"], "unlisted")
        self.assertEqual(days[0]["drink"]["items"], ["물"])
        self.assertEqual(days[5]["dinner"]["status"], "closed")
        self.assertEqual(days[5]["drink"]["status"], "unlisted")
        self.assertEqual(days[6]["date"], "2026-09-13")

    def test_cup_rice_has_its_own_observed_time_not_an_inferred_lunch(self):
        data = regions()
        data["1.cupRice"]["texts"] = ["11:40", "컵밥"]
        days = menu_days(data, "2026-12-28")
        self.assertEqual(days[1]["cupRice"], {"status": "available", "items": ["컵밥"], "serviceTime": "11:40"})
        self.assertNotIn("lunch", days[1])
        self.assertEqual(days[6]["date"], "2027-01-03")

    def test_twelve_items_plus_time_fit_the_offering_limit(self):
        region = {"texts": ["11:40"] + ["밥"] * 12, "minimumScore": 1,
                  "uncoveredPixels": 0, "clipped": False}
        validate_menu_regions({"1.cupRice": region})
        region["texts"].append("국")
        with self.assertRaises(Rejected):
            validate_menu_regions({"1.cupRice": region})

    def test_model_redirects_reject_downgrades_and_credentials_before_following(self):
        from urllib.request import Request
        from download_models import HttpsRedirect
        handler = HttpsRedirect()
        request = Request("https://huggingface.co/example")
        for target in ("http://example.org/model", "https://user:pass@example.org/model", "file:///tmp/model"):
            with self.assertRaises(RuntimeError):
                handler.redirect_request(request, None, 302, "Found", {}, target)
        redirected = handler.redirect_request(request, None, 302, "Found", {}, "https://example.org/model")
        self.assertEqual(redirected.full_url, "https://example.org/model")

    def test_item_length_is_utf16_not_python_codepoint_count(self):
        from types import SimpleNamespace
        def engine(text):
            return SimpleNamespace(predict=lambda _: [SimpleNamespace(json={"res": {
                "rec_texts": [text], "rec_scores": [1], "rec_boxes": [[20, 20, 200, 50]]}})])
        blank = np.full((100, 200, 3), 255, dtype=np.uint8)
        read_region(engine("🍚" * 60), blank, "0.korean")
        with self.assertRaises(Rejected):
            read_region(engine("🍚" * 61), blank, "0.korean")


if __name__ == "__main__":
    unittest.main()
