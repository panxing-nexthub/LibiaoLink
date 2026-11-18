-- LibiaoLink · 0103 项目管理实施工程师已移交状态（2026-11-18）
-- 业务口径：实施工程师选择器顶部提供可点击的「已移交」按钮，点击即保存该状态，再点取消。
-- 状态为实施工程师格子的替代值：选中「已移交」时清空工程师名单且不显示姓名；该字段只属于 project_management_records，不写入项目空间。
--
-- 幂等说明（2026-11-18）：测试机曾手工执行本文件的 DDL 但未写入 schema_migrations；
-- add column if not exists 使迁移器可在不破坏既有列的前提下补记本迁移。
--
-- 回滚（如需）：
--   alter table project_management_records drop column if exists implementation_handed_over;

alter table project_management_records
  add column if not exists implementation_handed_over boolean not null default false;

comment on column project_management_records.implementation_handed_over is
  '实施工程师已移交状态：false = 未选择，true = 格子直接显示「已移交」并清空工程师名单';
