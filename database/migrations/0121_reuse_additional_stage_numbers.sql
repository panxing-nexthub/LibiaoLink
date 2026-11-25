-- 展示编号只约束未删除的阶段，历史任务继续指向创建时的阶段 ID。
alter table tasks add column additional_stage_id uuid;

update tasks as task
set additional_stage_id = stage.id
from project_additional_stages as stage
where task.project_id = stage.project_id
  and task.stage_key = stage.stage_key
  and task.additional_stage_number = stage.number;

alter table project_additional_stages add constraint uq_project_additional_stages_identity
  unique (project_id, stage_key, number, id);
alter table tasks drop constraint fk_tasks_additional_stage;
alter table tasks add constraint fk_tasks_additional_stage
  foreign key (project_id, stage_key, additional_stage_number, additional_stage_id)
  references project_additional_stages (project_id, stage_key, number, id);
alter table tasks add constraint ck_tasks_additional_stage_pair
  check ((additional_stage_number is null) = (additional_stage_id is null));

alter table project_additional_stages drop constraint uq_project_additional_stages_number;
create unique index uq_project_additional_stages_active_number
  on project_additional_stages (project_id, stage_key, number) where deleted_at is null;
