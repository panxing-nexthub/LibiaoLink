-- 案例小组 v0.2 的 cases 表，按 v1.0 字段与更新答复补列和约束。
create table "case".cases (
  id uuid primary key default uuidv7(),
  source_project_id uuid not null,
  locale text not null,
  title text not null,
  summary text,
  change_summary text,
  content jsonb not null default '{"schemaVersion":1,"fields":[]}',
  solution_parameters jsonb not null default '{"schemaVersion":1,"groups":[]}',
  outcomes jsonb not null default '{"schemaVersion":1,"metrics":[]}',
  confidentiality jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint cases_locale_nonempty_chk check (length(btrim(locale)) > 0),
  constraint cases_title_length_chk check (length(btrim(title)) between 1 and 300),
  constraint cases_summary_length_chk check (length(summary) between 1 and 5000),
  constraint cases_change_summary_length_chk check (length(change_summary) <= 1000),
  constraint cases_content_shape_chk check ((
    jsonb_typeof(content) = 'object' and content @> '{"schemaVersion":1}'
    and jsonb_typeof(content->'fields') = 'array'
  ) is true),
  constraint cases_solution_parameters_shape_chk check ((
    jsonb_typeof(solution_parameters) = 'object' and solution_parameters @> '{"schemaVersion":1}'
    and jsonb_typeof(solution_parameters->'groups') = 'array'
  ) is true),
  constraint cases_outcomes_shape_chk check ((
    jsonb_typeof(outcomes) = 'object' and outcomes @> '{"schemaVersion":1}'
    and jsonb_typeof(outcomes->'metrics') = 'array'
  ) is true),
  constraint cases_confidentiality_shape_chk check ((
    jsonb_typeof(confidentiality) = 'object' and confidentiality @> '{"schemaVersion":1}'
    and confidentiality->>'mode' in ('public', 'partial', 'private')
    and confidentiality->>'customerIdentity' in ('secret', 'internal', 'public')
    and confidentiality->>'contentVisibility' in ('secret', 'internal', 'public')
    and confidentiality->>'mediaPermission' in ('secret', 'internal', 'public')
    and (confidentiality->>'mode' <> 'private' or nullif(confidentiality->'internalScope', 'null'::jsonb) is not null)
  ) is true),
  constraint cases_created_by_nonempty_chk check (length(btrim(created_by)) > 0),
  constraint cases_row_version_chk check (row_version > 0)
);

create index cases_source_project_idx on "case".cases (source_project_id);

grant usage on schema "case" to case_gateway_authoring_rw;
grant select on "case".cases to case_gateway_authoring_rw;
grant insert (id, source_project_id, locale, title, summary, change_summary,
              content, solution_parameters, outcomes, confidentiality, created_by)
  on "case".cases to case_gateway_authoring_rw;
grant update (title, summary, change_summary, content, solution_parameters,
              outcomes, confidentiality, row_version, updated_at)
  on "case".cases to case_gateway_authoring_rw;
