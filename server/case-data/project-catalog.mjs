import { createHmac, timingSafeEqual } from "node:crypto";
import { caseCatalogCursorPattern, CaseProjectCatalogQuerySchema } from "@libiaolink/contracts/case-data/project-catalog";
import { CaseDataError } from "./database-credentials.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const selectAvailableProjects = `
  select project_id as "externalProjectId", project_code as "projectCode", project_name as "projectName",
         customer_text as "customerText", region, project_type as "projectType", manager_ids as "managerIds",
         manager_names as "managerNames", status, source_version as "sourceVersion", source_updated_at as "updatedAt",
         archived_at as "archivedAt", deleted_at as "deletedAt", synced_at as "syncedAt"
  from project_read.project_summary where deleted_at is null and source_missing_at is null
`;

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
  };
}
