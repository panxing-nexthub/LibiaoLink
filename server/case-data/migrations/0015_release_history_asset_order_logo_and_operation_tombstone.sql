-- 2026-11-21 增量：案例素材持久排序、发布历史枚举、客户 Logo 版本冻结与 operation 墓碑。
-- 0014 已部署，本文件只做增量变更。

alter table "case".case_asset_links add column sort_order integer;

with ranked as (
  select asset_id, case_id,
         row_number() over (partition by case_id order by created_at, asset_id) as position
  from "case".case_asset_links
)
update "case".case_asset_links link
set sort_order = least((ranked.position - 1) * 10, 100000)
from ranked
where (link.asset_id, link.case_id) = (ranked.asset_id, ranked.case_id);

alter table "case".case_asset_links
  alter column sort_order set default 10,
  alter column sort_order set not null,
  add constraint case_asset_links_sort_order_chk check (sort_order between 0 and 100000);
create index case_asset_links_case_order_idx
  on "case".case_asset_links (case_id, sort_order, asset_id);
grant insert (sort_order), update (sort_order)
  on "case".case_asset_links to case_gateway_authoring_rw;

alter table "case".case_releases
  add column customer_logo_asset_id uuid,
  add column customer_logo_asset_version_id uuid,
  add column customer_logo_object_version_id text,
  add constraint case_releases_customer_logo_chk check (
    (customer_logo_asset_id is null and customer_logo_asset_version_id is null
      and customer_logo_object_version_id is null)
    or (customer_logo_asset_id is not null and customer_logo_asset_version_id is not null
      and customer_logo_object_version_id is not null)
  ),
  add constraint case_releases_customer_logo_fk
    foreign key (customer_logo_asset_id, customer_logo_asset_version_id, customer_logo_object_version_id)
    references "case".case_assets (id, asset_version_id, object_version_id) on delete restrict;
grant insert (customer_logo_asset_id, customer_logo_asset_version_id, customer_logo_object_version_id)
  on "case".case_releases to case_gateway_authoring_rw;

create or replace view "case".published_release_v with (security_barrier = true) as
select id as release_id, case_id, version_no, case_snapshot, activated_at,
       customer_logo_asset_id, customer_logo_asset_version_id, customer_logo_object_version_id
from "case".case_releases where status = 'active';

create view "case".published_release_logo_v with (security_barrier = true) as
select p.release_id, p.case_id, p.customer_logo_asset_id as asset_id,
       p.customer_logo_asset_version_id as asset_version_id,
       p.customer_logo_object_version_id as object_version_id,
       a.object_key, a.mime_type, a.size_bytes
from "case".published_release_v p
join "case".case_assets a
  on (a.id, a.asset_version_id, a.object_version_id) =
     (p.customer_logo_asset_id, p.customer_logo_asset_version_id, p.customer_logo_object_version_id);
grant select on "case".published_release_logo_v to case_gateway_public_ro;

alter table "case".case_idempotency_keys
  alter column response drop not null,
  add column purged_at timestamptz;
alter table "case".case_idempotency_keys
  drop constraint case_idempotency_keys_response_check,
  add constraint case_idempotency_keys_response_check check (
    (response is not null and jsonb_typeof(response) = 'object' and purged_at is null)
    or (response is null and purged_at is not null)
  );

create or replace function "case".purge_case_operation_results(confirmed_client text, confirmed_operations uuid[])
returns integer
language sql
security definer
set search_path = pg_catalog
as $$
  with tombstoned as (
    update "case".case_idempotency_keys as receipt
    set response = null, purged_at = statement_timestamp()
    where receipt.client_id = confirmed_client
      and cardinality(confirmed_operations) between 1 and 500
      and receipt.operation_id = any(confirmed_operations)
      and receipt.purged_at is null
      and case
        when receipt.expires_at <= statement_timestamp()
          and receipt.created_at <= statement_timestamp() - interval '30 days'
        then pg_try_advisory_xact_lock(hashtextextended(jsonb_build_array(receipt.client_id, receipt.operation_id)::text, 0))
        else false
      end
    returning 1
  )
  select count(*)::integer from tombstoned;
$$;

revoke all on function "case".purge_case_operation_results(text, uuid[]) from public;
grant execute on function "case".purge_case_operation_results(text, uuid[]) to case_operation_cleanup;
