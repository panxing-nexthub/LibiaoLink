-- 项目的完成结果通过归档记录保存。收紧状态约束，不改写项目的验收或归档记录。
alter table projects
  drop constraint ck_projects_status,
  add constraint ck_projects_status check (status in ('active', 'paused', 'archived'));
