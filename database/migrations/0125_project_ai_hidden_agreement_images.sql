-- AI 项目总结：记录被用户移除的自动抽取布局图 / 三维图（按 auto-N 隐藏）
create table project_ai_hidden_agreement_images (
  project_id uuid not null references projects(id) on delete cascade,
  kind       text not null,
  image_id   text not null,
  hidden_at  timestamptz not null default now(),
  primary key (project_id, kind, image_id),
  constraint ck_project_ai_hidden_agreement_images_kind check (kind in ('layout', 'three_d')),
  constraint ck_project_ai_hidden_agreement_images_id check (image_id like 'auto-%')
);

grant select, insert, update, delete on project_ai_hidden_agreement_images to libiaolink_api;
grant select on project_ai_hidden_agreement_images to libiaolink_readonly;
