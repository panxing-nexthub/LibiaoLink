-- LibiaoLink · 0102 项目管理独立记录表（2026-11-17）
-- 业务口径修订：项目管理页是独立的项目准备记录，不读取 / 不写入 projects，也不进入项目空间、回收站、归档或工作台。
--   1. 新增 project_management_records：编号、名称、项目经理、实施工程师、实施方式、风险提醒、项目地点等记录字段；
--   2. 编号 / 名称允许空串，以支持表格逐格写入即保存；
--   3. 项目经理复用现有资格名单，但记录只保存账号 id 快照，不建立 projects 外键；
--   4. 实施工程师仅保存启用账号 id，不建立业务项目关系；
--   5. 其余到货日期 / 计划实施 / 实施天数等列先保留为可空占位列，当前页面不编辑。
--
-- 0101 曾把准备字段误加到 projects；本迁移回撤这些列，确保项目主数据零改动。
--
-- 回滚（如需）：
--   drop table if exists project_management_records;
--   alter table projects
--     add column implementation_engineer_ids uuid[] not null default '{}'::uuid[],
--     add column implementation_method text,
--     add column risk_reminder text;

alter table projects
  drop constraint if exists ck_projects_implementation_engineer_ids_limit,
  drop constraint if exists ck_projects_implementation_engineer_ids_no_null,
  drop constraint if exists ck_projects_implementation_method,
  drop constraint if exists ck_projects_risk_reminder_length;

alter table projects
  drop column if exists implementation_engineer_ids,
  drop column if exists implementation_method,
  drop column if exists risk_reminder;

create table project_management_records (
  id uuid primary key default gen_random_uuid(),
  code text not null default '',
  name text not null default '',
  manager_ids uuid[] not null default '{}'::uuid[],
  implementation_engineer_ids uuid[] not null default '{}'::uuid[],
  implementation_method text,
  risk_reminder text,
  region text not null default '未分类',
  current_stage text,
  arrival_date date,
  planned_start_date date,
  planned_end_date date,
  implementation_days integer,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_project_management_records_code_length
    check (char_length(code) <= 50),
  constraint ck_project_management_records_name_length
    check (char_length(name) <= 200),
  constraint ck_project_management_records_manager_ids_limit
    check (cardinality(manager_ids) <= 200),
  constraint ck_project_management_records_manager_ids_no_null
    check (array_position(manager_ids, null::uuid) is null),
  constraint ck_project_management_records_engineer_ids_limit
    check (cardinality(implementation_engineer_ids) <= 50),
  constraint ck_project_management_records_engineer_ids_no_null
    check (array_position(implementation_engineer_ids, null::uuid) is null),
  constraint ck_project_management_records_method
    check (
      implementation_method is null
      or implementation_method in (
        'onsite_installation_guidance',
        'remote_installation_guidance',
        'installation_delivery',
        'remote_guidance',
        'onsite_guidance'
      )
    ),
  constraint ck_project_management_records_risk_length
    check (risk_reminder is null or char_length(risk_reminder) <= 2000),
  constraint ck_project_management_records_region_length
    check (char_length(region) <= 80),
  constraint ck_project_management_records_stage_length
    check (current_stage is null or char_length(current_stage) <= 120),
  constraint ck_project_management_records_days
    check (implementation_days is null or implementation_days >= 0),
  constraint ck_project_management_records_version
    check (version >= 0)
);

create index ix_project_management_records_created
  on project_management_records (created_at asc, id asc);

comment on table project_management_records is
  '项目管理页独立准备记录：与 projects 无外键、无业务联动；支持逐格写入即保存';
comment on column project_management_records.manager_ids is
  '项目经理账号 id 快照，候选复用现有项目经理资格名单，但不建立项目成员关系';
comment on column project_management_records.implementation_engineer_ids is
  '实施工程师账号 id 快照（0-50 位，仅启用账号），不建立项目成员关系';
comment on column project_management_records.implementation_method is
  '实施方式：onsite_installation_guidance / remote_installation_guidance / installation_delivery / remote_guidance / onsite_guidance';

grant select, insert, update, delete on table project_management_records to libiaolink_api;
grant select on table project_management_records to libiaolink_readonly;
