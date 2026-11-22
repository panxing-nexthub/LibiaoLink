-- AI 项目总结缓存：同一项目 + 上下文指纹 + prompt 版本只保留一条；
-- 项目数据变化后 source_hash 变化，下次生成会写入新行，旧行保留可追溯。
-- 只缓存生成成功的结果；模型失败 / 超时不落库，由调用方重试。
create table project_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source_hash text not null,
  prompt_version text not null,
  model_id text,
  summary_text text not null,
  summary_json jsonb not null,
  generated_by uuid references users(id),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_project_ai_summaries_source unique (project_id, source_hash, prompt_version),
  constraint ck_project_ai_summaries_text check (char_length(summary_text) between 1 and 20000)
);

create index ix_project_ai_summaries_project on project_ai_summaries (project_id, generated_at desc);

grant select, insert, update, delete on project_ai_summaries to libiaolink_api;
grant select on project_ai_summaries to libiaolink_readonly;
