import { CaseAggregateError } from "./case-aggregate.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

async function readAsset(client, assetId, assetVersionId, lock) {
  const { rows: [asset] } = await client.query(`
    select id as "assetId", asset_version_id as "assetVersionId", object_version_id as "objectVersionId",
      object_key as "objectKey", mime_type as "mimeType", size_bytes as "sizeBytes", original_filename as "fileName",
      sha256, media_version as "mediaVersion", scan_status as "scanStatus", transcode_status as "transcodeStatus",
      preview_status as "previewStatus", image_width as "imageWidth", image_height as "imageHeight", duration_ms as "durationMs"
    from "case".case_assets where id = $1 and asset_version_id = $2 ${lock ? "for update" : ""}
  `, [assetId, assetVersionId]);
  if (!asset) throw new CaseAggregateError("NOT_FOUND", "素材版本不存在");
  return asset;
}

function mediaView({ assetId, assetVersionId, objectVersionId, sha256, mediaVersion, scanStatus,
  transcodeStatus, previewStatus, imageWidth, imageHeight, durationMs }) {
  return { assetId, assetVersionId, objectVersionId, sha256, mediaVersion, scanStatus, transcodeStatus,
    previewStatus, dimensions: imageWidth === null ? null : { width: imageWidth, height: imageHeight }, durationMs };
}

function assertTransition(current, next) {
  if (next !== undefined && current !== "pending" && next !== current) {
    throw new CaseAggregateError("MEDIA_STATE_CONFLICT", "不能覆盖已确定的处理结果");
  }
}

export async function saveAssetMedia(client, assetId, assetVersionId, input) {
  const asset = await readAsset(client, assetId, assetVersionId, true);
  if (input.objectVersionId !== asset.objectVersionId || input.sha256 !== asset.sha256) {
    throw new CaseAggregateError("VALIDATION_FAILED", "媒体结果与固定对象版本或 SHA-256 不匹配");
  }
  if (input.expectedVersion !== asset.mediaVersion) throw new CaseAggregateError("VERSION_CONFLICT", "媒体版本已变化");
  const result = input.result;
  assertTransition(asset.scanStatus, result.scanStatus);
  assertTransition(asset.transcodeStatus, result.transcodeStatus);
  assertTransition(asset.previewStatus, result.previewStatus);
  if ((result.dimensions && !asset.mimeType.startsWith("image/")) ||
      (result.durationMs && !asset.mimeType.startsWith("video/"))) {
    throw new CaseAggregateError("VALIDATION_FAILED", "媒体元数据与素材类型不匹配");
  }
  const values = [assetVersionId, result.scanStatus ?? asset.scanStatus, result.transcodeStatus ?? asset.transcodeStatus,
    result.previewStatus ?? asset.previewStatus, result.dimensions?.width ?? asset.imageWidth,
    result.dimensions?.height ?? asset.imageHeight, result.durationMs ?? asset.durationMs];
  const updated = await client.query(`
    update "case".case_assets set scan_status = $2, transcode_status = $3, preview_status = $4,
      image_width = $5, image_height = $6, duration_ms = $7, media_version = media_version + 1
    where asset_version_id = $1 and (scan_status, transcode_status, preview_status, image_width, image_height, duration_ms)
      is distinct from ($2::text, $3::text, $4::text, $5::integer, $6::integer, $7::integer)
  `, values);
  return mediaView(updated.rowCount ? await readAsset(client, assetId, assetVersionId, false) : asset);
}

export function createAssetMediaReads(pool, storage) {
  const find = (assetId, assetVersionId) => withCaseAuthoringTransaction(pool, true,
    (client) => readAsset(client, assetId, assetVersionId, false));
  return {
    async state(assetId, assetVersionId) {
      return mediaView(await find(assetId, assetVersionId));
    },
    async ticket(assetId, assetVersionId) {
      return storage.downloadTicket(await find(assetId, assetVersionId));
    },
  };
}
