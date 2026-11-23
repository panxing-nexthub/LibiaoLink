-- 编号说明：main 的 0113 已用于 0113_project_view_grants；本迁移合并时顺延为 0114。
-- 兼容测试机 / 正式机曾以旧文件名 0113_project_document_analyses.sql 手工执行：以下 DDL 幂等。
-- 迁移记录修复与部署顺序见 deploy/prod/README.md 的 2026-11-23 迁移重编号说明。
-- 项目文件 AI 分析：按项目文件视图逐文件提炼摘要。
-- runs 负责排队与总体状态；file analyses 按当前文件版本 + prompt 版本缓存。
create table if not exists project_document_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'queued',
  prompt_version text not null,
  requested_by uuid references users(id),
  file_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_project_document_analysis_runs_status
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  constraint ck_project_document_analysis_runs_counts
    check (file_count >= 0 and succeeded_count >= 0 and failed_count >= 0 and skipped_count >= 0)
);

create unique index if not exists uq_project_document_analysis_runs_active
  on project_document_analysis_runs (project_id)
  where status in ('queued', 'running');
create index if not exists ix_project_document_analysis_runs_status
  on project_document_analysis_runs (status, created_at);

create table if not exists project_file_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  file_version_id uuid not null references file_versions(id) on delete cascade,
  content_hash text not null,
  file_name text not null,
  file_kind text not null,
  status text not null default 'succeeded',
  summary_json jsonb,
  model_id text,
  prompt_version text not null,
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_project_file_analyses_version_prompt unique (file_version_id, prompt_version),
  constraint ck_project_file_analyses_kind check (file_kind in ('pdf', 'image', 'word', 'excel')),
  constraint ck_project_file_analyses_status check (status in ('succeeded', 'failed', 'skipped'))
);

create index if not exists ix_project_file_analyses_project on project_file_analyses (project_id, generated_at desc);
create index if not exists ix_project_file_analyses_file on project_file_analyses (file_id, file_version_id);

grant select, insert, update, delete on project_document_analysis_runs to libiaolink_api;
grant select, insert, update, delete on project_file_analyses to libiaolink_api;
grant select on project_document_analysis_runs to libiaolink_readonly;
grant select on project_file_analyses to libiaolink_readonly;
