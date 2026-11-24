-- AI 项目总结：设备布局 / 三维图的人工替换（覆盖技术协议自动判页）
create table project_ai_manual_images (
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null,
  object_key  text not null,
  mime        text not null,
  size_bytes  integer not null,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  primary key (project_id, kind),
  constraint ck_project_ai_manual_images_kind check (kind in ('layout', 'three_d')),
  constraint ck_project_ai_manual_images_size check (size_bytes >= 0)
);

grant select, insert, update, delete on project_ai_manual_images to libiaolink_api;
grant select on project_ai_manual_images to libiaolink_readonly;
