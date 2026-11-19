-- 参数仅由维护任务传入，内容为案例小组已确认 outbox 结清的操作标识。
create function "case".purge_case_operation_results(confirmed_client text, confirmed_operations uuid[])
returns integer
language sql
security definer
set search_path = pg_catalog
as $$
  with removed as (
    delete from "case".case_idempotency_keys as receipt
    where receipt.client_id = confirmed_client
      and cardinality(confirmed_operations) between 1 and 500
      and receipt.operation_id = any(confirmed_operations)
      and case
        when receipt.expires_at <= statement_timestamp()
          and receipt.created_at <= statement_timestamp() - interval '30 days'
        then pg_try_advisory_xact_lock(hashtextextended(jsonb_build_array(receipt.client_id, receipt.operation_id)::text, 0))
        else false
      end
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke all on function "case".purge_case_operation_results(text, uuid[]) from public;
grant usage on schema "case" to case_operation_cleanup;
grant execute on function "case".purge_case_operation_results(text, uuid[]) to case_operation_cleanup;
