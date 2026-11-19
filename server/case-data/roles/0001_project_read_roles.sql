-- 独立案例实例管理员执行。凭据由受控渠道下发。
begin;

do $$
declare
  role_name text;
  existing_role pg_catalog.pg_roles%rowtype;
begin
  if current_database() <> 'libiaolink_case'
     or exists (select 1 from pg_catalog.pg_database where datname = 'libiaolink')
     or to_regclass('public.projects') is not null
     or to_regclass('public.schema_migrations') is not null then
    raise exception '案例运行角色只能在独立 libiaolink_case 实例配置';
  end if;

  foreach role_name in array array[
    'case_project_projection_rw', 'case_gateway_authoring_rw', 'case_operation_cleanup', 'case_gateway_public_ro'
  ] loop
    select * into existing_role from pg_catalog.pg_roles where rolname = role_name;
    if not found then
      execute format('create role %I login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls', role_name);
    elsif not existing_role.rolcanlogin or existing_role.rolsuper or existing_role.rolcreatedb
       or existing_role.rolcreaterole or existing_role.rolinherit or existing_role.rolreplication
       or existing_role.rolbypassrls
       or exists (select 1 from pg_catalog.pg_auth_members where member = existing_role.oid) then
      raise exception '既有角色 % 的权限属性与案例运行角色约定不符', role_name;
    end if;
  end loop;
end $$;

grant connect on database libiaolink_case
  to case_project_projection_rw, case_gateway_authoring_rw, case_operation_cleanup, case_gateway_public_ro;

commit;
