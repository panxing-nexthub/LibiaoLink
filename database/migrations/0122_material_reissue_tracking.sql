-- LibiaoLink · 0122 物料补发发货登记（2026-11-25）
-- 业务口径：补发页可跨多张补发申请单勾选物料行，批量登记已发货 / 已签收、快递单号、
-- 预计到货时间、发货备注与凭证图片；登记结果进入「补发追踪」。
--
-- 变更：change_requests 新增 material_reissue_tracking jsonb 数组（默认 []）；
-- 普通变更为空数组，物料补发按 lineIndex 对应 material_reissue.materials 行。
--
-- 回滚（如需）：
--   alter table change_requests drop constraint ck_change_requests_material_reissue_tracking_array;
--   alter table change_requests drop constraint ck_change_requests_material_reissue_tracking_scope;
--   alter table change_requests drop column material_reissue_tracking;

alter table change_requests
  add column material_reissue_tracking jsonb not null default '[]'::jsonb;

alter table change_requests
  add constraint ck_change_requests_material_reissue_tracking_array
  check (jsonb_typeof(material_reissue_tracking) = 'array'),
  add constraint ck_change_requests_material_reissue_tracking_scope
  check (change_type = 'material_reissue' or material_reissue_tracking = '[]'::jsonb);
