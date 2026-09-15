import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("generate_ponty_jobs", ROOT / "scripts" / "generate-ponty-jobs.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class PontyGeneratorTests(unittest.TestCase):
    def setUp(self):
        payload = json.loads((ROOT / "tests" / "fixtures" / "ponty-v2-feed.json").read_text(encoding="utf-8"))
        self.raw_job = payload[0]

    def test_accepts_the_raw_v2_feed_shape(self):
        self.assertEqual(MODULE.jobs_from_fixture([self.raw_job]), [self.raw_job])

    def test_v2_fetch_requests_only_the_regular_feed(self):
        requests = []

        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(self.payload).encode("utf-8")

        def fake_urlopen(request, timeout):
            requests.append((request, timeout))
            if request.full_url == "https://ponty-system.se/oauth2/token":
                return FakeResponse({"access_token": "test-access-token"})
            return FakeResponse([self.raw_job])

        with patch.object(MODULE.urllib.request, "urlopen", side_effect=fake_urlopen):
            jobs = MODULE.fetch_v2_feed(
                "client-id",
                "client-secret",
                "https://ponty-system.se/oauth2/token",
                "https://openapi.ponty-system.se/v2/ads/feed",
            )

        self.assertEqual(jobs, [self.raw_job])
        self.assertEqual(requests[1][0].full_url, "https://openapi.ponty-system.se/v2/ads/feed")
        self.assertNotIn("showcase", requests[1][0].full_url)
        self.assertEqual(requests[1][0].get_header("Authorization"), "Bearer test-access-token")

    def test_resolves_relative_apply_url_against_ponty_apply_origin(self):
        job = MODULE.normalize_job(self.raw_job)
        self.assertEqual(job["apply_url"], "https://pnty-apply.ponty-system.se/priorekrytering?id=3")

    def test_preserves_absolute_https_apply_url(self):
        raw_job = {**self.raw_job, "apply_url": "https://ansok.example.com/form?id=3"}
        self.assertEqual(MODULE.normalize_job(raw_job)["apply_url"], "https://ansok.example.com/form?id=3")

    def test_writes_grid_data_and_a_matching_static_page(self):
        job = MODULE.normalize_job(self.raw_job)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "_data").mkdir()
            active_count = MODULE.generate(root, [job])

            public_feed = json.loads((root / "assets" / "data" / "ponty-jobs.json").read_text(encoding="utf-8"))
            internal_manifest = json.loads((root / "_data" / "ponty_jobs.json").read_text(encoding="utf-8"))
            self.assertEqual(active_count, 1)
            self.assertEqual(public_feed["jobs"][0]["route"], "/lediga-jobb/serviceelektriker-3/")
            self.assertEqual(public_feed["version"], internal_manifest["version"])
            self.assertTrue((root / "lediga-jobb" / "serviceelektriker-3" / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
