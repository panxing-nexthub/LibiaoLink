-- LibiaoLink · 0101 项目准备字段（2026-11-17）
-- 业务口径：项目管理页作为项目新建前准备区，项目经理 / 实施工程师 / 实施方式 / 风险提醒随项目主数据保存。
--   1. implementation_engineer_ids：实施工程师账号（0–50 位，数组顺序 = 展示顺序）；
--   2. implementation_method：实施方式单选，仅允许五种业务口径；
--   3. risk_reminder：风险提醒手填文本。
-- 项目地点继续复用 projects.region；项目当前阶段继续复用 projects.stage_key（本次页面不编辑）。
--
-- 回滚（如需）：
--   alter table projects drop constraint ck_projects_implementation_method;
--   alter table projects drop column risk_reminder;
--   alter table projects drop column implementation_method;
--   alter table projects drop column implementation_engineer_ids;

alter table projects
  add column implementation_engineer_ids uuid[] not null default '{}'::uuid[],
  add column implementation_method text,
  add column risk_reminder text;

alter table projects
  add constraint ck_projects_implementation_engineer_ids_limit
    check (cardinality(implementation_engineer_ids) <= 50),
  add constraint ck_projects_implementation_engineer_ids_no_null
    check (array_position(implementation_engineer_ids, null::uuid) is null),
  add constraint ck_projects_implementation_method
    check (
      implementation_method is null
      or implementation_method in (
        'onsite_installation_guidance',
        'remote_installation_guidance',
        'installation_delivery',
        'remote_guidance',
        'onsite_guidance'
      )
    ),
  add constraint ck_projects_risk_reminder_length
    check (risk_reminder is null or char_length(risk_reminder) <= 2000);

comment on column projects.implementation_engineer_ids is
  '项目实施工程师账号（项目准备表单，0–50 位，数组顺序 = 展示顺序）';
comment on column projects.implementation_method is
  '实施方式：onsite_installation_guidance / remote_installation_guidance / installation_delivery / remote_guidance / onsite_guidance';
comment on column projects.risk_reminder is
  '项目风险提醒（项目准备表单，手填，最长 2000 字）';
