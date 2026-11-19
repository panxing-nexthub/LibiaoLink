import { caseSingleUploadMaxBytes, caseUploadPartBytes } from "@libiaolink/contracts/case-data/assets";
import { CaseAggregateError } from "./case-aggregate.mjs";
import { CaseAssetError } from "./case-asset-storage.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

const uploadColumns = `id as "uploadId", asset_id as "assetId", asset_version_id as "assetVersionId", expires_at as "expiresAt"`;
const assetColumns = `id as "assetId", case_id as "caseId", asset_version_id as "assetVersionId",
  object_version_id as "objectVersionId", original_filename as "fileName", mime_type as "mimeType", size_bytes as "sizeBytes",
  sha256, scan_status as "scanStatus", transcode_status as "transcodeStatus"`;

function multipartPlan(sizeBytes) {
  return { partSize: caseUploadPartBytes, partCount: Math.ceil(sizeBytes / caseUploadPartBytes) };
}

function multipartPartLength(sizeBytes, partNumber) {
  return Math.min(caseUploadPartBytes, sizeBytes - (partNumber - 1) * caseUploadPartBytes);
}

function requireMultipart(upload) {
  if (!upload.multipartUploadId) throw new CaseAggregateError("VALIDATION_FAILED", "会话使用单次 PUT");
}

export async function createCaseUpload(client, storage, caseId, clientId, input) {
  const { rows: [upload] } = await client.query(`
    with ids as (select uuidv7() as upload_id, uuidv7() as version_id)
    insert into "case".case_asset_uploads (id, case_id, client_id, asset_id, asset_version_id, object_key,
      original_filename, mime_type, size_bytes, sha256)
    select upload_id, c.id, $2, coalesce($3::uuid, uuidv7()), version_id, 'cases/' || c.id || '/' || version_id,
           $4, $5, $6, $7
    from "case".cases c cross join ids where c.id = $1
      and ($3::uuid is null or exists (
        select 1 from "case".case_assets where id = $3 and case_id = c.id and client_id = $2
      ))
    returning ${uploadColumns}, object_key as "objectKey"
  `, [caseId, clientId, input.assetId, input.fileName, input.mimeType, input.sizeBytes, input.sha256]);
  if (!upload) throw new CaseAggregateError("NOT_FOUND", "案例或素材不存在");
  const { objectKey, ...session } = upload;
  if (input.sizeBytes <= caseSingleUploadMaxBytes) return session;
  const multipartUploadId = await storage.openMultipart({ objectKey, mimeType: input.mimeType });
  await client.query('update "case".case_asset_uploads set multipart_upload_id = $2 where id = $1',
    [session.uploadId, multipartUploadId]);
  return { ...session, multipart: multipartPlan(input.sizeBytes) };
}

async function findUpload(client, uploadId, clientId, lock = false) {
  const { rows: [upload] } = await client.query(`
    select ${uploadColumns}, case_id as "caseId", object_key as "objectKey", mime_type as "mimeType",
           size_bytes as "sizeBytes", sha256, multipart_upload_id as "multipartUploadId",
           completed_object_version_id as "completedVersionId",
           expires_at > statement_timestamp() as active
    from "case".case_asset_uploads where id = $1 and client_id = $2 ${lock ? "for update" : ""}
  `, [uploadId, clientId]);
  if (!upload) throw new CaseAggregateError("NOT_FOUND", "上传会话不存在");
  return upload;
}

function checkActiveUpload(upload) {
  if (!upload.active) throw new CaseAssetError(410, "UPLOAD_SESSION_EXPIRED", "上传会话已过期");
}

function checkOpenUpload(upload) {
  checkActiveUpload(upload);
  if (upload.completedVersionId) throw new CaseAggregateError("UPLOAD_ALREADY_COMPLETED", "上传会话已完成");
}

function requireAsset(asset) {
  if (!asset) throw new CaseAggregateError("NOT_FOUND", "素材版本不存在");
  return asset;
}

async function findAsset(client, assetId, assetVersionId, clientId) {
  const { rows: [asset] } = await client.query(`
    select ${assetColumns}, object_key as "objectKey" from "case".case_assets
    where id = $1 and asset_version_id = $2 and client_id = $3
  `, [assetId, assetVersionId, clientId]);
  return requireAsset(asset);
}

async function mergedVersion(storage, upload) {
  const parts = await storage.listParts(upload);
  if (parts) {
    const { partCount } = multipartPlan(upload.sizeBytes);
    if (parts.length !== partCount || parts.some((part, index) =>
      part.partNumber !== index + 1 || part.sizeBytes !== multipartPartLength(upload.sizeBytes, index + 1))) {
      throw new CaseAssetError(409, "UPLOAD_PARTS_INCOMPLETE", "分片尚未齐全或大小不符，请续传后用原操作标识重试");
    }
    const version = await storage.mergeParts(upload, parts);
    if (version) return version;
  }
  return storage.locateUploadVersion(upload);
}

export async function completeCaseUpload(client, storage, uploadId, clientId, { objectVersionId, operatorUserKey }) {
  const upload = await findUpload(client, uploadId, clientId, true);
  const multipart = Boolean(upload.multipartUploadId);
  if (multipart && objectVersionId) {
    throw new CaseAggregateError("VALIDATION_FAILED", "分片上传由网关取得合并版本");
  }
  if (upload.completedVersionId) {
    if (objectVersionId && upload.completedVersionId !== objectVersionId) {
      throw new CaseAggregateError("UPLOAD_ALREADY_COMPLETED", "上传会话已绑定另一个对象版本");
    }
    const { objectKey, ...asset } = await findAsset(client, upload.assetId, upload.assetVersionId, clientId);
    return asset;
  }
  checkActiveUpload(upload);
  const versionId = multipart ? await mergedVersion(storage, upload) :
    objectVersionId ?? await storage.locateUploadVersion(upload);
  if (!versionId) throw new CaseAssetError(409, "UPLOAD_OBJECT_MISSING", "找不到该会话的对象版本，请用原操作标识重试");
  await storage.verify(upload, versionId);
  const updated = await client.query(`
    update "case".case_asset_uploads set completed_object_version_id = $2
    where id = $1 and expires_at > statement_timestamp()
  `, [uploadId, versionId]);
  checkActiveUpload({ active: updated.rowCount === 1 });
  const kind = upload.mimeType === "application/pdf" ? "document" : upload.mimeType.split("/")[0];
  const { rows: [asset] } = await client.query(`
    insert into "case".case_assets (id, case_id, client_id, asset_version_id, object_version_id, object_key, asset_kind,
      original_filename, mime_type, size_bytes, sha256, transcode_status, created_by)
    select asset_id, case_id, client_id, asset_version_id, completed_object_version_id, object_key, $2,
      original_filename, mime_type, size_bytes, sha256, $3, $4
    from "case".case_asset_uploads where id = $1
    returning ${assetColumns}
  `, [uploadId, kind, kind === "video" ? "pending" : "not_required", operatorUserKey]);
  return asset;
}

export function createCaseAssets(pool, storage) {
  return {
    async target(uploadId, clientId) {
      const upload = await withCaseAuthoringTransaction(pool, true, (client) => findUpload(client, uploadId, clientId));
      checkOpenUpload(upload);
      if (upload.multipartUploadId) throw new CaseAggregateError("VALIDATION_FAILED", "分片会话应申请单个分片上传地址");
      return storage.uploadTarget(upload);
    },
    async partTarget(uploadId, clientId, partNumber) {
      const upload = await withCaseAuthoringTransaction(pool, true, (client) => findUpload(client, uploadId, clientId));
      checkOpenUpload(upload);
      requireMultipart(upload);
      const length = multipartPartLength(upload.sizeBytes, partNumber);
      if (length <= 0) throw new CaseAggregateError("VALIDATION_FAILED", "分片编号超出会话范围");
      return storage.partTarget(upload, partNumber, length);
    },
    async parts(uploadId, clientId) {
      const upload = await withCaseAuthoringTransaction(pool, true, (client) => findUpload(client, uploadId, clientId));
      requireMultipart(upload);
      const plan = multipartPlan(upload.sizeBytes);
      if (upload.completedVersionId) return { ...plan, uploadedParts: [], merged: true };
      checkActiveUpload(upload);
      const parts = await storage.listParts(upload);
      if (parts) return { ...plan, uploadedParts: parts.map(({ partNumber, sizeBytes }) => ({ partNumber, sizeBytes })), merged: false };
      const recovered = await storage.locateUploadVersion(upload);
      if (!recovered) throw new CaseAssetError(409, "UPLOAD_OBJECT_MISSING", "找不到该会话的分片或已合并版本");
      return { ...plan, uploadedParts: [], merged: true };
    },
    async ticket(assetId, assetVersionId, clientId) {
      const asset = await withCaseAuthoringTransaction(pool, true,
        (client) => findAsset(client, assetId, assetVersionId, clientId));
      return storage.downloadTicket(asset);
    },
  };
}
