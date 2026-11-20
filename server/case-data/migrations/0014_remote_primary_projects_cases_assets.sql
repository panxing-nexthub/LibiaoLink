-- 远端主存 P0：项目软删除、案例版本/语言分组、项目级素材与跨案例挂接。
-- 0012/0013 已部署，不修改历史文件。

alter table project_read.local_projects add column deleted_at timestamptz;
alter table project_read.local_projects drop constraint ux_local_projects_code;

create or replace function project_read.sync_project_code_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, project_read
as $claim$
declare
  claim_source text;
  claim_available boolean;
begin
  claim_source := case TG_TABLE_NAME
    when $$project_summary$$ then $$core$$
    when $$local_projects$$ then $$local$$
    else null
  end;
  if claim_source is null then
    raise exception $$unsupported project claim source: %$$, TG_TABLE_NAME;
  end if;

  if TG_OP = $$DELETE$$ then
    delete from project_read.project_code_claim
    where project_id = OLD.project_id and source_kind = claim_source;
    return OLD;
  end if;

  if TG_OP = $$UPDATE$$ then
    delete from project_read.project_code_claim
    where project_id = OLD.project_id and source_kind = claim_source;
  end if;

  claim_available := (to_jsonb(NEW) ->> $$deleted_at$$) is null
    and (to_jsonb(NEW) ->> $$source_missing_at$$) is null;
  insert into project_read.project_code_claim (project_id, project_code, source_kind, is_available)
  values (NEW.project_id, btrim(NEW.project_code), claim_source, claim_available);
  return NEW;
end;
$claim$;

revoke all on function project_read.sync_project_code_claim() from public;

drop trigger if exists trg_local_projects_claim_code on project_read.local_projects;
create trigger trg_local_projects_claim_code
after insert or update of project_id, project_code, deleted_at on project_read.local_projects
for each row execute function project_read.sync_project_code_claim();

create or replace view project_read.project_directory
with (security_invoker = true) as
select project_id, project_code, project_name, customer_text, region, project_type,
       manager_ids, manager_names, status, source_version, source_updated_at, archived_at,
       deleted_at, synced_at, source_missing_at, 'core'::text as source_kind
from project_read.project_summary
union all
select project_id, project_code, project_name, customer_text, region, project_type,
       manager_ids, manager_names, status, source_version, source_updated_at, archived_at,
       deleted_at, synced_at, null::timestamptz as source_missing_at, 'local'::text as source_kind
from project_read.local_projects;

alter table "case".cases
  add column translation_group_id uuid,
  add column review_status text not null default 'not_submitted'
    check (review_status in ('not_submitted', 'reviewing', 'approved', 'rejected')),
  add column review_ref text check (review_ref is null or char_length(btrim(review_ref)) between 1 and 256),
  add column archived_at timestamptz,
  add column deleted_at timestamptz;

update "case".cases set translation_group_id = id where translation_group_id is null;
alter table "case".cases alter column translation_group_id set not null;
alter table "case".cases alter column translation_group_id set default uuidv7();
create index cases_translation_group_idx on "case".cases (translation_group_id);
create index cases_project_updated_idx on "case".cases (source_project_id, updated_at desc, id desc);
create index cases_review_status_idx on "case".cases (source_project_id, review_status);

create table "case".case_versions (
  id uuid primary key default uuidv7(),
  case_id uuid not null references "case".cases (id) on delete restrict,
  version_no integer not null check (version_no > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  change_summary text check (change_summary is null or char_length(change_summary) <= 1000),
  restored_from_version_id uuid,
  created_by text not null check (char_length(btrim(created_by)) between 1 and 128),
  created_at timestamptz not null default statement_timestamp(),
  unique (case_id, version_no),
  unique (case_id, id),
  foreign key (restored_from_version_id) references "case".case_versions (id) on delete restrict
);
create index case_versions_case_idx on "case".case_versions (case_id, version_no desc);

insert into "case".case_versions (case_id, version_no, snapshot, change_summary, created_by, created_at)
select c.id, c.row_version,
       jsonb_build_object(
         'locale', c.locale,
         'translationGroupId', c.translation_group_id,
         'title', c.title,
         'summary', c.summary,
         'changeSummary', c.change_summary,
         'content', c.content,
         'solutionParameters', c.solution_parameters,
         'outcomes', c.outcomes,
         'confidentiality', c.confidentiality
       ),
       c.change_summary, c.created_by, c.updated_at
from "case".cases c;

alter table "case".case_asset_uploads
  add column project_id uuid,
  alter column case_id drop not null;

update "case".case_asset_uploads u
set project_id = c.source_project_id
from "case".cases c
where u.case_id = c.id;

alter table "case".case_asset_uploads alter column project_id set not null;
create index case_asset_uploads_project_idx on "case".case_asset_uploads (project_id);

alter table "case".case_assets
  add column project_id uuid,
  add column asset_version_no integer,
  alter column case_id drop not null;

update "case".case_assets a
set project_id = c.source_project_id
from "case".cases c
where a.case_id = c.id;

with numbered as (
  select id, asset_version_id,
         row_number() over (partition by id order by created_at, asset_version_id) as version_no
  from "case".case_assets
)
update "case".case_assets a
set asset_version_no = numbered.version_no
from numbered
where a.id = numbered.id and a.asset_version_id = numbered.asset_version_id;

alter table "case".case_assets
  alter column project_id set not null,
  alter column asset_version_no set not null,
  add constraint case_assets_version_no_chk check (asset_version_no > 0),
  add constraint case_assets_asset_version_no_key unique (id, asset_version_no);
create index case_assets_project_idx on "case".case_assets (project_id, created_at desc);

create table "case".case_asset_metadata (
  asset_id uuid primary key default uuidv7(),
  project_id uuid not null,
  client_id text not null,
  asset_type text not null default 'other'
    check (asset_type in ('logo', 'cover', 'image', 'video', 'document', 'other')),
  title text check (title is null or (char_length(title) between 1 and 300 and title ~ '[^[:space:]]')),
  description text check (description is null or char_length(description) <= 2000),
  locale text check (locale is null or (char_length(locale) between 2 and 20 and locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$')),
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 30),
  classification text not null default 'L1' check (classification in ('L1', 'L2', 'L3')),
  customer_visible boolean not null default false,
  customer_presentation_allowed boolean not null default false,
  share_allowed boolean not null default false,
  row_version integer not null default 1 check (row_version > 0),
  created_by text not null check (char_length(btrim(created_by)) between 1 and 128),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz,
  deleted_at timestamptz
);
create index case_asset_metadata_project_idx on "case".case_asset_metadata (project_id, created_at desc, asset_id desc);

insert into "case".case_asset_metadata
  (asset_id, project_id, client_id, asset_type, title, description, locale, tags, classification,
   customer_visible, customer_presentation_allowed, share_allowed, row_version, created_by, created_at, updated_at)
select distinct on (id)
  id, project_id, client_id,
  case asset_kind when 'image' then 'image' when 'video' then 'video' when 'document' then 'document' else 'other' end,
  null, null, null, '{}'::text[], 'L1', false, false, false, 1, created_by, created_at, created_at
from "case".case_assets
order by id, created_at, asset_version_id;

create table "case".case_asset_links (
  asset_id uuid not null references "case".case_asset_metadata (asset_id) on delete restrict,
  case_id uuid not null references "case".cases (id) on delete restrict,
  project_id uuid not null,
  created_by text not null check (char_length(btrim(created_by)) between 1 and 128),
  created_at timestamptz not null default statement_timestamp(),
  primary key (asset_id, case_id)
);
create index case_asset_links_case_idx on "case".case_asset_links (case_id, created_at desc, asset_id desc);

insert into "case".case_asset_links (asset_id, case_id, project_id, created_by, created_at)
select distinct a.id, a.case_id, a.project_id, a.created_by, a.created_at
from "case".case_assets a
where a.case_id is not null;

alter table "case".case_release_assets
  drop constraint case_release_assets_object_version_fk,
  add constraint case_release_assets_asset_version_fk
    foreign key (asset_id, asset_version_id, object_version_id)
    references "case".case_assets (id, asset_version_id, object_version_id) on delete restrict;

create or replace view "case".published_release_assets_v with (security_barrier = true) as
select r.release_id, r.case_id, r.asset_id, r.asset_version_id, r.object_version_id, r.sort_order,
       a.object_key, a.mime_type, a.size_bytes
from "case".case_release_assets r
join "case".published_release_v p using (release_id, case_id)
join "case".case_assets a
  on (a.id, a.asset_version_id, a.object_version_id) =
     (r.asset_id, r.asset_version_id, r.object_version_id);

grant select on project_read.project_directory to case_gateway_authoring_rw;
grant select, insert, update on project_read.local_projects to case_gateway_authoring_rw;

grant select on "case".case_asset_metadata, "case".case_asset_links to case_gateway_authoring_rw;
grant insert (asset_id, project_id, client_id, asset_type, title, description, locale, tags, classification,
              customer_visible, customer_presentation_allowed, share_allowed, created_by)
  on "case".case_asset_metadata to case_gateway_authoring_rw;
grant update (asset_type, title, description, locale, tags, classification, customer_visible,
              customer_presentation_allowed, share_allowed, row_version, updated_at, archived_at, deleted_at)
  on "case".case_asset_metadata to case_gateway_authoring_rw;
grant insert (asset_id, case_id, project_id, created_by), delete
  on "case".case_asset_links to case_gateway_authoring_rw;

alter table "case".case_asset_uploads
  add constraint case_asset_uploads_project_required_chk check (project_id is not null);
grant insert (id, case_id, project_id, client_id, asset_id, asset_version_id, object_key, original_filename,
              mime_type, size_bytes, sha256)
  on "case".case_asset_uploads to case_gateway_authoring_rw;

grant select on "case".case_versions to case_gateway_authoring_rw;
grant insert (case_id, version_no, snapshot, change_summary, restored_from_version_id, created_by)
  on "case".case_versions to case_gateway_authoring_rw;

grant insert (id, source_project_id, locale, title, summary, change_summary,
              content, solution_parameters, outcomes, confidentiality, created_by,
              translation_group_id, review_status, review_ref),
  update (title, summary, change_summary, content, solution_parameters, outcomes, confidentiality,
          review_status, review_ref, archived_at, deleted_at, row_version, updated_at)
  on "case".cases to case_gateway_authoring_rw;

grant insert (id, case_id, client_id, asset_version_id, object_version_id, object_key, asset_kind,
              original_filename, mime_type, size_bytes, sha256, transcode_status, created_by,
              project_id, asset_version_no)
  on "case".case_assets to case_gateway_authoring_rw;
