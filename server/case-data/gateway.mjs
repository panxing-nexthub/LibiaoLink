import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { readCaseAssetStorage } from "./case-asset-storage.mjs";
import { CaseAggregateError, CaseQueryError } from "./case-aggregate.mjs";
import { CaseRequestError, createCaseHttp, matchCaseDataRoute, parse, readBody } from "./case-http.mjs";
import { createCaseReleaseReads } from "./case-releases.mjs";
import { CaseDataError, errorCode, readCredential, readDatabaseUrl } from "./database-credentials.mjs";
import { createServiceAuthenticator } from "./gateway-auth.mjs";
import { createCapacityGuard, createRequestAdmission } from "./gateway-controls.mjs";
import { CatalogQueryError, createProjectCatalog, parseCatalogQuery } from "./project-catalog.mjs";
import { createProjectCatalogHttp } from "./project-catalog-http.mjs";
import { caseErrorResponse } from "./case-write.mjs";

const directoryVariable = "CASE_GATEWAY_SECRET_DIR";
const publicDirectoryVariable = "CASE_GATEWAY_PUBLIC_SECRET_DIR";
const projectPath = "/api/v1/projects";
const projectItemPattern = /^\/api\/v1\/projects\/([^/]+)$/;
const projectReadScope = "case-data:projects:read";
const projectWriteScope = "case-data:projects:write";
const rateWindowMs = 60_000;
const uploadActions = new Set(["create", "createProject", "target", "part", "complete", "media-input"]);
const retryableDatabaseErrors = new Set(["55P03", "57014", "53300", "57P03"]);

function readInteger(name, fallback, min, max) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) {
    throw new CaseDataError(`${name} 必须是 ${min} 至 ${max} 的整数`);
  }
  return value;
}

function rateLimit(maximum) {
  const windows = new Map();
  let nextSweep = 0;
  return (clientId) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [id, window] of windows) {
        if (window.ends <= now) windows.delete(id);
      }
      nextSweep = now + rateWindowMs;
    }
    let window = windows.get(clientId);
    if (!window || window.ends <= now) {
      window = { ends: now + rateWindowMs, used: 0 };
      windows.set(clientId, window);
    }
    if (window.used >= maximum) return Math.ceil((window.ends - now) / 1000);
    window.used += 1;
    return 0;
  };
}

function makeHandler({ authenticate, catalog, projectCatalog, cases, assetStorage, publicProbe, cursorKey, projectsPerMinute,
  admit, checkCapacity }) {
  const retryAfter = rateLimit(projectsPerMinute);
  const caseRetryAfter = rateLimit(projectsPerMinute);
  const assetRetryAfter = rateLimit(projectsPerMinute);
  const mediaRetryAfter = rateLimit(projectsPerMinute);
  const publicRetryAfter = rateLimit(projectsPerMinute);
  let probing = false;
  return async function handle(request, response) {
    const traceId = randomUUID();
    const started = performance.now();
    let route = "unknown";
    let clientId;
    let release;
    let resourceId;
    const writeMetadata = {};
    function send(status, body, headers = {}) {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Request-Id": traceId,
        ...headers,
      });
      response.end(JSON.stringify(body));
    }
    function fail(status, code, message, details = [], headers) {
      send(status, { code, message, details, traceId }, headers);
    }

    try {
      if (!request.url?.startsWith("/") || request.url.startsWith("//") || request.url.length > 4096) {
        return fail(422, "VALIDATION_FAILED", "请求地址无效");
      }
      const url = new URL(request.url, "http://case-gateway.local");
      const caseRoute = matchCaseDataRoute(url.pathname);
      const projectItem = projectItemPattern.exec(url.pathname);
      if (!caseRoute && !projectItem && ![projectPath, "/healthz", "/readyz"].includes(url.pathname)) {
        return fail(404, "NOT_FOUND", "资源不存在");
      }
      route = caseRoute?.path ?? (projectItem ? "/api/v1/projects/{projectId}" : url.pathname);
      const allowed = caseRoute ? Object.keys(caseRoute.scopes) : projectItem ? ["GET", "PATCH"] :
        route === projectPath ? ["GET", "POST"] : ["GET"];
      if (!allowed.includes(request.method)) {
        return fail(405, "METHOD_NOT_ALLOWED", "请求方法无效", [], { Allow: allowed.join(", ") });
      }
      if (route === "/healthz") return send(200, { status: "ok" });

      if (caseRoute || projectItem || route === projectPath) {
        const authorization = request.headersDistinct.authorization;
        const principal = authorization?.length === 1 ? authenticate(authorization[0]) : null;
        if (!principal) return fail(401, "AUTH_REQUIRED", "服务认证失败", [], { "WWW-Authenticate": "Bearer" });
        clientId = principal.clientId;
        const scope = caseRoute ? caseRoute.scopes[request.method] :
          request.method === "GET" ? projectReadScope : projectWriteScope;
        if (!principal.scopes.has(scope)) return fail(403, "FORBIDDEN", "缺少请求所需权限");
        const limit = caseRoute?.publicRelease ? publicRetryAfter : scope === "case-data:assets:process" ?
          mediaRetryAfter : caseRoute?.assetAction ? assetRetryAfter :
          caseRoute ? caseRetryAfter : retryAfter;
        const wait = limit(clientId);
        if (wait) return fail(429, "RATE_LIMITED", "请求过于频繁", [], { "Retry-After": wait });
        if (request.method === "GET" && (Number(request.headers["content-length"] ?? 0) !== 0 || request.headers["transfer-encoding"])) {
          return fail(422, "VALIDATION_FAILED", "查询接口只接收 URL 参数", [], { Connection: "close" });
        }
        const admission = admit(clientId);
        if (!admission.release) {
          return fail(admission.status, admission.code, admission.message, [], { "Retry-After": 1, Connection: "close" });
        }
        release = admission.release;
      } else {
        if (probing) return fail(503, "GATEWAY_BUSY", "已有就绪探测在执行", [], { "Retry-After": 1 });
        probing = true;
        release = () => { probing = false; };
        await checkCapacity("probe");
      }

      if (caseRoute) {
        if (url.searchParams.size !== 0 && !caseRoute.allowQuery) throw new CaseRequestError("案例接口不接受查询参数");
        const effect = caseRoute.releaseAction === "deactivate" ? "withdraw" : uploadActions.has(caseRoute.assetAction) ?
          "upload" : request.method === "GET" ? "read" : "write";
        const capacityCode = await checkCapacity(effect);
        if (capacityCode) {
          return fail(503, capacityCode, "案例存储容量受限，请稍后用原操作标识重试", [],
            { "Retry-After": 5, Connection: "close" });
        }
        const result = await cases(request, caseRoute, clientId, writeMetadata);
        resourceId = result.resourceId ?? result.body?.resourceId ?? result.body?.releaseId ??
          result.body?.assetVersionId ?? result.body?.subjectId ?? result.body?.caseId ?? result.body?.externalProjectId;
        if (result.stream) {
          response.writeHead(result.status, { "Cache-Control": "no-store", "X-Request-Id": traceId, ...result.headers });
          await pipeline(Readable.fromWeb(result.stream), response).catch((error) => {
            console.error(JSON.stringify({ event: "public_asset_stream_interrupted", traceId, code: errorCode(error) }));
          });
          return;
        }
        return result.status >= 400
          ? fail(result.status, result.body.code, result.body.message, result.body.details, result.headers)
          : send(result.status, result.body, result.headers);
      }

      if (projectItem && request.method === "GET") {
        if (url.searchParams.size !== 0) throw new CaseRequestError("项目读取不接受查询参数");
        const result = await projectCatalog.get(projectItem[1]);
        resourceId = result.resourceId ?? result.body?.externalProjectId;
        return result.status >= 400
          ? fail(result.status, result.body.code, result.body.message, result.body.details, result.headers)
          : send(result.status, result.body, result.headers);
      }

      if (projectItem && request.method === "PATCH") {
        if (url.searchParams.size !== 0) throw new CaseRequestError("项目更新不接受查询参数");
        const capacityCode = await checkCapacity("write");
        if (capacityCode) {
          return fail(503, capacityCode, "案例存储容量受限，请稍后用原操作标识重试", [],
            { "Retry-After": 5, Connection: "close" });
        }
        const result = await projectCatalog.update(request, clientId, projectItem[1], writeMetadata);
        resourceId = result.resourceId ?? result.body?.externalProjectId;
        return result.status >= 400
          ? fail(result.status, result.body.code, result.body.message, result.body.details, result.headers)
          : send(result.status, result.body, result.headers);
      }

      if (route === projectPath && request.method === "POST") {
        if (url.searchParams.size !== 0) throw new CaseRequestError("项目注册不接受查询参数");
        const capacityCode = await checkCapacity("write");
        if (capacityCode) {
          return fail(503, capacityCode, "案例存储容量受限，请稍后用原操作标识重试", [],
            { "Retry-After": 5, Connection: "close" });
        }
        const result = await projectCatalog.register(request, clientId, writeMetadata);
        resourceId = result.resourceId ?? result.body?.externalProjectId;
        return result.status >= 400
          ? fail(result.status, result.body.code, result.body.message, result.body.details, result.headers)
          : send(result.status, result.body, result.headers);
      }

      const query = route === projectPath ? parseCatalogQuery(url.searchParams, cursorKey) : null;
      try {
        if (query) return send(200, await catalog.list(query));
        await catalog.probe();
      } catch (error) {
        console.error(JSON.stringify({ event: "catalog_unavailable", traceId, databaseCode: errorCode(error) }));
        return fail(503, "PROJECT_CATALOG_UNAVAILABLE", "项目目录暂不可用");
      }
      if (assetStorage) {
        try {
          await assetStorage.probe();
        } catch {
          return fail(503, "ASSET_STORAGE_UNAVAILABLE", "案例对象存储暂不可用");
        }
      }
      if (publicProbe) {
        try {
          await publicProbe();
        } catch (error) {
          console.error(JSON.stringify({ event: "published_release_unavailable", traceId, databaseCode: errorCode(error) }));
          return fail(503, "PUBLIC_RELEASE_UNAVAILABLE", "发布读面暂不可用");
        }
      }
      return send(200, { status: "ok" });
    } catch (error) {
      if (error instanceof CaseRequestError) {
        const oversized = error.status === 413;
        return fail(error.status, oversized ? "PAYLOAD_TOO_LARGE" : "VALIDATION_FAILED", error.message, error.details,
          oversized ? { Connection: "close" } : undefined);
      }
      if (error instanceof CatalogQueryError || error instanceof CaseQueryError) {
        return fail(422, "VALIDATION_FAILED", "查询参数无效", [
          { code: "invalid_query", message: error.message, path: error.path },
        ]);
      }
      if (error instanceof CaseAggregateError) {
        const result = caseErrorResponse(error);
        return fail(result.status, result.body.code, result.body.message, result.body.details);
      }
      console.error(JSON.stringify({ event: "gateway_request_failed", traceId, code: errorCode(error) }));
      if (retryableDatabaseErrors.has(error?.code)) {
        return fail(503, "CASE_DATABASE_BUSY", "案例数据库暂忙", [], { "Retry-After": 1 });
      }
      return fail(500, "INTERNAL", "请求处理失败");
    } finally {
      release?.();
      console.log(JSON.stringify({ event: "request", traceId, clientId, route, resourceId, ...writeMetadata,
        status: response.statusCode, durationMs: Math.round(performance.now() - started) }));
    }
  };
}

async function main() {
  const issuer = process.env.CASE_GATEWAY_TOKEN_ISSUER;
  const audience = process.env.CASE_GATEWAY_TOKEN_AUDIENCE;
  if (URL.parse(issuer ?? "")?.protocol !== "https:" || !audience?.trim()) {
    throw new CaseDataError("须配置 HTTPS 的 CASE_GATEWAY_TOKEN_ISSUER 和 CASE_GATEWAY_TOKEN_AUDIENCE");
  }
  const port = readInteger("CASE_GATEWAY_PORT", 34602, 0, 65535);
  const projectsPerMinute = readInteger("CASE_GATEWAY_PROJECTS_PER_MINUTE", 120, 1, 10000);
  const maxActive = readInteger("CASE_GATEWAY_MAX_ACTIVE_REQUESTS", 16, 1, 256);
  const admit = createRequestAdmission(maxActive,
    readInteger("CASE_GATEWAY_MAX_ACTIVE_PER_CLIENT", Math.min(6, maxActive), 1, maxActive));
  const checkCapacity = createCapacityGuard({
    locations: process.env.CASE_GATEWAY_CAPACITY_PATHS,
    warning: readInteger("CASE_GATEWAY_CAPACITY_WARN_PERCENT", 75, 1, 100),
    stopUploads: readInteger("CASE_GATEWAY_CAPACITY_STOP_UPLOADS_PERCENT", 85, 1, 100),
    stopWrites: readInteger("CASE_GATEWAY_CAPACITY_STOP_WRITES_PERCENT", 90, 1, 100),
  });
  const [connectionString, jwks, rawCursorKey, assetStorage, publicConnectionString] = await Promise.all([
    readDatabaseUrl(directoryVariable, "case_gateway_authoring_rw_database_url"),
    readCredential(directoryVariable, "case_gateway_public_jwks"),
    readCredential(directoryVariable, "case_gateway_cursor_key"),
    readCaseAssetStorage(),
    process.env[publicDirectoryVariable] === undefined ? null :
      readDatabaseUrl(publicDirectoryVariable, "case_gateway_public_ro_database_url"),
  ]);
  if (!/^[a-f0-9]{64}$/i.test(rawCursorKey)) throw new CaseDataError("case_gateway_cursor_key 须为 32 字节十六进制密钥");
  const cursorKey = Buffer.from(rawCursorKey, "hex");
  const authenticate = createServiceAuthenticator(jwks, issuer, audience);
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 2_000,
    statement_timeout: 2_000, lock_timeout: 500, idle_in_transaction_session_timeout: 60_000 });
  pool.on("error", (error) => console.error(JSON.stringify({ event: "catalog_connection_failed", code: errorCode(error) })));
  const catalog = createProjectCatalog(pool, cursorKey);
  const projectCatalog = createProjectCatalogHttp(pool, catalog, { parse, readBody });
  const publicPool = publicConnectionString ? new pg.Pool({
    connectionString: publicConnectionString, max: 2, connectionTimeoutMillis: 2_000, statement_timeout: 2_000,
    lock_timeout: 500, idle_in_transaction_session_timeout: 10_000,
  }) : null;
  publicPool?.on("error", (error) => console.error(JSON.stringify({ event: "published_release_connection_failed", code: errorCode(error) })));
  const releaseReads = createCaseReleaseReads(pool, publicPool, cursorKey);
  const cases = createCaseHttp(pool, assetStorage, releaseReads, Boolean(publicPool), cursorKey);
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 10_000, headersTimeout: 5_000,
    connectionsCheckingInterval: 1_000 },
    makeHandler({ authenticate, catalog, projectCatalog, cases, assetStorage,
      publicProbe: publicPool ? releaseReads.probe : null, cursorKey, projectsPerMinute, admit, checkCapacity }));
  const listening = once(server, "listening");
  server.listen(port, "127.0.0.1");
  await listening;
  console.log(JSON.stringify({ event: "listening", port: server.address().port }));

  const stop = () => server.close(() => { void Promise.all([pool.end(), publicPool?.end()]); });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error) => {
  const message = error instanceof CaseDataError ? error.message : `案例数据网关启动失败${errorCode(error)}`;
  console.error(message);
  process.exitCode = 1;
});
