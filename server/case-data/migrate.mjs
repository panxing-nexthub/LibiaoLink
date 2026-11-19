import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { CaseDataError, errorCode, readDatabaseUrl } from "./database-credentials.mjs";

const migrationsDir = new URL("./migrations/", import.meta.url);
const migrationLock = 20261119;

async function readMigrations() {
  const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  if (filenames.length === 0) throw new CaseDataError("未找到案例库迁移文件");
  return Promise.all(filenames.map(async (filename) => {
    const source = await readFile(new URL(filename, migrationsDir), "utf8");
    const sql = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    return { filename, sql, checksum };
  }));
}

async function verifyTarget(db) {
  const { rows: [target] } = await db.query(`
    select current_database() as database_name,
           session_user as login_role, current_user as effective_role,
           current_setting('is_superuser') = 'on' as is_superuser,
           exists (select 1 from pg_catalog.pg_database where datname = 'libiaolink') as has_core_database,
           to_regclass('public.projects') is not null
             or to_regclass('public.schema_migrations') is not null as has_core_tables
  `);
  if (target.database_name !== "libiaolink_case") {
    throw new CaseDataError("目标数据库必须是 libiaolink_case");
  }
  if (target.has_core_database || target.has_core_tables) {
    throw new CaseDataError("目标必须是独立案例实例，检测到核心数据库或核心表");
  }
  if (target.login_role !== "case_migrator" || target.effective_role !== "case_migrator" || target.is_superuser) {
    throw new CaseDataError("案例迁移须直接使用非超级用户 case_migrator 登录");
  }
}

async function applyMigration(db, migration) {
  await db.query("begin");
  try {
    await db.query(migration.sql);
    await db.query('insert into "case".case_schema_migrations (filename, checksum) values ($1, $2)', [
      migration.filename, migration.checksum,
    ]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw new CaseDataError(`迁移失败并回滚 ${migration.filename}${errorCode(error)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.length === 1 && args[0] === "--check";
  if (args.length && !checkOnly) throw new CaseDataError("案例迁移仅接受 --check 参数");
  const connectionString = await readDatabaseUrl("CASE_MIGRATION_SECRET_DIR", "case_migration_database_url");
  const migrations = await readMigrations();
  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000, lock_timeout: 2_000, idle_in_transaction_session_timeout: 60_000 });
  try {
    await db.connect();
    await verifyTarget(db);
    // 连接持有锁，覆盖账本检查和各文件事务，关闭连接时释放。
    if (checkOnly) {
      await db.query("select pg_advisory_lock_shared($1::bigint)", [migrationLock]);
      await db.query("begin read only");
      const { rows: [{ ledger }] } = await db.query("select to_regclass('\"case\".case_schema_migrations') as ledger");
      if (!ledger) throw new CaseDataError("案例迁移账本不存在");
    } else {
      await db.query("select pg_advisory_lock($1::bigint)", [migrationLock]);
      await db.query(`
        create schema if not exists "case";
        create table if not exists "case".case_schema_migrations (
          filename text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        )
      `);
    }
    const { rows: applied } = await db.query('select filename, checksum from "case".case_schema_migrations order by filename collate "C"');
    for (const [index, previous] of applied.entries()) {
      const migration = migrations[index];
      if (previous.filename !== migration?.filename || previous.checksum !== migration.checksum) {
        throw new CaseDataError(`迁移历史漂移 ${previous.filename}，须恢复原文件内容及顺序`);
      }
    }
    const pending = migrations.slice(applied.length);
    if (checkOnly) {
      if (pending.length) throw new CaseDataError(`案例迁移账本落后，尚有 ${pending.length} 个待执行迁移`);
      await db.query("commit");
      console.log(`case-migrate: 已核对 ${applied.length} 个迁移，迁移历史无漂移`);
      return;
    }
    for (const migration of pending) {
      await applyMigration(db, migration);
      console.log(`case-migrate: 已执行 ${migration.filename}`);
    }
    console.log(`case-migrate: 本次执行 ${pending.length} 个迁移，迁移历史无漂移`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  const message = error instanceof CaseDataError ? error.message : `案例迁移失败${errorCode(error)}`;
  console.error(`case-migrate: ${message}`);
  process.exitCode = 1;
});
