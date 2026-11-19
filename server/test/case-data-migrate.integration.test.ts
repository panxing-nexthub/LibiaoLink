import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { expect, it } from "vitest";

const migrationScript = fileURLToPath(new URL("../case-data/migrate.mjs", import.meta.url));
const caseUrl = process.env.CASE_DATA_TEST_MIGRATOR_URL;
const coreUrl = process.env.CASE_DATA_TEST_CORE_URL;
const projectionUrl = process.env.CASE_DATA_TEST_PROJECTION_URL;
const authoringUrl = process.env.CASE_DATA_TEST_AUTHORING_URL;

function localTestDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== `/${database}`) {
    throw new Error("Use the dedicated loopback PostgreSQL fixture for this test");
  }
  return new Client({ connectionString });
}

async function runMigration(connectionString: string, mode = 0o600, args: string[] = []) {
  const secretDir = await mkdtemp(join(tmpdir(), "libiaolink-case-migrate-"));
  try {
    const secretFile = join(secretDir, "case_migration_database_url");
    await writeFile(secretFile, connectionString, { mode: 0o600 });
    if (mode !== 0o600) await chmod(secretFile, mode);
    return spawnSync(process.execPath, [migrationScript, ...args], {
      env: { ...process.env, CASE_MIGRATION_SECRET_DIR: secretDir },
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    await rm(secretDir, { recursive: true, force: true });
  }
}

it.skipIf(!caseUrl)("applies the project summary migration and preserves its ledger on replay", async () => {
  const db = localTestDatabase(caseUrl!, "libiaolink_case");
  const first = await runMigration(caseUrl!);
  expect(first.status, first.stderr).toBe(0);
  await db.connect();
  try {
    const ledger = 'select filename, checksum, applied_at from "case".case_schema_migrations order by filename';
    const before = await db.query(ledger);
    expect(before.rows).toContainEqual(
      expect.objectContaining({ filename: "0001_project_summary.sql", checksum: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );

    const replay = await runMigration(caseUrl!);
    expect(replay.status, replay.stderr).toBe(0);
    expect(replay.stdout).toContain("无漂移");
    expect((await db.query(ledger)).rows).toEqual(before.rows);
    const check = await runMigration(caseUrl!, 0o600, ["--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain(`已核对 ${before.rowCount} 个迁移`);
    expect((await db.query(ledger)).rows).toEqual(before.rows);

    await db.query("begin");
    const addProject = `insert into project_read.project_summary
      (project_id, project_code, project_name, region, project_type, manager_ids, manager_names,
       status, source_version, source_updated_at, synced_at)
      values (gen_random_uuid(), 'test', '投影测试', '华东', '分拣', array[gen_random_uuid()],
              $1::text[], 'archived', 0, now(), now())`;
    await db.query(addProject, [[null]]);
    await expect(db.query(addProject, [[]])).rejects.toMatchObject({ code: "23514" });
  } finally {
    await db.query("rollback");
    await db.end();
  }
}, 20_000);

it.skipIf(!coreUrl)("rejects a core database before creating either case schema", async () => {
  const db = localTestDatabase(coreUrl!, "libiaolink");
  const result = await runMigration(coreUrl!);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("目标数据库必须是 libiaolink_case");
  await db.connect();
  try {
    const { rows } = await db.query("select to_regnamespace('case') as case_schema, to_regnamespace('project_read') as project_schema");
    expect(rows).toEqual([{ case_schema: null, project_schema: null }]);
  } finally {
    await db.end();
  }
}, 15_000);

it.skipIf(!caseUrl)("rejects a credential file readable by other users", async () => {
  const result = await runMigration(caseUrl!, 0o644);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("凭据文件权限");
});

async function expectDenied(db: Client, sql: string) {
  await db.query("begin");
  try {
    await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.query("rollback");
  }
}

it.skipIf(!projectionUrl)("allows the projection login to upsert summaries while forbidding deletion and DDL", async () => {
  const db = localTestDatabase(projectionUrl!, "libiaolink_case");
  await db.connect();
  try {
    await db.query("begin");
    try {
      const projectId = randomUUID();
      const upsert = `insert into project_read.project_summary
        (project_id, project_code, project_name, region, project_type, manager_ids, manager_names,
         status, source_version, source_updated_at, synced_at)
        values ($1, 'test', '权限测试', '华东', '分拣', array[gen_random_uuid()],
                array[null::text], 'archived', $2, now(), now())
        on conflict (project_id) do update set source_version = excluded.source_version`;
      await db.query(upsert, [projectId, 0]);
      await db.query(upsert, [projectId, 1]);
      const { rows } = await db.query("select source_version from project_read.project_summary where project_id = $1", [projectId]);
      expect(rows).toEqual([{ source_version: 1 }]);
    } finally {
      await db.query("rollback");
    }
    await expectDenied(db, "delete from project_read.project_summary where false");
    await expectDenied(db, "truncate project_read.project_summary");
    await expectDenied(db, "create table project_read.permission_probe (id int)");
    await expectDenied(db, "alter table project_read.project_summary add column permission_probe int");
    await expectDenied(db, 'select filename from "case".case_schema_migrations');
  } finally {
    await db.end();
  }
});

it.skipIf(!authoringUrl)("allows the authoring login to read summaries while forbidding writes, DDL and ledger access", async () => {
  const db = localTestDatabase(authoringUrl!, "libiaolink_case");
  await db.connect();
  try {
    await db.query("select project_id, status, source_version from project_read.project_summary");
    await expectDenied(db, "insert into project_read.project_summary select * from project_read.project_summary where false");
    await expectDenied(db, "update project_read.project_summary set synced_at = now() where false");
    await expectDenied(db, "delete from project_read.project_summary where false");
    await expectDenied(db, "truncate project_read.project_summary");
    await expectDenied(db, "create table project_read.permission_probe (id int)");
    await expectDenied(db, "alter table project_read.project_summary add column permission_probe int");
    await expectDenied(db, 'select filename from "case".case_schema_migrations');
  } finally {
    await db.end();
  }
});
