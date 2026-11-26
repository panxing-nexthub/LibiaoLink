-- 项目总览阶段备注。原阶段使用字典键，新增阶段使用分组 UUID。
create table project_stage_notes (
  project_id uuid not null references projects(id) on delete cascade,
  stage_ref text not null,
  note text not null,
  primary key (project_id, stage_ref)
);

grant select, insert, update, delete on project_stage_notes to libiaolink_api;
