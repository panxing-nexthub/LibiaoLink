-- 既有归档均为标准验收归档。只补类型，不重跑归档流程或发送通知。
update project_archives set archive_kind = 'accepted' where archive_kind is null;
alter table project_archives
  alter column archive_kind set default 'accepted',
  alter column archive_kind set not null;
