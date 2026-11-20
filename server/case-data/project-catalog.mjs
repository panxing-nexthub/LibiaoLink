import { createHmac, timingSafeEqual } from "node:crypto";
import { caseCatalogCursorPattern, CaseProjectCatalogQuerySchema } from "@libiaolink/contracts/case-data/project-catalog";
import { CaseAggregateError } from "./case-aggregate.mjs";
import { CaseDataError } from "./database-credentials.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const selectAvailableProjects = `
  select project_id as "externalProjectId", project_code as "projectCode", project_name as "projectName",
         customer_text as "customerText", region, project_type as "projectType", manager_ids as "managerIds",
         manager_names as "managerNames", status, source_version as "sourceVersion", source_updated_at as "updatedAt",
         archived_at as "archivedAt", deleted_at as "deletedAt", synced_at as "syncedAt"
  from project_read.project_directory where deleted_at is null and source_missing_at is null
`;
const localProjectColumns = `project_id as "externalProjectId", project_code as "projectCode", project_name as "projectName",
  customer_text as "customerText", region, project_type as "projectType", manager_ids as "managerIds",
  manager_names as "managerNames", status, source_version as "sourceVersion", source_updated_at as "updatedAt",
  archived_at as "archivedAt", null::timestamptz as "deletedAt", synced_at as "syncedAt"`;
const localProjectConflicts = new Map([
  ["ux_project_code_claim_code", ["PROJECT_CODE_EXISTS", "项目编号已存在"]],
  ["ux_local_projects_code", ["PROJECT_CODE_EXISTS", "项目编号已存在"]],
  ["pk_project_code_claim", ["PROJECT_ID_EXISTS", "项目 ID 已存在"]],
  ["pk_local_projects", ["PROJECT_ID_EXISTS", "项目 ID 已存在"]],
]);

const localProjectPatchColumns = {
  projectCode: ["project_code", "text"],
  projectName: ["project_name", "text"],
  customerText: ["customer_text", "text"],
  region: ["region", "text"],
  projectType: ["project_type", "text"],
  managerIds: ["manager_ids", "uuid[]"],
  managerNames: ["manager_names", "text[]"],
  status: ["status", "text"],
};

function rethrowProjectConflict(error) {
  const conflict = error?.code === "23505" ? localProjectConflicts.get(error.constraint) : null;
  if (conflict) throw new CaseAggregateError(...conflict);
  throw error;
}

export class CatalogQueryError extends Error {
  constructor(path, message) {
    super(message);
    this.path = path;
  }
}

function cursorSignature(payload, key) {
  return createHmac("sha256", key).update(payload).digest();
}

function encodeCursor(id, filters, key) {
  const payload = Buffer.from(JSON.stringify([id, filters])).toString("base64url");
  return `${payload}.${cursorSignature(payload, key).toString("base64url")}`;
}

function decodeCursor(cursor, filters, key) {
  const match = caseCatalogCursorPattern.exec(cursor);
  if (!match) throw new CatalogQueryError("query.cursor", "游标无效");
  const [, payload, encodedSignature] = match;
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.toString("base64url") !== encodedSignature || !timingSafeEqual(signature, cursorSignature(payload, key))) {
    throw new CatalogQueryError("query.cursor", "游标无效");
  }
  const [id, signedFilters] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (typeof id !== "string" || !uuid.test(id) || JSON.stringify(signedFilters) !== JSON.stringify(filters)) {
    throw new CatalogQueryError("query.cursor", "游标与筛选条件不匹配");
  }
  return id;
}

export function parseCatalogQuery(params, cursorKey) {
  const seen = new Set();
  for (const name of params.keys()) {
    if (!Object.hasOwn(CaseProjectCatalogQuerySchema.shape, name)) throw new CatalogQueryError("query", "存在未知查询参数");
    if (seen.has(name)) throw new CatalogQueryError(`query.${name}`, "查询参数不可重复");
    seen.add(name);
  }

  const query = Object.fromEntries(params);
  if (query.limit !== undefined && !/^\d{1,3}$/.test(query.limit)) {
    throw new CatalogQueryError("query.limit", "limit 必须是 1–200 的整数");
  }
  const parsed = CaseProjectCatalogQuerySchema.safeParse({
    ...query, limit: query.limit === undefined ? undefined : Number(query.limit),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const name = issue.path[0];
    throw new CatalogQueryError(`query.${name}`, name === "limit" ? "limit 必须是 1–200 的整数" : issue.message);
  }
  const { limit, cursor, status = null, region = null, projectType = null } = parsed.data;
  const filters = [status, region, projectType];
  return { limit, filters, afterId: cursor === undefined ? null : decodeCursor(cursor, filters, cursorKey) };
}

export async function registerLocalProject(client, input) {
  try {
    const { rows: [project] } = await client.query(`
      insert into project_read.local_projects (project_id, project_code, project_name, customer_text, region,
        project_type, manager_ids, manager_names, status, archived_at)
      values (coalesce($1::uuid, uuidv7()), $2, $3, $4, $5, $6, $7::uuid[], $8::text[], $9,
        case when $9 = 'archived' then statement_timestamp() end)
      returning ${localProjectColumns}
    `, [input.externalProjectId ?? null, input.projectCode, input.projectName, input.customerText, input.region,
      input.projectType, input.managerIds, input.managerNames, input.status]);
    return { status: 201, body: project, resourceId: project.externalProjectId };
  } catch (error) {
    rethrowProjectConflict(error);
  }
}

export async function patchLocalProject(client, projectId, expectedVersion, patch) {
  const fields = Object.keys(patch);
  if (fields.length === 0 || fields.some((field) => !Object.hasOwn(localProjectPatchColumns, field))) {
    throw new CaseAggregateError("VALIDATION_FAILED", "请求包含不可更新的本地项目字段");
  }

  const { rows: [local] } = await client.query(
    "select source_version from project_read.local_projects where project_id = $1 for update", [projectId],
  );
  if (!local) {
    const { rowCount } = await client.query(
      "select 1 from project_read.project_summary where project_id = $1", [projectId],
    );
    if (rowCount) throw new CaseAggregateError("PROJECT_SOURCE_READ_ONLY", "核心项目只读，不能通过本地项目接口更新");
    throw new CaseAggregateError("NOT_FOUND", "本地项目不存在");
  }
  if (local.source_version !== expectedVersion) {
    throw new CaseAggregateError("PROJECT_VERSION_CONFLICT", "项目版本已变化");
  }

  const assignments = fields.map((field, index) => {
    const [column, type] = localProjectPatchColumns[field];
    return `${column} = $${index + 2}::${type}`;
  });
  const statusIndex = fields.indexOf("status");
  if (statusIndex >= 0) {
    assignments.push(`archived_at = case when $${statusIndex + 2} = 'archived'
      then coalesce(archived_at, statement_timestamp()) else null end`);
  }
  assignments.push("source_version = source_version + 1", "source_updated_at = statement_timestamp()",
    "updated_at = statement_timestamp()", "synced_at = statement_timestamp()");
  const values = fields.map((field) => patch[field]);

  try {
    const { rows: [project] } = await client.query(`
      update project_read.local_projects
      set ${assignments.join(", ")}
      where project_id = $1
      returning ${localProjectColumns}
    `, [projectId, ...values]);
    return { status: 200, body: project, resourceId: project.externalProjectId };
  } catch (error) {
    rethrowProjectConflict(error);
  }
}

export function createProjectCatalog(pool, cursorKey) {
  async function query(sql, parameters) {
    if (pool.waitingCount >= 8) throw new CaseDataError("项目目录连接等待队列已满");
    return withCaseAuthoringTransaction(pool, true, (client) => client.query(sql, parameters));
  }

  return {
    async probe() {
      await query(`${selectAvailableProjects} limit 0`);
    },
    async list({ limit, filters, afterId }) {
      const { rows } = await query(`
        ${selectAvailableProjects}
          and ($1::uuid is null or project_id > $1::uuid)
          and ($2::text is null or status = $2)
          and ($3::text is null or region = $3)
          and ($4::text is null or project_type = $4)
        order by project_id limit $5
      `, [afterId, ...filters, limit + 1]);
      const items = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? encodeCursor(items.at(-1).externalProjectId, filters, cursorKey) : null;
      return { items, nextCursor };
    },
    registerLocal: (client, input) => registerLocalProject(client, input),
    updateLocal: (client, projectId, expectedVersion, patch) => patchLocalProject(client, projectId, expectedVersion, patch),
  };
}
