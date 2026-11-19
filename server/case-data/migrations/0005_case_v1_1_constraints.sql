-- 0004 已建立三个标量列与空容器默认值。这里接入案例小组 002 评审稿的收紧约束。
alter table "case".cases
  drop constraint cases_locale_nonempty_chk,
  drop constraint cases_title_length_chk,
  drop constraint cases_summary_length_chk,
  drop constraint cases_change_summary_length_chk,
  drop constraint cases_content_shape_chk,
  drop constraint cases_solution_parameters_shape_chk,
  drop constraint cases_outcomes_shape_chk,
  drop constraint cases_confidentiality_shape_chk,
  drop constraint cases_created_by_nonempty_chk,
  add constraint cases_locale_v1_chk check (char_length(locale) between 2 and 20 and locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  add constraint cases_title_v1_chk check (char_length(title) between 1 and 300 and title ~ '[^[:space:]]'),
  add constraint cases_summary_v1_chk check (summary is null or (char_length(summary) <= 5000 and summary ~ '[^[:space:]]')),
  add constraint cases_change_summary_v1_chk check (change_summary is null or (char_length(change_summary) <= 1000 and change_summary ~ '[^[:space:]]')),
  add constraint cases_created_by_v1_chk check (char_length(created_by) between 1 and 128 and created_by ~ '[^[:space:]]'),
  add constraint cases_content_v1_chk check ((
    content @> '{"schemaVersion":1}' and content - 'schemaVersion' - 'fields' = '{}'::jsonb
    and case when jsonb_typeof(content->'fields') = 'array' then jsonb_array_length(content->'fields') <= 200 else false end
  ) is true),
  add constraint cases_solution_parameters_v1_chk check ((
    solution_parameters @> '{"schemaVersion":1}' and solution_parameters - 'schemaVersion' - 'groups' = '{}'::jsonb
    and case when jsonb_typeof(solution_parameters->'groups') = 'array' then jsonb_array_length(solution_parameters->'groups') <= 20 else false end
  ) is true),
  add constraint cases_outcomes_v1_chk check ((
    outcomes @> '{"schemaVersion":1}' and outcomes - 'schemaVersion' - 'metrics' = '{}'::jsonb
    and case when jsonb_typeof(outcomes->'metrics') = 'array' then jsonb_array_length(outcomes->'metrics') <= 100 else false end
  ) is true),
  add constraint cases_confidentiality_v1_chk check ((
    confidentiality @> '{"schemaVersion":1}'
    and confidentiality - 'schemaVersion' - 'mode' - 'customerIdentity' - 'contentVisibility' - 'mediaPermission' - 'internalScope' = '{}'::jsonb
    and confidentiality->>'mode' in ('public', 'partial', 'private')
    and confidentiality->>'customerIdentity' in ('secret', 'internal', 'public')
    and confidentiality->>'contentVisibility' in ('secret', 'internal', 'public')
    and confidentiality->>'mediaPermission' in ('secret', 'internal', 'public')
    and case coalesce(jsonb_typeof(confidentiality->'internalScope'), 'null')
          when 'null' then confidentiality->>'mode' <> 'private'
          when 'string' then confidentiality->>'internalScope' ~ '[^[:space:]]'
            and char_length(confidentiality->>'internalScope') <= 2000
          else false
        end
  ) is true);

-- v0.2 托管 schema。案例侧补充属性提供方案类型，核心项目投影仍只用于项目来源校验。
create table "case".project_profiles (
  id uuid primary key default uuidv7(),
  project_id uuid not null unique,
  source_version integer not null check (source_version >= 0),
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0)
);

grant select (project_id, attributes) on "case".project_profiles to case_gateway_authoring_rw;
