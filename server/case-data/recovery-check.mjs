import pg from "pg";
import { CaseAssetError, readCaseAssetStorage } from "./case-asset-storage.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";
import { CaseDataError, errorCode, readDatabaseUrl } from "./database-credentials.mjs";

async function main() {
  const [connectionString, storage] = await Promise.all([
    readDatabaseUrl("CASE_GATEWAY_SECRET_DIR", "case_gateway_authoring_rw_database_url"),
    readCaseAssetStorage(),
  ]);
  if (!storage) throw new CaseDataError("须配置独立案例桶才能校验恢复结果");
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, lock_timeout: 500, idle_in_transaction_session_timeout: 10_000 });
  const summary = { checked: 0, missing: 0, mismatch: 0 };
  try {
    await storage.probe();
    let cursor = null;
    for (;;) {
      const { rows } = await withCaseAuthoringTransaction(pool, true, (client) => client.query(`
        select a.asset_version_id as "assetVersionId", a.object_version_id as "objectVersionId",
               a.object_key as "objectKey", a.mime_type as "mimeType", a.size_bytes as "sizeBytes", a.sha256
        from "case".case_assets a
        where ($1::uuid is null or a.asset_version_id > $1)
          and exists (
            select 1 from "case".case_release_assets r
            where (r.case_id, r.asset_id, r.asset_version_id, r.object_version_id) =
                  (a.case_id, a.id, a.asset_version_id, a.object_version_id)
          )
        order by a.asset_version_id
        limit 50
      `, [cursor]));
      if (rows.length === 0) break;
      for (const asset of rows) {
        summary.checked += 1;
        try {
          await storage.verify(asset, asset.objectVersionId);
        } catch (error) {
          if (!(error instanceof CaseAssetError)) throw error;
          if (error.code === "UPLOAD_OBJECT_MISSING") summary.missing += 1;
          else if (error.code === "ASSET_OBJECT_MISMATCH") summary.mismatch += 1;
          else throw error;
          console.error(JSON.stringify({ assetVersionId: asset.assetVersionId, code: error.code }));
        }
      }
      cursor = rows.at(-1).assetVersionId;
    }
    console.log(JSON.stringify(summary));
    if (summary.missing || summary.mismatch) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof CaseDataError ? error.message : `案例恢复校验未完成${errorCode(error)}`);
  process.exitCode = 1;
});
