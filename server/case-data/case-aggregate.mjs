import { createHmac, timingSafeEqual } from "node:crypto";
import { CaseListQuerySchema, CaseVersionListQuerySchema, caseListCursorPattern } from "@libiaolink/contracts/case-data";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";
import { hashCasePayload } from "./case-write.mjs";

const caseViewColumns = `c.id as "caseId", c.source_project_id as "sourceProjectId",
  c.translation_group_id as "translationGroupId", c.locale, c.title, c.summary,
  c.change_summary as "changeSummary", c.content, c.solution_parameters as "solutionParameters", c.outcomes,
  c.confidentiality, c.review_status as "reviewStatus", c.review_ref as "reviewRef",
  active.id as "activeReleaseId", c.archived_at as "archivedAt", c.deleted_at as "deletedAt",
  case when c.deleted_at is not null then 'deleted'
       when c.archived_at is not null then 'archived'
       when active.id is not null then 'published'
       when c.review_status = 'reviewing' then 'reviewing'
       else 'draft' end as status,
  c.created_by as "createdBy", c.created_at as "createdAt", c.updated_at as "updatedAt", c.row_version as "rowVersion"`;
const caseViewFrom = `"case".cases c
  left join "case".case_releases active on active.case_id = c.id and active.status = 'active'`;
const listColumns = `c.id as "caseId", c.source_project_id as "sourceProjectId",
  c.translation_group_id as "translationGroupId", c.locale, c.title, c.review_status as "reviewStatus",
  active.id as "activeReleaseId", c.change_summary as "changeSummary", c.row_version as "rowVersion",
  c.created_at as "createdAt", c.updated_at as "updatedAt", c.archived_at as "archivedAt", c.deleted_at as "deletedAt",
  case when c.deleted_at is not null then 'deleted'
       when c.archived_at is not null then 'archived'
       when active.id is not null then 'published'
       when c.review_status = 'reviewing' then 'reviewing'
       else 'draft' end as status`;
const versionColumns = `v.id as "caseVersionId", v.case_id as "caseId", v.version_no as "versionNo",
  v.change_summary as "changeSummary", v.restored_from_version_id as "restoredFromVersionId",
  v.created_by as "createdBy", v.created_at as "createdAt", v.snapshot`;
const patchColumns = {
  title: ["title", "text"],
  summary: ["summary", "text"],
  changeSummary: ["change_summary", "text"],
  content: ["content", "jsonb"],
  solutionParameters: ["solution_parameters", "jsonb"],
  outcomes: ["outcomes", "jsonb"],
  confidentiality: ["confidentiality", "jsonb"],
  reviewStatus: ["review_status", "text"],
  reviewRef: ["review_ref", "text"],
  archived: [null, "boolean"],
  deleted: [null, "boolean"],
};

export class CaseAggregateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class CaseQueryError extends Error {
  constructor(path, message) {
    super(message);
    this.path = path;
  }
}

function requireCase(row) {
  if (!row) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
  return row;
}

function writeValue(field, value) {
  if (field === "title" && typeof value === "string") return value.trim();
  if (field === "summary" && value === "") return null;
  return patchColumns[field][1] === "jsonb" ? JSON.stringify(value) : value;
}

function projectAllowsSolutions(project, types) {
  return `(cardinality(${types}::text[]) = 0 or exists (
    select 1 from "case".project_profiles
    where project_id = ${project} and jsonb_typeof(attributes->'solutionTypes') = 'array'
      and attributes->'solutionTypes' @> to_jsonb(${types}::text[])
  ))`;
}

function requireSolutionMembership(allowed) {
  if (!allowed) throw new CaseAggregateError("VALIDATION_FAILED", "方案类型不在案例项目的已登记范围内");
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

export function parseCaseVersionListQuery(params, cursorKey) {
  const seen = new Set();
  for (const name of params.keys()) {
    if (!["limit", "cursor"].includes(name)) throw new CaseQueryError("query", "存在未知查询参数");
    if (seen.has(name)) throw new CaseQueryError(`query.${name}`, "查询参数不可重复");
    seen.add(name);
  }
  const parsed = CaseVersionListQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CaseQueryError(`query.${issue.path[0]}`, issue.message);
  }
  const filters = [];
  const after = parsed.data.cursor === undefined ? null : decodeCursor(parsed.data.cursor, filters, cursorKey);
  return { limit: parsed.data.limit, afterVersionNo: after?.[0] ?? null };
}

export function parseCaseListQuery(params, cursorKey) {
  const seen = new Set();
  for (const name of params.keys()) {
    if (!Object.hasOwn(CaseListQuerySchema.shape, name)) throw new CaseQueryError("query", "存在未知查询参数");
    if (seen.has(name)) throw new CaseQueryError(`query.${name}`, "查询参数不可重复");
    seen.add(name);
  }
  const query = Object.fromEntries(params);
  const parsed = CaseListQuerySchema.safeParse(query);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const name = issue.path[0];
    throw new CaseQueryError(`query.${name}`, issue.message);
  }
  const { limit, cursor, status = null, keyword = null, updatedAfter = null } = parsed.data;
  const filters = [status, keyword, updatedAfter];
  const after = cursor === undefined ? null : decodeCursor(cursor, filters, cursorKey);
  return { limit, filters, afterUpdatedAt: after?.[0] ?? null, afterId: after?.[1] ?? null };
}

function versionOf(row) {
  return {
    locale: row.locale, translationGroupId: row.translationGroupId, title: row.title, summary: row.summary,
    changeSummary: row.changeSummary, content: row.content, solutionParameters: row.solutionParameters,
    outcomes: row.outcomes, confidentiality: row.confidentiality,
  };
}

async function insertCaseVersion(client, row, { restoredFromVersionId = null, changeSummary, createdBy } = {}) {
  await client.query(`
    insert into "case".case_versions
      (case_id, version_no, snapshot, change_summary, restored_from_version_id, created_by)
    values ($1, $2, $3::jsonb, $4, $5, $6)
  `, [row.caseId, row.rowVersion, JSON.stringify(versionOf(row)), changeSummary ?? row.changeSummary,
    restoredFromVersionId, createdBy ?? row.createdBy]);
}

async function readCaseView(client, caseId, lock = false) {
  const { rows: [row] } = await client.query(`
    select ${caseViewColumns} from ${caseViewFrom} where c.id = $1 ${lock ? "for update of c" : ""}
  `, [caseId]);
  return row ?? null;
}

export async function insertCase(client, input) {
  const types = input.solutionParameters?.groups?.map(({ solutionType }) => solutionType) ?? [];
  // 项目可选性、项目版本和方案类型从同一个 SQL 快照读取。
  const { rows: [{ projectAvailable, projectVersionMatches, solutionsAllowed, caseId }] } = await client.query(`
    with ids as (
      select coalesce($1::uuid, uuidv7()) as case_id,
             coalesce($14::uuid, $1::uuid, uuidv7()) as translation_group_id
    ), available_project as (
      select project_id, source_version, ${projectAllowsSolutions("project_directory.project_id", "$13")} as solutions_allowed
      from project_read.project_directory
      where project_id = $2 and deleted_at is null and source_missing_at is null
    ), inserted as (
      insert into "case".cases (id, source_project_id, locale, title, summary, change_summary,
                                content, solution_parameters, outcomes, confidentiality, created_by,
                                translation_group_id, review_status, review_ref)
      select ids.case_id, project_id, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12,
             ids.translation_group_id, coalesce($15, 'not_submitted'), $16
      from available_project cross join ids where source_version = $3 and solutions_allowed
      on conflict (id) do nothing returning id
    )
    select exists (select 1 from available_project) as "projectAvailable",
           exists (select 1 from available_project where source_version = $3) as "projectVersionMatches",
           exists (select 1 from available_project where solutions_allowed) as "solutionsAllowed",
           inserted.id as "caseId"
    from (values (1)) as result (unused) left join inserted on true
  `, [input.caseId, input.sourceProjectId, input.sourceVersion, input.locale,
    writeValue("title", input.title), writeValue("summary", input.summary), input.changeSummary,
    writeValue("content", input.content), writeValue("solutionParameters", input.solutionParameters),
    writeValue("outcomes", input.outcomes), writeValue("confidentiality", input.confidentiality), input.operatorUserKey, types,
    input.translationGroupId ?? null, input.reviewStatus, input.reviewRef ?? null]);
  if (!projectAvailable) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
  if (!projectVersionMatches) throw new CaseAggregateError("PROJECT_VERSION_CONFLICT", "项目版本已变化");
  requireSolutionMembership(solutionsAllowed);
  if (!caseId) throw new CaseAggregateError("CASE_ID_CONFLICT", "案例 ID 已存在");
  const created = requireCase(await readCaseView(client, caseId));
  await insertCaseVersion(client, created, { changeSummary: created.changeSummary, createdBy: input.operatorUserKey });
  return created;
}

function samePatchValue(field, current, next) {
  if (field === "archived") return (current.archivedAt !== null) === next;
  if (field === "deleted") return (current.deletedAt !== null) === next;
  if (["content", "solutionParameters", "outcomes", "confidentiality"].includes(field)) {
    return hashCasePayload(current[field]) === hashCasePayload(next);
  }
  return current[field] === writeValue(field, next);
}

export async function patchCase(client, caseId, expectedVersion, patch, versionMetadata = {}) {
  const fields = Object.keys(patch);
  if (fields.some((field) => !Object.hasOwn(patchColumns, field))) {
    throw new CaseAggregateError("VALIDATION_FAILED", "请求包含不可更新的案例字段");
  }
  const current = requireCase(await readCaseView(client, caseId, true));
  if (current.rowVersion !== expectedVersion) throw new CaseAggregateError("VERSION_CONFLICT", "案例版本已变化");
  if (fields.length === 0 || fields.every((field) => samePatchValue(field, current, patch[field]))) return current;

  const types = patch.solutionParameters?.groups?.map(({ solutionType }) => solutionType) ?? [];
  if (types.length > 0) {
    const { rows: [{ allowed }] } = await client.query(`select ${projectAllowsSolutions("$1::uuid", "$2")} as allowed`,
      [current.sourceProjectId, types]);
    requireSolutionMembership(allowed);
  }

  const assignments = [];
  const values = [];
  for (const field of fields) {
    const [column, type] = patchColumns[field];
    const parameter = `$${values.length + 2}`;
    values.push(writeValue(field, patch[field]));
    if (field === "archived") {
      assignments.push(`archived_at = case when ${parameter}::boolean
        then coalesce(archived_at, statement_timestamp()) else null end`);
    } else if (field === "deleted") {
      assignments.push(`deleted_at = case when ${parameter}::boolean
        then coalesce(deleted_at, statement_timestamp()) else null end`);
    } else {
      assignments.push(`${column} = ${parameter}::${type}`);
    }
  }
  assignments.push("row_version = row_version + 1", "updated_at = statement_timestamp()");
  await client.query(`
    update "case".cases set ${assignments.join(", ")} where id = $1
  `, [caseId, ...values]);
  const updated = requireCase(await readCaseView(client, caseId));
  await insertCaseVersion(client, updated, versionMetadata);
  return updated;
}

export async function restoreCaseVersion(client, caseId, caseVersionId, input) {
  const current = requireCase(await readCaseView(client, caseId, true));
  if (current.rowVersion !== input.expectedVersion) throw new CaseAggregateError("VERSION_CONFLICT", "案例版本已变化");
  const { rows: [version] } = await client.query(`
    select ${versionColumns} from "case".case_versions v where v.case_id = $1 and v.id = $2
  `, [caseId, caseVersionId]);
  if (!version) throw new CaseAggregateError("NOT_FOUND", "案例版本不存在");
  const restored = { ...version.snapshot };
  delete restored.locale;
  delete restored.translationGroupId;
  if (input.changeSummary !== undefined) restored.changeSummary = input.changeSummary;
  return patchCase(client, caseId, input.expectedVersion, restored, {
    restoredFromVersionId: caseVersionId,
    changeSummary: input.changeSummary ?? `恢复自版本 ${version.versionNo}`,
    createdBy: input.operatorUserKey,
  });
}

async function requireProject(client, projectId) {
  const { rowCount } = await client.query(`
    select 1 from project_read.project_directory
    where project_id = $1 and deleted_at is null and source_missing_at is null
  `, [projectId]);
  if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
}

export async function listProjectCases(client, projectId, input, cursorKey) {
  await requireProject(client, projectId);
  const [status, keyword, updatedAfter] = input.filters;
  const { rows } = await client.query(`
    with listed as (
      select ${listColumns}
      from "case".cases c
      left join "case".case_releases active on active.case_id = c.id and active.status = 'active'
      where c.source_project_id = $1
        and ($3::text is null or position(lower($3) in lower(c.title)) > 0
          or position(lower($3) in lower(coalesce(c.summary, ''))) > 0
          or position(lower($3) in lower(coalesce(c.change_summary, ''))) > 0)
    )
    select * from listed
    where (($2::text is null and status <> 'deleted') or status = $2)
      and ($4::timestamptz is null or "updatedAt" >= $4)
      and ($5::timestamptz is null or ("updatedAt", "caseId") < ($5, $6::uuid))
    order by "updatedAt" desc, "caseId" desc limit $7
  `, [projectId, status, keyword, updatedAfter, input.afterUpdatedAt, input.afterId, input.limit + 1]);
  const items = rows.slice(0, input.limit);
  const nextCursor = rows.length > input.limit
    ? encodeCursor([new Date(items.at(-1).updatedAt).toISOString(), items.at(-1).caseId], input.filters, cursorKey) : null;
  return { items, nextCursor };
}

export async function listCaseVersions(client, caseId, { limit, afterVersionNo }, cursorKey) {
  const { rowCount } = await client.query('select 1 from "case".cases where id = $1', [caseId]);
  if (!rowCount) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
  const { rows } = await client.query(`
    select ${versionColumns} from "case".case_versions v
    where v.case_id = $1 and ($2::integer is null or v.version_no < $2)
    order by v.version_no desc limit $3
  `, [caseId, afterVersionNo, limit + 1]);
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor([items.at(-1).versionNo], [], cursorKey) : null;
  return { items, nextCursor };
}

export async function getCaseVersion(client, caseId, caseVersionId) {
  const { rows: [version] } = await client.query(`
    select ${versionColumns} from "case".case_versions v where v.case_id = $1 and v.id = $2
  `, [caseId, caseVersionId]);
  if (!version) throw new CaseAggregateError("NOT_FOUND", "案例版本不存在");
  return version;
}

export async function listCaseTranslations(client, caseId) {
  const { rows: [current] } = await client.query(
    'select translation_group_id as "translationGroupId" from "case".cases where id = $1', [caseId],
  );
  if (!current) throw new CaseAggregateError("NOT_FOUND", "案例不存在");
  const { rows } = await client.query(`
    select c.id as "caseId", c.translation_group_id as "translationGroupId", c.locale, c.title,
      active.id as "activeReleaseId", c.row_version as "rowVersion", c.updated_at as "updatedAt",
      case when c.deleted_at is not null then 'deleted'
           when c.archived_at is not null then 'archived'
           when active.id is not null then 'published'
           when c.review_status = 'reviewing' then 'reviewing'
           else 'draft' end as status
    from "case".cases c
    left join "case".case_releases active on active.case_id = c.id and active.status = 'active'
    where c.translation_group_id = $1
    order by c.locale collate "C", c.id limit 100
  `, [current.translationGroupId]);
  return { translationGroupId: current.translationGroupId, items: rows };
}

export function createCaseAggregate(pool, cursorKey) {
  return {
    create: (input) => withCaseAuthoringTransaction(pool, false, (client) => insertCase(client, input)),
    createInTransaction: insertCase,
    get: (caseId) => withCaseAuthoringTransaction(pool, true, async (client) => requireCase(await readCaseView(client, caseId))),
    patch: (caseId, expectedVersion, patch) => withCaseAuthoringTransaction(pool, false,
      (client) => patchCase(client, caseId, expectedVersion, patch)),
    patchInTransaction: patchCase,
    restore: (caseId, caseVersionId, input) => withCaseAuthoringTransaction(pool, false,
      (client) => restoreCaseVersion(client, caseId, caseVersionId, input)),
    restoreInTransaction: restoreCaseVersion,
    listByProject: (projectId, input) => withCaseAuthoringTransaction(pool, true,
      (client) => listProjectCases(client, projectId, input, cursorKey)),
    versions: (caseId, input) => withCaseAuthoringTransaction(pool, true,
      (client) => listCaseVersions(client, caseId, input, cursorKey)),
    version: (caseId, caseVersionId) => withCaseAuthoringTransaction(pool, true,
      (client) => getCaseVersion(client, caseId, caseVersionId)),
    translations: (caseId) => withCaseAuthoringTransaction(pool, true,
      (client) => listCaseTranslations(client, caseId)),
  };
}
