import { z } from "../zod.ts";
import { CaseLocaleSchema, CaseUuidSchema, caseWriteContext } from "./case-requests.ts";

export const caseSingleUploadMaxBytes = 32 * 1024 * 1024;
export const caseAssetMaxBytes = 256 * 1024 * 1024;
export const caseUploadPartBytes = 8 * 1024 * 1024;
export const caseUploadMaxParts = caseAssetMaxBytes / caseUploadPartBytes;
export const CaseAssetTypeSchema = z.enum(["logo", "cover", "image", "video", "document", "other"]);
export const CaseAssetClassificationSchema = z.enum(["L1", "L2", "L3"]);
const mimeType = z.enum(["image/png", "image/jpeg", "image/webp", "image/avif", "video/mp4", "application/pdf"]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const sizeBytes = z.number().int().min(1).max(caseAssetMaxBytes);
const timestamp = z.iso.datetime({ offset: true });
const fileName = z.string().trim().min(1).max(255).refine(
  (value) => !/[\\/\u0000-\u001f\u007f\ud800-\udfff]/u.test(value) && value !== "." && value !== "..",
  "文件名含不支持的字符",
);
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional()
  .transform((value) => value?.trim() ? value : null);
const tag = z.string().trim().min(1).max(64).refine(
  (value) => !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value), "标签含不支持的字符",
);
const tags = z.array(tag).max(30).default([]).superRefine((items, context) => {
  const seen = new Set<string>();
  for (const [index, value] of items.entries()) {
    if (seen.has(value)) context.addIssue({ code: "custom", path: [index], message: "标签不可重复" });
    seen.add(value);
  }
});
const metadataFields = {
  assetType: CaseAssetTypeSchema.default("other"),
  title: optionalText(300),
  description: optionalText(2000),
  locale: CaseLocaleSchema.nullable().optional().transform((value) => value ?? null),
  tags,
  classification: CaseAssetClassificationSchema.default("L1"),
  customerVisible: z.boolean().default(false),
  customerPresentationAllowed: z.boolean().default(false),
  shareAllowed: z.boolean().default(false),
};
export const CaseObjectVersionIdSchema = z.string().min(1).max(1024).refine(
  (value) => value !== "null" && value.trim() === value && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  "须提供对象存储返回的版本 ID",
);

export const CaseCreateUploadBodySchema = z.strictObject({
  ...caseWriteContext, assetId: CaseUuidSchema.optional(), fileName, mimeType, sizeBytes, sha256, ...metadataFields,
}).openapi("CaseCreateUploadBody");
export const CaseCompleteUploadBodySchema = z.strictObject({
  ...caseWriteContext, objectVersionId: CaseObjectVersionIdSchema.optional(),
}).openapi("CaseCompleteUploadBody");
export const CaseUploadSessionSchema = z.strictObject({
  uploadId: CaseUuidSchema, assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema, expiresAt: timestamp,
  multipart: z.strictObject({ partSize: z.literal(caseUploadPartBytes), partCount: z.number().int().min(1).max(caseUploadMaxParts) }).optional(),
}).openapi("CaseUploadSession");
export const CaseUploadTargetSchema = z.strictObject({
  url: z.url(), expiresAt: timestamp, method: z.literal("PUT"), headers: z.record(z.string(), z.string()),
}).openapi("CaseUploadTarget");
export const CaseAssetDownloadTicketSchema = z.strictObject({
  method: z.literal("GET"), url: z.url(), expiresAt: timestamp, objectVersionId: CaseObjectVersionIdSchema,
  contentType: z.string().min(1),
}).openapi("CaseAssetDownloadTicket");
export const CaseAssetPreviewTicketSchema = CaseAssetDownloadTicketSchema.openapi("CaseAssetPreviewTicket");

export const CaseUploadPartNumberSchema = z.number().int().min(1).max(caseUploadMaxParts);
export const CaseUploadedPartsSchema = z.strictObject({
  partSize: z.literal(caseUploadPartBytes), partCount: CaseUploadPartNumberSchema,
  uploadedParts: z.array(z.strictObject({
    partNumber: CaseUploadPartNumberSchema, sizeBytes: z.number().int().min(1).max(caseUploadPartBytes),
  })).max(caseUploadMaxParts),
  merged: z.boolean(),
}).openapi("CaseUploadedParts");

const scanStatus = z.enum(["pending", "passed", "failed"]);
const transcodeStatus = z.enum(["not_required", "pending", "ready", "failed"]);
const previewStatus = z.enum(["pending", "ready", "failed"]);
const positiveInteger = z.number().int().min(1).max(2_147_483_647);
const dimensions = z.strictObject({ width: positiveInteger, height: positiveInteger });
const mediaResult = z.strictObject({
  scanStatus: z.enum(["passed", "failed"]).optional(),
  transcodeStatus: z.enum(["ready", "failed"]).optional(),
  previewStatus: z.enum(["ready", "failed"]).optional(),
  dimensions: dimensions.optional(), durationMs: positiveInteger.optional(),
}).refine((value) => Object.keys(value).length > 0, "至少提交一项媒体处理结果");

export const CaseSaveAssetMediaBodySchema = z.strictObject({
  ...caseWriteContext, expectedVersion: positiveInteger, objectVersionId: CaseObjectVersionIdSchema, sha256,
  result: mediaResult,
}).openapi("CaseSaveAssetMediaBody");
export const CaseAssetMediaStateSchema = z.strictObject({
  assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema, objectVersionId: CaseObjectVersionIdSchema, sha256,
  mediaVersion: positiveInteger, scanStatus, transcodeStatus, previewStatus,
  dimensions: dimensions.nullable(), durationMs: positiveInteger.nullable(),
}).openapi("CaseAssetMediaState");

const assetMetadata = {
  assetType: CaseAssetTypeSchema, title: z.string().nullable(), description: z.string().nullable(),
  locale: z.string().nullable(), tags: z.array(tag).max(30), classification: CaseAssetClassificationSchema,
  customerVisible: z.boolean(), customerPresentationAllowed: z.boolean(), shareAllowed: z.boolean(),
};
export const CaseAssetVersionViewSchema = z.strictObject({
  projectId: CaseUuidSchema, caseId: CaseUuidSchema.nullable(), assetId: CaseUuidSchema,
  assetVersionId: CaseUuidSchema, versionNo: positiveInteger, objectVersionId: CaseObjectVersionIdSchema,
  ...assetMetadata, fileName, mimeType, sizeBytes, sha256, scanStatus, transcodeStatus, previewStatus,
  dimensions: dimensions.nullable(), durationMs: positiveInteger.nullable(), mediaVersion: positiveInteger,
  thumbnailAvailable: z.boolean(), createdBy: z.string(), createdAt: timestamp,
  rowVersion: positiveInteger, archivedAt: timestamp.nullable(), deletedAt: timestamp.nullable(),
}).openapi("CaseAssetVersionView");
export const CaseAssetVersionSchema = CaseAssetVersionViewSchema;
export const CaseAssetSummarySchema = z.strictObject({
  assetId: CaseUuidSchema, projectId: CaseUuidSchema, caseIds: z.array(CaseUuidSchema).max(500),
  ...assetMetadata, rowVersion: positiveInteger, createdAt: timestamp, updatedAt: timestamp,
  archivedAt: timestamp.nullable(), deletedAt: timestamp.nullable(), currentVersion: CaseAssetVersionViewSchema,
}).openapi("CaseAssetSummary");
export const CaseAssetListSchema = z.strictObject({
  items: z.array(CaseAssetSummarySchema).max(200), nextCursor: z.string().nullable(),
}).openapi("CaseAssetList");
export const CaseAssetVersionListSchema = z.strictObject({
  assetId: CaseUuidSchema, items: z.array(CaseAssetVersionViewSchema).max(200),
}).openapi("CaseAssetVersionList");
export const CaseAssetListQuerySchema = z.strictObject({
  limit: z.coerce.number({ error: "limit 必须是 1–200 的整数" }).int().min(1).max(200).default(50),
  cursor: z.string().optional(), assetType: CaseAssetTypeSchema.optional(),
  includeArchived: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).openapi("CaseAssetListQuery");
export const CaseAssetPatchBodySchema = z.strictObject({
  ...caseWriteContext, expectedVersion: positiveInteger,
  assetType: CaseAssetTypeSchema.optional(),
  title: z.union([z.string().trim().max(300).transform((value) => value || null), z.null()]).optional(),
  description: z.union([z.string().trim().max(2000).transform((value) => value || null), z.null()]).optional(),
  locale: z.union([CaseLocaleSchema, z.null()]).optional(),
  tags: z.array(tag).max(30).optional(), classification: CaseAssetClassificationSchema.optional(),
  customerVisible: z.boolean().optional(), customerPresentationAllowed: z.boolean().optional(), shareAllowed: z.boolean().optional(),
  archived: z.boolean().optional(), deleted: z.boolean().optional(),
}).refine((value) => ["assetType", "title", "description", "locale", "tags", "classification", "customerVisible",
  "customerPresentationAllowed", "shareAllowed", "archived", "deleted"].some((key) => (value as Record<string, unknown>)[key] !== undefined),
"至少提供一个可更新字段").openapi("CaseAssetPatchBody");
export const CaseAssetLinkBodySchema = z.strictObject({ ...caseWriteContext }).openapi("CaseAssetLinkBody");
export const CaseAssetLinkViewSchema = z.strictObject({
  assetId: CaseUuidSchema, caseId: CaseUuidSchema, linked: z.boolean(),
}).openapi("CaseAssetLinkView");
