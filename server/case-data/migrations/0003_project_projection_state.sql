alter table project_read.project_summary
  add column missing_scans smallint not null default 0 check (missing_scans between 0 and 2),
  add column last_seen_scan_id uuid;

create index ix_project_summary_manager_ids on project_read.project_summary using gin (manager_ids);

create table project_read.projection_watermarks (
  stream text primary key check (stream in ('projects', 'managers')),
  scanned_through timestamptz not null
);

grant select, insert, update on project_read.projection_watermarks to case_project_projection_rw;
