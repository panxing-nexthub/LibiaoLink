import unittest

import uuid

from worker import PageSummary, extension_of, file_kind, jsonable, parse_json_content


class WorkerUnitTests(unittest.TestCase):
    def test_extension_and_kind(self):
        self.assertEqual(extension_of("a.PDF"), "pdf")
        self.assertEqual(file_kind("a.pdf"), "pdf")
        self.assertEqual(file_kind("a.docx"), "word")
        self.assertEqual(file_kind("a.xlsx"), "excel")
        self.assertEqual(file_kind("a.png"), "image")
        self.assertIsNone(file_kind("a.dwg"))

    def test_jsonable_uuid(self):
        value = uuid.uuid4()
        self.assertEqual(jsonable({"id": value}), {"id": str(value)})

    def test_parse_json_with_fence(self):
        parsed = parse_json_content('说明\n\u0060\u0060\u0060json\n{"summary":"ok","keyFacts":[]}\n\u0060\u0060\u0060')
        self.assertEqual(parsed["summary"], "ok")

    def test_page_summary_truncates_facts(self):
        facts = [{"category": "other", "key": f"k{i}", "value": i, "unit": None, "evidence": "e", "confidence": 0.9} for i in range(12)]
        summary = PageSummary(documentType="pdf", purpose="test", summary="test", keyFacts=facts)
        self.assertEqual(len(summary.keyFacts), 8)

    def test_page_summary_truncates_lists_and_long_items(self):
        summary = PageSummary(
            documentType="pdf",
            purpose="test",
            summary="test",
            risks=[f"risk-{i}" for i in range(12)],
            decisions=[f"decision-{i}" for i in range(12)],
            warnings=["warning-" + "x" * 700],
            missing=["missing-" + "y" * 400],
        )
        self.assertEqual(len(summary.risks), 8)
        self.assertEqual(len(summary.decisions), 8)
        self.assertEqual(len(summary.warnings), 1)
        self.assertEqual(len(summary.warnings[0]), 500)
        self.assertEqual(len(summary.missing[0]), 300)

    def test_page_summary_rejects_empty_evidence(self):
        with self.assertRaises(Exception):
            PageSummary(documentType="pdf", purpose="test", summary="test", keyFacts=[{"category": "other", "key": "k", "value": 1, "unit": None, "evidence": "", "confidence": 0.9}])


if __name__ == "__main__":
    unittest.main()
