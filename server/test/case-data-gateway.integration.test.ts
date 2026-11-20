import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { expect, it } from "vitest";
import { verifyCaseAssetRequests } from "./case-data-assets.fixture.js";
import { verifyAssetProcessing } from "./case-data-asset-processing.fixture.js";
import { verifyCaseDataEndToEnd } from "./case-data-c10.fixture.js";
import { verifyProjectData } from "./case-data-project-data.fixture.js";
import { verifyCaseReleaseRequests } from "./case-data-releases.fixture.js";

const adminUrl = process.env.CASE_DATA_GATEWAY_TEST_ADMIN_URL;
const gatewayUrl = process.env.CASE_DATA_GATEWAY_TEST_DATABASE_URL;
const cleanupUrl = process.env.CASE_DATA_OPERATION_CLEANUP_TEST_DATABASE_URL;
const publicUrl = process.env.CASE_DATA_PUBLIC_TEST_DATABASE_URL;
const partnerUrl = process.env.CASE_DATA_PARTNER_TEST_DATABASE_URL;
const partnerWorkerUrl = process.env.CASE_DATA_PARTNER_OUTBOX_TEST_DATABASE_URL;
const gatewayScript = fileURLToPath(new URL("../case-data/gateway.mjs", import.meta.url));
const cleanupScript = fileURLToPath(new URL("../case-data/operation-cleanup.mjs", import.meta.url));
const recoveryScript = fileURLToPath(new URL("../case-data/recovery-check.mjs", import.meta.url));
const issuer = "https://case-gateway.example.test/issuer";
const audience = "case-data-gateway";
const readScope = "case-data:projects:read";
const fixtureProjectId = "0190d2e4-4b9a-7c10-9f31-2b8a6d4e7f01";
const s3Endpoint = process.env.CASE_DATA_ASSETS_TEST_ENDPOINT;
const s3Bucket = process.env.CASE_DATA_ASSETS_TEST_BUCKET;
const s3Access = process.env.CASE_DATA_ASSETS_TEST_ACCESS_KEY;
const s3Secret = process.env.CASE_DATA_ASSETS_TEST_SECRET_KEY;
const s3AdminAccess = process.env.CASE_DATA_ASSETS_TEST_ADMIN_ACCESS_KEY;
const s3AdminSecret = process.env.CASE_DATA_ASSETS_TEST_ADMIN_SECRET_KEY;

function checkRecovery(dir: string) {
  return spawnSync(process.execPath, [recoveryScript], {
    env: { ...process.env, CASE_GATEWAY_SECRET_DIR: dir, CASE_GATEWAY_ASSET_BUCKET: s3Bucket, CASE_GATEWAY_S3_ENDPOINT: s3Endpoint },
    encoding: "utf8", timeout: 10_000,
  });
}

function serviceToken(key: KeyObject, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const parts = [encode({ alg: "RS256", typ: "at+jwt", kid: "fixture", ...header }), encode({
    iss: issuer, aud: audience, sub: "case-author", client_id: "case-author", scope: readScope,
    iat: now - 1, exp: now + 120, jti: randomUUID(), ...claims,
  })].join(".");
  return `${parts}.${sign("RSA-SHA256", Buffer.from(parts), key).toString("base64url")}`;
}

async function writeGatewayCredentials(dir: string, dbUrl: string, publicKey: KeyObject) {
  await Promise.all([
    writeFile(join(dir, "case_gateway_authoring_rw_database_url"), dbUrl, { mode: 0o600 }),
    writeFile(join(dir, "case_gateway_cursor_key"), randomBytes(32).toString("hex"), { mode: 0o600 }),
    writeFile(join(dir, "case_gateway_public_jwks"), JSON.stringify({
      keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" }],
    }), { mode: 0o600 }),
  ]);
}

async function startGateway(dir: string, settings: NodeJS.ProcessEnv = {}) {
  const gateway = spawn(process.execPath, [gatewayScript], {
    env: { ...process.env, CASE_GATEWAY_SECRET_DIR: dir, CASE_GATEWAY_TOKEN_ISSUER: issuer,
      CASE_GATEWAY_TOKEN_AUDIENCE: audience, CASE_GATEWAY_PORT: "0", CASE_GATEWAY_PROJECTS_PER_MINUTE: "25", ...settings },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(gateway, "exit");
  let stderr = "";
  gateway.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: gateway.stdout });
  async function stop(signal: NodeJS.Signals = "SIGTERM") {
    lines.close();
    if (gateway.exitCode === null && gateway.signalCode === null) gateway.kill(signal);
    await exit;
  }
  try {
    const first = await lines[Symbol.asyncIterator]().next();
    if (first.done || typeof first.value !== "string") throw new Error(`Gateway exited before listening: ${stderr}`);
    const { port } = JSON.parse(first.value);
    return { base: `http://127.0.0.1:${port}`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function dropWriteResponse(base: string, path: string, headers: Record<string, string>, body: string) {
  type WriteResult = { status: number; body: { caseId: string; rowVersion: number } };
  const upstream: { result?: WriteResult; error?: unknown } = {};
  const proxy = createServer(async (request, downstream) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await fetch(base + path, {
        method: "POST", headers, body: Buffer.concat(chunks), signal: AbortSignal.timeout(4000),
      });
      upstream.result = { status: result.status, body: await result.json() as WriteResult["body"] };
    } catch (error) {
      upstream.error = error;
    } finally {
      downstream.destroy();
    }
  });
  const listening = once(proxy, "listening");
  proxy.listen(0, "127.0.0.1");
  await listening;
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Drop-response proxy needs a TCP listener");
  try {
    await expect(fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", headers, body, signal: AbortSignal.timeout(4000),
    })).rejects.toMatchObject({ cause: { code: "UND_ERR_SOCKET" } });
    if (!upstream.result) throw new Error("The upstream write did not return a result", { cause: upstream.error });
    return upstream.result;
  } finally {
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }
}

async function verifyCaseRequests(db: Client, base: string, token: (claims?: Record<string, unknown>) => string) {
  const projectId = fixtureProjectId;
  const collection = `/api/v1/projects/${projectId}/cases`;
  const clientId = "case-http-author";
  const authorized = token({ sub: clientId, client_id: clientId, scope: "case-data:cases:read case-data:cases:write" });
  const request = (path: string, method: string, body?: object, bearer = authorized) => fetch(`${base}${path}`, {
    method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000),
  });
  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, traceId: response.headers.get("x-request-id") });
  }
  const operation = (id: number) => `0190d2e4-a002-7b66-9d88-${String(id).padStart(12, "0")}`;
  await db.query(`
    insert into project_read.project_summary
      (project_id, project_code, project_name, region, project_type, manager_ids, manager_names,
       status, source_version, source_updated_at, synced_at)
    values ($1, 'P-AIRROB', '某零售仓', '华东', '分拣', array[$2::uuid], array[null::text], 'active', 42, now(), now())
  `, [projectId, randomUUID()]);
  await db.query(`insert into "case".project_profiles (project_id, source_version, attributes)
    values ($1, 42, '{"solutionTypes":["airrob"]}')`, [projectId]);

  const create = {
    operationId: "0190d2e4-a001-7b55-8c77-0d1e2f3a4b5c", externalProjectId: projectId, sourceVersion: 42,
    operatorUserKey: "usr_case_001", traceId: "trace-case-20261119-0001", locale: "zh-CN",
    title: "某零售仓 AirRob 拣选升级", summary: "在不扩建仓库的前提下提升拣选吞吐。", changeSummary: "首次创建",
    confidentiality: { schemaVersion: 1, mode: "partial", customerIdentity: "internal",
      contentVisibility: "internal", mediaPermission: "secret", internalScope: null },
  };
  await expectError(await request(collection, "POST", create, ""), 401, "AUTH_REQUIRED");
  await expectError(await request(collection, "POST", create, token({ scope: "case-data:cases:read" })), 403, "FORBIDDEN");
  await expectError(await request(collection, "POST", { ...create, confidentiality: undefined }), 422, "VALIDATION_FAILED");
  await expectError(await request(collection, "POST", { ...create, operationId: operation(1), sourceVersion: 41 }), 409, "PROJECT_VERSION_CONFLICT");
  await expectError(await request(collection, "POST", { ...create, externalProjectId: randomUUID() }), 422, "VALIDATION_FAILED");

  // A concurrent caller using this key is told to retry while the transaction is in flight.
  await db.query("begin");
  try {
    await db.query("select pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text,$2::uuid)::text,0))",
      [clientId, create.operationId]);
    const busy = await request(collection, "POST", create);
    expect(busy.headers.get("retry-after")).toBe("1");
    await expectError(busy, 409, "IDEMPOTENCY_IN_PROGRESS");
  } finally {
    await db.query("rollback");
  }
  const response = await request(collection, "POST", create);
  expect(response.status).toBe(201);
  const created = await response.json() as { caseId: string; updatedAt: string };
  expect(created.caseId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(created).toMatchObject({
    sourceProjectId: projectId, locale: "zh-CN", createdBy: "usr_case_001", rowVersion: 1,
    content: { schemaVersion: 1, fields: [] }, solutionParameters: { schemaVersion: 1, groups: [] },
    outcomes: { schemaVersion: 1, metrics: [] }, confidentiality: create.confidentiality,
  });
  const item = `/api/v1/cases/${created.caseId}`;
  await expectError(await request(item, "GET", undefined, token({ scope: "case-data:cases:write" })), 403, "FORBIDDEN");
  const read = await request(item, "GET");
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(created);
  await expectError(await request(collection, "POST", { ...create, title: "其他标题" }), 409, "IDEMPOTENCY_CONFLICT");

  const pain = { key: "pain_points", fieldType: "text", valueText: "人工拣选效率低，峰值订单无法及时履约。",
    customerShareAllowed: true, customerPresentationAllowed: true, aiAllowed: false, sortOrder: 0 };
  const highlights = { key: "highlights", fieldType: "highlights", highlights: ["不停仓改造", "峰值吞吐提升 40%"],
    classification: "L1", customerShareAllowed: true, customerPresentationAllowed: true, aiAllowed: false, sortOrder: 1 };
  const description = { ...pain, key: "solution_description_zh", sortOrder: 2, classification: "L1",
    valueText: "采用 AirRob 货到人方案，分阶段替换人工拣选。" };
  const patch = {
    operationId: "0190d2e4-a002-7b66-9d88-1e2f3a4b5c6d", expectedVersion: 1, operatorUserKey: "usr_case_002",
    traceId: "trace-case-20261119-0002", changeSummary: "补充痛点、方案参数和成果指标",
    content: { schemaVersion: 1, fields: [pain, highlights, description] },
    solutionParameters: { schemaVersion: 1, groups: [
      { solutionType: "airrob", parameters: { sets: "12", flyboxes: "240", capacity: "1200", capacity_unit: "箱/小时" } },
    ] },
    outcomes: { schemaVersion: 1, metrics: [{ label: "提升人效", value: "40", unit: "%" },
      { label: "吞吐量", value: 1200, unit: "箱/小时" }] },
  };
  const privatePolicy = { ...create.confidentiality, mode: "private", contentVisibility: "secret" };
  const patchInput = { operationId: operation(2), expectedVersion: 1, operatorUserKey: patch.operatorUserKey };
  for (const fields of [
    [pain, pain], [{ ...pain, key: "unknown" }], [{ ...pain, classification: null }],
    [{ ...pain, aiAllowed: true }], [{ ...pain, fieldType: "metrics" }], [{ ...pain, valueText: "<p>富文本</p>" }],
  ]) {
    await expectError(await request(item, "PATCH", { ...patchInput, content: { schemaVersion: 1, fields } }),
      422, "VALIDATION_FAILED");
  }
  await expectError(await request(item, "PATCH", { ...patchInput, locale: "en" }), 422, "VALIDATION_FAILED");
  await expectError(await request(item, "PATCH", { ...patchInput, confidentiality: { ...privatePolicy, internalScope: "  " } }),
    422, "VALIDATION_FAILED");
  await expectError(await request(item, "PATCH", { ...patchInput, confidentiality: { ...privatePolicy, internalScope: ["sales"] } }),
    422, "VALIDATION_FAILED");
  await expectError(await request(item, "PATCH", { ...patchInput, solutionParameters: { schemaVersion: 1, groups: [
    { solutionType: "airrob", parameters: { invalid: true } },
  ] } }), 422, "VALIDATION_FAILED");
  await expectError(await request(item, "PATCH", { ...patchInput, solutionParameters: { schemaVersion: 1, groups: [
    { solutionType: "t_sort", parameters: { platforms: 2 } },
  ] } }), 422, "VALIDATION_FAILED");

  const update = await request(item, "PATCH", patch);
  expect(update.status).toBe(200);
  const updated = await update.json() as { updatedAt: string };
  expect(updated).toMatchObject({
    rowVersion: 2, createdBy: "usr_case_001", content: { fields: [{ ...pain, classification: "L1" }, highlights, description] },
    confidentiality: create.confidentiality, solutionParameters: patch.solutionParameters, outcomes: patch.outcomes,
  });
  expect(updated.updatedAt).not.toBe(created.updatedAt);
  expect(await (await request(item, "PATCH", patch)).json()).toEqual(updated);
  await expectError(await request(item, "PATCH", { ...patch, operationId: operation(3) }), 409, "VERSION_CONFLICT");
  expect(await (await request(item, "PATCH", { ...patch, operationId: operation(4), expectedVersion: 2 })).json()).toEqual(updated);
  const restricted = await request(item, "PATCH", {
    ...patchInput, operationId: operation(5), expectedVersion: 2,
    confidentiality: { ...privatePolicy, internalScope: "  案例组；销售负责人；法务  " },
  });
  expect(restricted.status).toBe(200);
  expect(await restricted.json()).toMatchObject({ rowVersion: 3,
    confidentiality: { ...privatePolicy, internalScope: "案例组；销售负责人；法务" } });
  const replay = await request(collection, "POST", { ...create, traceId: "create-replay" });
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(created);
  expect((await db.query(`select count(*)::int as count from "case".cases`)).rows[0].count).toBe(1);
}

it.skipIf(!adminUrl || !gatewayUrl)("authenticates and scopes project catalog and case requests in the isolated gateway", async () => {
  for (const connection of [adminUrl!, gatewayUrl!]) {
    const url = new URL(connection);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/libiaolink_case");
  }
  const db = new Client({ connectionString: adminUrl });
  await db.connect();
  const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-gateway-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = (claims?: Record<string, unknown>, header?: Record<string, unknown>, key = privateKey) =>
    serviceToken(key, claims, header);

  try {
    expect((await db.query("select count(*)::int as count from project_read.project_summary")).rows[0].count).toBe(0);
    const manager = randomUUID();
    await db.query(`
      insert into project_read.project_summary
        (project_id, project_code, project_name, region, project_type, manager_ids, manager_names,
         status, source_version, source_updated_at, archived_at, deleted_at, source_missing_at, synced_at)
      select ('10000000-0000-4000-8000-00000000000' || seq)::uuid, 'P-' || seq, '目录项目 ' || seq,
             '华东', '分拣', array[$1::uuid], array[null::text],
             case when seq = 2 then 'archived' else 'active' end, seq, now(),
             case when seq = 2 then now() end, case when seq = 3 then now() end,
             case when seq = 4 then now() end, now()
      from generate_series(1, 4) as seq
    `, [manager]);
    await writeGatewayCredentials(dir, gatewayUrl!, publicKey);
    const gateway = await startGateway(dir);
    try {
      const { base } = gateway;
      const request = (query = "", bearer?: string) => fetch(`${base}/api/v1/projects${query}`, {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
        signal: AbortSignal.timeout(4000),
      });

      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/readyz`)).status).toBe(200);
      const unauthenticated = await request();
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("www-authenticate")).toContain("Bearer");
      expect(await unauthenticated.json()).toMatchObject({
        code: "AUTH_REQUIRED", traceId: unauthenticated.headers.get("x-request-id"),
      });
      for (const invalid of [token({ aud: "other-service" }), token({ iss: "https://other.example.test" }),
        token({ exp: 1 }), token({ nbf: Math.floor(Date.now() / 1000) + 300 }), token({}, { alg: "HS256" }),
        token({}, { typ: "JWT" }), token({}, { kid: "unknown" }), token({}, {}, otherKey), token({ sub: "human" })]) {
        expect((await request("", invalid)).status).toBe(401);
      }
      const publicService = token({ client_id: "case-public", sub: "case-public", scope: "case-data:releases:read" });
      const forbidden = await request("", publicService);
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toMatchObject({ code: "FORBIDDEN" });
      expect((await request("", token({ scope: `${readScope}:other` }))).status).toBe(403);

      const authorized = token();
      const firstPage = await request("?limit=1", authorized);
      expect(firstPage.status).toBe(200);
      const page = await firstPage.json() as { items: unknown[]; nextCursor: string };
      expect(page.items).toEqual([{
        externalProjectId: "10000000-0000-4000-8000-000000000001", projectCode: "P-1", projectName: "目录项目 1",
        customerText: null, region: "华东", projectType: "分拣", managerIds: [manager], managerNames: [null],
        status: "active", sourceVersion: 1, updatedAt: expect.any(String), archivedAt: null, deletedAt: null,
        syncedAt: expect.any(String),
      }]);
      expect(page.nextCursor).toEqual(expect.any(String));
      const cursor = encodeURIComponent(page.nextCursor);
      const second = await (await request(`?limit=1&cursor=${cursor}`, authorized)).json();
      expect(second).toMatchObject({ items: [{ projectCode: "P-2", status: "archived" }], nextCursor: null });
      const archived = await (await request(`?status=archived&region=${encodeURIComponent("华东")}`, authorized)).json();
      expect(archived).toMatchObject({ items: [{ projectCode: "P-2", status: "archived" }], nextCursor: null });
      expect(await (await request("?status=paused", authorized)).json()).toEqual({ items: [], nextCursor: null });
      for (const query of [`?cursor=${cursor}&status=archived`, `?cursor=${cursor}A`, "?limit=0", "?limit=1&limit=2", "?unknown=1", "?region=%00"]) {
        const invalid = await request(query, authorized);
        expect(invalid.status).toBe(422);
        expect(await invalid.json()).toMatchObject({ code: "VALIDATION_FAILED" });
      }

      await db.query("revoke select on project_read.project_summary from case_gateway_authoring_rw");
      try {
        expect((await fetch(`${base}/readyz`)).status).toBe(503);
        const unavailable = await request("", authorized);
        expect(unavailable.status).toBe(503);
        expect(await unavailable.json()).toMatchObject({ code: "PROJECT_CATALOG_UNAVAILABLE" });
      } finally {
        await db.query("grant select on project_read.project_summary to case_gateway_authoring_rw");
      }

      let limited: Response | undefined;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await request("", authorized);
        if (response.status === 429) { limited = response; break; }
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
      expect(limited?.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(await limited?.json()).toMatchObject({ code: "RATE_LIMITED" });
      expect((await request("", token({ sub: "another-author", client_id: "another-author" }))).status).toBe(200);
      await verifyCaseRequests(db, base, token);
      const operationId = "0190d2e4-a003-7000-8000-000000000001";
      const owner = "outbox-fixture";
      const collection = `/api/v1/projects/${fixtureProjectId}/cases`;
      const writeHeaders = { Authorization: `Bearer ${token({
        sub: owner, client_id: owner, scope: "case-data:cases:write",
      })}`, "Content-Type": "application/json" };
      const input = {
        operationId, externalProjectId: fixtureProjectId, sourceVersion: 42, operatorUserKey: "outbox_author",
        locale: "zh-CN", title: "写入成功但客户端未收到响应",
        confidentiality: { schemaVersion: 1, mode: "partial", customerIdentity: "internal",
          contentVisibility: "internal", mediaPermission: "secret" },
      };
      const body = JSON.stringify(input);
      const committed = await dropWriteResponse(base, collection, writeHeaders, body);
      expect(committed.status).toBe(201);
      expect(committed.body.rowVersion).toBe(1);
      await gateway.stop("SIGKILL");

      const restarted = await startGateway(dir);
      try {
        const lookup = (id: string, clientId = owner, scope = "case-data:operations:read") =>
          fetch(`${restarted.base}/api/v1/operations/${id}`, {
            headers: { Authorization: `Bearer ${token({ sub: clientId, client_id: clientId, scope })}` },
            signal: AbortSignal.timeout(4000),
          });
        const found = await lookup(operationId);
        expect(found.status).toBe(200);
        expect(await found.json()).toMatchObject({ operationId, statusCode: 201,
          response: committed.body, resourceId: committed.body.caseId });
        expect((await lookup(operationId, "another-outbox")).status).toBe(404);
        expect((await lookup(operationId, owner, "case-data:releases:read")).status).toBe(403);
        expect((await lookup("invalid-operation-id")).status).toBe(422);
        const failedWrite = await lookup("0190d2e4-a002-7b66-9d88-000000000003", "case-http-author");
        expect(failedWrite.status).toBe(200);
        expect(await failedWrite.json()).toMatchObject({
          statusCode: 409, resourceId: null, response: { code: "VERSION_CONFLICT" },
        });
        const replay = await fetch(restarted.base + collection, {
          method: "POST", headers: writeHeaders, body, signal: AbortSignal.timeout(4000),
        });
        expect(replay.status).toBe(201);
        expect(await replay.json()).toEqual(committed.body);
        const count = await db.query(`select count(*)::int as count, min(row_version) as version
          from "case".cases where created_by = 'outbox_author'`);
        expect(count.rows).toEqual([{ count: 1, version: 1 }]);

        const retryId = "0190d2e4-a003-7000-8000-000000000002";
        const retry = () => fetch(restarted.base + collection, {
          method: "POST", headers: writeHeaders, signal: AbortSignal.timeout(4000),
          body: JSON.stringify({ ...input, operationId: retryId, operatorUserKey: "outbox_retry_author" }),
        });
        await db.query('revoke insert on "case".case_idempotency_keys from case_gateway_authoring_rw');
        try {
          expect((await retry()).status).toBe(500);
          expect((await lookup(retryId)).status).toBe(404);
          expect((await db.query(`select 1 from "case".cases where created_by = 'outbox_retry_author'`)).rowCount).toBe(0);
        } finally {
          await db.query('grant insert on "case".case_idempotency_keys to case_gateway_authoring_rw');
        }
        expect((await retry()).status).toBe(201);
        expect((await lookup(retryId)).status).toBe(200);
        expect((await db.query(`select 1 from "case".cases where created_by = 'outbox_retry_author'`)).rowCount).toBe(1);
      } finally {
        await restarted.stop();
      }
    } finally {
      await gateway.stop();
    }
  } finally {
    await db.end();
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);

it.skipIf(!adminUrl || !gatewayUrl)("registers local projects in the case catalog without copying them into the core projection", async () => {
  for (const connection of [adminUrl!, gatewayUrl!]) {
    const url = new URL(connection);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/libiaolink_case");
  }
  const db = new Client({ connectionString: adminUrl });
  await db.connect();
  const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-local-project-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = (claims: Record<string, unknown>) => serviceToken(privateKey, claims);
  const localProjectId = "10000000-0000-4000-8000-00000000a001";
  const coreProjectId = "10000000-0000-4000-8000-00000000a000";
  const hiddenCoreId = "10000000-0000-4000-8000-00000000a006";
  const hiddenLocalId = "10000000-0000-4000-8000-00000000a007";
  const manager = randomUUID();

  try {
    await writeGatewayCredentials(dir, gatewayUrl!, publicKey);
    const gateway = await startGateway(dir);
    try {
      const { base } = gateway;
      const writeScopes = "case-data:projects:write case-data:projects:read case-data:cases:write";
      const author = token({ sub: "local-project-author", client_id: "local-project-author", scope: writeScopes });
      const reader = token({ sub: "local-project-reader", client_id: "local-project-reader", scope: readScope });
      const jsonHeaders = { Authorization: `Bearer ${author}`, "Content-Type": "application/json" };
      const input = {
        operationId: "0190d2e4-a020-7000-8000-000000000001",
        externalProjectId: localProjectId,
        operatorUserKey: "local_project_author",
        projectCode: "LOCAL-PROJECT-001",
        projectName: "本地案例项目",
        customerText: "本地客户",
        region: "华南",
        projectType: "分拣",
        managerIds: [],
        managerNames: [],
        status: "active",
      };
      const register = (body: Record<string, unknown> = input, bearer = author) => fetch(`${base}/api/v1/projects`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      });

      const forbidden = await register(input, reader);
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toMatchObject({ code: "FORBIDDEN" });

      const createdResponse = await register();
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as Record<string, unknown>;
      expect(created).toMatchObject({
        externalProjectId: localProjectId, projectCode: "LOCAL-PROJECT-001", projectName: "本地案例项目",
        customerText: "本地客户", region: "华南", projectType: "分拣", managerIds: [], managerNames: [],
        status: "active", sourceVersion: 1, archivedAt: null, deletedAt: null,
      });
      expect(created.updatedAt).toEqual(expect.any(String));
      expect(created.syncedAt).toEqual(expect.any(String));

      const replay = await register();
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(created);

      await db.query(`
        insert into project_read.project_summary
          (project_id, project_code, project_name, customer_text, region, project_type, manager_ids, manager_names,
           status, source_version, source_updated_at, archived_at, deleted_at, source_missing_at, synced_at)
        values ($1, 'CORE-PROJECT-001', '核心目录项目', null, '华东', '分拣', array[$2::uuid], array[null::text],
                'active', 7, now(), null, null, null, now())
      `, [coreProjectId, manager]);

      await db.query(`
        insert into project_read.project_summary
          (project_id, project_code, project_name, customer_text, region, project_type, manager_ids, manager_names,
           status, source_version, source_updated_at, archived_at, deleted_at, source_missing_at, synced_at)
        values ($1, 'HIDDEN-PROJECT-001', '源缺失项目', null, '华东', '分拣',
                array[$2::uuid], array[null::text], 'active', 1, now(), null, null, now(), now())
      `, [hiddenCoreId, manager]);

      const hiddenLocal = await register({
        ...input, operationId: "0190d2e4-a020-7000-8000-000000000010",
        externalProjectId: hiddenLocalId, projectCode: "HIDDEN-PROJECT-001", projectName: "可复用隐藏编号的本地项目",
      });
      expect(hiddenLocal.status).toBe(201);
      expect(await hiddenLocal.json()).toMatchObject({
        externalProjectId: hiddenLocalId, projectCode: "HIDDEN-PROJECT-001", status: "active",
      });
      const hiddenClaims = await db.query(
        "select source_kind, is_available from project_read.project_code_claim where project_code = $1 order by source_kind",
        ["HIDDEN-PROJECT-001"],
      );
      expect(hiddenClaims.rows).toEqual([
        { source_kind: "core", is_available: false },
        { source_kind: "local", is_available: true },
      ]);
      await expect(db.query(
        "update project_read.project_summary set source_missing_at = null, synced_at = now() where project_id = $1",
        [hiddenCoreId],
      )).rejects.toMatchObject({ code: "23505", constraint: "ux_project_code_claim_code" });

      await expect(db.query(`
        insert into project_read.project_summary
          (project_id, project_code, project_name, customer_text, region, project_type, manager_ids, manager_names,
           status, source_version, source_updated_at, archived_at, deleted_at, source_missing_at, synced_at)
        values ($1, 'LOCAL-PROJECT-001', '冲突核心项目', null, '华东', '分拣', array[$2::uuid], array[null::text],
                'active', 1, now(), null, null, null, now())
      `, ["10000000-0000-4000-8000-00000000a004", manager])).rejects.toMatchObject({
        code: "23505", constraint: "ux_project_code_claim_code",
      });

      await expect(db.query(`
        insert into project_read.project_summary
          (project_id, project_code, project_name, customer_text, region, project_type, manager_ids, manager_names,
           status, source_version, source_updated_at, archived_at, deleted_at, source_missing_at, synced_at)
        values ($1, 'CORE-PROJECT-002', '冲突核心项目', null, '华东', '分拣', array[$2::uuid], array[null::text],
                'active', 1, now(), null, null, null, now())
      `, [localProjectId, manager])).rejects.toMatchObject({
        code: "23505", constraint: "pk_project_code_claim",
      });

      const listedResponse = await fetch(`${base}/api/v1/projects?limit=200`, {
        headers: { Authorization: `Bearer ${reader}` }, signal: AbortSignal.timeout(4000),
      });
      expect(listedResponse.status).toBe(200);
      const listed = await listedResponse.json() as { items: Array<Record<string, unknown>> };
      expect(listed.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ externalProjectId: localProjectId, projectCode: "LOCAL-PROJECT-001" }),
        expect.objectContaining({ externalProjectId: coreProjectId, projectCode: "CORE-PROJECT-001" }),
      ]));

      const duplicateLocal = await register({
        ...input, operationId: "0190d2e4-a020-7000-8000-000000000002",
        externalProjectId: "10000000-0000-4000-8000-00000000a002",
      });
      expect(duplicateLocal.status).toBe(409);
      expect(await duplicateLocal.json()).toMatchObject({ code: "PROJECT_CODE_EXISTS" });

      const duplicateCore = await register({
        ...input, operationId: "0190d2e4-a020-7000-8000-000000000003",
        externalProjectId: "10000000-0000-4000-8000-00000000a003", projectCode: "CORE-PROJECT-001",
      });
      expect(duplicateCore.status).toBe(409);
      expect(await duplicateCore.json()).toMatchObject({ code: "PROJECT_CODE_EXISTS" });

      const duplicateCoreId = await register({
        ...input, operationId: "0190d2e4-a020-7000-8000-000000000005",
        externalProjectId: coreProjectId, projectCode: "LOCAL-PROJECT-002",
      });
      expect(duplicateCoreId.status).toBe(409);
      expect(await duplicateCoreId.json()).toMatchObject({ code: "PROJECT_ID_EXISTS" });

      const caseResponse = await fetch(`${base}/api/v1/projects/${localProjectId}/cases`, {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({
          operationId: "0190d2e4-a020-7000-8000-000000000004", externalProjectId: localProjectId,
          sourceVersion: 1, operatorUserKey: "local_project_author", locale: "zh-CN", title: "本地项目案例",
          confidentiality: { schemaVersion: 1, mode: "partial", customerIdentity: "internal",
            contentVisibility: "internal", mediaPermission: "secret" },
        }),
        signal: AbortSignal.timeout(4000),
      });
      expect(caseResponse.status).toBe(201);
      expect(await caseResponse.json()).toMatchObject({ sourceProjectId: localProjectId, title: "本地项目案例" });

      const localCount = await db.query("select count(*)::int as count from project_read.local_projects where project_id = $1", [localProjectId]);
      expect(localCount.rows).toEqual([{ count: 1 }]);
      const projected = await db.query("select count(*)::int as count from project_read.project_summary where project_id = $1", [localProjectId]);
      expect(projected.rows).toEqual([{ count: 0 }]);
      const claim = await db.query(`select source_kind from project_read.project_code_claim where project_code = 'LOCAL-PROJECT-001'`);
      expect(claim.rows).toEqual([{ source_kind: "local" }]);

      const patch = (projectId: string, body: Record<string, unknown>, bearer = author) => fetch(`${base}/api/v1/projects/${projectId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      });
      const writeContext = (operationId: string, expectedVersion: number, fields: Record<string, unknown>) => ({
        operationId, operatorUserKey: "local_project_author", expectedVersion, ...fields,
      });

      const forbiddenPatch = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-000000000006", 1, { projectName: "无权更新" },
      ), reader);
      expect(forbiddenPatch.status).toBe(403);
      expect(await forbiddenPatch.json()).toMatchObject({ code: "FORBIDDEN" });

      const missingPatch = await patch("10000000-0000-4000-8000-00000000a099", writeContext(
        "0190d2e4-a020-7000-8000-000000000007", 1, { projectName: "不存在" },
      ));
      expect(missingPatch.status).toBe(404);
      expect(await missingPatch.json()).toMatchObject({ code: "NOT_FOUND" });

      const corePatch = await patch(coreProjectId, writeContext(
        "0190d2e4-a020-7000-8000-000000000008", 7, { projectName: "试图改名核心项目" },
      ));
      expect(corePatch.status).toBe(409);
      expect(await corePatch.json()).toMatchObject({ code: "PROJECT_SOURCE_READ_ONLY" });

      const stalePatch = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-000000000009", 9, { projectName: "旧版本更新" },
      ));
      expect(stalePatch.status).toBe(409);
      expect(await stalePatch.json()).toMatchObject({ code: "PROJECT_VERSION_CONFLICT" });

      const emptyPatch = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-00000000000a", 1, {},
      ));
      expect(emptyPatch.status).toBe(422);
      expect(await emptyPatch.json()).toMatchObject({ code: "VALIDATION_FAILED" });

      const managerPairPatch = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-00000000000b", 1, { managerIds: [manager] },
      ));
      expect(managerPairPatch.status).toBe(422);
      expect(await managerPairPatch.json()).toMatchObject({ code: "VALIDATION_FAILED" });

      const archiveBody = writeContext("0190d2e4-a020-7000-8000-00000000000c", 1, {
        projectName: "本地案例项目（归档）", customerText: null, region: "华中", projectType: "搬运",
        managerIds: [manager], managerNames: ["项目经理"], status: "archived",
      });
      const archivedResponse = await patch(localProjectId, archiveBody);
      expect(archivedResponse.status).toBe(200);
      const archived = await archivedResponse.json() as Record<string, unknown>;
      expect(archived).toMatchObject({
        externalProjectId: localProjectId, projectCode: "LOCAL-PROJECT-001", projectName: "本地案例项目（归档）",
        customerText: null, region: "华中", projectType: "搬运", managerIds: [manager], managerNames: ["项目经理"],
        status: "archived", sourceVersion: 2, archivedAt: expect.any(String), deletedAt: null,
      });

      const archiveReplay = await patch(localProjectId, archiveBody);
      expect(archiveReplay.status).toBe(200);
      expect(await archiveReplay.json()).toEqual(archived);

      const idempotencyConflict = await patch(localProjectId, {
        ...archiveBody, projectName: "同一操作标识的另一请求",
      });
      expect(idempotencyConflict.status).toBe(409);
      expect(await idempotencyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      const unarchiveResponse = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-00000000000d", 2, { status: "active" },
      ));
      expect(unarchiveResponse.status).toBe(200);
      expect(await unarchiveResponse.json()).toMatchObject({ status: "active", sourceVersion: 3, archivedAt: null });

      const codeConflict = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-00000000000e", 3, { projectCode: "CORE-PROJECT-001" },
      ));
      expect(codeConflict.status).toBe(409);
      expect(await codeConflict.json()).toMatchObject({ code: "PROJECT_CODE_EXISTS" });

      const renamedCode = await patch(localProjectId, writeContext(
        "0190d2e4-a020-7000-8000-00000000000f", 3, { projectCode: "LOCAL-PROJECT-001-UPDATED" },
      ));
      expect(renamedCode.status).toBe(200);
      expect(await renamedCode.json()).toMatchObject({
        projectCode: "LOCAL-PROJECT-001-UPDATED", status: "active", sourceVersion: 4,
      });
      const updatedClaim = await db.query(
        "select source_kind from project_read.project_code_claim where project_code = $1", ["LOCAL-PROJECT-001-UPDATED"],
      );
      expect(updatedClaim.rows).toEqual([{ source_kind: "local" }]);
      const oldClaim = await db.query(
        "select count(*)::int as count from project_read.project_code_claim where project_code = $1", ["LOCAL-PROJECT-001"],
      );
      expect(oldClaim.rows).toEqual([{ count: 0 }]);
    } finally {
      await gateway.stop();
    }
  } finally {
    await db.end();
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);

it.skipIf(!adminUrl || !cleanupUrl)("cleans only expired operations confirmed settled by the owning outbox", async () => {
  for (const connection of [adminUrl!, cleanupUrl!]) {
    const url = new URL(connection);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/libiaolink_case");
  }
  const db = new Client({ connectionString: adminUrl });
  const worker = new Client({ connectionString: cleanupUrl });
  const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-operation-cleanup-"));
  const manifest = join(dir, "settled.json");
  const owner = "fixture-cleanup-owner";
  const other = "fixture-cleanup-other";
  const settled = "0190d2e4-a004-7000-8000-000000000001";
  const unresolved = "0190d2e4-a004-7000-8000-000000000002";
  const unexpired = "0190d2e4-a004-7000-8000-000000000003";
  async function clean(operationIds: string[], deleted: number) {
    await writeFile(manifest, JSON.stringify({ clientId: owner, operationIds }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [cleanupScript, manifest], {
      env: { ...process.env, CASE_OPERATION_CLEANUP_SECRET_DIR: dir }, encoding: "utf8", timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ confirmed: operationIds.length, deleted });
  }
  try {
    await db.connect();
    await worker.connect();
    await writeFile(join(dir, "case_operation_cleanup_database_url"), cleanupUrl!, { mode: 0o600 });
    await db.query(`
      insert into "case".case_idempotency_keys (client_id, operation_id, request_hash, status_code, response, created_at, expires_at)
      select client_id, operation_id, repeat('a', 64), 200, '{}'::jsonb,
             now() - make_interval(days => days_old), now() + make_interval(days => 30 - days_old)
      from (values ($1::text, $3::uuid, 31), ($2, $3, 31), ($1, $4, 31), ($1, $5, 0))
        as fixture(client_id, operation_id, days_old)
    `, [owner, other, settled, unresolved, unexpired]);
    const read = 'select 1 from "case".case_idempotency_keys';
    await expect(worker.query(read)).rejects.toMatchObject({ code: "42501" });
    await expect(worker.query('delete from "case".case_idempotency_keys where false')).rejects.toMatchObject({ code: "42501" });
    const permission = await db.query(`
      select has_function_privilege('case_gateway_authoring_rw',
        '"case".purge_case_operation_results(text,uuid[])', 'execute') as can_purge
    `);
    expect(permission.rows).toEqual([{ can_purge: false }]);

    await clean([], 0);
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text,$2::uuid)::text,0))",
        [owner, settled]);
      await clean([settled, unexpired], 0);
    } finally {
      await db.query("rollback");
    }
    await clean([settled, unexpired], 1);
    await clean([settled, unexpired], 0);
    const survivors = await db.query(`
      select client_id, operation_id from "case".case_idempotency_keys where client_id in ($1,$2)
      order by client_id, operation_id
    `, [owner, other]);
    expect(survivors.rows).toEqual([
      { client_id: other, operation_id: settled }, { client_id: owner, operation_id: unresolved },
      { client_id: owner, operation_id: unexpired },
    ]);
  } finally {
    await Promise.all([worker.end(), db.end()]);
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);

it.skipIf(!adminUrl || !gatewayUrl || !s3Endpoint || !s3Bucket || !s3Access || !s3Secret || !s3AdminAccess || !s3AdminSecret)(
  "uploads and downloads exact immutable asset versions against a dedicated versioned S3 bucket",
  async () => {
    for (const connection of [adminUrl!, gatewayUrl!]) {
      const url = new URL(connection);
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/libiaolink_case");
    }
    expect(new URL(s3Endpoint!).hostname).toBe("127.0.0.1");
    expect(s3Bucket).toBe("libiaolink-case-proof");
    const db = new Client({ connectionString: adminUrl });
    const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-assets-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    try {
      await db.connect();
      const { rows: [{ id }] } = await db.query(`
        insert into "case".cases (source_project_id, locale, title, created_by, confidentiality)
        values ($1, 'zh-CN', '素材联调案例', 'fixture',
                '{"schemaVersion":1,"mode":"partial","customerIdentity":"internal","contentVisibility":"internal","mediaPermission":"secret"}')
        returning id
      `, [fixtureProjectId]);
      await Promise.all([
        writeGatewayCredentials(dir, gatewayUrl!, publicKey),
        writeFile(join(dir, "case_s3_access_key"), s3Access!, { mode: 0o600 }),
        writeFile(join(dir, "case_s3_secret_key"), s3Secret!, { mode: 0o600 }),
      ]);
      const ticketSeconds = 3;
      const gateway = await startGateway(dir, { CASE_GATEWAY_ASSET_BUCKET: s3Bucket, CASE_GATEWAY_S3_ENDPOINT: s3Endpoint,
        CASE_GATEWAY_ASSET_DOWNLOAD_SECONDS: String(ticketSeconds), CASE_GATEWAY_PROJECTS_PER_MINUTE: "60" });
      try {
        const scope = "case-data:assets:read case-data:assets:write case-data:operations:read";
        const owner = serviceToken(privateKey, { scope });
        const other = serviceToken(privateKey, { scope, sub: "another-asset-service", client_id: "another-asset-service" });
        await verifyCaseAssetRequests({
          db, base: gateway.base, caseId: id,
          ownerToken: owner, anotherToken: other,
          unauthorizedToken: serviceToken(privateKey, { scope: "case-data:releases:read" }),
          endpoint: s3Endpoint!, bucket: s3Bucket!, ticketSeconds,
          credentials: { accessKeyId: s3Access!, secretAccessKey: s3Secret! },
          adminCredentials: { accessKeyId: s3AdminAccess!, secretAccessKey: s3AdminSecret! },
        });
        await verifyAssetProcessing({ db, base: gateway.base, caseId: id, owner, other,
          processor: serviceToken(privateKey, { scope: "case-data:assets:process", sub: "asset-processor", client_id: "asset-processor" }) });
      } finally {
        await gateway.stop();
      }
    } finally {
      await db.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, 45_000,
);

it.skipIf(!adminUrl || !gatewayUrl || !publicUrl || !partnerUrl || !partnerWorkerUrl || !s3Endpoint || !s3Bucket || !s3Access || !s3Secret)(
  "replays directory through withdrawal with the case group's transactional outbox across process crashes", async () => {
    for (const connection of [adminUrl!, gatewayUrl!, publicUrl!, partnerUrl!, partnerWorkerUrl!]) {
      expect(new URL(connection).hostname).toBe("127.0.0.1");
    }
    const hostedDatabase = new URL(adminUrl!);
    const partnerDatabase = new URL(partnerUrl!);
    expect(hostedDatabase.pathname).toBe("/libiaolink_case");
    expect(partnerDatabase.pathname).toBe("/case_partner_fixture");
    expect(hostedDatabase.port).not.toBe(partnerDatabase.port);
    expect(new URL(s3Endpoint!).hostname).toBe("127.0.0.1");
    expect(s3Bucket).toBe("libiaolink-case-proof");
    const hosted = new Client({ connectionString: adminUrl });
    const local = new Client({ connectionString: partnerUrl });
    const dir = await mkdtemp(join(tmpdir(), "libiaolink-c10-e2e-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const projectId = randomUUID();
    const authorClientId = "c10-case-author";
    try {
      await Promise.all([hosted.connect(), local.connect()]);
      expect((await local.query("select to_regclass('case_local.outbox')::text as outbox")).rows).toEqual([
        { outbox: "case_local.outbox" },
      ]);
      expect((await hosted.query("select to_regnamespace('case_local') as partner_schema")).rows).toEqual([{ partner_schema: null }]);
      await hosted.query(`
        insert into project_read.project_summary (project_id, project_code, project_name, region, project_type,
          manager_ids, manager_names, status, source_version, source_updated_at, synced_at)
        values ($1, 'P-C10', 'C10 脱敏项目', 'C10', '分拣', array[$2::uuid], array[null::text], 'active', 10, now(), now())
      `, [projectId, randomUUID()]);
      await Promise.all([
        writeGatewayCredentials(dir, gatewayUrl!, publicKey),
        writeFile(join(dir, "case_gateway_public_ro_database_url"), publicUrl!, { mode: 0o600 }),
        writeFile(join(dir, "case_s3_access_key"), s3Access!, { mode: 0o600 }),
        writeFile(join(dir, "case_s3_secret_key"), s3Secret!, { mode: 0o600 }),
      ]);
      const scopes = ["projects:read", "cases:write", "assets:write", "releases:write", "operations:read"];
      await verifyCaseDataEndToEnd({
        hosted, local, localUrl: partnerWorkerUrl!, projectId, authorClientId,
        authorToken: serviceToken(privateKey, { client_id: authorClientId, sub: authorClientId,
          scope: scopes.map((scope) => `case-data:${scope}`).join(" ") }),
        publicToken: serviceToken(privateKey, { client_id: "c10-case-public", sub: "c10-case-public", scope: "case-data:releases:read" }),
        mediaToken: serviceToken(privateKey, { client_id: "c10-media", sub: "c10-media", scope: "case-data:assets:process" }),
        startGateway: () => startGateway(dir, { CASE_GATEWAY_PUBLIC_SECRET_DIR: dir, CASE_GATEWAY_ASSET_BUCKET: s3Bucket,
          CASE_GATEWAY_S3_ENDPOINT: s3Endpoint, CASE_GATEWAY_PROJECTS_PER_MINUTE: "80",
          CASE_DATA_PARTNER_TEST_DATABASE_URL: undefined, CASE_DATA_PARTNER_OUTBOX_TEST_DATABASE_URL: undefined }),
      });
      const verified = checkRecovery(dir);
      expect(verified.status, verified.stderr).toBe(0);
      expect(JSON.parse(verified.stdout)).toEqual({ checked: 1, missing: 0, mismatch: 0 });
    } finally {
      await Promise.all([hosted.end(), local.end()]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 45_000,
);

it.skipIf(!adminUrl || !gatewayUrl || !publicUrl || !s3Endpoint || !s3Bucket || !s3Access || !s3Secret || !s3AdminAccess || !s3AdminSecret)(
  "stages, switches and withdraws a case release without exposing inactive snapshots", async () => {
    const db = new Client({ connectionString: adminUrl });
    const publicDb = new Client({ connectionString: publicUrl });
    const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-releases-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const projectId = randomUUID();
    try {
      for (const connection of [adminUrl!, gatewayUrl!, publicUrl!]) {
        const url = new URL(connection);
        expect(url.hostname).toBe("127.0.0.1");
        expect(url.pathname).toBe("/libiaolink_case");
      }
      expect(new URL(s3Endpoint!).hostname).toBe("127.0.0.1");
      expect(s3Bucket).toBe("libiaolink-case-proof");
      await Promise.all([db.connect(), publicDb.connect()]);
      await db.query(`
        insert into project_read.project_summary
          (project_id, project_code, project_name, region, project_type, manager_ids, manager_names,
            status, source_version, source_updated_at, synced_at)
        values ($1, 'P-RELEASE', '项目原名', '华东', '分拣', array[$2::uuid], array['仅内部经理'], 'active', 4, now(), now())
      `, [projectId, randomUUID()]);
      const { rows: [{ id }, { id: anotherCaseId }] } = await db.query(`
        insert into "case".cases (source_project_id, locale, title, created_by, confidentiality)
        select $1, 'zh-CN', '仅内部草稿', 'fixture',
               '{"schemaVersion":1,"mode":"partial","customerIdentity":"internal","contentVisibility":"internal","mediaPermission":"secret"}'::jsonb
        from generate_series(1,2)
        returning id
      `, [projectId]);
      await Promise.all([
        writeGatewayCredentials(dir, gatewayUrl!, publicKey),
        writeFile(join(dir, "case_gateway_public_ro_database_url"), publicUrl!, { mode: 0o600 }),
        writeFile(join(dir, "case_s3_access_key"), s3Access!, { mode: 0o600 }),
        writeFile(join(dir, "case_s3_secret_key"), s3Secret!, { mode: 0o600 }),
      ]);
      const gateway = await startGateway(dir, { CASE_GATEWAY_PUBLIC_SECRET_DIR: dir, CASE_GATEWAY_ASSET_BUCKET: s3Bucket,
        CASE_GATEWAY_S3_ENDPOINT: s3Endpoint, CASE_GATEWAY_PROJECTS_PER_MINUTE: "80" });
      try {
        const scope = "case-data:releases:write case-data:releases:history:read case-data:assets:read case-data:assets:write case-data:operations:read";
        await verifyCaseReleaseRequests({
          base: gateway.base, caseId: id, anotherCaseId, projectId, db, publicDb, endpoint: s3Endpoint!, bucket: s3Bucket!,
          authorToken: serviceToken(privateKey, { scope }),
          publicToken: serviceToken(privateKey, { scope: "case-data:releases:read", sub: "release-public", client_id: "release-public" }),
          adminCredentials: { accessKeyId: s3AdminAccess!, secretAccessKey: s3AdminSecret! },
        });
        const failed = checkRecovery(dir);
        expect(failed.status).toBe(1);
        expect(JSON.parse(failed.stdout)).toMatchObject({ missing: 1, mismatch: 0 });
        expect(failed.stderr).toContain("UPLOAD_OBJECT_MISSING");
      } finally {
        await gateway.stop();
      }
    } finally {
      await Promise.all([db.end(), publicDb.end()]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 25_000,
);

it.skipIf(!adminUrl || !gatewayUrl)("writes isolated project profiles, subjects, aliases and members under separate scopes", async () => {
  for (const connection of [adminUrl!, gatewayUrl!]) {
    const url = new URL(connection);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/libiaolink_case");
  }
  const db = new Client({ connectionString: adminUrl });
  const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-project-data-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  try {
    await db.connect();
    await writeGatewayCredentials(dir, gatewayUrl!, publicKey);
    const gateway = await startGateway(dir, { CASE_GATEWAY_PROJECTS_PER_MINUTE: "60" });
    try {
      await verifyProjectData({ db, base: gateway.base, catalogToken: serviceToken(privateKey),
        token: serviceToken(privateKey, { scope: "case-data:project-data:read case-data:project-data:write case-data:cases:write" }) });
    } finally {
      await gateway.stop();
    }
  } finally {
    await db.end();
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);

it.skipIf(!gatewayUrl)("rejects overload and pauses capacity-sensitive writes at the gateway", async () => {
  const dir = await mkdtemp(join(tmpdir(), "libiaolink-case-controls-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const caseCollection = `/api/v1/projects/${fixtureProjectId}/cases`;
  const bearer = (id: string) => ({
    Authorization: `Bearer ${serviceToken(privateKey, { sub: id, client_id: id,
      scope: `${readScope} case-data:cases:write case-data:releases:write` })}`,
  });
  try {
    await writeGatewayCredentials(dir, gatewayUrl!, publicKey);
    const gateway = await startGateway(dir, { CASE_GATEWAY_MAX_ACTIVE_REQUESTS: "1", CASE_GATEWAY_MAX_ACTIVE_PER_CLIENT: "1" });
    const held = httpRequest(gateway.base + caseCollection, {
      method: "POST", headers: { ...bearer("holder"), "Content-Type": "application/json",
        "Content-Length": "2", Expect: "100-continue" },
      signal: AbortSignal.timeout(5000),
    });
    const postResponse = once(held, "response");
    void postResponse.catch(() => {});
    try {
      const intermediate = once(held, "continue");
      held.flushHeaders();
      await intermediate;
      for (const [clientId, status, code] of [["holder", 429, "CLIENT_CONCURRENCY_LIMIT"], ["other", 503, "GATEWAY_BUSY"]] as const) {
        const refused = await fetch(gateway.base + "/api/v1/projects", { headers: bearer(clientId) });
        expect(refused.status).toBe(status);
        expect(refused.headers.get("retry-after")).toBe("1");
        expect(await refused.json()).toMatchObject({ code });
      }
      held.end("{}");
      expect((await postResponse)[0].statusCode).toBe(422);
      expect((await fetch(gateway.base + "/api/v1/projects", { headers: bearer("holder") })).status).toBe(200);
    } finally {
      held.destroy();
      await gateway.stop();
    }

    const guarded = await startGateway(dir, { CASE_GATEWAY_CAPACITY_PATHS: JSON.stringify([join(dir, "unmounted")]) });
    try {
      const headers = { ...bearer("author"), "Content-Type": "application/json" };
      const blocked = await fetch(guarded.base + caseCollection, { method: "POST", headers, body: "{}" });
      expect(blocked.status).toBe(503);
      expect(await blocked.json()).toMatchObject({ code: "CAPACITY_UNAVAILABLE" });
      expect((await fetch(guarded.base + "/api/v1/projects", { headers })).status).toBe(200);
      // The capacity guard lets withdrawal reach normal request validation.
      const withdrawal = `/api/v1/cases/${randomUUID()}/releases/${randomUUID()}/deactivate`;
      expect((await fetch(guarded.base + withdrawal, { method: "POST", headers, body: "{}" })).status).toBe(422);
    } finally {
      await guarded.stop();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
