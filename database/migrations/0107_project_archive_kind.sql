-- 历史清单保留 null；从本版本起，归档事务记录操作人选择的类型。
-- 回滚：alter table project_archives drop column archive_kind;
alter table project_archives add column archive_kind text
  constraint ck_project_archives_kind check (archive_kind in ('accepted', 'unaccepted'));
