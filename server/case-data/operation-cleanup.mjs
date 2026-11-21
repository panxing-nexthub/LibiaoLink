import { readFile } from "node:fs/promises";
import { CaseOperationIdSchema } from "@libiaolink/contracts/case-data";
import pg from "pg";
import { assertCaseDatabaseRole, CaseDataError, errorCode, readDatabaseUrl } from "./database-credentials.mjs";

async function readConfirmedOperations() {
  const [filename] = process.argv.slice(2);
  if (!filename || process.argv.length !== 3) throw new CaseDataError("须提供一份已结清 outbox 操作的 JSON 清单");
  const manifest = await readFile(filename, "utf8").then(JSON.parse).catch(() => {
    throw new CaseDataError("无法读取已结清 outbox 操作的 JSON 清单");
  });
  if (!manifest || typeof manifest.clientId !== "string" || !manifest.clientId.trim()
      || manifest.clientId.length > 256 || !Array.isArray(manifest.operationIds)
      || manifest.operationIds.length > 500 || Object.keys(manifest).length !== 2
      || !manifest.operationIds.every((id) => CaseOperationIdSchema.safeParse(id).success)) {
    throw new CaseDataError("清单须包含一个 clientId 和最多 500 个 UUIDv7 operationIds");
  }
  return { clientId: manifest.clientId, operationIds: [...new Set(manifest.operationIds.map((id) => id.toLowerCase()))] };
}

async function main() {
  const { clientId, operationIds } = await readConfirmedOperations();
  const connectionString = await readDatabaseUrl("CASE_OPERATION_CLEANUP_SECRET_DIR", "case_operation_cleanup_database_url");
  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, lock_timeout: 500, idle_in_transaction_session_timeout: 10_000 });
  try {
    await db.connect();
    await assertCaseDatabaseRole(db, "case_operation_cleanup");
    const { rows: [{ tombstoned }] } = await db.query(
      'select "case".purge_case_operation_results($1, $2::uuid[]) as tombstoned', [clientId, operationIds],
    );
    console.log(JSON.stringify({ confirmed: operationIds.length, tombstoned }));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  const message = error instanceof CaseDataError ? error.message : `案例操作结果清理失败${errorCode(error)}`;
  console.error(message);
  process.exitCode = 1;
});
