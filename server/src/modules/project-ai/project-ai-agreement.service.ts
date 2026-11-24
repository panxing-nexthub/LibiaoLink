import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  ProjectAiExtractedFieldSchema,
  type ProjectAiAgreement,
  type ProjectAiAgreementImage,
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
const MAX_MANUAL_IMAGES_PER_KIND = 12;
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

/** 兼容旧版单对象 extraction.layout / threeD 与新版数组。 */
function asImageArray(value: unknown): RawRecord[] {
  if (Array.isArray(value)) {
    return value.map((item) => asRecord(item)).filter((item): item is RawRecord => item !== null);
  }
  const single = asRecord(value);
  return single === null ? [] : [single];
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

function imageUrl(projectId: string, kind: ImageKind, revision: string, imageId: string | null): string {
  let url = "/api/v1/projects/" + encodeURIComponent(projectId) + "/ai-agreement-images/" + kind + "?v=" + encodeURIComponent(revision);
  if (imageId !== null) url += "&imageId=" + encodeURIComponent(imageId);
  return url;
}

/**
 * 技术协议定向抽取（P1）读取面 + 人工图片（0117 支持一类多张）。
 *
 * 自动抽取由 document-analysis worker 写入 project_file_analyses.summary_json.extraction；
 * 人工图片写入 project_ai_manual_images，读图时手动值整体优先于自动图。
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
      .where(eq(projectAiManualImages.projectId, projectId))
      .orderBy(asc(projectAiManualImages.kind), asc(projectAiManualImages.sortOrder), asc(projectAiManualImages.updatedAt));
    const extractedAt = (found.generatedAt ?? new Date()).toISOString();
    const manualOf = (kind: ImageKind) => manualRows.filter((row) => row.kind === kind);
    const revision = (kind: ImageKind): string => {
      const rows = manualOf(kind);
      if (rows.length === 0) return extractedAt;
      return rows.reduce((latest, row) => (row.updatedAt.getTime() > latest.getTime() ? row.updatedAt : latest), rows[0]?.updatedAt ?? new Date(extractedAt)).toISOString();
    };
    const imagesOf = (kind: ImageKind): ProjectAiAgreementImage[] => {
      const manual = manualOf(kind);
      if (manual.length > 0) {
        return manual.map((row) => ({
          id: row.id,
          manual: true,
          pageNo: null,
          url: imageUrl(projectId, kind, revision(kind), row.id),
          caption: "人工上传",
        }));
      }
      return asImageArray(raw[kind === "layout" ? "layout" : "threeD"]).map((image, index) => {
        const pageNo = pageOf(image);
        const hasObject = typeof image["objectKey"] === "string" && image["objectKey"] !== "";
        return {
          id: "auto-" + String(index),
          manual: false,
          pageNo,
          url: hasObject ? imageUrl(projectId, kind, extractedAt, null) : null,
          caption: pageNo === null ? null : "技术协议第 " + String(pageNo) + " 页",
        };
      });
    };
    return {
      fileName: found.fileName,
      fileVersionId: found.fileVersionId,
      partyA: fieldOf(raw["partyA"]),
      customer: fieldOf(raw["customer"]),
      projectAddress: fieldOf(raw["projectAddress"]),
      background: fieldOf(raw["background"]),
      layout: imagesOf("layout"),
      threeD: imagesOf("three_d"),
      extractedAt,
    };
  }

  /** 受控读取抽取 / 人工图片：只认库里记录的对象键，不向客户端暴露对象存储地址。 */
  async image(projectId: string, kind: ImageKind, imageId?: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (imageId !== undefined) {
      const rows = await this.database.db
        .select()
        .from(projectAiManualImages)
        .where(
          and(
            eq(projectAiManualImages.projectId, projectId),
            eq(projectAiManualImages.kind, kind),
            eq(projectAiManualImages.id, imageId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      const object = await this.storage.getObject(row.objectKey);
      return object === null ? null : { bytes: Buffer.from(object.bytes), contentType: row.mime };
    }

    const manualRows = await this.database.db
      .select()
      .from(projectAiManualImages)
      .where(and(eq(projectAiManualImages.projectId, projectId), eq(projectAiManualImages.kind, kind)))
      .orderBy(asc(projectAiManualImages.sortOrder), asc(projectAiManualImages.updatedAt))
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
    const images = asImageArray(raw[kind === "layout" ? "layout" : "threeD"]);
    const image = images[0];
    const objectKey = image !== undefined && typeof image["objectKey"] === "string" ? image["objectKey"] : null;
    if (objectKey === null || objectKey === "") return null;
    const object = await this.storage.getObject(objectKey);
    return object === null ? null : { bytes: Buffer.from(object.bytes), contentType: object.contentType ?? "image/png" };
  }

  /** 追加一张人工图片；同类型最多 12 张，人工图整体覆盖自动抽取图。 */
  async replace(projectId: string, kind: ImageKind, actorId: string, bytes: Buffer, _mime: string): Promise<void> {
    const mime = detectImageMime(bytes);
    const extension = mime === null ? undefined : MANUAL_MIME_EXTENSION[mime];
    if (mime === null || extension === undefined) {
      throw new AppError("VALIDATION_FAILED", "仅支持 PNG / JPEG / WebP 图片");
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANUAL_IMAGE_BYTES) {
      throw new AppError("VALIDATION_FAILED", "图片为空或超过 10 MB");
    }
    const existing = await this.database.db
      .select({ sortOrder: projectAiManualImages.sortOrder })
      .from(projectAiManualImages)
      .where(and(eq(projectAiManualImages.projectId, projectId), eq(projectAiManualImages.kind, kind)))
      .orderBy(desc(projectAiManualImages.sortOrder))
      .limit(1);
    const nextSortOrder = (existing[0]?.sortOrder ?? -1) + 1;
    if (nextSortOrder >= MAX_MANUAL_IMAGES_PER_KIND) {
      throw new AppError("VALIDATION_FAILED", "每类最多上传 12 张图片");
    }
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const objectKey = "projects/" + projectId + "/ai-extraction/manual/" + kind + "-" + hash + "." + extension;
    await this.storage.putObject({ objectKey, body: bytes, contentType: mime });
    await this.database.db.insert(projectAiManualImages).values({
      projectId,
      kind,
      objectKey,
      mime,
      sizeBytes: bytes.byteLength,
      sortOrder: nextSortOrder,
      updatedBy: actorId,
    });
  }

  /** 移除一张人工图片；其余人工图片保留，全部移除后回落到自动抽取图。 */
  async remove(projectId: string, kind: ImageKind, actorId: string, imageId: string): Promise<void> {
    void actorId;
    await this.database.db
      .delete(projectAiManualImages)
      .where(
        and(
          eq(projectAiManualImages.projectId, projectId),
          eq(projectAiManualImages.kind, kind),
          eq(projectAiManualImages.id, imageId),
        ),
      );
  }
}
