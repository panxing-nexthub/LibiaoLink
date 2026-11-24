-- AI 项目总结：设备布局 / 三维图的人工图片从「一类型一张」扩展为「一类型多张」
-- 既有行保留并补齐 id / sort_order；新行按 sort_order 追加。
alter table project_ai_manual_images add column if not exists id uuid;
alter table project_ai_manual_images add column if not exists sort_order integer not null default 0;
update project_ai_manual_images set id = gen_random_uuid() where id is null;
alter table project_ai_manual_images alter column id set default gen_random_uuid();
alter table project_ai_manual_images alter column id set not null;
alter table project_ai_manual_images drop constraint if exists project_ai_manual_images_pkey;
alter table project_ai_manual_images add constraint project_ai_manual_images_pkey primary key (id);
create unique index if not exists uq_project_ai_manual_images_order
  on project_ai_manual_images (project_id, kind, sort_order);
