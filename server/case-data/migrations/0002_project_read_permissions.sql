grant usage on schema project_read to case_project_projection_rw, case_gateway_authoring_rw;

-- 对账保留旧摘要并更新缺失标记，因此写入角色只需要读、插入和更新。
grant select, insert, update on project_read.project_summary to case_project_projection_rw;
grant select on project_read.project_summary to case_gateway_authoring_rw;
