create table "case".case_asset_uploads (
  id uuid primary key,
  case_id uuid not null references "case".cases (id) on delete restrict,
  client_id text not null,
  asset_id uuid not null,
  asset_version_id uuid not null unique,
  object_key text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 33554432),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default statement_timestamp() + interval '15 minutes',
  completed_object_version_id text
);

create table "case".case_assets (
  id uuid not null,
  case_id uuid not null references "case".cases (id) on delete restrict,
  client_id text not null,
  asset_version_id uuid not null unique,
  object_version_id text not null check (object_version_id <> '' and object_version_id <> 'null'),
  object_key text not null unique,
  asset_kind text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 33554432),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null default 'pending' check (scan_status in ('pending', 'passed', 'failed')),
  transcode_status text not null check (transcode_status in ('not_required', 'pending', 'ready', 'failed')),
  created_by text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (id, asset_version_id),
  unique (id, asset_version_id, object_version_id)
);

create index case_assets_case_idx on "case".case_assets (case_id);

grant select on "case".case_asset_uploads, "case".case_assets to case_gateway_authoring_rw;
grant insert (id, case_id, client_id, asset_id, asset_version_id, object_key, original_filename,
              mime_type, size_bytes, sha256) on "case".case_asset_uploads to case_gateway_authoring_rw;
grant update (completed_object_version_id) on "case".case_asset_uploads to case_gateway_authoring_rw;
grant insert (id, case_id, client_id, asset_version_id, object_version_id, object_key, asset_kind,
              original_filename, mime_type, size_bytes, sha256, transcode_status, created_by)
  on "case".case_assets to case_gateway_authoring_rw;
