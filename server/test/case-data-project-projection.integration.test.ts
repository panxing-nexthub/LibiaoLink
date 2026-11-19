import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { expect, it } from "vitest";

const coreAdminUrl = process.env.CASE_DATA_PROJECTION_TEST_CORE_ADMIN_URL;
const caseAdminUrl = process.env.CASE_DATA_PROJECTION_TEST_CASE_ADMIN_URL;
const secretDir = process.env.CASE_DATA_PROJECTION_TEST_SECRET_DIR;
const executable = fileURLToPath(new URL("../case-data/project-projection.mjs", import.meta.url));
const oldTime = "2000-01-01T00:00:00.123456Z";
const [first, second, removed, lateOld, lateRecent] = [
  "10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003", "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
] as const;
const [managerA, managerB, managerMissing] = [
  "20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
] as const;

function fixture(connectionString: string, database: string) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== `/${database}`) {
    throw new Error("Project projection tests need a disposable loopback database pair");
  }
  return new Client({ connectionString });
}

function invoke(mode: "incremental" | "reconcile") {
  return spawnSync(process.execPath, [executable, mode], {
    env: {
      ...process.env,
      CASE_PROJECTION_SECRET_DIR: secretDir,
      CASE_PROJECTION_BATCH_SIZE: "1",
      CASE_PROJECTION_BATCH_PAUSE_MS: "0",
      CASE_PROJECTION_OVERLAP_SECONDS: "300",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
}

function run(mode: "incremental" | "reconcile") {
  const execution = invoke(mode);
  expect(execution.status, execution.stderr).toBe(0);
  return JSON.parse(execution.stdout);
}

async function addProject(db: Client, id: string, code: string, managers: string[], time: string | null = oldTime) {
  await db.query(`
    insert into public.projects (id, code, name, region, project_type, manager_ids, stage_key, status, updated_at)
    values ($1, $2, $2, '华东', '分拣', $3, 'presale', 'active', coalesce($4::timestamptz, clock_timestamp()))
  `, [id, code, managers, time]);
}

async function summary(db: Client, id: string) {
  const { rows } = await db.query(`
    select project_name, manager_names, source_version, status, archived_at, deleted_at,
           synced_at::text, source_updated_at::text, missing_scans, source_missing_at, last_seen_at::text
    from project_read.project_summary where project_id = $1
  `, [id]);
  return rows[0];
}

it.skipIf(!coreAdminUrl || !caseAdminUrl || !secretDir)(
  "projects by precise cursors and reconciles late writes, missed scans, and reappearances across two PostgreSQL instances",
  async () => {
    const source = fixture(coreAdminUrl!, "libiaolink");
    const delayed = fixture(coreAdminUrl!, "libiaolink");
    const target = fixture(caseAdminUrl!, "libiaolink_case");
    await Promise.all([source.connect(), delayed.connect(), target.connect()]);
    try {
      expect((await source.query("select count(*)::int as total from public.projects")).rows[0].total).toBe(0);
      expect((await target.query("select count(*)::int as total from project_read.projection_watermarks")).rows[0].total).toBe(0);
      await source.query(`
        insert into public.users (id, casdoor_id, username, display_name, updated_at)
        values ($1, 'case-c04-a', 'case-c04-a', '经理甲', $3), ($2, 'case-c04-b', 'case-c04-b', '经理乙', $3)
      `, [managerA, managerB, oldTime]);
      await addProject(source, first, "C04-A", [managerB, managerMissing, managerA]);
      await addProject(source, second, "C04-B", [managerA]);
      await addProject(source, removed, "C04-C", [managerB]);
      await delayed.query("begin");
      await addProject(delayed, lateOld, "C04-OLD", [managerA]);
      await addProject(delayed, lateRecent, "C04-RECENT", [managerA], null);

      expect(run("incremental")).toMatchObject({ projectsRead: 3, projectsChanged: 3, projectPages: 3, managersRead: 2 });
      expect(await summary(target, first)).toMatchObject({ manager_names: ["经理乙", null, "经理甲"], source_version: 0 });
      expect((await summary(target, second)).source_updated_at).toContain(".123456");
      expect(await summary(target, lateRecent)).toBeUndefined();
      await delayed.query("commit");

      await source.query("update public.users set display_name = '经理甲新名', updated_at = clock_timestamp() where id = $1", [managerA]);
      await source.query("update public.projects set status = 'archived', archived_at = clock_timestamp(), archived_by = $2, version = 1, updated_at = clock_timestamp() where id = $1", [second, managerA]);
      await source.query("update public.projects set deleted_at = clock_timestamp(), deleted_by = $2, version = 1, updated_at = clock_timestamp() where id = $1", [first, managerA]);
      run("incremental");
      expect(await summary(target, lateOld)).toBeUndefined();
      expect(await summary(target, lateRecent)).toMatchObject({ manager_names: ["经理甲新名"] });
      expect(await summary(target, first)).toMatchObject({ manager_names: ["经理乙", null, "经理甲新名"], deleted_at: expect.any(Date) });
      expect(await summary(target, second)).toMatchObject({ status: "archived", archived_at: expect.any(Date), source_version: 1 });
      const repeated = await summary(target, first);
      expect(run("incremental")).toMatchObject({ projectsChanged: 0, summariesRenamed: 0 });
      expect(await summary(target, first)).toEqual(repeated);

      await source.query("update public.projects set deleted_at = null, deleted_by = null, version = 2, updated_at = clock_timestamp() where id = $1", [first]);
      await source.query("update public.users set display_name = '经理乙新名', updated_at = clock_timestamp() where id = $1", [managerB]);
      expect(run("incremental")).toMatchObject({ summariesRenamed: 1 });
      expect(await summary(target, first)).toMatchObject({ deleted_at: null, source_version: 2 });
      expect(await summary(target, removed)).toMatchObject({ manager_names: ["经理乙新名"], source_version: 0 });
      await source.query("delete from public.projects where id = $1", [removed]);
      await source.query("update public.projects set name = '过窗修复', version = 2, updated_at = $2 where id = $1", [second, oldTime]);
      await source.query("update public.users set display_name = '经理乙对账名', updated_at = $2 where id = $1", [managerB, oldTime]);
      expect(run("reconcile")).toMatchObject({ idsRead: 4, projectsRepaired: 2, firstMissing: 1, newlyMissing: 0 });
      expect(await summary(target, first)).toMatchObject({ manager_names: ["经理乙对账名", null, "经理甲新名"], source_version: 2 });
      expect(await summary(target, second)).toMatchObject({ project_name: "过窗修复", source_version: 2 });
      expect(await summary(target, lateOld)).toMatchObject({ project_name: "C04-OLD" });
      expect(await summary(target, removed)).toMatchObject({ missing_scans: 1, source_missing_at: null });

      const lastSeen = (await summary(target, first)).last_seen_at;
      await target.query("begin");
      await target.query("select project_id from project_read.project_summary where project_id = $1 for update", [second]);
      const failed = invoke("reconcile");
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain("55P03");
      await target.query("rollback");
      expect(await summary(target, first)).toMatchObject({ last_seen_at: lastSeen });
      expect(await summary(target, removed)).toMatchObject({ missing_scans: 1, source_missing_at: null });

      expect(run("reconcile")).toMatchObject({ newlyMissing: 1 });
      expect(await summary(target, removed)).toMatchObject({ missing_scans: 2, source_missing_at: expect.any(Date) });
      await addProject(source, removed, "C04-C", [managerB]);
      run("reconcile");
      expect(await summary(target, removed)).toMatchObject({ missing_scans: 0, source_missing_at: null });

      await target.query("begin");
      await target.query("select pg_advisory_xact_lock(20261120)");
      expect(run("incremental")).toMatchObject({ status: "busy" });
      await target.query("rollback");
    } finally {
      await Promise.all([source.end(), delayed.end(), target.end()]);
    }
  },
  25_000,
);
