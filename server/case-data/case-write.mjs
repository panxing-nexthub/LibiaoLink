import { createHash } from "node:crypto";
import { CaseAggregateError } from "./case-aggregate.mjs";
import { withCaseAuthoringTransaction } from "./case-authoring-transaction.mjs";

const caseErrorStatus = {
  NOT_FOUND: 404, CASE_ID_CONFLICT: 409, PROJECT_VERSION_CONFLICT: 409, VERSION_CONFLICT: 409,
  PROJECT_CODE_EXISTS: 409, PROJECT_ID_EXISTS: 409, PROJECT_SOURCE_READ_ONLY: 409, VALIDATION_FAILED: 422,
  UPLOAD_ALREADY_COMPLETED: 409, ACTIVE_RELEASE_MISMATCH: 409, RELEASE_STATE_CONFLICT: 409,
  RELEASE_ASSET_MISMATCH: 409, RELEASE_ASSET_NOT_READY: 409, MEDIA_STATE_CONFLICT: 409,
};

export function caseErrorResponse(error) {
  if (!(error instanceof CaseAggregateError) || !Object.hasOwn(caseErrorStatus, error.code)) throw error;
  return { status: caseErrorStatus[error.code], body: { code: error.code, message: error.message, details: [] } };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function hashCasePayload(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function readCaseOperation(pool, clientId, operationId) {
  return withCaseAuthoringTransaction(pool, true, async (client) => {
    const { rows: [operation] } = await client.query(`
      select operation_id as "operationId", status_code as "statusCode", response, resource_id as "resourceId",
             created_at as "createdAt", expires_at as "expiresAt"
      from "case".case_idempotency_keys where client_id = $1 and operation_id = $2
    `, [clientId, operationId]);
    return operation;
  });
}

export function writeCaseOnce(pool, { clientId, operationId, method, path, payload }, work) {
  // 传输元数据不参与哈希。数组顺序是持久化语义的一部分。
  const hash = hashCasePayload({ method, path, payload });
  return withCaseAuthoringTransaction(pool, false, async (client) => {
    const key = [clientId, operationId];
    const { rows: [{ acquired }] } = await client.query(`
      select pg_try_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text, $2::uuid)::text, 0)) as acquired
    `, key);
    if (!acquired) {
      return { status: 409, body: { code: "IDEMPOTENCY_IN_PROGRESS", message: "操作正在执行", details: [] },
        headers: { "Retry-After": 1 } };
    }

    const { rows: [stored] } = await client.query(`
      select request_hash, status_code, response, resource_id
      from "case".case_idempotency_keys where client_id = $1 and operation_id = $2
    `, key);
    if (stored) {
      if (stored.request_hash !== hash) {
        return { status: 409, body: { code: "IDEMPOTENCY_CONFLICT", message: "同一操作标识已用于不同请求", details: [] } };
      }
      return { status: stored.status_code, body: stored.response, resourceId: stored.resource_id };
    }

    await client.query("savepoint case_write");
    let result;
    try {
      result = await work(client);
    } catch (error) {
      result = caseErrorResponse(error);
      await client.query("rollback to savepoint case_write");
    }
    await client.query("release savepoint case_write");
    const resourceId = result.resourceId ?? result.body.caseId ?? null;
    await client.query(`
      insert into "case".case_idempotency_keys (client_id, operation_id, request_hash, status_code, response, resource_id)
      values ($1, $2, $3, $4, $5::jsonb, $6)
    `, [...key, hash, result.status, JSON.stringify(result.body), resourceId]);
    return { ...result, resourceId };
  });
}
