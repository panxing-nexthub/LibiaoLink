const table = "project_read.project_summary";
const summaryFields = {
  project_code: "text", project_name: "text", customer_text: "text", region: "text",
  project_type: "text", manager_ids: "uuid[]", manager_names: "text[]", status: "text",
  source_version: "integer", source_updated_at: "timestamptz", deleted_at: "timestamptz", archived_at: "timestamptz",
};
const fields = Object.keys(summaryFields);
const columns = fields.join(", ");
const recordTypes = Object.entries(summaryFields).map(([column, type]) => `${column} ${type}`).join(", ");

export async function upsertProjects(target, projects) {
  if (projects.length === 0) return 0;
  const result = await target.query(`
    insert into ${table} as summary (project_id, ${columns}, synced_at)
    select project_id, ${columns}, transaction_timestamp()
    from jsonb_to_recordset($1::jsonb) as incoming(project_id uuid, ${recordTypes})
    on conflict (project_id) do update set
      ${fields.map((field) => `${field} = excluded.${field}`).join(", ")},
      synced_at = transaction_timestamp(), source_missing_at = null, missing_scans = 0
    where (${fields.map((field) => `summary.${field}`).join(", ")})
          is distinct from (${fields.map((field) => `excluded.${field}`).join(", ")})
       or summary.missing_scans > 0
       or summary.source_missing_at is not null
  `, [JSON.stringify(projects)]);
  return result.rowCount;
}

export async function refreshChangedManagers(target, users) {
  const result = await target.query(`
    with changed as (
      select id, display_name from jsonb_to_recordset($1::jsonb) as user_change(id uuid, display_name text)
    ), refreshed as (
      select summary.project_id, array(
        select coalesce(changed.display_name, summary.manager_names[manager.ordinality::int])
        from unnest(summary.manager_ids) with ordinality as manager(id, ordinality)
        left join changed on changed.id = manager.id order by manager.ordinality
      ) as manager_names
      from ${table} summary where summary.manager_ids && $2::uuid[]
    )
    update ${table} summary set manager_names = refreshed.manager_names, synced_at = transaction_timestamp()
    from refreshed where summary.project_id = refreshed.project_id
      and summary.manager_names is distinct from refreshed.manager_names
  `, [JSON.stringify(users), users.map(({ id }) => id)]);
  return result.rowCount;
}

export async function findProjectsToRepair(target, sourceIds) {
  const { rows } = await target.query(`
    select observed.project_id from jsonb_to_recordset($1::jsonb) as observed(
      project_id uuid, source_updated_at timestamptz, source_version integer, deleted_at timestamptz, archived_at timestamptz
    )
    left join ${table} summary on summary.project_id = observed.project_id
    where (summary.source_updated_at, summary.source_version, summary.deleted_at, summary.archived_at)
      is distinct from (observed.source_updated_at, observed.source_version, observed.deleted_at, observed.archived_at)
  `, [JSON.stringify(sourceIds)]);
  return rows.map(({ project_id }) => project_id);
}

export async function readExistingManagerIds(target, ids) {
  if (ids.length === 0) return [];
  const { rows } = await target.query(`select project_id, manager_ids from ${table} where project_id = any($1::uuid[])`, [ids]);
  return rows;
}

export async function markSeen(target, projects, scanId) {
  await target.query(`
    update ${table} summary set
      synced_at = case when summary.source_missing_at is not null
                          or summary.manager_names is distinct from observed.manager_names
                       then transaction_timestamp() else summary.synced_at end,
      manager_names = observed.manager_names, last_seen_at = transaction_timestamp(),
      last_seen_scan_id = $2::uuid, source_missing_at = null, missing_scans = 0
    from jsonb_to_recordset($1::jsonb) as observed(project_id uuid, manager_names text[])
    where summary.project_id = observed.project_id
  `, [JSON.stringify(projects), scanId]);
}

export async function markMissing(target, scanId) {
  const { rows: [counts] } = await target.query(`
    with changed as (
      update ${table} set missing_scans = missing_scans + 1,
        source_missing_at = case when missing_scans = 1 then transaction_timestamp() end
      where last_seen_scan_id is distinct from $1::uuid and missing_scans < 2
      returning missing_scans
    )
    select count(*) filter (where missing_scans = 1)::int as first_missing,
           count(*) filter (where missing_scans = 2)::int as newly_missing from changed
  `, [scanId]);
  return { firstMissing: counts.first_missing, newlyMissing: counts.newly_missing };
}
