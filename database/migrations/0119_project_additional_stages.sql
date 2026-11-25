-- 项目内新增的任务分组，按原阶段独立编号；删除记录留作编号历史。
create table project_additional_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage_key text not null,
  number integer not null,
  deleted_at timestamptz,
  constraint uq_project_additional_stages_number unique (project_id, stage_key, number),
  constraint ck_project_additional_stages_key check (stage_key in ('presale', 'design', 'purchase', 'assembly', 'install', 'deploy', 'trial', 'production', 'acceptance')),
  constraint ck_project_additional_stages_number check (number > 0)
);

alter table tasks add column additional_stage_number integer;
alter table tasks add constraint ck_tasks_additional_stage_key check (additional_stage_number is null or stage_key is not null);
alter table tasks add constraint fk_tasks_additional_stage foreign key
  (project_id, stage_key, additional_stage_number) references project_additional_stages (project_id, stage_key, number);

grant select, insert, update on project_additional_stages to libiaolink_api;
