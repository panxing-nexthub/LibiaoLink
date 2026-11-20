import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { CaseDataError, errorCode, readDatabaseUrl } from "./database-credentials.mjs";
import { readManagerChanges, readManagerNames, readProjectChanges, readProjectIds, readProjects } from "./project-source.mjs";
import { findProjectsToRepair, markMissing, markSeen, readExistingManagerIds, refreshChangedManagers, upsertProjects } from "./project-summary.mjs";

const projectionLock = 20261120;
const secretDirectory = "CASE_PROJECTION_SECRET_DIR";

function readInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) {
    throw new CaseDataError(`${name} 必须是 ${min} 至 ${max} 的整数`);
  }
  return value;
}

async function* batches(readPage, getCursor, config) {
  let cursor = null;
  while (true) {
    const rows = await readPage(cursor);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < config.batchSize) return;
    cursor = getCursor(rows.at(-1));
    await delay(config.pauseMs);
  }
}

function attachNames(projects, names) {
  return projects.map((project) => ({
    ...project,
    manager_names: project.manager_ids.map((id) => names.get(id) ?? null),
  }));
}

async function increment(source, target, config, upper) {
  const { rows } = await target.query("select stream, scanned_through::text from project_read.projection_watermarks");
  const watermarks = new Map(rows.map(({ stream, scanned_through }) => [stream, scanned_through]));
  const result = { projectPages: 0, projectsRead: 0, projectsChanged: 0, managerPages: 0, managersRead: 0, summariesRenamed: 0 };

  const projectPages = batches(
    (cursor) => readProjectChanges(source, watermarks.get("projects") ?? null, upper, cursor, config),
    (row) => ({ updatedAt: row.source_updated_at, id: row.project_id }), config,
  );
  for await (const projects of projectPages) {
    const names = await readManagerNames(source, projects);
    result.projectPages += 1;
    result.projectsRead += projects.length;
    result.projectsChanged += await upsertProjects(target, attachNames(projects, names));
  }

  const managerPages = batches(
    (cursor) => readManagerChanges(source, watermarks.get("managers") ?? null, upper, cursor, config),
    (row) => ({ updatedAt: row.updated_at, id: row.id }), config,
  );
  for await (const users of managerPages) {
    result.managerPages += 1;
    result.managersRead += users.length;
    result.summariesRenamed += await refreshChangedManagers(target, users);
  }

  // 整次成功扫描的上界和摘要在同一个目标事务提交，失败后从上次上界回看。
  await target.query(`
    insert into project_read.projection_watermarks (stream, scanned_through)
    values ('projects', $1::timestamptz), ('managers', $1::timestamptz)
    on conflict (stream) do update set scanned_through = greatest(
      projection_watermarks.scanned_through, excluded.scanned_through
    )
  `, [upper]);
  return { ...result, readThrough: upper };
}

async function reconcile(source, target, config) {
  const scanId = randomUUID();
  const result = { projectPages: 0, idsRead: 0, projectsRepaired: 0 };
  const pages = batches((id) => readProjectIds(source, id, config.batchSize), (row) => row.project_id, config);
  for await (const observed of pages) {
    const repairIds = await findProjectsToRepair(target, observed);
    const needsRepair = new Set(repairIds);
    const repairs = await readProjects(source, repairIds);
    const unchanged = await readExistingManagerIds(target,
      observed.map((row) => row.project_id).filter((id) => !needsRepair.has(id)));
    const names = await readManagerNames(source, [...repairs, ...unchanged]);
    const resolved = attachNames(repairs, names);
    result.projectPages += 1;
    result.idsRead += observed.length;
    result.projectsRepaired += await upsertProjects(target, resolved);
    await markSeen(target, [...resolved, ...attachNames(unchanged, names)], scanId);
  }
  return { ...result, ...await markMissing(target, scanId) };
}

async function requireConnection(db, database, role) {
  const { rows: [actual] } = await db.query(`
    select current_database() as database, session_user as login_role, current_user as effective_role,
           current_setting('transaction_read_only') as read_only,
           exists (select 1 from pg_catalog.pg_database where datname = 'libiaolink') as has_core_database
  `);
  if (actual.database !== database || actual.login_role !== role || actual.effective_role !== role) {
    throw new CaseDataError(`投影连接必须使用 ${role} 登录 ${database}`);
  }
  if (database === "libiaolink" && actual.read_only !== "on") {
    throw new CaseDataError("核心投影连接必须使用只读事务");
  }
  if (database === "libiaolink_case" && actual.has_core_database) {
    throw new CaseDataError("投影目标必须是独立案例库实例");
  }
}

async function runOnce(source, target, mode, config) {
  await target.query("begin");
  let sourceTransaction = false;
  try {
    await requireConnection(target, "libiaolink_case", "case_project_projection_rw");
    const { rows: [{ acquired }] } = await target.query(
      "select pg_try_advisory_xact_lock($1::bigint) as acquired", [projectionLock]);
    if (!acquired) {
      await target.query("rollback");
      return { mode, status: "busy" };
    }

    await source.query("begin isolation level repeatable read read only");
    sourceTransaction = true;
    await requireConnection(source, "libiaolink", "case_project_ro");
    const { rows: [{ upper }] } = await source.query("select transaction_timestamp()::text as upper");
    const result = mode === "incremental" ? await increment(source, target, config, upper)
      : await reconcile(source, target, config);
    await source.query("commit");
    sourceTransaction = false;
    await target.query("commit");
    return { mode, status: "ok", ...result };
  } catch (error) {
    if (sourceTransaction) await source.query("rollback").catch(() => {});
    await target.query("rollback").catch(() => {});
    throw error;
  }
}

const retryableProjectionErrors = new Set([
  "40001", "40P01", "55P03", "57014", "53300", "57P03",
]);

function isConnectionFailure(error) {
  const code = error?.code;
  return (typeof code === "string" && (
    code.startsWith("08") || code.startsWith("57P")
    || ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(code)
  )) || (error instanceof Error
    && /Client has already been closed|Connection terminated|not queryable/.test(error.message));
}

function logWatchError(error, durationMs) {
  const payload = { mode: "watch", status: "error", durationMs };
  if (typeof error?.code === "string") payload.code = error.code;
  payload.message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify(payload));
}

async function waitForNextRun(intervalMs, signal) {
  try {
    await delay(intervalMs, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

async function watch(source, target, config) {
  const intervalMs = readInteger("CASE_PROJECTION_WATCH_MS", 1000, 250, 60000);
  const stopping = new AbortController();
  const stop = () => stopping.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    console.log(JSON.stringify({ mode: "watch", status: "started", intervalMs }));
    while (!stopping.signal.aborted) {
      const started = Date.now();
      try {
        const result = await runOnce(source, target, "incremental", config);
        if (result.status === "ok" && (result.projectsChanged > 0 || result.summariesRenamed > 0)) {
          console.log(JSON.stringify({ ...result, durationMs: Date.now() - started }));
        }
      } catch (error) {
        logWatchError(error, Date.now() - started);
        // 配置或连接故障应由进程守护重启；可恢复的 SQL 错误留在循环内重试。
        if (error instanceof CaseDataError || isConnectionFailure(error)
            || !retryableProjectionErrors.has(error?.code)) throw error;
      }
      if (!stopping.signal.aborted) await waitForNextRun(intervalMs, stopping.signal);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  console.log(JSON.stringify({ mode: "watch", status: "stopped" }));
}

async function main() {
  const [mode, ...otherArgs] = process.argv.slice(2);
  if (!["incremental", "reconcile", "watch"].includes(mode) || otherArgs.length !== 0) {
    throw new CaseDataError("用法为 project-projection.mjs incremental、reconcile 或 watch");
  }
  const config = {
    batchSize: readInteger("CASE_PROJECTION_BATCH_SIZE", 100, 1, 500),
    pauseMs: readInteger("CASE_PROJECTION_BATCH_PAUSE_MS", 25, 0, 1000),
    overlapSeconds: readInteger("CASE_PROJECTION_OVERLAP_SECONDS", 300, 1, 86400),
  };
  const started = Date.now();
  const source = new pg.Client({
    connectionString: await readDatabaseUrl(secretDirectory, "case_project_ro_database_url"),
    connectionTimeoutMillis: 5_000,
  });
  const target = new pg.Client({
    connectionString: await readDatabaseUrl(secretDirectory, "case_project_projection_rw_database_url"),
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000, lock_timeout: 500, idle_in_transaction_session_timeout: 30_000,
  });
  try {
    await Promise.all([source.connect(), target.connect()]);
    if (mode === "watch") {
      await watch(source, target, config);
      return;
    }
    const result = await runOnce(source, target, mode, config);
    console.log(JSON.stringify({ ...result, durationMs: Date.now() - started }));
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

main().catch((error) => {
  const message = error instanceof CaseDataError ? error.message : `项目摘要投影失败${errorCode(error)}`;
  console.error(`case-project-projection: ${message}`);
  process.exitCode = 1;
});
