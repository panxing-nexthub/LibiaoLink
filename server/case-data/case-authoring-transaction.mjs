import { assertCaseDatabaseRole } from "./database-credentials.mjs";

async function withCaseTransaction(pool, readOnly, role, roleError, work) {
  const client = await pool.connect();
  let reusable = false;
  try {
    await client.query(readOnly ? "begin read only" : "begin isolation level read committed read write");
    await assertCaseDatabaseRole(client, role, roleError);
    const result = await work(client);
    await client.query("commit");
    reusable = true;
    return result;
  } catch (error) {
    // 回滚失败时丢弃连接，仍由上层处理原异常。
    reusable = await client.query("rollback").then(() => true, () => false);
    throw error;
  } finally {
    client.release(!reusable);
  }
}

export function withCaseAuthoringTransaction(pool, readOnly, work) {
  return withCaseTransaction(pool, readOnly, "case_gateway_authoring_rw", "案例操作须通过独立案例库的网关作者角色执行", work);
}

export function withCasePublicReadTransaction(pool, work) {
  return withCaseTransaction(pool, true, "case_gateway_public_ro", "发布读面须通过独立案例库的公开只读角色执行", work);
}
