-- 成果文件下拉选项按创建账号隔离。公共字典和任务成果保持原有结构。
create table personal_deliverable_types (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint uq_personal_deliverable_types_owner_name unique (owner_id, name),
  constraint ck_personal_deliverable_types_name check (char_length(btrim(name)) between 1 and 50)
);

grant select, insert on personal_deliverable_types to libiaolink_api;
revoke update, delete on personal_deliverable_types from libiaolink_api;
revoke all on personal_deliverable_types from libiaolink_readonly;
