import { z } from "../zod.ts";
import { CaseObjectVersionIdSchema, caseAssetMaxBytes } from "./asset-requests.ts";
import { CaseCustomerLogoReferenceSchema, CaseLocaleSchema, CaseUuidSchema, caseWriteContext } from "./case-requests.ts";

const text = (length: number) => z.string().trim().min(1).max(length).refine(
  (value) => !/[\u0000\ud800-\udfff]/u.test(value), "含不支持的字符",
);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const sourceVersion = z.number().int().min(0).max(2_147_483_647);
const snapshot = z.strictObject({
  schemaVersion: z.literal(1), locale: CaseLocaleSchema, title: text(300),
  summary: text(5000).nullable().default(null),
  sections: z.array(z.strictObject({ heading: text(200), text: text(20_000) })).max(20).default([]),
}).openapi("PublishedCaseSnapshot");
const assetReferenceFields = {
  assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema, objectVersionId: CaseObjectVersionIdSchema,
};
const assetReference = z.strictObject(assetReferenceFields);
const frozenAssetReference = z.strictObject({
  ...assetReferenceFields, sortOrder: z.number().int().min(0).max(100_000),
});
const writeAssets = z.array(assetReference).max(12).superRefine((assets, context) => {
  const versions = new Set<string>();
  for (const [index, { assetVersionId }] of assets.entries()) {
    if (versions.has(assetVersionId)) context.addIssue({ code: "custom", path: [index, "assetVersionId"], message: "素材版本重复" });
    versions.add(assetVersionId);
  }
});
const expectedActiveReleaseId = CaseUuidSchema.nullable();
const approvalRef = z.string().min(1).max(256).regex(/^[!-~]+$/);

export const StageCaseReleaseBodySchema = z.strictObject({
  ...caseWriteContext, externalProjectId: CaseUuidSchema, sourceVersion, caseSnapshot: snapshot, assets: writeAssets,
}).openapi("StageCaseReleaseBody");
export const ActivateCaseReleaseBodySchema = z.strictObject({
  ...caseWriteContext, expectedActiveReleaseId, approvalRef,
}).openapi("ActivateCaseReleaseBody");
export const DeactivateCaseReleaseBodySchema = z.strictObject({
  ...caseWriteContext, expectedActiveReleaseId,
}).openapi("DeactivateCaseReleaseBody");

const releaseMetadata = {
  releaseId: CaseUuidSchema, caseId: CaseUuidSchema, versionNo: z.number().int().min(1),
  status: z.enum(["staged", "active", "superseded", "withdrawn"]),
  customerLogo: CaseCustomerLogoReferenceSchema.nullable(),
  sourceVersion, caseContentHash: hash, projectSnapshotHash: hash, releaseHash: hash,
  stagedAt: timestamp, activatedAt: timestamp.nullable(), supersededAt: timestamp.nullable(), withdrawnAt: timestamp.nullable(),
};
export const CaseReleaseReceiptSchema = z.strictObject(releaseMetadata).openapi("CaseReleaseReceipt");
export const CaseReleaseHistorySchema = z.strictObject({
  ...releaseMetadata, approvalRef: approvalRef.nullable(), caseSnapshot: snapshot,
  projectSnapshot: z.record(z.string(), z.unknown()), assets: z.array(frozenAssetReference),
}).openapi("CaseReleaseHistory");
export const CaseReleaseListQuerySchema = z.strictObject({
  limit: z.coerce.number({ error: "limit 必须是 1–100 的整数" }).int().min(1).max(100).default(50),
  cursor: z.string().optional(),
}).openapi("CaseReleaseListQuery");
export const CaseReleaseListSchema = z.strictObject({
  items: z.array(CaseReleaseHistorySchema).max(100), nextCursor: z.string().nullable(),
}).openapi("CaseReleaseList");
export const PublishedCaseReleaseSchema = z.strictObject({
  releaseId: CaseUuidSchema, caseId: CaseUuidSchema, versionNo: z.number().int().min(1),
  customerLogo: CaseCustomerLogoReferenceSchema.nullable(), caseSnapshot: snapshot, activatedAt: timestamp,
  assets: z.array(z.strictObject({
    assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema, sortOrder: z.number().int().min(0).max(100_000),
    mimeType: z.string(), sizeBytes: z.number().int().min(1).max(caseAssetMaxBytes),
  })),
}).openapi("PublishedCaseRelease");
