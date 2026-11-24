#!/usr/bin/env python3
"""LibiaoLink document-analysis worker.

Processes only files visible in the project detail "项目文件" view:
task files plus change-request files. Allowed kinds: PDF, image, Word, Excel.
Report-site and issue images are excluded for image files.

The worker is intentionally a separate service because document conversion requires
LibreOffice, Poppler and PyMuPDF, which must not be installed into the API container.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import boto3
import cairosvg
import pymupdf as fitz
import psycopg
import requests
from botocore.config import Config as BotoConfig
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageOps
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError, field_validator

PROMPT_VERSION = "project-file-summary-v1"
MAX_FACTS = 8
MAX_PAGES_DEFAULT = 20
MODEL_TIMEOUT_SECONDS = 180
CONVERSION_TIMEOUT_SECONDS = 90
MAX_FILE_MB_DEFAULT = 200
IMAGE_DPI = 120
MAX_IMAGE_SIDE = 1600
EXTRACTION_VERSION = "project-agreement-extraction-v4"
AGREEMENT_DOC_TYPE = "技术协议"
LAYOUT_WORDS = ("布局", "平面布置", "平面图", "车间布局", "布局规划", "cad")
THREE_D_WORDS = ("三维图", "三维效果", "三维模型", "3d图", "3d效果", "3d模型", "效果图", "渲染图", "鸟瞰")
BACKGROUND_WORDS = ("项目背景", "背景需求", "需求概述", "建设目标", "项目概述", "项目需求", "场地信息")

WORD_EXT = {"doc", "docx"}
EXCEL_EXT = {"xls", "xlsx"}
IMAGE_EXT = {"png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "avif", "gif", "svg"}
FACT_CATEGORIES = {
    "basic_info", "business", "performance", "scope", "responsibility",
    "site", "network", "power", "team", "schedule", "safety", "delivery", "other",
}
logger = logging.getLogger("document-analysis-worker")


class KeyFact(BaseModel):
    category: Literal["basic_info", "business", "performance", "scope", "responsibility", "site", "network", "power", "team", "schedule", "safety", "delivery", "other"]
    key: str = Field(min_length=1, max_length=120)
    value: Any | None = None
    unit: str | None = None
    evidence: str = Field(min_length=1, max_length=600)
    confidence: float = Field(ge=0, le=1)

    @field_validator("value")
    @classmethod
    def normalize_value(cls, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, list):
            return [str(v) for v in value[:20]]
        return json.dumps(value, ensure_ascii=False)[:1000]


class PageSummary(BaseModel):
    documentType: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=600)
    summary: str = Field(min_length=1, max_length=1500)
    keyFacts: list[KeyFact] = Field(default_factory=list, max_length=MAX_FACTS)
    risks: list[str] = Field(default_factory=list, max_length=8)
    decisions: list[str] = Field(default_factory=list, max_length=8)
    warnings: list[str] = Field(default_factory=list, max_length=10)
    missing: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("keyFacts", mode="before")
    @classmethod
    def truncate_facts(cls, value: Any) -> Any:
        return value[:MAX_FACTS] if isinstance(value, list) else value

    @field_validator("risks", "decisions", mode="before")
    @classmethod
    def truncate_risks_decisions(cls, value: Any) -> Any:
        return [str(item)[:600] for item in value[:8]] if isinstance(value, list) else value

    @field_validator("warnings", mode="before")
    @classmethod
    def truncate_warnings(cls, value: Any) -> Any:
        return [str(item)[:500] for item in value[:10]] if isinstance(value, list) else value

    @field_validator("missing", mode="before")
    @classmethod
    def truncate_missing(cls, value: Any) -> Any:
        return [str(item)[:300] for item in value[:10]] if isinstance(value, list) else value


def jsonable(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def extension_of(name: str) -> str:
    suffix = Path(name).suffix
    return suffix[1:].lower() if suffix else ""


def file_kind(name: str) -> str | None:
    ext = extension_of(name)
    if ext == "pdf":
        return "pdf"
    if ext in WORD_EXT:
        return "word"
    if ext in EXCEL_EXT:
        return "excel"
    if ext in IMAGE_EXT:
        return "image"
    return None


def read_secret(name: str) -> str | None:
    for key in (name, name.upper()):
        value = os.environ.get(key)
        if value:
            return value
    path = Path("/run/secrets") / name.lower()
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return None


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def decrypt_model_key_stored(encoded: str, provider_id: str, value: str) -> str:
    key = base64.b64decode(encoded, validate=True)
    version, iv_b64, tag_b64, cipher_b64 = value.split(":", 3)
    if version != "v1":
        raise RuntimeError("unsupported model key version")
    iv = b64url_decode(iv_b64)
    tag = b64url_decode(tag_b64)
    cipher = b64url_decode(cipher_b64)
    plaintext = AESGCM(key).decrypt(iv, cipher + tag, provider_id.encode("utf-8"))
    return plaintext.decode("utf-8")


def parse_json_content(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model content contains no JSON object")
    return json.loads(text[start:end + 1])


def connect_db() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL missing")
    return psycopg.connect(dsn, row_factory=dict_row)


def find_project(conn: psycopg.Connection, arg: str) -> tuple[str, str]:
    try:
        uuid.UUID(arg)
        row = conn.execute("select id, code from projects where id = %s and deleted_at is null", (arg,)).fetchone()
    except ValueError:
        row = conn.execute("select id, code from projects where code = %s and deleted_at is null", (arg,)).fetchone()
    if row is None:
        raise RuntimeError("project not found: " + arg)
    return str(row["id"]), str(row["code"])


def active_model(conn: psycopg.Connection) -> dict[str, Any]:
    row = conn.execute(
        """
        select p.id, p.base_url, s.model_id, p.api_key_encrypted
        from ai_model_selection s
        join ai_model_providers p on p.id = s.provider_id
        where s.id limit 1
        """
    ).fetchone()
    if row is None:
        raise RuntimeError("no active model configured")
    encrypted = row.get("api_key_encrypted")
    if not encrypted:
        raise RuntimeError("active model has no API key")
    encryption_key = read_secret("model_config_encryption_key")
    if not encryption_key:
        raise RuntimeError("MODEL_CONFIG_ENCRYPTION_KEY missing")
    key = decrypt_model_key_stored(encryption_key, str(row["id"]), str(encrypted))
    return {"base_url": str(row["base_url"]).rstrip("/"), "model_id": str(row["model_id"]), "api_key": key}


def s3_client():
    endpoint = os.environ.get("S3_ENDPOINT")
    if not endpoint:
        raise RuntimeError("S3_ENDPOINT missing")
    access = read_secret("s3_access_key")
    secret = read_secret("s3_secret_key")
    if not access or not secret:
        raise RuntimeError("S3 credentials missing")
    force = os.environ.get("S3_FORCE_PATH_STYLE", "auto")
    path_style = bool(force == "true") if force in ("true", "false") else not re.search(r"\.amazonaws\.com$", endpoint, re.I)
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        config=BotoConfig(s3={"addressing_style": "path" if path_style else "auto"}, signature_version="s3v4", retries={"max_attempts": 3}),
    )


def prompt_for_page(page_no: int, printed_label: str | None, display_name: str, kind: str, page_text: str) -> str:
    return (
        "你是项目 AI 总结的文件提炼器。目标不是抄录，而是提炼对项目总结有价值的信息。"
        "只输出一个 JSON 对象，不要解释、Markdown 或代码围栏。\n\n"
        "输出结构：{\"documentType\":\"文件类型\",\"purpose\":\"文件用途\",\"summary\":\"本页摘要\","
        "\"keyFacts\":[{\"category\":\"basic_info|business|performance|scope|responsibility|site|network|power|team|schedule|safety|delivery|other\","
        "\"key\":\"字段名\",\"value\":\"值\",\"unit\":\"单位或null\",\"evidence\":\"原文短句\",\"confidence\":0.0}],"
        "\"risks\":[\"风险\"],\"decisions\":[\"决策\"],\"warnings\":[\"需人工确认\"],\"missing\":[\"缺失信息\"]}\n\n"
        "硬约束：\n"
        "1. 最多 5 条 keyFacts；tables 不得输出；禁止逐行抄写任务清单、进度表、规则表或长表格。\n"
        "2. 长表页面只总结总体进度、关键规则、异常、延期和关键结论。\n"
        "3. 只使用页面图片和文本中出现的事实，不推断。\n"
        "4. 小字不确定时写入 warnings，不要猜。\n"
        "5. 所有数组必须存在，无内容返回 []。\n"
        "6. 硬长度：summary ≤ 600 字；risks / decisions / warnings / missing 各 ≤ 3 条；整份 JSON ≤ 1200 个汉字。\n\n"
        f"文件：{display_name}；类型：{kind}；PDF 第 {page_no} 页；印刷页码：{printed_label or '未识别'}。\n\n"
        "页面文本：\n" + page_text[:10000]
    )


def prompt_for_page_compact(page_no: int, printed_label: str | None, display_name: str, kind: str, page_text: str) -> str:
    return (
        "你是项目文件提炼器。只输出一个 JSON 对象，不要解释、Markdown 或代码围栏。\n\n"
        "结构：{\"documentType\":\"文件类型\",\"purpose\":\"文件用途\",\"summary\":\"本页摘要\","
        "\"keyFacts\":[{\"category\":\"basic_info|business|performance|scope|responsibility|site|network|power|team|schedule|safety|delivery|other\","
        "\"key\":\"字段名\",\"value\":\"值\",\"unit\":null,\"evidence\":\"原文短句\",\"confidence\":0.0}],"
        "\"risks\":[],\"decisions\":[],\"warnings\":[],\"missing\":[]}\n\n"
        "硬约束：summary ≤ 200 字；keyFacts ≤ 3 条；risks / decisions / warnings / missing 各 ≤ 2 条；"
        "不要逐行抄写表格；只使用页面中出现的事实。\n\n"
        f"文件：{display_name}；类型：{kind}；PDF 第 {page_no} 页；印刷页码：{printed_label or '未识别'}。\n\n"
        "页面文本：\n" + page_text[:6000]
    )


JSON_OBJECT_MODE = "unknown"


def call_model(model: dict[str, Any], prompt: str, image_png: bytes, max_tokens: int | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    global JSON_OBJECT_MODE
    payload = {
        "model": model["model_id"],
        "temperature": 0,
        "max_tokens": int(max_tokens if max_tokens is not None else os.environ.get("DOCUMENT_ANALYSIS_MAX_TOKENS", "10000")),
        "stream": False,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image_png).decode("ascii")}},
            ],
        }],
    }
    use_json = JSON_OBJECT_MODE != "unsupported"
    if use_json:
        payload["response_format"] = {"type": "json_object"}
    started = time.time()
    response = requests.post(
        model["base_url"] + "/chat/completions",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + model["api_key"]},
        json=payload,
        timeout=MODEL_TIMEOUT_SECONDS,
    )
    if use_json and response.status_code in (400, 422):
        JSON_OBJECT_MODE = "unsupported"
        logger.warning("document analysis: model gateway rejected response_format, falling back to text JSON")
        payload.pop("response_format", None)
        response = requests.post(
            model["base_url"] + "/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + model["api_key"]},
            json=payload,
            timeout=MODEL_TIMEOUT_SECONDS,
        )
    if response.status_code != 200:
        raise RuntimeError("model HTTP " + str(response.status_code) + ": " + response.text[:500])
    if use_json and JSON_OBJECT_MODE == "unknown":
        JSON_OBJECT_MODE = "supported"
    data = response.json()
    choice = (data.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content") or ""
    finish_reason = choice.get("finish_reason")
    usage = data.get("usage") or {}
    logger.info(
        "page model finish=%s promptTokens=%s completionTokens=%s chars=%s",
        finish_reason,
        usage.get("prompt_tokens"),
        usage.get("completion_tokens"),
        len(content),
    )
    if finish_reason == "length":
        raise RuntimeError("model output truncated (finish_reason=length)")
    parsed = PageSummary.model_validate(parse_json_content(content))
    meta = {
        "model": model["model_id"],
        "finishReason": finish_reason,
        "elapsedMs": int((time.time() - started) * 1000),
        "promptVersion": PROMPT_VERSION,
        "completionTokens": usage.get("completion_tokens"),
    }
    return parsed.model_dump(), meta


def convert_to_pdf(source: Path, temp_dir: Path) -> Path:
    output = temp_dir / "source.pdf"
    profile = temp_dir / "lo-profile"
    soffice = shutil.which("libreoffice") or shutil.which("soffice")
    if not soffice:
        raise RuntimeError("LibreOffice binary not found")
    command = [
        soffice, "--headless", "--norestore", "--nofirststartwizard",
        "-env:UserInstallation=file://" + profile.as_posix(),
        "--convert-to", "pdf", "--outdir", temp_dir.as_posix(), source.as_posix(),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=CONVERSION_TIMEOUT_SECONDS)
    if result.returncode != 0 or not output.exists():
        raise RuntimeError("LibreOffice conversion failed: " + (result.stderr or result.stdout)[-800:])
    return output


def image_coverage(page: fitz.Page) -> float:
    rect = page.rect
    if rect.width <= 0 or rect.height <= 0:
        return 0.0
    area = 0.0
    try:
        for info in page.get_images(full=True):
            xref = info[0]
            try:
                for image_rect in page.get_image_rects(xref):
                    area += max(0.0, image_rect.width) * max(0.0, image_rect.height)
            except Exception:
                continue
    except Exception:
        return 0.0
    return min(1.0, area / (rect.width * rect.height))


def is_technical_agreement(row: dict[str, Any]) -> bool:
    doc_type = str(row.get("doc_type") or "")
    name = str(row.get("name") or "")
    return doc_type == AGREEMENT_DOC_TYPE or "技术协议" in name or "技术规格书" in name


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def labeled_value(text: str, labels: tuple[str, ...]) -> tuple[str | None, str | None]:
    for label in labels:
        for match in re.finditer(rf"{label}\s*[:：]\s*([^\n\r]{{1,120}})", text):
            value = normalize_space(match.group(1))
            value = re.split(r"[；;]", value)[0].strip()
            if value:
                return value, normalize_space(match.group(0))[:600]
    return None, None


def agreement_field(value: str | None, evidence: str | None, page_no: int | None, confidence: float) -> dict[str, Any]:
    if value:
        return {"status": "found", "value": value, "evidence": evidence, "sourcePage": page_no, "confidence": confidence}
    return {"status": "not_found", "value": None, "evidence": None, "sourcePage": None, "confidence": 0.0}


def find_agreement_field(
    pages: list[dict[str, Any]],
    page_records: list[dict[str, Any]],
    labels: tuple[str, ...],
) -> dict[str, Any]:
    ordered = pages[:8]
    for page in ordered:
        value, evidence = labeled_value(page["text"], labels)
        if value:
            return agreement_field(value, evidence, page["pdfPage"], 0.75)
    # 扫描件 / 文本层缺失时，退回前 5 页逐页模型 keyFacts；字段名必须由目标标签开头，
    # 避免「大客户销售」被当成客户、团队联系人被当成甲方。
    for record in page_records:
        if int(record["page"]["pdfPage"]) > 5:
            continue
        for fact in record["extraction"].get("keyFacts") or []:
            key = str(fact.get("key") or "")
            if not any(key.startswith(label) for label in labels):
                continue
            raw_value = fact.get("value")
            if isinstance(raw_value, list):
                raw_value = "、".join(str(item) for item in raw_value)
            value = normalize_space(str(raw_value or ""))
            if value:
                page_no = record["page"]["pdfPage"]
                return agreement_field(
                    value,
                    str(fact.get("evidence") or "")[:600],
                    page_no,
                    float(fact.get("confidence") or 0.5),
                )
    return agreement_field(None, None, None, 0.0)


def find_agreement_background(pages: list[dict[str, Any]], page_records: list[dict[str, Any]]) -> dict[str, Any]:
    pieces: list[str] = []
    for page, record in zip(pages, page_records):
        extraction = record["extraction"]
        combined = " ".join([
            str(page["text"] or ""),
            str(extraction.get("documentType") or ""),
            str(extraction.get("summary") or ""),
        ])
        if "目录" in combined:
            continue
        if any(word in page["text"] for word in BACKGROUND_WORDS):
            summary = str(extraction.get("summary") or "").strip()
            if summary:
                pieces.append(summary)
    if not pieces:
        for record in page_records[1:5]:
            summary = str(record["extraction"].get("summary") or "").strip()
            if summary:
                pieces.append(summary)
    value = "\n".join(pieces).strip()
    if len(value) > 1200:
        value = value[:1200] + "…"
    if value:
        return agreement_field(value, value[:200], None, 0.6)
    return agreement_field(None, None, None, 0.0)


def select_agreement_page(
    pages: list[dict[str, Any]],
    page_records: list[dict[str, Any]],
    words: tuple[str, ...],
    exclude_page: int | None = None,
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_score = 0.0
    for page, record in zip(pages, page_records):
        if len(pages) > 1 and page["pdfPage"] == 1:
            continue
        if exclude_page is not None and page["pdfPage"] == exclude_page:
            continue
        extraction = record["extraction"]
        combined = " ".join([
            str(page["text"] or ""),
            str(extraction.get("documentType") or ""),
            str(extraction.get("purpose") or ""),
            str(extraction.get("summary") or ""),
        ]).lower()
        score = (5.0 if any(word in combined for word in words) else 0.0) + float(page.get("imageCoverage") or 0.0) * 3.0
        if score > best_score:
            best = page
            best_score = score
    if best is None or best_score < 3.0:
        return None
    return best


def upload_extraction_image(s3, project_id: str, row: dict[str, Any], kind: str, page: dict[str, Any]) -> dict[str, Any]:
    body = Path(page["imagePath"]).read_bytes()
    digest = str(page["imageSha256"])[:12]
    object_key = f"projects/{project_id}/ai-extraction/{row['file_id']}/{kind}-{digest}.png"
    s3.put_object(
        Bucket=os.environ.get("S3_BUCKET", "libiaolink"),
        Key=object_key,
        Body=body,
        ContentType="image/png",
        CacheControl="no-store",
    )
    return {"pageNo": page["pdfPage"], "objectKey": object_key, "byteSize": len(body)}


def build_agreement_extraction(
    s3,
    project_id: str,
    row: dict[str, Any],
    pages: list[dict[str, Any]],
    page_records: list[dict[str, Any]],
) -> dict[str, Any]:
    party_a = find_agreement_field(pages, page_records, ("甲方名称", "甲方", "委托方", "买方", "发包方"))
    customer = find_agreement_field(pages, page_records, ("客户名称", "最终用户", "使用单位", "业主", "客户"))
    address = find_agreement_field(pages, page_records, ("项目地址", "实施地点", "建设地点", "场地地址"))
    background = find_agreement_background(pages, page_records)
    layout_page = select_agreement_page(pages, page_records, LAYOUT_WORDS)
    three_d_page = select_agreement_page(
        pages,
        page_records,
        THREE_D_WORDS,
        exclude_page=layout_page["pdfPage"] if layout_page is not None else None,
    )
    empty_image = {"pageNo": None, "objectKey": None, "byteSize": 0}
    return {
        "fileName": str(row["name"]),
        "fileVersionId": str(row["file_version_id"]),
        "partyA": party_a,
        "customer": customer,
        "projectAddress": address,
        "background": background,
        "layout": upload_extraction_image(s3, project_id, row, "layout", layout_page) if layout_page is not None else empty_image,
        "threeD": upload_extraction_image(s3, project_id, row, "three_d", three_d_page) if three_d_page is not None else empty_image,
    }


def render_document_pages(source_bytes: bytes, display_name: str, kind: str, temp_dir: Path) -> tuple[list[dict[str, Any]], int]:
    ext = extension_of(display_name)
    pages: list[dict[str, Any]] = []
    if kind == "image":
        image_source = io.BytesIO(source_bytes)
        if ext == "svg":
            image_source = io.BytesIO(cairosvg.svg2png(bytestring=source_bytes))
        with Image.open(image_source) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
            page_path = temp_dir / "page-001.png"
            image.save(page_path, "PNG", optimize=True)
        pages.append({"pdfPage": 1, "printedPageLabel": None, "imagePath": page_path, "text": "", "imageCoverage": 1.0, "imageSha256": sha256_bytes(page_path.read_bytes()), "textSha256": sha256_bytes(b"")})
        return pages, 1

    source_path = temp_dir / ("source." + ext)
    source_path.write_bytes(source_bytes)
    pdf_path = source_path if ext == "pdf" else convert_to_pdf(source_path, temp_dir)
    doc = fitz.open(pdf_path)
    try:
        total_pages = doc.page_count
        max_pages = int(os.environ.get("DOCUMENT_ANALYSIS_MAX_PAGES", str(MAX_PAGES_DEFAULT)))
        for index in range(min(total_pages, max_pages)):
            page = doc.load_page(index)
            text = page.get_text("text") or ""
            matrix = fitz.Matrix(IMAGE_DPI / 72.0, IMAGE_DPI / 72.0)
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            page_path = temp_dir / ("page-" + str(index + 1).zfill(3) + ".png")
            pixmap.save(page_path.as_posix())
            match = re.search(r"第\s*(\d+)\s*页\s*共\s*(\d+)\s*页", text)
            printed_label = f"第{match.group(1)}页共{match.group(2)}页" if match else None
            pages.append({
                "pdfPage": index + 1,
                "printedPageLabel": printed_label,
                "imagePath": page_path,
                "text": text,
                "imageCoverage": image_coverage(page),
                "imageSha256": sha256_bytes(page_path.read_bytes()),
                "textSha256": sha256_bytes(text.encode("utf-8")),
            })
        return pages, total_pages
    finally:
        doc.close()


def analyze_file(conn: psycopg.Connection, model: dict[str, Any], s3, project_id: str, row: dict[str, Any]) -> dict[str, Any]:
    name = str(row["name"])
    kind = file_kind(name)
    if kind is None:
        raise RuntimeError("unsupported file type")
    max_bytes = int(os.environ.get("DOCUMENT_ANALYSIS_MAX_FILE_MB", str(MAX_FILE_MB_DEFAULT))) * 1024 * 1024
    if int(row["size_bytes"] or 0) > max_bytes:
        raise RuntimeError("file exceeds size limit")
    response = s3.get_object(Bucket=os.environ.get("S3_BUCKET", "libiaolink"), Key=str(row["object_key"]))
    source_bytes = response["Body"].read()
    if len(source_bytes) > max_bytes:
        raise RuntimeError("downloaded file exceeds size limit")
    temp_dir = Path(tempfile.mkdtemp(prefix="libiaolink-doc-analysis-"))
    try:
        pages, total_pages = render_document_pages(source_bytes, name, kind, temp_dir)
        page_records: list[dict[str, Any]] = []
        agreement_compact = is_technical_agreement(row)
        for page in pages:
            prompt = (
                prompt_for_page_compact(page["pdfPage"], page["printedPageLabel"], name, kind, page["text"])
                if agreement_compact
                else prompt_for_page(page["pdfPage"], page["printedPageLabel"], name, kind, page["text"])
            )
            image_bytes = page["imagePath"].read_bytes()
            try:
                extraction, meta = call_model(model, prompt, image_bytes)
            except Exception as error:  # noqa: BLE001 - 单页失败不能拖垮整份文件
                logger.warning(
                    "page analysis failed, retry compact project=%s file=%s page=%s: %s",
                    project_id,
                    name,
                    page["pdfPage"],
                    str(error)[:300],
                )
                try:
                    compact_prompt = prompt_for_page_compact(
                        page["pdfPage"],
                        page["printedPageLabel"],
                        name,
                        kind,
                        page["text"],
                    )
                    extraction, meta = call_model(model, compact_prompt, image_bytes, max_tokens=2000)
                except Exception as retry_error:  # noqa: BLE001
                    logger.warning(
                        "page analysis skipped project=%s file=%s page=%s: %s",
                        project_id,
                        name,
                        page["pdfPage"],
                        str(retry_error)[:300],
                    )
                    extraction = {
                        "documentType": kind,
                        "purpose": "",
                        "summary": "",
                        "keyFacts": [],
                        "risks": [],
                        "decisions": [],
                        "warnings": ["本页分析失败：" + str(retry_error)[:200]],
                        "missing": [],
                    }
                    meta = {
                        "model": model["model_id"],
                        "finishReason": "failed",
                        "elapsedMs": 0,
                        "promptVersion": PROMPT_VERSION,
                    }
            page_records.append({
                "page": {
                    "pdfPage": page["pdfPage"],
                    "printedPageLabel": page["printedPageLabel"],
                    "imageSha256": page["imageSha256"],
                    "textSha256": page["textSha256"],
                },
                "extraction": extraction,
                "meta": meta,
            })
        key_facts: list[dict[str, Any]] = []
        risks: list[str] = []
        decisions: list[str] = []
        warnings: list[str] = []
        missing: list[str] = []
        summaries: list[str] = []
        for record in page_records:
            extraction = record["extraction"]
            summaries.append(extraction["summary"])
            for fact in extraction["keyFacts"]:
                if len(key_facts) >= MAX_FACTS:
                    break
                key_facts.append({**fact, "sourcePage": record["page"]})
            risks.extend(extraction["risks"])
            decisions.extend(extraction["decisions"])
            warnings.extend(extraction["warnings"])
            missing.extend(extraction["missing"])
        summary = {
            "file": {"name": name, "kind": kind},
            "selection": {"taskId": str(row.get("task_id")) if row.get("task_id") else None, "changeFile": bool(row.get("change_file")), "reportIssueImage": bool(row.get("report_issue_link"))},
            "pageCount": total_pages,
            "analyzedPages": len(page_records),
            "truncated": total_pages > len(page_records),
            "pages": page_records,
            "summary": {
                "documentType": page_records[0]["extraction"]["documentType"] if page_records else kind,
                "purpose": page_records[0]["extraction"]["purpose"] if page_records else "",
                "summaries": summaries,
                "keyFacts": key_facts[:MAX_FACTS],
                "risks": risks[:12],
                "decisions": decisions[:12],
                "warnings": warnings[:15],
                "missing": missing[:15],
            },
        }
        if is_technical_agreement(row):
            try:
                summary["extractionVersion"] = EXTRACTION_VERSION
                summary["extraction"] = build_agreement_extraction(s3, project_id, row, pages, page_records)
            except Exception as error:  # noqa: BLE001 - 抽取失败不能拖垮整份文件分析
                logger.warning(
                    "agreement extraction failed project=%s file=%s: %s",
                    project_id,
                    name,
                    str(error)[:500],
                )
        return summary
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def select_project_files(conn: psycopg.Connection, project_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        with change_files as (
          select distinct v.file_id
          from file_versions v
          join change_requests c on c.id = v.change_request_id
          where c.project_id = %s
        )
        select f.id as file_id, f.name, f.status, f.task_id, f.doc_type, f.current_version_id as file_version_id,
               fv.content_hash, fv.object_key, fv.mime, fv.size_bytes,
               (cf.file_id is not null) as change_file,
               exists(select 1 from file_links fl where fl.file_id = f.id and fl.object_type in ('report', 'issue')) as report_issue_link
        from files f
        join file_versions fv on fv.id = f.current_version_id
        left join change_files cf on cf.file_id = f.id
        where f.project_id = %s
          and f.status in ('draft', 'final', 'changed', 'archived')
          and (
            f.task_id is not null
            or cf.file_id is not null
            or f.doc_type = '技术协议'
            or f.name like %s
            or f.name like %s
          )
        order by f.updated_at desc, f.name
        """,
        (project_id, project_id, "%技术协议%", "%技术规格书%"),
    ).fetchall()
    return list(rows)


def upsert_analysis(conn: psycopg.Connection, run_id: str, project_id: str, row: dict[str, Any], kind: str, status: str, summary: dict[str, Any] | None, model_id: str | None, error: str | None) -> None:
    conn.execute(
        """
        insert into project_file_analyses
          (project_id, file_id, file_version_id, content_hash, file_name, file_kind, status, summary_json, model_id, prompt_version, error, generated_at, updated_at)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
        on conflict (file_version_id, prompt_version) do update set
          status = excluded.status, summary_json = excluded.summary_json, model_id = excluded.model_id,
          error = excluded.error, generated_at = excluded.generated_at, updated_at = now()
        """,
        (project_id, row["file_id"], row["file_version_id"], row["content_hash"], row["name"], kind, status, Jsonb(jsonable(summary)) if summary is not None else None, model_id, PROMPT_VERSION, error),
    )
    conn.commit()


def process_run(conn: psycopg.Connection, run: dict[str, Any]) -> None:
    run_id = str(run["id"])
    project_id = str(run["project_id"])
    project_code = str(run["project_code"])
    started = time.time()
    try:
        model = active_model(conn)
        s3 = s3_client()
        rows = select_project_files(conn, project_id)
        supported = []
        skipped = 0
        for row in rows:
            kind = file_kind(str(row["name"]))
            if kind is None:
                skipped += 1
                continue
            if kind == "image" and row.get("report_issue_link"):
                skipped += 1
                continue
            supported.append((row, kind))
        conn.execute(
            "update project_document_analysis_runs set status='running', file_count=%s, skipped_count=%s, started_at=now(), updated_at=now() where id=%s",
            (len(supported), skipped, run_id),
        )
        conn.commit()
        succeeded = 0
        failed = 0
        for row, kind in supported:
            try:
                existing = conn.execute(
                    "select status, summary_json from project_file_analyses where file_version_id=%s and prompt_version=%s and status='succeeded' limit 1",
                    (row["file_version_id"], PROMPT_VERSION),
                ).fetchone()
                if existing is not None:
                    existing_summary = existing.get("summary_json")
                    needs_extraction = is_technical_agreement(row) and not (
                        isinstance(existing_summary, dict)
                        and isinstance(existing_summary.get("extraction"), dict)
                        and existing_summary.get("extractionVersion") == EXTRACTION_VERSION
                    )
                    if not needs_extraction:
                        succeeded += 1
                        logger.info("reuse analysis project=%s file=%s", project_code, row["name"])
                        continue
                logger.info("analyze project=%s file=%s kind=%s bytes=%s", project_code, row["name"], kind, row["size_bytes"])
                summary = analyze_file(conn, model, s3, project_id, row)
                upsert_analysis(conn, run_id, project_id, row, kind, "succeeded", summary, model["model_id"], None)
                succeeded += 1
            except Exception as error:  # noqa: BLE001 - one bad file must not stop the project run
                failed += 1
                message = str(error)[:1000]
                logger.exception("file analysis failed project=%s file=%s: %s", project_code, row["name"], message)
                upsert_analysis(conn, run_id, project_id, row, kind, "failed", None, model["model_id"], message)
        status = "succeeded" if failed == 0 or succeeded > 0 else "failed"
        conn.execute(
            "update project_document_analysis_runs set status=%s, succeeded_count=%s, failed_count=%s, finished_at=now(), updated_at=now() where id=%s",
            (status, succeeded, failed, run_id),
        )
        conn.commit()
        logger.info("run complete project=%s run=%s succeeded=%s failed=%s skipped=%s elapsedMs=%s", project_code, run_id, succeeded, failed, skipped, int((time.time() - started) * 1000))
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        logger.exception("run failed project=%s run=%s: %s", project_code, run_id, str(error)[:1000])
        conn.execute(
            "update project_document_analysis_runs set status='failed', error=%s, finished_at=now(), updated_at=now() where id=%s",
            (str(error)[:2000], run_id),
        )
        conn.commit()


def enqueue_run(conn: psycopg.Connection, project_id: str, code: str, requested_by: str | None) -> str:
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (project_id,))
        active = conn.execute(
            "select id from project_document_analysis_runs where project_id=%s and status in ('queued','running') limit 1 for update",
            (project_id,),
        ).fetchone()
        if active is not None:
            return str(active["id"])
        row = conn.execute(
            "insert into project_document_analysis_runs (project_id, status, prompt_version, requested_by) values (%s, 'queued', %s, %s) returning id",
            (project_id, PROMPT_VERSION, requested_by),
        ).fetchone()
        if row is None:
            raise RuntimeError("failed to create run")
        logger.info("enqueued project=%s run=%s", code, row["id"])
        return str(row["id"])


def claim_run(conn: psycopg.Connection, run_id: str | None = None) -> dict[str, Any] | None:
    with conn.transaction():
        if run_id is None:
            row = conn.execute(
                """
                select r.id, r.project_id, p.code as project_code
                from project_document_analysis_runs r
                join projects p on p.id = r.project_id
                where r.status = 'queued'
                order by r.created_at
                for update skip locked
                limit 1
                """
            ).fetchone()
        else:
            row = conn.execute(
                """
                select r.id, r.project_id, p.code as project_code
                from project_document_analysis_runs r
                join projects p on p.id = r.project_id
                where r.id = %s and r.status = 'queued'
                for update
                """,
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        conn.execute("update project_document_analysis_runs set status='running', started_at=now(), updated_at=now() where id=%s", (row["id"],))
        return dict(row)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="LibiaoLink document-analysis worker")
    sub = parser.add_subparsers(dest="command", required=True)
    enqueue = sub.add_parser("enqueue")
    enqueue.add_argument("--project", required=True, help="project code or UUID")
    enqueue.add_argument("--requested-by", default=None)
    run = sub.add_parser("run")
    run.add_argument("--project", required=True, help="project code or UUID")
    run.add_argument("--requested-by", default=None)
    poll = sub.add_parser("poll")
    poll.add_argument("--once", action="store_true")
    poll.add_argument("--interval", type=int, default=30)
    args = parser.parse_args()

    conn = connect_db()
    try:
        if args.command == "enqueue":
            project_id, code = find_project(conn, args.project)
            run_id = enqueue_run(conn, project_id, code, args.requested_by)
            conn.commit()
            print(json.dumps({"runId": run_id, "projectId": project_id, "projectCode": code}, ensure_ascii=False, indent=2))
        elif args.command == "run":
            project_id, code = find_project(conn, args.project)
            run_id = enqueue_run(conn, project_id, code, args.requested_by)
            conn.commit()
            claimed = claim_run(conn, run_id)
            if claimed is None:
                raise RuntimeError("run is not queued: " + run_id)
            process_run(conn, claimed)
        elif args.command == "poll":
            while True:
                claimed = claim_run(conn)
                if claimed is None:
                    if args.once:
                        break
                    time.sleep(max(5, args.interval))
                    continue
                process_run(conn, claimed)
                if args.once:
                    break
    finally:
        conn.close()


if __name__ == "__main__":
    main()
