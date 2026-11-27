import io
import tempfile
import unittest

import uuid
from pathlib import Path

import pymupdf as fitz
from PIL import Image

from worker import PageSummary, extension_of, extract_page_picture, file_kind, find_agreement_background, jsonable, parse_json_content


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


class PictureExtractionTests(unittest.TestCase):
    @staticmethod
    def _png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
        buffer = io.BytesIO()
        Image.new("RGB", (width, height), color).save(buffer, "PNG")
        return buffer.getvalue()

    def test_extracts_dominant_picture_instead_of_page_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "agreement.pdf"
            doc = fitz.open()
            page = doc.new_page(width=595, height=842)
            page.insert_image(fitz.Rect(40, 40, 80, 80), stream=self._png(64, 64, (200, 0, 0)))
            page.insert_image(fitz.Rect(40, 150, 555, 500), stream=self._png(1200, 800, (10, 120, 200)))
            doc.save(pdf_path)
            doc.close()

            doc = fitz.open(pdf_path)
            page = doc.load_page(0)
            picture = extract_page_picture(page, Path(tmp), 0)
            doc.close()

            self.assertIsNotNone(picture)
            self.assertGreaterEqual(picture["width"], 1000)
            self.assertGreaterEqual(picture["height"], 600)
            with Image.open(picture["path"]) as image:
                self.assertEqual(image.format, "PNG")
                self.assertEqual((image.width, image.height), (picture["width"], picture["height"]))

    def test_returns_none_when_page_has_no_embedded_picture(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = fitz.open()
            doc.new_page(width=595, height=842)
            page = doc.load_page(0)
            self.assertIsNone(extract_page_picture(page, Path(tmp), 0))
            doc.close()


class AgreementBackgroundTests(unittest.TestCase):
    @staticmethod
    def _page(no: int, text: str) -> dict:
        return {"pdfPage": no, "text": text}

    @staticmethod
    def _record(summary: str) -> dict:
        return {"extraction": {"summary": summary}}

    def test_background_skips_toc_and_supplier_intro(self):
        pages = [
            self._page(1, "目录 1 公司简介 2 项目概述 3 方案设计"),
            self._page(2, "公司简介 立镖机器人 企业使命 研发投入 发明专利 技术优势"),
            self._page(3, "项目概述 客户为某某科技有限公司 项目位于广州市 场地为1层播种区"),
        ]
        records = [
            self._record("本页为技术协议第1页目录，列出公司简介、项目概述等章节。"),
            self._record("本页为技术协议第2页，介绍立镖机器人公司简介、企业使命、研发投入与专利。"),
            self._record("客户为某某科技有限公司，项目位于广州市，场地为1层播种区。"),
        ]
        result = find_agreement_background(pages, records)
        self.assertEqual(result["status"], "found")
        self.assertNotIn("立镖", result["value"])
        self.assertNotIn("目录", result["value"])
        self.assertIn("某某科技有限公司", result["value"])

    def test_background_not_found_when_only_supplier_intro(self):
        pages = [self._page(1, "公司简介 立镖机器人 企业使命 研发投入 技术优势")]
        records = [self._record("本页为技术协议第1页，介绍立镖机器人公司简介与发展历程。")]
        result = find_agreement_background(pages, records)
        self.assertEqual(result["status"], "not_found")
        self.assertIsNone(result["value"])


if __name__ == "__main__":
    unittest.main()
