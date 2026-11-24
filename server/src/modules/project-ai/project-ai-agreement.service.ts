import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  ProjectAiExtractedFieldSchema,
  type ProjectAiAgreement,
  type ProjectAiExtractedField,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { projectAiManualImages } from "../../db/schema/project-ai.js";
import { ObjectStorage } from "../../storage/index.js";
import { DocumentAnalysisService } from "../document-analysis/index.js";

type RawRecord = Record<string, unknown>;
type ImageKind = "layout" | "three_d";

const MAX_MANUAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MANUAL_MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function detectImageMime(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function asRecord(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function fieldOf(value: unknown): ProjectAiExtractedField {
  const parsed = ProjectAiExtractedFieldSchema.safeParse(value);
  if (parsed.success) {
    return {
      status: parsed.data.status,
      value: parsed.data.value,
      evidence: parsed.data.evidence,
      sourcePage: parsed.data.sourcePage,
      confidence: parsed.data.confidence,
    };
  }
  return { status: "failed", value: null, evidence: null, sourcePage: null, confidence: 0 };
}

function pageOf(raw: RawRecord | null): number | null {
  if (raw === null) return null;
  const pageNo = raw["pageNo"];
  return typeof pageNo === "number" && Number.isInteger(pageNo) && pageNo > 0 ? pageNo : null;
}

function imageOf(
  projectId: string,
  kind: ImageKind,
  raw: RawRecord | null,
  revision: string,
  manual: boolean,
): ProjectAiAgreement["layout"] {
  const pageNo = manual ? null : pageOf(raw);
  const hasObject = manual || (raw !== null && typeof raw["objectKey"] === "string" && raw["objectKey"] !== "");
  return {
    pageNo,
    url: hasObject
      ? "/api/v1/projects/" + encodeURIComponent(projectId) + "/ai-agreement-images/" + kind + "?v=" + encodeURIComponent(revision)
      : null,
    caption: manual ? "人工上传" : pageNo === null ? null : "技术协议第 " + String(pageNo) + " 页",
  };
}

/**
 * 技术协议定向抽取（P1）读取面 + 人工替换。
 *
 * 自动抽取由 document-analysis worker 写入 project_file_analyses.summary_json.extraction；
 * 人工替换写入 project_ai_manual_images，读图时手动值优先。
 * 不触发模型、不写总结缓存。
 */
@Injectable()
export class ProjectAiAgreementService {
  constructor(
    private readonly analyses: DocumentAnalysisService,
    private readonly storage: ObjectStorage,
    private readonly database: DatabaseService,
  ) {}

  async load(projectId: string): Promise<ProjectAiAgreement | null> {
    const found = await this.analyses.extractionForProject(projectId);
    if (found === null) return null;
    const raw = asRecord(found.extraction);
    if (raw === null) return null;
    const manualRows = await this.database.db
      .select()
      .from(projectAiManualImages)
      .where(eq(projectAiManualImages.projectId, projectId));
    const manual = new Map(manualRows.map((row) => [row.kind, row]));
    const extractedAt = (found.generatedAt ?? new Date()).toISOString();
    const revision = (kind: ImageKind): string => manual.get(kind)?.updatedAt.toISOString() ?? extractedAt;
    return {
      fileName: found.fileName,
      fileVersionId: found.fileVersionId,
      partyA: fieldOf(raw["partyA"]),
      customer: fieldOf(raw["customer"]),
      projectAddress: fieldOf(raw["projectAddress"]),
      background: fieldOf(raw["background"]),
      layout: imageOf(projectId, "layout", asRecord(raw["layout"]), revision("layout"), manual.has("layout")),
      threeD: imageOf(projectId, "three_d", asRecord(raw["threeD"]), revision("three_d"), manual.has("three_d")),
      extractedAt,
    };
  }

  /** 受控读取抽取 / 人工替换页图：只认库里记录的对象键，不向客户端暴露对象存储地址。 */
  async image(projectId: string, kind: ImageKind): Promise<{ bytes: Buffer; contentType: string } | null> {
    const manualRows = await this.database.db
      .select()
      .from(projectAiManualImages)
      .where(and(eq(projectAiManualImages.projectId, projectId), eq(projectAiManualImages.kind, kind)))
      .limit(1);
    const manual = manualRows[0];
    if (manual !== undefined) {
      const object = await this.storage.getObject(manual.objectKey);
      return object === null ? null : { bytes: Buffer.from(object.bytes), contentType: manual.mime };
    }

    const found = await this.analyses.extractionForProject(projectId);
    if (found === null) return null;
    const raw = asRecord(found.extraction);
    if (raw === null) return null;
    const image = asRecord(raw[kind === "layout" ? "layout" : "threeD"]);
    const objectKey = image !== null && typeof image["objectKey"] === "string" ? image["objectKey"] : null;
    if (objectKey === null || objectKey === "") return null;
    const object = await this.storage.getObject(objectKey);
    return object === null ? null : { bytes: Buffer.from(object.bytes), contentType: object.contentType ?? "image/png" };
  }

  /** 人工替换布局图 / 三维图：校验类型与大小，写对象存储并 upsert 覆盖记录。 */
  async replace(projectId: string, kind: ImageKind, actorId: string, bytes: Buffer, _mime: string): Promise<void> {
    const mime = detectImageMime(bytes);
    const extension = mime === null ? undefined : MANUAL_MIME_EXTENSION[mime];
    if (mime === null || extension === undefined) {
      throw new AppError("VALIDATION_FAILED", "仅支持 PNG / JPEG / WebP 图片");
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANUAL_IMAGE_BYTES) {
      throw new AppError("VALIDATION_FAILED", "图片为空或超过 10 MB");
    }
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const objectKey = "projects/" + projectId + "/ai-extraction/manual/" + kind + "-" + hash + "." + extension;
    await this.storage.putObject({ objectKey, body: bytes, contentType: mime });
    await this.database.db
      .insert(projectAiManualImages)
      .values({ projectId, kind, objectKey, mime, sizeBytes: bytes.byteLength, updatedBy: actorId })
      .onConflictDoUpdate({
        target: [projectAiManualImages.projectId, projectAiManualImages.kind],
        set: { objectKey, mime, sizeBytes: bytes.byteLength, updatedBy: actorId, updatedAt: new Date() },
      });
  }
}
