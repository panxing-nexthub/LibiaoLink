-- 归档项目的日报附图使用专用上传会话，和普通文件版本及变更会话区分。
alter table upload_sessions drop constraint if exists ck_upload_sessions_intent;
alter table upload_sessions add constraint ck_upload_sessions_intent
  check (intent in ('version', 'change', 'report_photo'));
