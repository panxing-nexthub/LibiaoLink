import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

const caseColumns = `id as "caseId", source_project_id as "sourceProjectId", locale, title, summary,
  change_summary as "changeSummary", content, solution_parameters as "solutionParameters", outcomes, confidentiality,
  created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt", row_version as "rowVersion"`;

const patchColumns = {
  title: ["title", "text"],
  summary: ["summary", "text"],
  changeSummary: ["change_summary", "text"],
  content: ["content", "jsonb"],
  solutionParameters: ["solution_parameters", "jsonb"],
  outcomes: ["outcomes", "jsonb"],
  confidentiality: ["confidentiality", "jsonb"],
};

export class CaseAggregateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
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

export async function insertCase(client, input) {
  const types = input.solutionParameters?.groups?.map(({ solutionType }) => solutionType) ?? [];
  // 项目可选性、项目版本和方案类型从同一个 SQL 快照读取。
  const { rows: [{ projectAvailable, projectVersionMatches, solutionsAllowed, ...created }] } = await client.query(`
    with available_project as (
      select project_id, source_version, ${projectAllowsSolutions("project_directory.project_id", "$13")} as solutions_allowed
      from project_read.project_directory
      where project_id = $2 and deleted_at is null and source_missing_at is null
    ), inserted as (
      insert into "case".cases (id, source_project_id, locale, title, summary, change_summary,
                                content, solution_parameters, outcomes, confidentiality, created_by)
      select coalesce($1::uuid, uuidv7()), project_id, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12
      from available_project where source_version = $3 and solutions_allowed
      on conflict (id) do nothing returning ${caseColumns}
    )
    select exists (select 1 from available_project) as "projectAvailable",
           exists (select 1 from available_project where source_version = $3) as "projectVersionMatches",
           exists (select 1 from available_project where solutions_allowed) as "solutionsAllowed",
           inserted.*
    from (values (1)) as result (unused) left join inserted on true
  `, [input.caseId, input.sourceProjectId, input.sourceVersion, input.locale,
    writeValue("title", input.title), writeValue("summary", input.summary), input.changeSummary,
    writeValue("content", input.content), writeValue("solutionParameters", input.solutionParameters),
    writeValue("outcomes", input.outcomes), writeValue("confidentiality", input.confidentiality), input.operatorUserKey, types]);
  if (!projectAvailable) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
  if (!projectVersionMatches) throw new CaseAggregateError("PROJECT_VERSION_CONFLICT", "项目版本已变化");
  requireSolutionMembership(solutionsAllowed);
  if (!created.caseId) throw new CaseAggregateError("CASE_ID_CONFLICT", "案例 ID 已存在");
  return created;
}

export async function patchCase(client, caseId, expectedVersion, patch) {
  const fields = Object.keys(patch);
  if (fields.some((field) => !Object.hasOwn(patchColumns, field))) {
    throw new CaseAggregateError("VALIDATION_FAILED", "请求包含不可更新的案例字段");
  }
  const { rows: [row] } = await client.query(`select ${caseColumns} from "case".cases where id = $1 for update`, [caseId]);
  const current = requireCase(row);
  if (current.rowVersion !== expectedVersion) throw new CaseAggregateError("VERSION_CONFLICT", "案例版本已变化");
  if (fields.length === 0) return current;

  const types = patch.solutionParameters?.groups?.map(({ solutionType }) => solutionType) ?? [];
  if (types.length > 0) {
    const { rows: [{ allowed }] } = await client.query(`select ${projectAllowsSolutions("$1::uuid", "$2")} as allowed`,
      [current.sourceProjectId, types]);
    requireSolutionMembership(allowed);
  }

  const columns = fields.map((field) => patchColumns[field][0]);
  const values = fields.map((field, index) => `$${index + 2}::${patchColumns[field][1]}`);
  const assignments = columns.map((column, index) => `${column} = ${values[index]}`);
  // JSONB 同值比较忽略对象键顺序，数组仍按顺序比较。
  const { rows: [updated] } = await client.query(`
    update "case".cases set ${assignments.join(", ")}, row_version = row_version + 1, updated_at = clock_timestamp()
    where id = $1 and row(${columns.join(", ")}) is distinct from row(${values.join(", ")})
    returning ${caseColumns}
  `, [caseId, ...fields.map((field) => writeValue(field, patch[field]))]);
  return updated ?? current;
}

export function createCaseAggregate(pool) {
  return {
    create: (input) => withCaseAuthoringTransaction(pool, false, (client) => insertCase(client, input)),
    get: (caseId) => withCaseAuthoringTransaction(pool, true, async (client) => {
      const { rows: [row] } = await client.query(`select ${caseColumns} from "case".cases where id = $1`, [caseId]);
      return requireCase(row);
    }),
    patch: (caseId, expectedVersion, patch) => withCaseAuthoringTransaction(pool, false,
      (client) => patchCase(client, caseId, expectedVersion, patch)),
  };
}
