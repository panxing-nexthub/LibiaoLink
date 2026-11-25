-- 原阶段仍按项目判重，新增阶段各自从原阶段的同一个节点库选用节点。
drop index uq_tasks_active_source_node;
create unique index uq_tasks_active_source_node on tasks (project_id, task_node_id)
  where deleted_at is null and task_node_id is not null and additional_stage_number is null;
create unique index uq_tasks_additional_stage_source_node on tasks (project_id, stage_key, additional_stage_number, task_node_id)
  where deleted_at is null and task_node_id is not null and additional_stage_number is not null;
