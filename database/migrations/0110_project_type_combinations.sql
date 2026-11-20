-- 单类型项目保留原值，多选时额外类型按选择顺序保存。
alter table projects add column if not exists additional_project_types text[] not null default '{}';
-- 保存建项目时的模板来源，之后调整类型组合时仍可从同一模板增补节点。
alter table projects add column if not exists source_blueprint_type text;
