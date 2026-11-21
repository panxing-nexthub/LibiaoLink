import { createHmac, timingSafeEqual } from "node:crypto";
import { caseListCursorPattern } from "@libiaolink/contracts/case-data";
import { CaseReleaseListQuerySchema } from "@libiaolink/contracts/case-data/releases";
import { CaseAggregateError, CaseQueryError } from "./case-aggregate.mjs";
import { CaseAssetError } from "./case-asset-storage.mjs";
import { withCaseAuthoringTransaction, withCasePublicReadTransaction } from "./case-authoring-transaction.mjs";
import { hashCasePayload } from "./case-write.mjs";

const releaseColumns = `id as "releaseId", case_id as "caseId", version_no as "versionNo", status,
  case when customer_logo_asset_id is null then null else jsonb_build_object(
    'assetId', customer_logo_asset_id, 'assetVersionId', customer_logo_asset_version_id
  ) end as "customerLogo",
  source_version as "sourceVersion", case_content_hash as "caseContentHash", project_snapshot_hash as "projectSnapshotHash",
  release_hash as "releaseHash", staged_at as "stagedAt", activated_at as "activatedAt",
  superseded_at as "supersededAt", withdrawn_at as "withdrawnAt"`;
const suppliedAssets = `jsonb_to_recordset($2::jsonb) as supplied(
  "assetId" uuid, "assetVersionId" uuid, "objectVersionId" text
)`;
const frozenAssets = `jsonb_to_recordset($2::jsonb) as frozen(
  "assetId" uuid, "assetVersionId" uuid, "objectVersionId" text, "sortOrder" integer
)`;

export class CaseReleaseBusyError extends Error {}
export class CasePublicReleaseReadError extends Error {}

const missingRelease = () => new CaseAggregateError("NOT_FOUND", "发布版本不存在");
const unavailable = () => new CaseAssetError(503, "ASSET_STORAGE_UNAVAILABLE", "案例对象存储暂不可用");
const unready = () => new CaseAggregateError("RELEASE_ASSET_NOT_READY", "发布引用的素材未通过版本完整性或媒体处理门禁");

async function readPublicRelease(pool, work) {
  try {
    return await withCasePublicReadTransaction(pool, work);
  } catch (error) {
    if (error instanceof CaseAggregateError) throw error;
    throw new CasePublicReleaseReadError("发布读面暂不可用", { cause: error });
  }
}

async function lockCase(client, caseId) {
  try {
    const { rows: [row] } = await client.query(`
      select source_project_id as "sourceProjectId" from "case".cases where id = $1 for no key update nowait
    `, [caseId]);
    if (!row) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
    return row;
  } catch (error) {
    if (error?.code === "55P03") throw new CaseReleaseBusyError("案例正在切换发布版本，请用原操作标识重试");
    throw error;
  }
}

export async function stageCaseRelease(client, caseId, clientId, input) {
  const { sourceProjectId } = await lockCase(client, caseId);
  if (input.externalProjectId !== sourceProjectId) {
    throw new CaseAggregateError("VALIDATION_FAILED", "来源项目与案例不一致");
  }
  const { rows: [source] } = await client.query(`
    select source_version as "sourceVersion",
      jsonb_build_object('externalProjectId', project_id, 'projectCode', project_code, 'projectName', project_name,
        'region', region, 'projectType', project_type, 'status', status, 'sourceVersion', source_version,
        'sourceUpdatedAt', source_updated_at) as "projectSnapshot",
      (select p.attributes->>'customerLogoAssetId' from "case".project_profiles p
        where p.project_id = project_directory.project_id) as "customerLogoAssetId"
    from project_read.project_directory where project_id = $1 and deleted_at is null and source_missing_at is null
  `, [sourceProjectId]);
  if (!source) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
  if (source.sourceVersion !== input.sourceVersion) throw new CaseAggregateError("PROJECT_VERSION_CONFLICT", "项目版本已变化");

  let customerLogo = null;
  let customerLogoObjectVersionId = null;
  if (source.customerLogoAssetId) {
    const { rows: [logo] } = await client.query(`
      select a.id as "assetId", a.asset_version_id as "assetVersionId", a.object_version_id as "objectVersionId"
      from "case".case_assets a
      where a.id::text = lower($1) and a.project_id = $2 and a.client_id = $3
      order by a.asset_version_no desc limit 1
    `, [source.customerLogoAssetId, sourceProjectId, clientId]);
    if (!logo) throw new CaseAggregateError("CUSTOMER_LOGO_NOT_FOUND", "项目当前客户 Logo 没有可冻结的素材版本");
    customerLogo = { assetId: logo.assetId, assetVersionId: logo.assetVersionId };
    customerLogoObjectVersionId = logo.objectVersionId;
  }
  const projectSnapshot = { ...source.projectSnapshot, customerLogo };

  const supplied = JSON.stringify(input.assets);
  const verified = await client.query(`
    select supplied."assetId", supplied."assetVersionId", supplied."objectVersionId"
    from ${suppliedAssets}
    join "case".case_assets a
      on (a.id, a.asset_version_id, a.object_version_id) =
         (supplied."assetId", supplied."assetVersionId", supplied."objectVersionId")
    join "case".case_asset_metadata m on m.asset_id = a.id and m.client_id = a.client_id
    join "case".case_asset_links l on l.asset_id = a.id and l.case_id = $1 and l.project_id = a.project_id
    where a.client_id = $3 and m.archived_at is null and m.deleted_at is null
    order by l.sort_order asc, a.id asc, a.asset_version_no asc
  `, [caseId, supplied, clientId]);
  if (verified.rowCount !== input.assets.length) {
    throw new CaseAggregateError("RELEASE_ASSET_MISMATCH", "素材版本与当前案例、对象版本或调用方不匹配");
  }
  const assets = verified.rows.map((asset, sortOrder) => ({
    assetId: asset.assetId, assetVersionId: asset.assetVersionId,
    objectVersionId: asset.objectVersionId, sortOrder,
  }));
  const caseHash = hashCasePayload(input.caseSnapshot);
  const projectHash = hashCasePayload(projectSnapshot);
  const releaseHash = hashCasePayload({ caseContentHash: caseHash, projectSnapshotHash: projectHash, assets });
  const { rows: [release] } = await client.query(`
    insert into "case".case_releases (case_id, version_no, source_project_id, source_version, project_snapshot, case_snapshot,
      case_content_hash, project_snapshot_hash, release_hash, created_by,
      customer_logo_asset_id, customer_logo_asset_version_id, customer_logo_object_version_id)
    select $1, coalesce(max(version_no), 0) + 1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12
    from "case".case_releases where case_id = $1
    returning ${releaseColumns}
  `, [caseId, sourceProjectId, input.sourceVersion, JSON.stringify(projectSnapshot), JSON.stringify(input.caseSnapshot),
    caseHash, projectHash, releaseHash, input.operatorUserKey,
    customerLogo?.assetId ?? null, customerLogo?.assetVersionId ?? null, customerLogoObjectVersionId]);
  await client.query(`
    insert into "case".case_release_assets (release_id, case_id, asset_id, asset_version_id, object_version_id, sort_order)
    select $1, $3, "assetId", "assetVersionId", "objectVersionId", "sortOrder" from ${frozenAssets}
  `, [release.releaseId, JSON.stringify(assets), caseId]);
  return release;
}

async function currentAndTarget(client, caseId, releaseId, expectedActiveReleaseId) {
  await lockCase(client, caseId);
  const { rows: [target] } = await client.query(
    'select status from "case".case_releases where id = $1 and case_id = $2', [releaseId, caseId],
  );
  if (!target) throw missingRelease();
  const { rows: [active] } = await client.query(
    'select id from "case".case_releases where case_id = $1 and status = \'active\'', [caseId],
  );
  const activeId = active?.id ?? null;
  if (activeId !== expectedActiveReleaseId) {
    throw new CaseAggregateError("ACTIVE_RELEASE_MISMATCH", "当前 active 发布版本已变化");
  }
  return { activeId, status: target.status };
}

async function verifyReleaseAssets(client, releaseId, storage) {
  const { rows: assets } = await client.query(`
    select a.object_key as "objectKey", a.object_version_id as "objectVersionId", a.mime_type as "mimeType",
      a.size_bytes as "sizeBytes", a.sha256, a.scan_status = 'passed'
        and a.transcode_status in ('not_required', 'ready')
        and m.archived_at is null and m.deleted_at is null as ready
    from "case".case_release_assets r
    join "case".case_assets a
      on (a.id, a.asset_version_id, a.object_version_id) =
         (r.asset_id, r.asset_version_id, r.object_version_id)
    join "case".case_asset_metadata m on m.asset_id = a.id and m.client_id = a.client_id
    join "case".case_asset_links l on l.asset_id = a.id and l.case_id = r.case_id
    where r.release_id = $1 order by r.sort_order
  `, [releaseId]);
  if (!assets.every((asset) => asset.ready)) throw unready();
  if (assets.length && !storage) throw unavailable();
  const deadline = AbortSignal.timeout(15_000);
  for (const asset of assets) {
    try {
      await storage.verify(asset, asset.objectVersionId, deadline);
    } catch (error) {
      if (error instanceof CaseAssetError && ["UPLOAD_OBJECT_MISSING", "ASSET_OBJECT_MISMATCH"].includes(error.code)) throw unready();
      throw error;
    }
  }
}

export async function activateCaseRelease(client, storage, caseId, releaseId, input) {
  const { activeId, status } = await currentAndTarget(client, caseId, releaseId, input.expectedActiveReleaseId);
  if (status !== "staged") throw new CaseAggregateError("RELEASE_STATE_CONFLICT", "仅 staged 发布版本可激活");
  await verifyReleaseAssets(client, releaseId, storage);
  const { rows: [{ switchedAt }] } = await client.query('select statement_timestamp() as "switchedAt"');
  if (activeId) await client.query(
    `update "case".case_releases set status = 'superseded', superseded_at = $2 where id = $1`, [activeId, switchedAt],
  );
  const { rows: [release] } = await client.query(`
    update "case".case_releases set status = 'active', approval_ref = $2, activated_at = $3
    where id = $1 returning ${releaseColumns}
  `, [releaseId, input.approvalRef, switchedAt]);
  return release;
}

export async function deactivateCaseRelease(client, caseId, releaseId, input) {
  const { activeId } = await currentAndTarget(client, caseId, releaseId, input.expectedActiveReleaseId);
  if (activeId !== releaseId) throw new CaseAggregateError("RELEASE_STATE_CONFLICT", "仅当前 active 发布版本可撤回");
  const { rows: [release] } = await client.query(`
    update "case".case_releases set status = 'withdrawn', withdrawn_at = statement_timestamp()
    where id = $1 returning ${releaseColumns}
  `, [releaseId]);
  return release;
}

function cursorSignature(payload, key) {
  return createHmac("sha256", key).update(payload).digest();
}

function encodeCursor(stagedAt, releaseId, key) {
  const payload = Buffer.from(JSON.stringify([[stagedAt, releaseId], []])).toString("base64url");
  return `${payload}.${cursorSignature(payload, key).toString("base64url")}`;
}

function decodeCursor(cursor, key) {
  const match = caseListCursorPattern.exec(cursor);
  if (!match) throw new CaseQueryError("query.cursor", "游标无效");
  const [, payload, encodedSignature] = match;
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.toString("base64url") !== encodedSignature || !timingSafeEqual(signature, cursorSignature(payload, key))) {
    throw new CaseQueryError("query.cursor", "游标无效");
  }
  try {
    const [value, filters] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (JSON.stringify(filters) !== "[]" || !Array.isArray(value) || value.length !== 2) throw new Error();
    return value;
  } catch {
    throw new CaseQueryError("query.cursor", "游标无效");
  }
}

export function parseReleaseListQuery(params, cursorKey) {
  const seen = new Set();
  for (const name of params.keys()) {
    if (!Object.hasOwn(CaseReleaseListQuerySchema.shape, name)) throw new CaseQueryError("query", "存在未知查询参数");
    if (seen.has(name)) throw new CaseQueryError(`query.${name}`, "查询参数不可重复");
    seen.add(name);
  }
  const parsed = CaseReleaseListQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CaseQueryError(`query.${issue.path[0]}`, issue.message);
  }
  const { limit, cursor } = parsed.data;
  const after = cursor === undefined ? null : decodeCursor(cursor, cursorKey);
  return { limit, afterStagedAt: after?.[0] ?? null, afterReleaseId: after?.[1] ?? null };
}

export function createCaseReleaseReads(authorPool, publicPool, cursorKey) {
  const historyColumns = `${releaseColumns}, approval_ref as "approvalRef", case_snapshot as "caseSnapshot",
    jsonb_set(project_snapshot, '{customerLogo}', coalesce(project_snapshot->'customerLogo', 'null'::jsonb), true)
      as "projectSnapshot",
    coalesce((select jsonb_agg(jsonb_build_object(
      'assetId', asset_id, 'assetVersionId', asset_version_id, 'objectVersionId', object_version_id,
      'sortOrder', sort_order
    ) order by sort_order) from "case".case_release_assets where release_id = p.id), '[]'::jsonb) as assets`;
  return {
    history(caseId, releaseId) {
      return withCaseAuthoringTransaction(authorPool, true, async (client) => {
        const { rows: [release] } = await client.query(`
          select ${historyColumns}
          from "case".case_releases p where p.case_id = $1 and p.id = $2
        `, [caseId, releaseId]);
        if (!release) throw missingRelease();
        return release;
      });
    },
    list(caseId, { limit, afterStagedAt, afterReleaseId }) {
      return withCaseAuthoringTransaction(authorPool, true, async (client) => {
        const { rowCount } = await client.query('select 1 from "case".cases where id = $1', [caseId]);
        if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
        const { rows } = await client.query(`
          select ${historyColumns}, p.staged_at::text as "stagedCursor"
          from "case".case_releases p
          where p.case_id = $1
            and ($2::timestamptz is null or (p.staged_at, p.id) < ($2, $3::uuid))
          order by p.staged_at desc, p.id desc limit $4
        `, [caseId, afterStagedAt, afterReleaseId, limit + 1]);
        const items = rows.slice(0, limit).map(({ stagedCursor, ...item }) => item);
        const nextCursor = rows.length > limit
          ? encodeCursor(rows[limit - 1].stagedCursor, rows[limit - 1].releaseId, cursorKey) : null;
        return { items, nextCursor };
      });
    },
    published(caseId, releaseId) {
      return readPublicRelease(publicPool, async (client) => {
        const { rows: [release] } = await client.query(`
          select release_id as "releaseId", case_id as "caseId", version_no as "versionNo",
            case when customer_logo_asset_id is null then null else jsonb_build_object(
              'assetId', customer_logo_asset_id, 'assetVersionId', customer_logo_asset_version_id
            ) end as "customerLogo",
            case_snapshot as "caseSnapshot", activated_at as "activatedAt",
            coalesce((select jsonb_agg(jsonb_build_object(
              'assetId', a.asset_id, 'assetVersionId', a.asset_version_id, 'sortOrder', a.sort_order,
              'mimeType', a.mime_type, 'sizeBytes', a.size_bytes
            ) order by a.sort_order) from "case".published_release_assets_v a where a.release_id = p.release_id), '[]'::jsonb) as assets
          from "case".published_release_v p where p.case_id = $1 and p.release_id = $2
        `, [caseId, releaseId]);
        if (!release) throw missingRelease();
        return release;
      });
    },
    publishedAsset(caseId, releaseId, assetVersionId) {
      return readPublicRelease(publicPool, async (client) => {
        const { rows: [asset] } = await client.query(`
          select object_key as "objectKey", object_version_id as "objectVersionId",
            mime_type as "mimeType", size_bytes as "sizeBytes"
          from (
            select object_key, object_version_id, mime_type, size_bytes
            from "case".published_release_assets_v
            where case_id = $1 and release_id = $2 and asset_version_id = $3
            union all
            select object_key, object_version_id, mime_type, size_bytes
            from "case".published_release_logo_v
            where case_id = $1 and release_id = $2 and asset_version_id = $3
          ) available limit 1
        `, [caseId, releaseId, assetVersionId]);
        if (!asset) throw new CaseAggregateError("NOT_FOUND", "发布素材或客户 Logo 不存在");
        return asset;
      });
    },
    probe() {
      return withCasePublicReadTransaction(publicPool, (client) => client.query(`
        select release_id from "case".published_release_v limit 0;
        select object_version_id from "case".published_release_assets_v limit 0;
        select object_version_id from "case".published_release_logo_v limit 0
      `));
    },
  };
}
