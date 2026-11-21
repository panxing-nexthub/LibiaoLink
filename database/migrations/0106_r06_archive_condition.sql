-- 保留 R06 的启停、动作和自定义条件。
update automation_rules
set conditions = '[{"field":"project.status","op":"eq","value":"archived"}]'::jsonb,
    version = version + 1,
    updated_at = now()
where code = 'R06' and built_in and deleted_at is null
  and trigger = '{"kind":"event","topic":"project.completed"}'::jsonb
  and conditions = '[{"field":"project.status","op":"eq","value":"done"}]'::jsonb;
