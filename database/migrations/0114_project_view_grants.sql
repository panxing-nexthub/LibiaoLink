-- 项目经理添加的独立只读授权；与部门规则、项目名册和历史企微卡授权无关联。
create table project_view_grants (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index ix_project_view_grants_user on project_view_grants (user_id);
