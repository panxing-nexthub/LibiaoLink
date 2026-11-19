alter table "case".case_asset_uploads
  add column multipart_upload_id text,
  drop constraint case_asset_uploads_size_bytes_check,
  add constraint case_asset_uploads_size_bytes_check check (size_bytes between 1 and 268435456);

alter table "case".case_assets
  drop constraint case_assets_size_bytes_check,
  add constraint case_assets_size_bytes_check check (size_bytes between 1 and 268435456),
  add column preview_status text not null default 'pending' check (preview_status in ('pending', 'ready', 'failed')),
  add column image_width integer check (image_width > 0),
  add column image_height integer check (image_height > 0),
  add column duration_ms integer check (duration_ms > 0),
  add column media_version integer not null default 1 check (media_version > 0),
  add constraint case_assets_dimensions_pair check ((image_width is null) = (image_height is null));

grant update (multipart_upload_id) on "case".case_asset_uploads to case_gateway_authoring_rw;
grant update (scan_status, transcode_status, preview_status, image_width, image_height, duration_ms, media_version)
  on "case".case_assets to case_gateway_authoring_rw;
