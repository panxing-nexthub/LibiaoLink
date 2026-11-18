-- LibiaoLink · 0104 项目管理人工覆盖字段（2026-11-18）
-- 业务口径：所有表格内容均可编辑；项目空间自动识别值仍保留为默认值，人工填写后以人工值优先。
-- 六个字段均为 nullable：null = 使用自动识别 / 自动计算值，非 null = 人工覆盖。
--
-- 幂等说明（2026-11-18）：测试机曾手工执行本文件的 DDL 但未写入 schema_migrations；
-- 列使用 if not exists、约束先 drop if exists 再 add，使迁移器可安全补记本迁移。
--
-- 回滚（如需）：
--   alter table project_management_records
--     drop constraint if exists ck_project_management_records_stage_override_length,
--     drop constraint if exists ck_project_management_records_days_override,
--     drop column if exists current_stage_override,
--     drop column if exists startup_completed_at_override,
--     drop column if exists arrival_date_override,
--     drop column if exists planned_start_date_override,
--     drop column if exists planned_end_date_override,
--     drop column if exists implementation_days_override;

alter table project_management_records
  add column if not exists current_stage_override text,
  add column if not exists startup_completed_at_override date,
  add column if not exists arrival_date_override date,
  add column if not exists planned_start_date_override date,
  add column if not exists planned_end_date_override date,
  add column if not exists implementation_days_override integer;

alter table project_management_records
  drop constraint if exists ck_project_management_records_stage_override_length;

alter table project_management_records
  add constraint ck_project_management_records_stage_override_length
    check (current_stage_override is null or char_length(current_stage_override) <= 120);

alter table project_management_records
  drop constraint if exists ck_project_management_records_days_override;

alter table project_management_records
  add constraint ck_project_management_records_days_override
    check (implementation_days_override is null or implementation_days_override >= 0);

comment on column project_management_records.current_stage_override is
  '项目当前阶段人工覆盖值；null = 使用项目空间自动识别值';
comment on column project_management_records.startup_completed_at_override is
  '启动时间人工覆盖值；null = 使用项目空间自动识别值';
comment on column project_management_records.arrival_date_override is
  '到货日期人工覆盖值；null = 使用项目空间自动识别值';
comment on column project_management_records.planned_start_date_override is
  '计划实施开始人工覆盖值；null = 使用项目空间自动识别值';
comment on column project_management_records.planned_end_date_override is
  '计划实施完成人工覆盖值；null = 使用项目空间自动识别值';
comment on column project_management_records.implementation_days_override is
  '实施天数人工覆盖值；null = 按有效计划实施起止日期自动计算';
