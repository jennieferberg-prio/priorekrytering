import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "meta_importer", Path(__file__).resolve().parents[1] / "scripts/import-meta-leads.py"
)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def lead(lead_id="l:example"):
    return {"id": lead_id, "email": "test@example.com", "full_name": "Test Person",
            "phone_number": "p:+46700000000", "platform": "fb"}


class MetaImportTests(unittest.TestCase):
    def test_maps_contact_to_spontanansokan(self):
        payload = importer.application_payload(lead())
        self.assertEqual(payload["assignment_id"], 1)
        self.assertEqual(payload["phone"], "+46700000000")
        self.assertEqual(payload["firstname"], "Test")
        self.assertEqual(payload["lastname"], "Person")

    def test_dry_run_does_not_write_tracking(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            importer.import_leads([lead()], {}, path)
            self.assertFalse(path.exists())

    def test_preserves_ad_and_self_reported_title_as_application_details(self):
        row = lead()
        row.update(ad_name=" Elektriker – Stockholm ", job_title=" Servicetekniker ")
        payload = importer.application_payload(row)
        self.assertEqual(payload["extra"],
                         "Annons: Elektriker – Stockholm\nAngiven yrkestitel: Servicetekniker")
        self.assertEqual(payload["assignment_id"], 1)
        row.update(ad_name="", job_title=None)
        self.assertNotIn("extra", importer.application_payload(row))

    def test_skips_imported_and_repeated_ids_and_respects_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            state = {"l:old": 12}
            submitted = []

            def submit(payload):
                submitted.append(payload)
                return 13

            importer.import_leads(
                [lead("l:old"), lead(), lead(), lead("l:later")], state, path, submit, 1
            )
            self.assertEqual(len(submitted), 1)
            self.assertEqual(json.loads(path.read_text()), {"l:old": 12, "l:example": 13})

    def test_failed_submission_is_not_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            state = {}
            with self.assertRaises(RuntimeError):
                importer.import_leads([lead()], state, path,
                                      lambda payload: (_ for _ in ()).throw(RuntimeError("Failed")))
            self.assertEqual(state, {})
            self.assertFalse(path.exists())

    def test_sheet_authorization_failure_is_not_an_empty_import(self):
        with patch.object(importer, "request_json", return_value={"ok": False}):
            with self.assertRaises(RuntimeError):
                importer.read_leads("https://example.com", "test-token")

    def test_submits_multipart_payload_and_returns_application_id(self):
        with patch.object(importer, "request_json", return_value={"data": {"application_id": 42}}) as request:
            payload = importer.application_payload(lead())
            self.assertEqual(importer.create_application(payload, "test-token"), 42)
            url, body, headers = request.call_args.args
            self.assertEqual(url, "https://openapi.ponty-system.se/v2/applications")
            self.assertTrue(headers["Content-Type"].startswith("multipart/form-data; boundary="))
            self.assertIn(json.dumps(payload).encode(), body)
            self.assertNotIn(b"auto_approve", body)


if __name__ == "__main__":
    unittest.main()
