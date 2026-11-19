import { z } from "../zod.ts";
import { CaseUuidSchema, caseWriteContext } from "./case-requests.ts";

export const caseSingleUploadMaxBytes = 32 * 1024 * 1024;
export const caseAssetMaxBytes = 256 * 1024 * 1024;
export const caseUploadPartBytes = 8 * 1024 * 1024;
export const caseUploadMaxParts = caseAssetMaxBytes / caseUploadPartBytes;
const mimeType = z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "application/pdf"]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const sizeBytes = z.number().int().min(1).max(caseAssetMaxBytes);
const fileName = z.string().trim().min(1).max(255).refine(
  (value) => !/[\\/\u0000-\u001f\u007f\ud800-\udfff]/u.test(value) && value !== "." && value !== "..",
  "文件名含不支持的字符",
);
const timestamp = z.iso.datetime({ offset: true });
export const CaseObjectVersionIdSchema = z.string().min(1).max(1024).refine(
  (value) => value !== "null" && value.trim() === value && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  "须提供对象存储返回的版本 ID",
);

export const CaseCreateUploadBodySchema = z.strictObject({
  ...caseWriteContext, assetId: CaseUuidSchema.optional(), fileName, mimeType, sizeBytes, sha256,
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
export const CaseAssetVersionSchema = z.strictObject({
  caseId: CaseUuidSchema, assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema,
  objectVersionId: CaseObjectVersionIdSchema, fileName, mimeType, sizeBytes, sha256,
  scanStatus: z.enum(["pending", "passed", "failed"]),
  transcodeStatus: z.enum(["not_required", "pending", "ready", "failed"]),
}).openapi("CaseAssetVersion");
export const CaseAssetDownloadTicketSchema = z.strictObject({
  method: z.literal("GET"), url: z.url(), expiresAt: timestamp, objectVersionId: CaseObjectVersionIdSchema,
}).openapi("CaseAssetDownloadTicket");

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
