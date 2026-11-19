import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export class CaseDataError extends Error {}

export async function readCredential(directoryVariable, filename) {
  const directory = process.env[directoryVariable];
  if (!directory || !isAbsolute(directory)) {
    throw new CaseDataError(`${directoryVariable} 必须指向受控的绝对路径`);
  }
  const file = await open(join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(() => { throw new CaseDataError(`无法打开案例数据凭据文件 ${filename}`); });
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0) {
      throw new CaseDataError("凭据文件权限必须仅允许其所有者访问");
    }
    return (await file.readFile("utf8")).trim();
  } finally {
    await file.close();
  }
}

export async function readDatabaseUrl(directoryVariable, filename) {
  const value = await readCredential(directoryVariable, filename);
  const url = URL.parse(value);
  if (!url || !["postgresql:", "postgres:"].includes(url.protocol)
      || !url.hostname || !url.username || !url.password || url.pathname.length <= 1) {
    throw new CaseDataError("凭据文件须包含完整的 PostgreSQL 连接串");
  }
  return value;
}

export async function assertCaseDatabaseRole(client, role, failureMessage = `须通过独立案例库的 ${role} 角色执行操作`) {
  const { rows: [{ allowed }] } = await client.query(`
    select current_database() = 'libiaolink_case'
      and current_user = $1 and session_user = current_user
      and current_setting('is_superuser') = 'off'
      and to_regclass('public.projects') is null and to_regclass('public.schema_migrations') is null
      and not exists (select 1 from pg_catalog.pg_database where datname = 'libiaolink') as allowed
  `, [role]);
  if (!allowed) throw new CaseDataError(failureMessage);
}

export function errorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? `（${code}）` : "";
}
