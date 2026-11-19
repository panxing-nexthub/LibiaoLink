create table "case".subjects (
  id uuid primary key default uuidv7(),
  subject_type text not null check (subject_type in ('customer', 'partner', 'three_pl')),
  stable_key text not null check (length(btrim(stable_key)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'case_library',
  source_ref text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  row_version integer not null default 1 check (row_version > 0),
  unique (subject_type, stable_key),
  unique (id, subject_type)
);

create table "case".subject_aliases (
  id uuid primary key default uuidv7(),
  subject_id uuid not null references "case".subjects (id) on delete restrict,
  alias text not null check (length(btrim(alias)) > 0),
  locale text not null default 'zh-CN',
  source text,
  created_at timestamptz not null default statement_timestamp(),
  unique (subject_id, alias, locale)
);

create table "case".project_subjects (
  id uuid primary key default uuidv7(),
  project_id uuid not null,
  subject_id uuid not null,
  subject_type text not null,
  relation_type text not null check (relation_type = subject_type),
  is_primary boolean not null default false,
  source_version integer not null check (source_version >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (subject_id, subject_type) references "case".subjects (id, subject_type),
  unique (project_id, subject_id, relation_type)
);
create index project_subjects_subject_idx on "case".project_subjects (subject_id);

create table "case".project_members (
  id uuid primary key default uuidv7(),
  project_id uuid not null,
  operator_user_key text not null check (length(btrim(operator_user_key)) > 0),
  role_code text not null check (length(btrim(role_code)) > 0),
  source text,
  is_primary boolean not null default false,
  left_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (project_id, operator_user_key, role_code)
);
create index project_members_user_idx on "case".project_members (operator_user_key);

grant select on "case".subjects, "case".project_profiles,
  "case".subject_aliases, "case".project_subjects, "case".project_members to case_gateway_authoring_rw;
grant insert (subject_type, stable_key, display_name, status, source_system, source_ref),
  update (display_name, status, source_system, source_ref, row_version, updated_at)
  on "case".subjects to case_gateway_authoring_rw;
grant insert (project_id, source_version, attributes),
  update (source_version, attributes, row_version, updated_at)
  on "case".project_profiles to case_gateway_authoring_rw;
grant insert (subject_id, alias, locale, source), update (source), delete
  on "case".subject_aliases to case_gateway_authoring_rw;
grant insert (project_id, subject_id, subject_type, relation_type, is_primary, source_version),
  update (is_primary, source_version, updated_at), delete on "case".project_subjects to case_gateway_authoring_rw;
grant insert (project_id, operator_user_key, role_code, source, is_primary, left_at),
  update (source, is_primary, left_at, updated_at), delete on "case".project_members to case_gateway_authoring_rw;
