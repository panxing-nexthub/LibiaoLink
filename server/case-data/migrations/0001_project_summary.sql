-- 项目摘要由独立投影任务维护，供案例数据网关读取。
create schema project_read;

create table project_read.project_summary (
  project_id uuid primary key,
  project_code text not null,
  project_name text not null,
  customer_text text,
  region text not null,
  project_type text not null,
  manager_ids uuid[] not null,
  manager_names text[] not null,
  status text not null,
  source_version integer not null,
  source_updated_at timestamptz not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  synced_at timestamptz not null,
  last_seen_at timestamptz,
  source_missing_at timestamptz,
  constraint ck_project_summary_manager_ids check (
    cardinality(manager_ids) > 0 and array_position(manager_ids, null::uuid) is null
  ),
  -- 缺失姓名以 NULL 保位，两个数组使用相同下标。
  constraint ck_project_summary_manager_names check (
    cardinality(manager_names) = cardinality(manager_ids)
    and array_dims(manager_names) = array_dims(manager_ids)
  ),
  constraint ck_project_summary_status check (status in ('active', 'paused', 'done', 'archived')),
  constraint ck_project_summary_source_version check (source_version >= 0)
);
