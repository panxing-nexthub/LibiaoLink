-- 本地项目只保存在独立案例库，不写核心 libiaolink。
create table project_read.local_projects (
  project_id uuid not null,
  project_code text not null check (project_code = btrim(project_code) and char_length(project_code) between 1 and 50),
  project_name text not null check (char_length(btrim(project_name)) between 1 and 200),
  customer_text text check (customer_text is null or char_length(customer_text) <= 200),
  region text not null check (char_length(btrim(region)) between 1 and 100),
  project_type text not null check (char_length(btrim(project_type)) between 1 and 100),
  manager_ids uuid[] not null default '{}'::uuid[],
  manager_names text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active', 'paused', 'done', 'archived')),
  source_version integer not null default 1 check (source_version >= 1),
  source_updated_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz,
  synced_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint pk_local_projects primary key (project_id),
  constraint ux_local_projects_code unique (project_code),
  constraint ck_local_projects_manager_ids check (array_position(manager_ids, null::uuid) is null),
  constraint ck_local_projects_manager_names check (cardinality(manager_names) = cardinality(manager_ids)),
  constraint ck_local_projects_archived check (status <> 'archived' or archived_at is not null)
);

-- project_summary 仍是核心只读投影，不混入本地项目。此表只保存跨来源编号/ID 的占用声明。
create table project_read.project_code_claim (
  project_id uuid not null,
  project_code text not null,
  source_kind text not null check (source_kind in ('core', 'local')),
  is_available boolean not null,
  claimed_at timestamptz not null default statement_timestamp(),
  constraint pk_project_code_claim primary key (project_id)
);

-- 项目 ID 对全部历史摘要保留唯一占用；编号只对目录可见项唯一。
create unique index ux_project_code_claim_code
  on project_read.project_code_claim (project_code) where is_available;

insert into project_read.project_code_claim (project_id, project_code, source_kind, is_available)
select project_id, btrim(project_code), 'core', deleted_at is null and source_missing_at is null
from project_read.project_summary;

-- 触发器函数只维护占用声明；调用方不直接持有 claim 表权限。
create function project_read.sync_project_code_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, project_read
as $$
declare
  claim_source text;
  claim_available boolean;
begin
  claim_source := case TG_TABLE_NAME
    when 'project_summary' then 'core'
    when 'local_projects' then 'local'
    else null
  end;
  if claim_source is null then
    raise exception 'unsupported project claim source: %', TG_TABLE_NAME;
  end if;

  if TG_OP = 'DELETE' then
    delete from project_read.project_code_claim
    where project_id = OLD.project_id and source_kind = claim_source;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    delete from project_read.project_code_claim
    where project_id = OLD.project_id and source_kind = claim_source;
  end if;

  claim_available := case claim_source
    when 'local' then true
    else NEW.deleted_at is null and NEW.source_missing_at is null
  end;
  insert into project_read.project_code_claim (project_id, project_code, source_kind, is_available)
  values (NEW.project_id, btrim(NEW.project_code), claim_source, claim_available);
  return NEW;
end;
$$;

revoke all on function project_read.sync_project_code_claim() from public;

create trigger trg_project_summary_claim_code
after insert or update of project_id, project_code, deleted_at, source_missing_at on project_read.project_summary
for each row execute function project_read.sync_project_code_claim();

create trigger trg_project_summary_release_code
after delete on project_read.project_summary
for each row execute function project_read.sync_project_code_claim();

create trigger trg_local_projects_claim_code
after insert or update of project_id, project_code on project_read.local_projects
for each row execute function project_read.sync_project_code_claim();

create trigger trg_local_projects_release_code
after delete on project_read.local_projects
for each row execute function project_read.sync_project_code_claim();

-- TRUNCATE 不触发行级触发器；源表被整体重置时同步清空对应来源的占用声明。
create function project_read.clear_project_code_claims()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, project_read
as $claim$
declare
  claim_source text;
begin
  claim_source := case TG_TABLE_NAME
    when 'project_summary' then 'core'
    when 'local_projects' then 'local'
    else null
  end;
  if claim_source is null then
    raise exception 'unsupported project claim source: %', TG_TABLE_NAME;
  end if;

  delete from project_read.project_code_claim where source_kind = claim_source;
  return null;
end;
$claim$;

revoke all on function project_read.clear_project_code_claims() from public;

create trigger trg_project_summary_clear_claims
after truncate on project_read.project_summary
for each statement execute function project_read.clear_project_code_claims();

create trigger trg_local_projects_clear_claims
after truncate on project_read.local_projects
for each statement execute function project_read.clear_project_code_claims();

-- 网关只从这里读取合并目录；project_summary 的结构与只读权限保持不变。
-- 视图按调用者权限读取两个来源，避免绕过底层授权。
create view project_read.project_directory
with (security_invoker = true) as
select project_id, project_code, project_name, customer_text, region, project_type,
       manager_ids, manager_names, status, source_version, source_updated_at, archived_at,
       deleted_at, synced_at, source_missing_at, 'core'::text as source_kind
from project_read.project_summary
union all
select project_id, project_code, project_name, customer_text, region, project_type,
       manager_ids, manager_names, status, source_version, source_updated_at, archived_at,
       null::timestamptz as deleted_at, synced_at, null::timestamptz as source_missing_at,
       'local'::text as source_kind
from project_read.local_projects;

grant select on project_read.project_directory to case_gateway_authoring_rw;
grant select, insert, update on project_read.local_projects to case_gateway_authoring_rw;
