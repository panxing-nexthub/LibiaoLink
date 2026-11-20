import { CaseAggregateError } from "./case-aggregate.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";
import { hashCasePayload } from "./case-write.mjs";

const subjectColumns = `s.id as "subjectId", s.subject_type as "subjectType", s.stable_key as "stableKey",
  s.display_name as "displayName", s.status, s.source_system as "sourceSystem", s.source_ref as "sourceRef",
  s.row_version as "rowVersion", s.updated_at as "updatedAt",
  coalesce((select jsonb_agg(jsonb_build_object('alias', alias, 'locale', locale, 'source', source)
    order by alias collate "C", locale collate "C") from "case".subject_aliases where subject_id = s.id), '[]') as aliases`;
const locked = (client, namespace, ...key) =>
  client.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [JSON.stringify([namespace, ...key])]);

function orderInsensitive(items) {
  return items.map(hashCasePayload).sort();
}

function membersWithUtc(members) {
  return members.map((member) => ({ ...member, leftAt: member.leftAt === null ? null : new Date(member.leftAt).toISOString() }));
}

async function loadSubject(client, where, parameters) {
  const { rows: [subject] } = await client.query(
    `select ${subjectColumns} from "case".subjects s where ${where}`, parameters,
  );
  return subject;
}

async function loadProfile(client, projectId) {
  const { rows: [profile] } = await client.query(`
    select p.project_id as "externalProjectId", p.source_version as "sourceVersion", p.row_version as "rowVersion",
      p.updated_at as "updatedAt", p.attributes,
      coalesce((select jsonb_agg(jsonb_build_object('subjectId', subject_id, 'subjectType', subject_type, 'isPrimary', is_primary)
        order by subject_type collate "C", subject_id) from "case".project_subjects where project_id = p.project_id), '[]') as subjects,
      coalesce((select jsonb_agg(jsonb_build_object('operatorUserKey', operator_user_key, 'roleCode', role_code,
        'source', source, 'isPrimary', is_primary, 'leftAt', left_at) order by operator_user_key collate "C", role_code collate "C")
        from "case".project_members where project_id = p.project_id), '[]') as members
    from "case".project_profiles p where p.project_id = $1
  `, [projectId]);
  if (profile) profile.members = membersWithUtc(profile.members);
  return profile;
}

function checkVersion(current, expectedVersion) {
  if ((current?.rowVersion ?? 0) !== expectedVersion) {
    throw new CaseAggregateError("VERSION_CONFLICT", "当前版本已变化");
  }
}

export async function saveSubject(client, input) {
  const { subjectType, stableKey, displayName, status, sourceSystem, sourceRef, aliases, expectedVersion } = input;
  await locked(client, "case-subject", subjectType, stableKey);
  const current = await loadSubject(client, "s.subject_type = $1 and s.stable_key = $2", [subjectType, stableKey]);
  checkVersion(current, expectedVersion);
  if (current && current.displayName === displayName && current.status === status &&
      current.sourceSystem === sourceSystem && current.sourceRef === sourceRef &&
      hashCasePayload(orderInsensitive(current.aliases)) === hashCasePayload(orderInsensitive(aliases))) {
    return { status: 200, body: current, resourceId: current.subjectId };
  }
  const { rows: [{ id }] } = await client.query(`
    insert into "case".subjects (subject_type, stable_key, display_name, status, source_system, source_ref)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (subject_type, stable_key) do update set display_name = excluded.display_name, status = excluded.status,
      source_system = excluded.source_system, source_ref = excluded.source_ref,
      row_version = "case".subjects.row_version + 1, updated_at = statement_timestamp()
    returning id
  `, [subjectType, stableKey, displayName, status, sourceSystem, sourceRef]);
  await client.query(`
    with incoming as (select * from jsonb_to_recordset($2::jsonb) as v(alias text, locale text, source text)),
    removed as (
      delete from "case".subject_aliases a where subject_id = $1
        and not exists (select 1 from incoming i where (i.alias, i.locale) = (a.alias, a.locale))
    )
    insert into "case".subject_aliases (subject_id, alias, locale, source)
    select $1, alias, locale, source from incoming
    on conflict (subject_id, alias, locale) do update set source = excluded.source
    where "case".subject_aliases.source is distinct from excluded.source
  `, [id, JSON.stringify(aliases)]);
  return { status: current ? 200 : 201, body: await loadSubject(client, "s.id = $1", [id]), resourceId: id };
}

function profileDigest({ sourceVersion, attributes, subjects, members }) {
  return hashCasePayload({ sourceVersion, attributes, subjects: orderInsensitive(subjects), members: orderInsensitive(members) });
}

export async function saveProjectProfile(client, projectId, input) {
  await locked(client, "case-project-profile", projectId);
  const { rows: [project] } = await client.query(`
    select source_version from project_read.project_directory where project_id = $1 and deleted_at is null and source_missing_at is null
  `, [projectId]);
  if (!project) throw new CaseAggregateError("NOT_FOUND", "可选项目不存在");
  if (project.source_version !== input.sourceVersion) throw new CaseAggregateError("PROJECT_VERSION_CONFLICT", "项目版本已变化");
  const current = await loadProfile(client, projectId);
  checkVersion(current, input.expectedVersion);
  if (current && profileDigest(current) === profileDigest(input)) {
    return { status: 200, body: current, resourceId: projectId };
  }
  const subjects = JSON.stringify(input.subjects);
  const { rowCount } = await client.query(`
    select 1 from jsonb_to_recordset($1::jsonb) as v("subjectId" uuid, "subjectType" text)
    join "case".subjects s on (s.id, s.subject_type) = (v."subjectId", v."subjectType")
  `, [subjects]);
  if (rowCount !== input.subjects.length) throw new CaseAggregateError("VALIDATION_FAILED", "主体不存在或类型不匹配");

  await client.query(`
    insert into "case".project_profiles (project_id, source_version, attributes) values ($1,$2,$3::jsonb)
    on conflict (project_id) do update set source_version = excluded.source_version, attributes = excluded.attributes,
      row_version = "case".project_profiles.row_version + 1, updated_at = statement_timestamp()
  `, [projectId, input.sourceVersion, JSON.stringify(input.attributes)]);
  await client.query(`
    with incoming as (
      select "subjectId" as subject_id, "subjectType" as subject_type, "isPrimary" as is_primary
      from jsonb_to_recordset($2::jsonb) as v("subjectId" uuid, "subjectType" text, "isPrimary" boolean)
    ), removed as (
      delete from "case".project_subjects p where project_id = $1
        and not exists (select 1 from incoming i where (i.subject_id, i.subject_type) = (p.subject_id, p.relation_type))
    )
    insert into "case".project_subjects (project_id, subject_id, subject_type, relation_type, is_primary, source_version)
    select $1, subject_id, subject_type, subject_type, is_primary, $3 from incoming
    on conflict (project_id, subject_id, relation_type) do update set is_primary = excluded.is_primary,
      source_version = excluded.source_version, updated_at = statement_timestamp()
    where ("case".project_subjects.is_primary, "case".project_subjects.source_version)
      is distinct from (excluded.is_primary, excluded.source_version)
  `, [projectId, subjects, input.sourceVersion]);
  await client.query(`
    with incoming as (
      select "operatorUserKey" as user_key, "roleCode" as role_code, source, "isPrimary" as is_primary, "leftAt" as left_at
      from jsonb_to_recordset($2::jsonb) as v("operatorUserKey" text, "roleCode" text, source text, "isPrimary" boolean, "leftAt" timestamptz)
    ), removed as (
      delete from "case".project_members m where project_id = $1
        and not exists (select 1 from incoming i where (i.user_key, i.role_code) = (m.operator_user_key, m.role_code))
    )
    insert into "case".project_members (project_id, operator_user_key, role_code, source, is_primary, left_at)
    select $1, user_key, role_code, source, is_primary, left_at from incoming
    on conflict (project_id, operator_user_key, role_code) do update set source = excluded.source,
      is_primary = excluded.is_primary, left_at = excluded.left_at, updated_at = statement_timestamp()
    where ("case".project_members.source, "case".project_members.is_primary, "case".project_members.left_at)
      is distinct from (excluded.source, excluded.is_primary, excluded.left_at)
  `, [projectId, JSON.stringify(input.members)]);
  return { status: current ? 200 : 201, body: await loadProfile(client, projectId), resourceId: projectId };
}

export function createProjectDataReads(pool) {
  return {
    async subject(id) {
      const subject = await withCaseAuthoringTransaction(pool, true, (client) => loadSubject(client, "s.id = $1", [id]));
      if (!subject) throw new CaseAggregateError("NOT_FOUND", "主体不存在");
      return subject;
    },
    async profile(projectId) {
      const profile = await withCaseAuthoringTransaction(pool, true, (client) => loadProfile(client, projectId));
      if (!profile) throw new CaseAggregateError("NOT_FOUND", "项目补充数据不存在");
      return profile;
    },
  };
}
