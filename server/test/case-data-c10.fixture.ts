import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { expect } from "vitest";

type Gateway = { base: string; stop: (signal?: NodeJS.Signals) => Promise<void> };
type Fixture = {
  startGateway: () => Promise<Gateway>; hosted: Client; local: Client; localUrl: string;
  projectId: string; authorToken: string; publicToken: string; mediaToken: string; authorClientId: string;
};
type Observation = { method: string; operationId: string; status?: number; traceId?: string; requestId?: string;
  requestHash?: string; body?: unknown };
type Fault = "lose-request" | "lose-response";
const workerScript = fileURLToPath(new URL("./case-data-outbox-worker.fixture.mjs", import.meta.url));
const actor = "c10-fixture-reviewer";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3CkAAAAASUVORK5CYII=", "base64");

async function relayTo(upstream: () => string) {
  const events = new EventEmitter();
  const calls: Observation[] = [];
  let fault: Fault | undefined;
  const server = createServer(async (request, response) => {
    try {
      const path = request.url!;
      const method = request.method!;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = method === "POST" ? Buffer.concat(chunks).toString("utf8") : undefined;
      const payload = data ? JSON.parse(data) : undefined;
      const observation: Observation = {
        method, operationId: payload?.operationId ?? path.split("/").at(-1), traceId: payload?.traceId,
        requestHash: data ? createHash("sha256").update(data).digest("hex") : undefined,
      };
      calls.push(observation);
      const currentFault = fault;
      if (currentFault === "lose-request") {
        fault = undefined;
        events.emit("lost", observation);
        return;
      }
      const upstreamResponse = await fetch(upstream() + path, {
        method, body: data, redirect: "error", signal: AbortSignal.timeout(6500),
        headers: { Authorization: request.headers.authorization!, ...(data ? { "Content-Type": "application/json" } : {}) },
      });
      const result = await upstreamResponse.text();
      Object.assign(observation, { status: upstreamResponse.status, requestId: upstreamResponse.headers.get("x-request-id") });
      if (currentFault === "lose-response") {
        fault = undefined;
        // Hold the downstream response so the worker can be killed before it sees any acknowledgement.
        events.emit("lost", { ...observation, body: JSON.parse(result) });
        return;
      }
      response.writeHead(upstreamResponse.status, { "Content-Type": "application/json" });
      response.end(result);
    } catch {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end('{"code":"FIXTURE_RELAY_UNAVAILABLE"}');
    }
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("C10 relay needs a TCP listener");
  return {
    base: `http://127.0.0.1:${address.port}`, calls,
    nextFault(mode: Fault) {
      fault = mode;
      return once(events, "lost", { signal: AbortSignal.timeout(7000) }).then(([seen]) => seen as Observation);
    },
    async close() {
      const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

function startWorker(localUrl: string, base: string, token: string) {
  const worker = spawn(process.execPath, [workerScript], {
    env: { CASE_FIXTURE_PARTNER_DB: localUrl, CASE_FIXTURE_GATEWAY: base, CASE_FIXTURE_SERVICE_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  worker.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  worker.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const closed = once(worker, "close", { signal: AbortSignal.timeout(12_000) });
  return {
    async result() {
      const [code] = await closed;
      expect(code, stderr).toBe(0);
      return JSON.parse(stdout) as { status: string; operationId?: string };
    },
    async crash() {
      worker.kill("SIGKILL");
      const [, signal] = await closed;
      expect(signal).toBe("SIGKILL");
    },
  };
}

export async function verifyCaseDataEndToEnd(fixture: Fixture) {
  const { hosted, local, localUrl, projectId, authorToken, publicToken, mediaToken, authorClientId } = fixture;
  let gateway = await fixture.startGateway();
  const relay = await relayTo(() => gateway.base).catch(async (error) => {
    await gateway.stop();
    throw error;
  });
  const worker = () => startWorker(localUrl, relay.base, authorToken);
  async function crashDelivery(mode: Fault) {
    const lost = relay.nextFault(mode);
    const process = worker();
    try {
      const observation = await lost;
      expect(await worker().result()).toEqual({ status: "idle" });
      return observation;
    } finally {
      await process.crash();
    }
  }
  const send = (path: string, body?: object, token = authorToken, method = body ? "POST" : "GET") => fetch(gateway.base + path, {
    method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(7000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
  });
  async function metadata() {
    const { rows: [{ operationId }] } = await local.query('select uuidv7() as "operationId"');
    return { operationId: operationId as string, traceId: `c10-${operationId}`, operatorUserKey: actor };
  }
  async function json<T>(request: Promise<Response>, status: number) {
    const response = await request;
    expect(response.status).toBe(status);
    return await response.json() as T;
  }
  try {
    expect((await fetch(gateway.base + "/readyz")).status).toBe(200);
    const projects = await json<{ items: { externalProjectId: string; sourceVersion: number }[] }>(
      send("/api/v1/projects?region=C10"), 200,
    );
    expect(projects.items).toEqual([expect.objectContaining({ externalProjectId: projectId, sourceVersion: 10 })]);
    const { externalProjectId, sourceVersion } = projects.items[0]!;
    const { caseId } = await json<{ caseId: string }>(send(`/api/v1/projects/${externalProjectId}/cases`, {
      ...await metadata(), externalProjectId, sourceVersion, locale: "zh-CN", title: "内部草稿",
      confidentiality: { schemaVersion: 1, mode: "partial", customerIdentity: "internal",
        contentVisibility: "internal", mediaPermission: "secret" },
    }), 201);
    expect(await json(send(`/api/v1/cases/${caseId}`, {
      ...await metadata(), expectedVersion: 1, title: "已更新内部草稿",
    }, authorToken, "PATCH"), 200)).toMatchObject({ rowVersion: 2 });

    const { uploadId } = await json<{ uploadId: string }>(send(`/api/v1/cases/${caseId}/uploads`, {
      ...await metadata(), fileName: "C10.png", mimeType: "image/png", sizeBytes: png.byteLength,
      sha256: createHash("sha256").update(png).digest("hex"),
    }), 201);
    const target = await json<{ url: string; headers: Record<string, string> }>(send(`/api/v1/uploads/${uploadId}/target`), 200);
    const uploaded = await fetch(target.url, { method: "PUT", headers: target.headers, body: new Uint8Array(png),
      signal: AbortSignal.timeout(5000) });
    expect(uploaded.status).toBe(200);
    const asset = await json<{ assetId: string; assetVersionId: string; objectVersionId: string; sha256: string; scanStatus: string }>(
      send(`/api/v1/uploads/${uploadId}/complete`, { ...await metadata(), objectVersionId: uploaded.headers.get("x-amz-version-id") }), 200,
    );
    expect(asset.scanStatus).toBe("pending");
    const mediaStatePath = `/api/v1/assets/${asset.assetId}/versions/${asset.assetVersionId}/media-state`;
    expect(await json(send(mediaStatePath, { ...await metadata(), expectedVersion: 1,
      objectVersionId: asset.objectVersionId, sha256: asset.sha256, result: { scanStatus: "passed" },
    }, mediaToken, "PUT"), 200)).toMatchObject({ scanStatus: "passed", mediaVersion: 2 });
    await local.query("insert into case_local.users (user_key, display_name) values ($1, 'C10 夹具审核人')", [actor]);
    await local.query("insert into case_local.case_states (case_id, updated_by) values ($1, $2)", [caseId, actor]);

    type Write = Awaited<ReturnType<typeof metadata>> & Record<string, unknown>;
    async function enqueue(eventType: string, payload: Write, decision?: () => Promise<void>) {
      await local.query("begin");
      try {
        await decision?.();
        await local.query(`
          insert into case_local.business_audit (actor_user_key, action, resource_type, resource_id, change_set, result, trace_id)
          values ($1, $2, 'case', $3, jsonb_build_object('operationId', $4::text), 'success', $5)
        `, [actor, eventType, caseId, payload.operationId, payload.traceId]);
        await local.query(`
          insert into case_local.outbox (operation_id, request_hash, aggregate_type, aggregate_id, event_type, payload)
          select $1, encode(sha256(convert_to($4::jsonb::text, 'UTF8')), 'hex'), 'case', $2, $3, $4::jsonb
        `, [payload.operationId, caseId, eventType, JSON.stringify(payload)]);
        await local.query("commit");
      } catch (error) {
        await local.query("rollback");
        throw error;
      }
    }
    async function outbox(operationId: string) {
      const { rows: [entry] } = await local.query(`
        select status, attempt_count, locked_by, last_error, result from case_local.outbox where operation_id = $1
      `, [operationId]);
      return entry;
    }
    async function businessState() {
      return (await local.query("select business_status, current_release_id, row_version from case_local.case_states where case_id = $1",
        [caseId])).rows[0];
    }
    const expireLease = (operationId: string) => local.query(
      "update case_local.outbox set locked_at = statement_timestamp() - interval '31 seconds' where operation_id = $1", [operationId],
    );
    const commonStage = { externalProjectId, sourceVersion,
      caseSnapshot: { schemaVersion: 1, locale: "zh-CN", title: "C10 对外快照" },
      assets: [{ assetId: asset.assetId, assetVersionId: asset.assetVersionId, objectVersionId: asset.objectVersionId }] };
    const stage = { ...await metadata(), ...commonStage };
    await enqueue("stage_release", stage, async () => {
      await local.query("update case_local.case_states set business_status = 'in_review' where case_id = $1", [caseId]);
    });
    expect(await worker().result()).toEqual({ status: "succeeded", operationId: stage.operationId });
    const { result: staged } = await outbox(stage.operationId);
    expect(staged).toMatchObject({ caseId, status: "staged" });
    const releaseId = staged.releaseId as string;
    const publicPath = `/api/v1/public/cases/${caseId}/releases/${releaseId}`;
    const mediaPath = `${publicPath}/assets/${asset.assetVersionId}/content`;
    const { rows: [{ shareId }] } = await local.query(`
      insert into case_local.share_links (case_id, release_id, token_hash, expires_at, created_by)
      values ($1, $2, repeat('0', 64), statement_timestamp() + interval '1 hour', $3) returning id as "shareId"
    `, [caseId, releaseId, actor]);
    const cacheKey = `${caseId}:${releaseId}`;
    const cache = new Map<string, unknown>();
    async function readShare() {
      const { rows: [{ visible }] } = await local.query(`
        select exists (
          select 1 from case_local.share_links s join case_local.case_states c on c.case_id = s.case_id
          where s.id = $1 and s.revoked_at is null and s.expires_at > statement_timestamp()
            and c.business_status = 'published' and c.current_release_id = s.release_id
        ) as visible
      `, [shareId]);
      if (!visible) return { status: 404 };
      if (!cache.has(cacheKey)) cache.set(cacheKey, await json(send(publicPath, undefined, publicToken), 200));
      return { status: 200, body: cache.get(cacheKey) };
    }
    expect((await send(publicPath, undefined, publicToken)).status).toBe(404);
    expect(await readShare()).toEqual({ status: 404 });

    const approvalRef = `c10-review:${releaseId}`;
    const activate = { ...await metadata(), approvalRef, expectedActiveReleaseId: null };
    await enqueue("activate_release", activate, async () => {
      await local.query("update case_local.case_states set business_status = 'approved' where case_id = $1", [caseId]);
      await local.query(`
        insert into case_local.review_events (
          case_id, release_id, action, decision, reviewer_user_key, approval_ref, case_content_hash, project_snapshot_hash, trace_id
        ) values ($1, $2, 'approve', 'approved', $3, $4, $5, $6, $7)
      `, [caseId, releaseId, actor, approvalRef, staged.caseContentHash, staged.projectSnapshotHash, activate.traceId]);
    });
    const blocked = await metadata();
    await expect(enqueue("deactivate_release", { ...blocked, expectedActiveReleaseId: releaseId }, async () => {
      await local.query("update case_local.case_states set business_status = 'withdrawn' where case_id = $1", [caseId]);
    })).rejects.toMatchObject({ code: "23505", constraint: "outbox_one_pending_per_aggregate_uidx" });
    expect(await businessState()).toMatchObject({ business_status: "approved", current_release_id: null });
    expect((await local.query("select 1 from case_local.business_audit where trace_id = $1", [blocked.traceId])).rowCount).toBe(0);

    const committed = await crashDelivery("lose-response");
    expect(committed).toMatchObject({ method: "POST", operationId: activate.operationId, traceId: activate.traceId,
      requestId: expect.any(String), status: 200, body: { releaseId, status: "active" } });
    expect(await outbox(activate.operationId)).toMatchObject({ status: "pending", attempt_count: 1, locked_by: expect.any(String) });
    expect(await businessState()).toMatchObject({ business_status: "approved", current_release_id: null });
    expect((await send(publicPath, undefined, publicToken)).status).toBe(200);
    expect(await readShare()).toEqual({ status: 404 });
    await gateway.stop("SIGKILL");
    gateway = await fixture.startGateway();
    await expireLease(activate.operationId);
    expect(await worker().result()).toEqual({ status: "succeeded", operationId: activate.operationId });
    expect(await outbox(activate.operationId)).toMatchObject({ status: "succeeded", attempt_count: 2, locked_by: null, result: committed.body });
    expect(relay.calls.filter((call) => call.operationId === activate.operationId).map(({ method, status }) => [method, status]))
      .toEqual([["POST", 200], ["GET", 200]]);
    expect(await businessState()).toMatchObject({ business_status: "published", current_release_id: releaseId });
    const receipts = await hosted.query(`
      select resource_id, status_code, response from "case".case_idempotency_keys where client_id = $1 and operation_id = $2
    `, [authorClientId, activate.operationId]);
    expect(receipts.rows).toEqual([{ resource_id: releaseId, status_code: 200, response: committed.body }]);
    expect((await hosted.query(`
      select id, status from "case".case_releases where case_id = $1
    `, [caseId])).rows).toEqual([{ id: releaseId, status: "active" }]);
    expect((await local.query("select 1 from case_local.review_events where approval_ref = $1", [approvalRef])).rowCount).toBe(1);
    expect((await local.query("select 1 from case_local.business_audit where trace_id = $1", [activate.traceId])).rowCount).toBe(1);

    expect(await readShare()).toMatchObject({ status: 200, body: { caseId, releaseId, caseSnapshot: { title: "C10 对外快照" } } });
    expect(cache.has(cacheKey)).toBe(true);
    const media = await send(mediaPath, undefined, publicToken);
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer())).toEqual(png);
    const withdraw = { ...await metadata(), expectedActiveReleaseId: releaseId };
    await enqueue("deactivate_release", withdraw);
    const missing = await crashDelivery("lose-request");
    expect(missing).toMatchObject({ operationId: withdraw.operationId, method: "POST" });
    expect(missing.status).toBeUndefined();
    expect(await outbox(withdraw.operationId)).toMatchObject({ status: "pending", attempt_count: 1 });
    expect((await send(publicPath, undefined, publicToken)).status).toBe(200);
    await expireLease(withdraw.operationId);
    expect(await worker().result()).toEqual({ status: "succeeded", operationId: withdraw.operationId });
    const withdrawalCalls = relay.calls.filter((call) => call.operationId === withdraw.operationId);
    expect(withdrawalCalls.map(({ method, status }) => [method, status])).toEqual([["POST", undefined], ["GET", 404], ["POST", 200]]);
    expect(withdrawalCalls[2]!.requestHash).toBe(missing.requestHash);
    const settled = await outbox(withdraw.operationId);
    expect(settled).toMatchObject({ attempt_count: 2, status: "succeeded", result: { releaseId, status: "withdrawn" } });
    expect(await businessState()).toMatchObject({ business_status: "withdrawn", current_release_id: null });
    const share = (await local.query("select revoked_at from case_local.share_links where id = $1", [shareId])).rows[0];
    expect(share.revoked_at).toBeInstanceOf(Date);
    if (settled.result.status === "withdrawn") cache.delete(cacheKey);
    expect(cache.has(cacheKey)).toBe(false);
    expect(await readShare()).toEqual({ status: 404 });
    expect((await send(publicPath, undefined, publicToken)).status).toBe(404);
    expect((await send(mediaPath, undefined, publicToken)).status).toBe(404);

    const stale = { ...await metadata(), ...commonStage, sourceVersion: sourceVersion - 1 };
    await enqueue("stage_release", stale);
    expect(await worker().result()).toEqual({ status: "failed", operationId: stale.operationId });
    expect(await outbox(stale.operationId)).toMatchObject({ status: "failed", last_error: "PROJECT_VERSION_CONFLICT", attempt_count: 1 });
    expect(await worker().result()).toEqual({ status: "idle" });
  } finally {
    await relay.close();
    await gateway.stop();
  }
}
