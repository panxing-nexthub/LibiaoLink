import { createHmac, timingSafeEqual } from "node:crypto";
import { caseListCursorPattern } from "@libiaolink/contracts/case-data";
import { CaseAssetListQuerySchema, caseSingleUploadMaxBytes, caseUploadPartBytes } from "@libiaolink/contracts/case-data/assets";
import { CaseAggregateError, CaseQueryError } from "./case-aggregate.mjs";
import { CaseAssetError } from "./case-asset-storage.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

const uploadColumns = `id as "uploadId", case_id as "caseId", project_id as "projectId",
  asset_id as "assetId", asset_version_id as "assetVersionId", expires_at as "expiresAt"`;
const metadataColumns = `m.asset_id as "assetId", m.project_id as "projectId", m.asset_type as "assetType",
  m.title, m.description, m.locale, m.tags, m.classification, m.customer_visible as "customerVisible",
  m.customer_presentation_allowed as "customerPresentationAllowed", m.share_allowed as "shareAllowed",
  m.row_version as "rowVersion", m.created_at as "createdAt", m.updated_at as "updatedAt",
  m.archived_at as "archivedAt", m.deleted_at as "deletedAt"`;
const versionColumns = `${metadataColumns}, a.case_id as "caseId", a.asset_version_id as "assetVersionId",
  a.asset_version_no as "versionNo", a.object_version_id as "objectVersionId", a.original_filename as "fileName",
  a.mime_type as "mimeType", a.size_bytes as "sizeBytes", a.sha256, a.scan_status as "scanStatus",
  a.transcode_status as "transcodeStatus", a.preview_status as "previewStatus",
  a.image_width as "imageWidth", a.image_height as "imageHeight", a.duration_ms as "durationMs",
  a.media_version as "mediaVersion", a.created_by as "createdBy", a.created_at as "versionCreatedAt"`;
const versionFrom = `"case".case_assets a join "case".case_asset_metadata m on m.asset_id = a.id`;
const thumbnailMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/avif", "application/pdf"];

function multipartPlan(sizeBytes) {
  return { partSize: caseUploadPartBytes, partCount: Math.ceil(sizeBytes / caseUploadPartBytes) };
}

function multipartPartLength(sizeBytes, partNumber) {
  return Math.min(caseUploadPartBytes, sizeBytes - (partNumber - 1) * caseUploadPartBytes);
}

function requireMultipart(upload) {
  if (!upload.multipartUploadId) throw new CaseAggregateError("VALIDATION_FAILED", "会话使用单次 PUT");
}

function versionView(row) {
  return {
    projectId: row.projectId, caseId: row.caseId, assetId: row.assetId, assetVersionId: row.assetVersionId,
    versionNo: row.versionNo, objectVersionId: row.objectVersionId, assetType: row.assetType,
    title: row.title, description: row.description, locale: row.locale, tags: row.tags,
    classification: row.classification, customerVisible: row.customerVisible,
    customerPresentationAllowed: row.customerPresentationAllowed, shareAllowed: row.shareAllowed,
    fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, sha256: row.sha256,
    scanStatus: row.scanStatus, transcodeStatus: row.transcodeStatus, previewStatus: row.previewStatus,
    dimensions: row.imageWidth === null ? null : { width: row.imageWidth, height: row.imageHeight },
    durationMs: row.durationMs, mediaVersion: row.mediaVersion,
    thumbnailAvailable: thumbnailMimeTypes.includes(row.mimeType),
    createdBy: row.createdBy, createdAt: row.versionCreatedAt,
    rowVersion: row.rowVersion, archivedAt: row.archivedAt, deletedAt: row.deletedAt,
  };
}

function summaryView(row) {
  return {
    assetId: row.assetId, projectId: row.projectId, caseIds: row.caseIds,
    sortOrder: row.sortOrder ?? null, caseLinks: row.caseLinks, assetType: row.assetType,
    title: row.title, description: row.description, locale: row.locale, tags: row.tags,
    classification: row.classification, customerVisible: row.customerVisible,
    customerPresentationAllowed: row.customerPresentationAllowed, shareAllowed: row.shareAllowed,
    rowVersion: row.rowVersion, createdAt: row.createdAt, updatedAt: row.updatedAt,
    archivedAt: row.archivedAt, deletedAt: row.deletedAt, currentVersion: row.currentVersion,
  };
}

const currentVersionJson = `jsonb_build_object(
  'projectId', m.project_id, 'caseId', a.case_id, 'assetId', m.asset_id, 'assetVersionId', a.asset_version_id,
  'versionNo', a.asset_version_no, 'objectVersionId', a.object_version_id, 'assetType', m.asset_type,
  'title', m.title, 'description', m.description, 'locale', m.locale, 'tags', m.tags,
  'classification', m.classification, 'customerVisible', m.customer_visible,
  'customerPresentationAllowed', m.customer_presentation_allowed, 'shareAllowed', m.share_allowed,
  'fileName', a.original_filename, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes, 'sha256', a.sha256,
  'scanStatus', a.scan_status, 'transcodeStatus', a.transcode_status, 'previewStatus', a.preview_status,
  'dimensions', case when a.image_width is null then null else jsonb_build_object('width', a.image_width, 'height', a.image_height) end,
  'durationMs', a.duration_ms, 'mediaVersion', a.media_version,
  'thumbnailAvailable', a.mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/avif', 'application/pdf'),
  'createdBy', a.created_by, 'createdAt', a.created_at, 'rowVersion', m.row_version,
  'archivedAt', m.archived_at, 'deletedAt', m.deleted_at
)`;
function summarySelect(sortOrderExpression = 'null::integer') {
  return `select m.asset_id as "assetId", m.project_id as "projectId",
  coalesce((select jsonb_agg(l.case_id order by l.sort_order, l.case_id) from "case".case_asset_links l
    where l.asset_id = m.asset_id), '[]'::jsonb) as "caseIds",
  coalesce((select jsonb_agg(jsonb_build_object('caseId', l.case_id, 'sortOrder', l.sort_order)
    order by l.sort_order, l.case_id) from "case".case_asset_links l
    where l.asset_id = m.asset_id), '[]'::jsonb) as "caseLinks",
  ${sortOrderExpression} as "sortOrder",
  m.asset_type as "assetType", m.title, m.description, m.locale, m.tags, m.classification,
  m.customer_visible as "customerVisible", m.customer_presentation_allowed as "customerPresentationAllowed",
  m.share_allowed as "shareAllowed", m.row_version as "rowVersion", m.created_at as "createdAt",
  m.updated_at as "updatedAt", m.archived_at as "archivedAt", m.deleted_at as "deletedAt",
  ${currentVersionJson} as "currentVersion"
  from "case".case_asset_metadata m
  join lateral (
    select a.* from "case".case_assets a
    where a.id = m.asset_id order by a.asset_version_no desc limit 1
  ) a on true`;
}

function cursorSignature(payload, key) {
  return createHmac("sha256", key).update(payload).digest();
}

function encodeCursor(value, filters, key) {
  const payload = Buffer.from(JSON.stringify([value, filters])).toString("base64url");
  return `${payload}.${cursorSignature(payload, key).toString("base64url")}`;
}

function decodeCursor(cursor, filters, key) {
  const match = caseListCursorPattern.exec(cursor);
  if (!match) throw new CaseQueryError("query.cursor", "游标无效");
  const [, payload, encodedSignature] = match;
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.toString("base64url") !== encodedSignature || !timingSafeEqual(signature, cursorSignature(payload, key))) {
    throw new CaseQueryError("query.cursor", "游标无效");
  }
  let value;
  let signedFilters;
  try {
    [value, signedFilters] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new CaseQueryError("query.cursor", "游标无效");
  }
  if (JSON.stringify(signedFilters) !== JSON.stringify(filters)) {
    throw new CaseQueryError("query.cursor", "游标与筛选条件不匹配");
  }
  return value;
}

export function parseAssetListQuery(params, cursorKey, scope, id) {
  const seen = new Set();
  for (const name of params.keys()) {
    if (!Object.hasOwn(CaseAssetListQuerySchema.shape, name)) throw new CaseQueryError("query", "存在未知查询参数");
    if (seen.has(name)) throw new CaseQueryError(`query.${name}`, "查询参数不可重复");
    seen.add(name);
  }
  const parsed = CaseAssetListQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CaseQueryError(`query.${issue.path[0]}`, issue.message);
  }
  const { limit, cursor, assetType = null, includeArchived } = parsed.data;
  const filters = [scope, id, assetType, includeArchived];
  const after = cursor === undefined ? null : decodeCursor(cursor, filters, cursorKey);
  return { limit, filters, afterValue: after?.[0] ?? null, afterId: after?.[1] ?? null };
}

async function readTarget(client, { caseId, projectId }) {
  if (caseId) {
    const { rows: [row] } = await client.query(
      'select source_project_id as "projectId" from "case".cases where id = $1 and deleted_at is null', [caseId],
    );
    if (!row) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
    return row.projectId;
  }
  const { rows: [row] } = await client.query(`
    select project_id as "projectId" from project_read.project_directory
    where project_id = $1 and deleted_at is null and source_missing_at is null
  `, [projectId]);
  if (!row) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
  return row.projectId;
}

async function createMetadata(client, projectId, clientId, input, operatorUserKey) {
  if (input.assetId) {
    const { rowCount } = await client.query(`
      select 1 from "case".case_asset_metadata
      where asset_id = $1 and project_id = $2 and client_id = $3 and deleted_at is null
    `, [input.assetId, projectId, clientId]);
    if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "素材不存在");
    return input.assetId;
  }
  const { rows: [{ assetId }] } = await client.query('select uuidv7() as "assetId"');
  await client.query(`
    insert into "case".case_asset_metadata
      (asset_id, project_id, client_id, asset_type, title, description, locale, tags, classification,
       customer_visible, customer_presentation_allowed, share_allowed, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, $13)
  `, [assetId, projectId, clientId, input.assetType, input.title, input.description, input.locale, input.tags,
    input.classification, input.customerVisible, input.customerPresentationAllowed, input.shareAllowed, operatorUserKey]);
  return assetId;
}

export async function createCaseUpload(client, storage, target, clientId, input) {
  const projectId = await readTarget(client, target);
  const assetId = await createMetadata(client, projectId, clientId, input, input.operatorUserKey);
  const { rows: [upload] } = await client.query(`
    with ids as (select coalesce($1::uuid, uuidv7()) as upload_id, uuidv7() as version_id)
    insert into "case".case_asset_uploads (id, case_id, project_id, client_id, asset_id, asset_version_id,
      object_key, original_filename, mime_type, size_bytes, sha256)
    select upload_id, $2::uuid, $3, $4, $5, version_id,
      'projects/' || $3::uuid || '/assets/' || $5::uuid || '/' || version_id, $6, $7, $8, $9
    from ids
    returning ${uploadColumns}, object_key as "objectKey"
  `, [null, target.caseId ?? null, projectId, clientId, assetId, input.fileName, input.mimeType,
    input.sizeBytes, input.sha256]);
  const { objectKey, ...session } = upload;
  if (input.sizeBytes <= caseSingleUploadMaxBytes) return session;
  const multipartUploadId = await storage.openMultipart({ objectKey, mimeType: input.mimeType });
  await client.query('update "case".case_asset_uploads set multipart_upload_id = $2 where id = $1',
    [session.uploadId, multipartUploadId]);
  return { ...session, multipart: multipartPlan(input.sizeBytes) };
}

async function findUpload(client, uploadId, clientId, lock = false) {
  const { rows: [upload] } = await client.query(`
    select ${uploadColumns}, object_key as "objectKey", mime_type as "mimeType",
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
    select ${versionColumns}, a.object_key as "objectKey", a.client_id as "clientId"
    from ${versionFrom}
    where a.id = $1 and a.asset_version_id = $2 and a.client_id = $3 and m.client_id = $3
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
    return versionView(await findAsset(client, upload.assetId, upload.assetVersionId, clientId));
  }
  checkActiveUpload(upload);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [`case-asset:${upload.assetId}`]);
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
  const { rows: [{ assetVersionId, versionNo }] } = await client.query(`
    with next_version as (
      select coalesce(max(asset_version_no), 0) + 1 as version_no
      from "case".case_assets where id = $5
    )
    insert into "case".case_assets (id, case_id, client_id, asset_version_id, object_version_id, object_key, asset_kind,
      original_filename, mime_type, size_bytes, sha256, transcode_status, created_by, project_id, asset_version_no)
    select asset_id, case_id, client_id, asset_version_id, completed_object_version_id, object_key, $2,
      original_filename, mime_type, size_bytes, sha256, $3, $4, project_id, next_version.version_no
    from "case".case_asset_uploads cross join next_version where id = $1
    returning asset_version_id as "assetVersionId", asset_version_no as "versionNo"
  `, [uploadId, kind, kind === "video" ? "pending" : "not_required", operatorUserKey, upload.assetId]);
  if (versionNo > 1) await client.query(`
    update "case".case_asset_metadata
    set row_version = row_version + 1, updated_at = statement_timestamp()
    where asset_id = $1 and client_id = $2
  `, [upload.assetId, clientId]);
  await client.query(`
    insert into "case".case_asset_links (asset_id, case_id, project_id, created_by, sort_order)
    select u.asset_id, u.case_id, u.project_id, $2,
      least(coalesce((select max(l.sort_order) from "case".case_asset_links l
        where l.case_id = u.case_id), -10) + 10, 100000)
    from "case".case_asset_uploads u
    where u.id = $1 and u.case_id is not null
    on conflict (asset_id, case_id) do nothing
  `, [uploadId, operatorUserKey]);
  return versionView(await findAsset(client, upload.assetId, assetVersionId, clientId));
}

async function listAssets(client, scope, id, clientId, input, cursorKey) {
  const [, , assetType, includeArchived] = input.filters;
  if (scope === "case") {
    const { rowCount } = await client.query('select 1 from "case".cases where id = $1', [id]);
    if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
  } else {
    const { rowCount } = await client.query(`
      select 1 from project_read.project_directory where project_id = $1 and deleted_at is null and source_missing_at is null
    `, [id]);
    if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
  }
  const association = scope === "case"
    ? `join "case".case_asset_links link on link.asset_id = m.asset_id and link.case_id = $2`
    : "where m.project_id = $2";
  const where = scope === "case" ? "where m.client_id = $1" : "and m.client_id = $1";
  const sortOrderExpression = scope === "case" ? 'link.sort_order' : 'null::integer';
  const cursorClause = scope === "case"
    ? 'and ($5::integer is null or (link.sort_order, m.asset_id) > ($5::integer, $6::uuid))'
    : 'and ($5::timestamptz is null or (m.updated_at, m.asset_id) < ($5, $6::uuid))';
  const orderBy = scope === "case"
    ? 'order by link.sort_order asc, m.asset_id asc limit $7'
    : 'order by m.updated_at desc, m.asset_id desc limit $7';
  const { rows } = await client.query(`
    ${summarySelect(sortOrderExpression)}
    ${association}
    ${where}
      and m.deleted_at is null
      and ($3::text is null or m.asset_type = $3)
      and ($4::boolean or m.archived_at is null)
      ${cursorClause}
    ${orderBy}
  `, [clientId, id, assetType, includeArchived, input.afterValue, input.afterId, input.limit + 1]);
  const items = rows.slice(0, input.limit).map(summaryView);
  const cursorValue = scope === "case" ? items.at(-1)?.sortOrder :
    new Date(items.at(-1)?.updatedAt).toISOString();
  const nextCursor = rows.length > input.limit
    ? encodeCursor([cursorValue, items.at(-1).assetId], input.filters, cursorKey) : null;
  return { items, nextCursor };
}

async function assetDetail(client, assetId, clientId) {
  const { rows: [row] } = await client.query(`${summarySelect()} where m.asset_id = $1 and m.client_id = $2`,
    [assetId, clientId]);
  if (!row) throw new CaseAggregateError("NOT_FOUND", "素材不存在");
  return summaryView(row);
}

async function patchAsset(client, assetId, clientId, expectedVersion, patch) {
  const { rows: [current] } = await client.query(`
    select ${metadataColumns} from "case".case_asset_metadata m
    where m.asset_id = $1 and m.client_id = $2 for update
  `, [assetId, clientId]);
  if (!current) throw new CaseAggregateError("NOT_FOUND", "素材不存在");
  if (current.rowVersion !== expectedVersion) throw new CaseAggregateError("VERSION_CONFLICT", "素材版本已变化");
  const fields = Object.keys(patch);
  if (fields.length === 0 || fields.every((field) => {
    if (field === "archived") return (current.archivedAt !== null) === patch[field];
    if (field === "deleted") return (current.deletedAt !== null) === patch[field];
    return JSON.stringify(current[field]) === JSON.stringify(patch[field]);
  })) return assetDetail(client, assetId, clientId);
  if (patch.deleted === true) {
    const { rowCount } = await client.query(`
      select 1 from "case".case_release_assets where asset_id = $1
      union all
      select 1 from "case".case_releases where customer_logo_asset_id = $1
      limit 1
    `, [assetId]);
    if (rowCount) throw new CaseAggregateError("ASSET_REFERENCED", "素材已被发布版本或客户 Logo 快照引用，只能归档，不能删除");
  }
  const assignments = [];
  const values = [];
  const columns = {
    assetType: ["asset_type", "text"], title: ["title", "text"], description: ["description", "text"],
    locale: ["locale", "text"], tags: ["tags", "text[]"], classification: ["classification", "text"],
    customerVisible: ["customer_visible", "boolean"], customerPresentationAllowed: ["customer_presentation_allowed", "boolean"],
    shareAllowed: ["share_allowed", "boolean"],
  };
  for (const field of fields) {
    const parameter = `$${values.length + 3}`;
    values.push(patch[field]);
    if (field === "archived") {
      assignments.push(`archived_at = case when ${parameter}::boolean then coalesce(archived_at, statement_timestamp()) else null end`);
    } else if (field === "deleted") {
      assignments.push(`deleted_at = case when ${parameter}::boolean then coalesce(deleted_at, statement_timestamp()) else null end`);
    } else {
      const [column, type] = columns[field];
      assignments.push(`${column} = ${parameter}::${type}`);
    }
  }
  assignments.push("row_version = row_version + 1", "updated_at = statement_timestamp()");
  await client.query(`update "case".case_asset_metadata m set ${assignments.join(", ")}
    where m.asset_id = $1 and m.client_id = $2`, [assetId, clientId, ...values]);
  return assetDetail(client, assetId, clientId);
}

async function linkAsset(client, assetId, caseId, clientId, operatorUserKey, linked, sortOrder) {
  const { rows: [asset] } = await client.query(`
    select project_id as "projectId", archived_at as "archivedAt", deleted_at as "deletedAt"
    from "case".case_asset_metadata where asset_id = $1 and client_id = $2
  `, [assetId, clientId]);
  if (!asset) throw new CaseAggregateError("NOT_FOUND", "素材不存在");
  const { rows: [projectCase] } = await client.query(`
    select source_project_id as "projectId", archived_at as "archivedAt", deleted_at as "deletedAt"
    from "case".cases where id = $1
  `, [caseId]);
  if (!projectCase) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
  if (asset.projectId !== projectCase.projectId) {
    throw new CaseAggregateError("VALIDATION_FAILED", "素材与案例不属于同一项目");
  }
  if (!linked) {
    await client.query('delete from "case".case_asset_links where asset_id = $1 and case_id = $2', [assetId, caseId]);
    return { assetId, caseId, linked, sortOrder: null };
  }
  if (asset.deletedAt || projectCase.deletedAt || asset.archivedAt || projectCase.archivedAt) {
    throw new CaseAggregateError("ASSET_NOT_AVAILABLE", "素材或案例已归档、删除");
  }
  const { rows: [existing] } = await client.query(`
    select sort_order as "sortOrder" from "case".case_asset_links
    where asset_id = $1 and case_id = $2 for update
  `, [assetId, caseId]);
  if (existing) {
    if (sortOrder !== undefined && sortOrder !== existing.sortOrder) {
      await client.query(`
        update "case".case_asset_links set sort_order = $3 where asset_id = $1 and case_id = $2
      `, [assetId, caseId, sortOrder]);
    }
    return { assetId, caseId, linked, sortOrder: sortOrder ?? existing.sortOrder };
  }
  const { rows: [{ nextSortOrder }] } = await client.query(`
    select least(coalesce(max(sort_order), -10) + 10, 100000) as "nextSortOrder"
    from "case".case_asset_links where case_id = $1
  `, [caseId]);
  const assigned = sortOrder ?? nextSortOrder;
  await client.query(`
    insert into "case".case_asset_links (asset_id, case_id, project_id, created_by, sort_order)
    values ($1, $2, $3, $4, $5)
  `, [assetId, caseId, asset.projectId, operatorUserKey, assigned]);
  return { assetId, caseId, linked, sortOrder: assigned };
}

export function createCaseAssets(pool, storage, cursorKey) {
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
    async preview(assetId, assetVersionId, clientId) {
      const asset = await withCaseAuthoringTransaction(pool, true,
        (client) => findAsset(client, assetId, assetVersionId, clientId));
      if (!thumbnailMimeTypes.includes(asset.mimeType) || asset.scanStatus === "failed") {
        throw new CaseAggregateError("PREVIEW_NOT_AVAILABLE", "当前素材没有可用的内联预览");
      }
      return storage.previewTicket(asset);
    },
    listByCase: (caseId, clientId, input) => withCaseAuthoringTransaction(pool, true,
      (client) => listAssets(client, "case", caseId, clientId, input, cursorKey)),
    listByProject: (projectId, clientId, input) => withCaseAuthoringTransaction(pool, true,
      (client) => listAssets(client, "project", projectId, clientId, input, cursorKey)),
    detail: (assetId, clientId) => withCaseAuthoringTransaction(pool, true,
      (client) => assetDetail(client, assetId, clientId)),
    versions: (assetId, clientId) => withCaseAuthoringTransaction(pool, true, async (client) => {
      const { rowCount } = await client.query('select 1 from "case".case_asset_metadata where asset_id = $1 and client_id = $2',
        [assetId, clientId]);
      if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "素材不存在");
      const { rows } = await client.query(`
        select ${versionColumns} from ${versionFrom}
        where a.id = $1 and a.client_id = $2 and m.client_id = $2 order by a.asset_version_no desc
      `, [assetId, clientId]);
      return { assetId, items: rows.map(versionView) };
    }),
    patch: (assetId, clientId, expectedVersion, patch) => withCaseAuthoringTransaction(pool, false,
      (client) => patchAsset(client, assetId, clientId, expectedVersion, patch)),
    patchInTransaction: patchAsset,
    link: (assetId, caseId, clientId, operatorUserKey, linked, sortOrder) => withCaseAuthoringTransaction(pool, false,
      (client) => linkAsset(client, assetId, caseId, clientId, operatorUserKey, linked, sortOrder)),
    linkInTransaction: linkAsset,
  };
}
