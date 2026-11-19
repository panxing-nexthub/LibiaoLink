create table "case".case_releases (
  id uuid primary key default uuidv7(),
  case_id uuid not null references "case".cases (id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null default 'staged',
  source_project_id uuid not null,
  source_version integer not null check (source_version >= 0),
  project_snapshot jsonb not null check (jsonb_typeof(project_snapshot) = 'object'),
  case_snapshot jsonb not null check (jsonb_typeof(case_snapshot) = 'object'),
  case_content_hash text not null check (case_content_hash ~ '^[0-9a-f]{64}$'),
  project_snapshot_hash text not null check (project_snapshot_hash ~ '^[0-9a-f]{64}$'),
  release_hash text not null check (release_hash ~ '^[0-9a-f]{64}$'),
  approval_ref text,
  created_by text not null,
  staged_at timestamptz not null default statement_timestamp(),
  staged_xact_id xid8 not null default pg_current_xact_id(),
  activated_at timestamptz,
  superseded_at timestamptz,
  withdrawn_at timestamptz,
  unique (case_id, version_no),
  unique (id, case_id),
  check (
    (status = 'staged' and approval_ref is null and activated_at is null and superseded_at is null and withdrawn_at is null)
    or (status = 'active' and approval_ref is not null and activated_at is not null and superseded_at is null and withdrawn_at is null)
    or (status = 'superseded' and approval_ref is not null and activated_at is not null and superseded_at is not null and withdrawn_at is null)
    or (status = 'withdrawn' and approval_ref is not null and activated_at is not null and superseded_at is null and withdrawn_at is not null)
  )
);

create unique index case_releases_one_active on "case".case_releases (case_id) where status = 'active';

create function "case".guard_release_transition() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not (
    (old.status = 'staged' and new.status = 'active')
    or (old.status = 'active' and new.status in ('superseded', 'withdrawn')
        and (old.approval_ref, old.activated_at) is not distinct from (new.approval_ref, new.activated_at))
  ) then
    raise check_violation using message = 'invalid case release transition';
  end if;
  return new;
end;
$$;

create trigger guard_release_transition before update on "case".case_releases
for each row execute function "case".guard_release_transition();

alter table "case".case_assets add unique (case_id, id, asset_version_id, object_version_id);

create table "case".case_release_assets (
  release_id uuid not null,
  case_id uuid not null,
  asset_id uuid not null,
  asset_version_id uuid not null,
  object_version_id text not null,
  sort_order integer not null check (sort_order >= 0),
  primary key (release_id, asset_version_id),
  unique (release_id, sort_order),
  constraint case_release_assets_release_fk
    foreign key (release_id, case_id) references "case".case_releases (id, case_id) on delete restrict,
  constraint case_release_assets_object_version_fk
    foreign key (case_id, asset_id, asset_version_id, object_version_id)
    references "case".case_assets (case_id, id, asset_version_id, object_version_id) on delete restrict
);

create index case_release_assets_asset_reference
  on "case".case_release_assets (case_id, asset_id, asset_version_id, object_version_id);

create function "case".guard_release_asset_insert() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from "case".case_releases
    where id = new.release_id and case_id = new.case_id
      and status = 'staged' and staged_xact_id = pg_current_xact_id()
  ) then
    raise check_violation using message = 'case release assets can only be inserted during staging';
  end if;
  return new;
end;
$$;

create trigger guard_release_asset_insert before insert on "case".case_release_assets
for each row execute function "case".guard_release_asset_insert();

-- 两个读面只解析 active release，公开角色无需查询任何基表。
create view "case".published_release_v with (security_barrier = true) as
select id as release_id, case_id, version_no, case_snapshot, activated_at
from "case".case_releases where status = 'active';

create view "case".published_release_assets_v with (security_barrier = true) as
select r.release_id, r.case_id, r.asset_id, r.asset_version_id, r.object_version_id, r.sort_order,
       a.object_key, a.mime_type, a.size_bytes
from "case".case_release_assets r
join "case".published_release_v p using (release_id, case_id)
join "case".case_assets a
  on (a.case_id, a.id, a.asset_version_id, a.object_version_id) =
     (r.case_id, r.asset_id, r.asset_version_id, r.object_version_id);

grant select on "case".case_releases, "case".case_release_assets to case_gateway_authoring_rw;
grant insert (case_id, version_no, source_project_id, source_version, project_snapshot, case_snapshot,
              case_content_hash, project_snapshot_hash, release_hash, created_by)
  on "case".case_releases to case_gateway_authoring_rw;
grant update (status, approval_ref, activated_at, superseded_at, withdrawn_at)
  on "case".case_releases to case_gateway_authoring_rw;
grant insert (release_id, case_id, asset_id, asset_version_id, object_version_id, sort_order)
  on "case".case_release_assets to case_gateway_authoring_rw;
grant usage on schema "case" to case_gateway_public_ro;
grant select on "case".published_release_v, "case".published_release_assets_v to case_gateway_public_ro;
