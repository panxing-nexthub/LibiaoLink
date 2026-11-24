-- LibiaoLink · 项目总览的默认行顺序
-- 尚未排序的旧记录和普通新增记录继续按创建时间与 id 顺序追加。
alter table project_management_records
  add column if not exists sort_order integer;

comment on column project_management_records.sort_order is
  '项目总览自定义行位置；null 表示排在已排序记录之后，按创建时间和 id 排序';
