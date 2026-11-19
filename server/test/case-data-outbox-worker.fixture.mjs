// C10 单次投递夹具。只接入临时 case_local 库和网关 HTTP。
import { randomUUID } from "node:crypto";
import pg from "pg";

const { CASE_FIXTURE_PARTNER_DB: connectionString, CASE_FIXTURE_GATEWAY: gateway,
  CASE_FIXTURE_SERVICE_TOKEN: token } = process.env;
const workerId = randomUUID();

async function claim(db) {
  const { rows: [job] } = await db.query(`
    with candidate as (
      select id, attempt_count > 0 as recovering
      from case_local.outbox
      where status = 'pending' and next_attempt_at <= statement_timestamp()
        and (locked_at is null or locked_at <= statement_timestamp() - interval '30 seconds')
      order by created_at, id
      limit 1 for update skip locked
    )
    update case_local.outbox o
    set locked_by = $1, locked_at = statement_timestamp(), attempt_count = attempt_count + 1
    from candidate where o.id = candidate.id
    returning o.operation_id, o.aggregate_id, o.event_type, o.payload, candidate.recovering,
      o.request_hash = encode(sha256(convert_to(o.payload::text, 'UTF8')), 'hex') as payload_matches
  `, [workerId]);
  return job;
}

async function writePath(db, job) {
  const collection = `/api/v1/cases/${encodeURIComponent(job.aggregate_id)}/releases`;
  if (job.event_type === "stage_release") return collection;
  if (job.event_type === "deactivate_release") {
    return `${collection}/${encodeURIComponent(job.payload.expectedActiveReleaseId)}/deactivate`;
  }
  if (job.event_type === "activate_release") {
    const { rows: [review] } = await db.query(
      "select release_id from case_local.review_events where case_id = $1 and approval_ref = $2",
      [job.aggregate_id, job.payload.approvalRef],
    );
    if (review?.release_id) return `${collection}/${encodeURIComponent(review.release_id)}/activate`;
  }
  throw new Error("INVALID_FIXTURE_EVENT");
}

async function gatewayRequest(path, payload) {
  try {
    const response = await fetch(gateway + path, {
      method: payload ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload && JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(9000),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: 503, body: { code: "UNKNOWN_RESULT" } };
  }
}

async function deliver(db, job) {
  if (!job.payload_matches || job.payload.operationId !== job.operation_id) throw new Error("FIXTURE_PAYLOAD_CHANGED");
  if (job.recovering) {
    const found = await gatewayRequest(`/api/v1/operations/${encodeURIComponent(job.operation_id)}`);
    if (found.status === 200) {
      if (found.body.operationId !== job.operation_id) throw new Error("WRONG_GATEWAY_RECEIPT");
      return { status: found.body.statusCode, body: found.body.response };
    }
    if (found.status !== 404) return found;
  }
  return gatewayRequest(await writePath(db, job), job.payload);
}

async function settle(db, job, outcome) {
  const { status, body } = outcome;
  const retry = status >= 500 || [401, 403, 429].includes(status) ||
    ["IDEMPOTENCY_IN_PROGRESS", "RELEASE_SWITCH_IN_PROGRESS"].includes(body.code);
  const state = status >= 200 && status < 300 ? "succeeded" : retry ? "pending" : "failed";
  await db.query("begin");
  try {
    const changed = await db.query(`
      update case_local.outbox set status = $3, result = $4::jsonb, last_error = $5,
        locked_by = null, locked_at = null, updated_at = statement_timestamp(),
        next_attempt_at = statement_timestamp() + interval '1 second'
      where operation_id = $1 and locked_by = $2 and status = 'pending'
    `, [job.operation_id, workerId, state, state === "succeeded" ? JSON.stringify(body) : null,
      state === "succeeded" ? null : body.code ?? `HTTP_${status}`]);
    if (changed.rowCount !== 1) throw new Error("FIXTURE_LEASE_LOST");
    if (state === "succeeded" && job.event_type !== "stage_release") {
      const businessStatus = job.event_type === "activate_release" ? "published" : "withdrawn";
      await db.query(`
        update case_local.case_states set business_status = $2,
          current_release_id = $3, row_version = row_version + 1, updated_at = statement_timestamp()
        where case_id = $1
      `, [job.aggregate_id, businessStatus, businessStatus === "published" ? body.releaseId : null]);
      if (businessStatus === "withdrawn") {
        await db.query(`
          update case_local.share_links set revoked_at = statement_timestamp()
          where case_id = $1 and release_id = $2 and revoked_at is null
        `, [job.aggregate_id, body.releaseId]);
      }
    }
    await db.query("commit");
    return state;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

try {
  const local = new URL(connectionString);
  if (local.hostname !== "127.0.0.1" || local.pathname !== "/case_partner_fixture" ||
      new URL(gateway).hostname !== "127.0.0.1") throw new Error("NON_FIXTURE_TARGET");
  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
  try {
    await db.connect();
    const job = await claim(db);
    const status = job ? await settle(db, job, await deliver(db, job)) : "idle";
    console.log(JSON.stringify({ status, operationId: job?.operation_id }));
  } finally {
    await db.end();
  }
} catch {
  console.error("C10 outbox fixture worker failed");
  process.exitCode = 1;
}
