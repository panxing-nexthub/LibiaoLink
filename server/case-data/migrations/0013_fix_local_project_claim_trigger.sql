-- 0012 的触发器在 local_projects 上访问了不存在的 NEW.deleted_at/source_missing_at 字段。
-- 通过 to_jsonb 只读取当前来源实际存在的字段，保持相同占用规则。
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

  if claim_source = $$local$$ then
    claim_available := true;
  else
    claim_available := (to_jsonb(NEW) ->> $$deleted_at$$) is null
      and (to_jsonb(NEW) ->> $$source_missing_at$$) is null;
  end if;
  insert into project_read.project_code_claim (project_id, project_code, source_kind, is_available)
  values (NEW.project_id, btrim(NEW.project_code), claim_source, claim_available);
  return NEW;
end;
$claim$;
