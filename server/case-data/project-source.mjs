const projectColumns = `id as project_id, code as project_code, name as project_name,
  customer as customer_text, region, project_type, manager_ids, status, version as source_version,
  updated_at::text as source_updated_at, deleted_at::text, archived_at::text`;

// 保留 PostgreSQL 时间戳精度，分页和水位不经过 JavaScript Date。
const changeWindow = `updated_at >= coalesce($1::timestamptz - make_interval(secs => $2::int), '-infinity')
  and updated_at <= $3::timestamptz
  and ($4::timestamptz is null or (updated_at, id) > ($4::timestamptz, $5::uuid))`;

function changeParameters(watermark, upper, cursor, config) {
  return [
    watermark, config.overlapSeconds, upper, cursor?.updatedAt ?? null,
    cursor?.id ?? null, config.batchSize,
  ];
}

export async function readProjectChanges(source, watermark, upper, cursor, config) {
  // 两组过滤条件分别对应核心库的未删除和回收站 updated_at 部分索引。
  const projectPage = (filter) => `(select ${projectColumns} from public.projects
    where ${filter} and ${changeWindow} order by updated_at, id limit $6)`;
  const { rows } = await source.query(`
    select * from (${projectPage("deleted_at is null")} union all ${projectPage("deleted_at is not null")}) changes
    order by source_updated_at::timestamptz, project_id limit $6
  `, changeParameters(watermark, upper, cursor, config));
  return rows;
}

export async function readManagerChanges(source, watermark, upper, cursor, config) {
  const { rows } = await source.query(`
    select id, display_name, updated_at::text from public.users where ${changeWindow}
    order by users.updated_at, id limit $6
  `, changeParameters(watermark, upper, cursor, config));
  return rows;
}

export async function readProjectIds(source, afterId, batchSize) {
  const { rows } = await source.query(`
    select id as project_id, updated_at::text as source_updated_at, version as source_version,
           deleted_at::text, archived_at::text
    from public.projects where ($1::uuid is null or id > $1::uuid) order by id limit $2
  `, [afterId, batchSize]);
  return rows;
}

export async function readProjects(source, ids) {
  if (ids.length === 0) return [];
  const { rows } = await source.query(`select ${projectColumns} from public.projects where id = any($1::uuid[])`, [ids]);
  return rows;
}

export async function readManagerNames(source, projects) {
  const ids = [...new Set(projects.flatMap((project) => project.manager_ids))];
  const { rows } = await source.query("select id, display_name from public.users where id = any($1::uuid[])", [ids]);
  return new Map(rows.map(({ id, display_name }) => [id, display_name]));
}
