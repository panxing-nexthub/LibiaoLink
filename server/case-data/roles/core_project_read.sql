-- 由核心库管理员执行。核心侧仅配置投影账号和列级授权。
begin;

do $$
declare
  existing_role pg_catalog.pg_roles%rowtype;
begin
  if current_database() <> 'libiaolink'
     or to_regclass('public.projects') is null
     or to_regclass('public.users') is null
     or exists (select 1 from pg_catalog.pg_database where datname = 'libiaolink_case') then
    raise exception '投影源账号只能在独立核心 libiaolink 实例配置';
  end if;

  select * into existing_role from pg_catalog.pg_roles where rolname = 'case_project_ro';
  if not found then
    create role case_project_ro login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  elsif not existing_role.rolcanlogin or existing_role.rolsuper or existing_role.rolcreatedb
     or existing_role.rolcreaterole or existing_role.rolinherit or existing_role.rolreplication
     or existing_role.rolbypassrls
     or exists (select 1 from pg_catalog.pg_auth_members where member = existing_role.oid) then
    raise exception '既有 case_project_ro 权限属性与投影账号约定不符';
  end if;
end $$;

alter role case_project_ro connection limit 2;
alter role case_project_ro in database libiaolink set default_transaction_read_only = on;
alter role case_project_ro in database libiaolink set statement_timeout = '5s';
alter role case_project_ro in database libiaolink set lock_timeout = '500ms';
alter role case_project_ro in database libiaolink set idle_in_transaction_session_timeout = '10s';

grant connect on database libiaolink to case_project_ro;
grant usage on schema public to case_project_ro;
grant select (id, code, name, customer, region, project_type, manager_ids, status, version,
              updated_at, deleted_at, archived_at) on public.projects to case_project_ro;
grant select (id, display_name, updated_at) on public.users to case_project_ro;

commit;
