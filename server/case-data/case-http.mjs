import { CaseCreateBodySchema, CaseOperationIdSchema, CasePatchBodySchema, CaseRestoreVersionBodySchema,
  CaseUuidSchema } from "@libiaolink/contracts/case-data";
import { CaseAssetLinkBodySchema, CaseAssetPatchBodySchema, CaseCompleteUploadBodySchema, CaseCreateUploadBodySchema,
  CaseSaveAssetMediaBodySchema, CaseUploadPartNumberSchema } from "@libiaolink/contracts/case-data/assets";
import { CaseAggregateError, createCaseAggregate, parseCaseListQuery, parseCaseVersionListQuery } from "./case-aggregate.mjs";
import { createAssetMediaReads, saveAssetMedia } from "./case-asset-media.mjs";
import { CaseAssetError } from "./case-asset-storage.mjs";
import { completeCaseUpload, createCaseAssets, createCaseUpload, parseAssetListQuery } from "./case-assets.mjs";
import { createReleaseHttp, matchReleaseRoute } from "./case-release-http.mjs";
import { caseErrorResponse, readCaseOperation, writeCaseOnce } from "./case-write.mjs";
import { createProjectDataHttp, matchProjectDataRoute } from "./project-data-http.mjs";

const bodyLimit = 4 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class CaseRequestError extends Error {
  constructor(message, details = [], status = 422) {
    super(message);
    this.details = details;
    this.status = status;
  }
}

export function matchCaseDataRoute(pathname) {
  const projectCases = /^\/api\/v1\/projects\/([^/]+)\/cases$/.exec(pathname);
  if (projectCases) return { path: "/api/v1/projects/{projectId}/cases", projectId: projectCases[1], projectCases: true,
    allowQuery: true, scopes: { GET: "case-data:cases:read", POST: "case-data:cases:write" } };
  const projectUploads = /^\/api\/v1\/projects\/([^/]+)\/uploads$/.exec(pathname);
  if (projectUploads) return { path: "/api/v1/projects/{projectId}/uploads", projectId: projectUploads[1],
    assetAction: "createProject", scopes: { POST: "case-data:assets:write" } };
  const projectAssets = /^\/api\/v1\/projects\/([^/]+)\/assets$/.exec(pathname);
  if (projectAssets) return { path: "/api/v1/projects/{projectId}/assets", projectId: projectAssets[1],
    assetAction: "projectAssets", allowQuery: true, scopes: { GET: "case-data:assets:read" } };
  const restore = /^\/api\/v1\/cases\/([^/]+)\/versions\/([^/]+)\/restore$/.exec(pathname);
  if (restore) return { path: "/api/v1/cases/{caseId}/versions/{versionId}/restore", caseId: restore[1],
    caseVersionId: restore[2], caseRestore: true, scopes: { POST: "case-data:cases:write" } };
  const versionItem = /^\/api\/v1\/cases\/([^/]+)\/versions\/([^/]+)$/.exec(pathname);
  if (versionItem) return { path: "/api/v1/cases/{caseId}/versions/{versionId}", caseId: versionItem[1],
    caseVersionId: versionItem[2], caseVersionItem: true, scopes: { GET: "case-data:cases:read" } };
  const versionCollection = /^\/api\/v1\/cases\/([^/]+)\/versions$/.exec(pathname);
  if (versionCollection) return { path: "/api/v1/cases/{caseId}/versions", caseId: versionCollection[1],
    caseVersions: true, allowQuery: true, scopes: { GET: "case-data:cases:read" } };
  const translations = /^\/api\/v1\/cases\/([^/]+)\/translations$/.exec(pathname);
  if (translations) return { path: "/api/v1/cases/{caseId}/translations", caseId: translations[1],
    caseTranslations: true, scopes: { GET: "case-data:cases:read" } };
  const caseAssets = /^\/api\/v1\/cases\/([^/]+)\/assets$/.exec(pathname);
  if (caseAssets) return { path: "/api/v1/cases/{caseId}/assets", caseId: caseAssets[1], assetAction: "caseAssets",
    allowQuery: true, scopes: { GET: "case-data:assets:read" } };
  const item = /^\/api\/v1\/cases\/([^/]+)$/.exec(pathname);
  if (item) return { path: "/api/v1/cases/{caseId}", caseId: item[1],
    scopes: { GET: "case-data:cases:read", PATCH: "case-data:cases:write" } };
  const operation = /^\/api\/v1\/operations\/([^/]+)$/.exec(pathname);
  if (operation) return { path: "/api/v1/operations/{operationId}", operationId: operation[1],
    scopes: { GET: "case-data:operations:read" } };
  const uploads = /^\/api\/v1\/cases\/([^/]+)\/uploads$/.exec(pathname);
  if (uploads) return { path: "/api/v1/cases/{caseId}/uploads", assetAction: "create", caseId: uploads[1],
    scopes: { POST: "case-data:assets:write" } };
  const upload = /^\/api\/v1\/uploads\/([^/]+)\/(target|complete|parts)$/.exec(pathname);
  if (upload) return { path: `/api/v1/uploads/{uploadId}/${upload[2]}`, assetAction: upload[2], uploadId: upload[1],
    scopes: upload[2] === "complete" ? { POST: "case-data:assets:write" } : { GET: "case-data:assets:write" } };
  const part = /^\/api\/v1\/uploads\/([^/]+)\/parts\/([^/]+)\/target$/.exec(pathname);
  if (part) return { path: "/api/v1/uploads/{uploadId}/parts/{partNumber}/target", assetAction: "part",
    uploadId: part[1], partNumber: part[2], scopes: { GET: "case-data:assets:write" } };
  const preview = /^\/api\/v1\/assets\/([^/]+)\/versions\/([^/]+)\/preview-ticket$/.exec(pathname);
  if (preview) return { path: "/api/v1/assets/{assetId}/versions/{assetVersionId}/preview-ticket",
    assetAction: "preview", assetId: preview[1], assetVersionId: preview[2], scopes: { GET: "case-data:assets:read" } };
  const assetVersion = /^\/api\/v1\/assets\/([^/]+)\/versions\/([^/]+)\/(download-ticket|media-state|media-input)$/.exec(pathname);
  if (assetVersion) {
    const action = assetVersion[3];
    const processingScope = "case-data:assets:process";
    return { path: `/api/v1/assets/{assetId}/versions/{assetVersionId}/${action}`,
      assetAction: action, assetId: assetVersion[1], assetVersionId: assetVersion[2],
      scopes: action === "download-ticket" ? { GET: "case-data:assets:read" } :
        action === "media-state" ? { GET: processingScope, PUT: processingScope } : { GET: processingScope } };
  }
  const assetVersions = /^\/api\/v1\/assets\/([^/]+)\/versions$/.exec(pathname);
  if (assetVersions) return { path: "/api/v1/assets/{assetId}/versions", assetAction: "assetVersions",
    assetId: assetVersions[1], scopes: { GET: "case-data:assets:read" } };
  const link = /^\/api\/v1\/assets\/([^/]+)\/cases\/([^/]+)$/.exec(pathname);
  if (link) return { path: "/api/v1/assets/{assetId}/cases/{caseId}", assetAction: "link",
    assetId: link[1], caseId: link[2], scopes: { PUT: "case-data:assets:write", DELETE: "case-data:assets:write" } };
  const asset = /^\/api\/v1\/assets\/([^/]+)$/.exec(pathname);
  if (asset) return { path: "/api/v1/assets/{assetId}", assetAction: "asset", assetId: asset[1],
    scopes: { GET: "case-data:assets:read", PATCH: "case-data:assets:write" } };
  return matchReleaseRoute(pathname) ?? matchProjectDataRoute(pathname);
}

export function parse(schema, input, path) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CaseRequestError("请求字段无效", parsed.error.issues.slice(0, 20).map((issue) => ({
      code: issue.code, message: issue.message, path: [path, ...issue.path].join("."),
    })));
  }
  return parsed.data;
}

export async function readBody(request) {
  if (request.headers["idempotency-key"] !== undefined) {
    throw new CaseRequestError("本地联调使用请求体 operationId");
  }
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new CaseRequestError("请求体须使用 application/json");
  if (Number(request.headers["content-length"] ?? 0) > bodyLimit) {
    throw new CaseRequestError("请求体超过 4 MiB", [], 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) throw new CaseRequestError("请求体超过 4 MiB", [], 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(utf8.decode(Buffer.concat(chunks)));
  } catch {
    throw new CaseRequestError("请求体须为有效 JSON");
  }
}

function createAssetHttp(pool, storage, cursorKey) {
  const assets = createCaseAssets(pool, storage, cursorKey);
  const media = createAssetMediaReads(pool, storage);
  return async (request, route, clientId, writeMetadata) => {
    if (!storage) throw new CaseAssetError(503, "ASSET_STORAGE_UNAVAILABLE", "案例对象存储暂不可用");
    const action = route.assetAction;
    const method = request.method;
    const query = (scope, id) => parseAssetListQuery(
      new URL(request.url, "http://case-gateway.local").searchParams, cursorKey, scope, id,
    );

    if (action === "caseAssets") {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      return { status: 200, body: await assets.listByCase(caseId, clientId, query("case", caseId)), resourceId: caseId };
    }
    if (action === "projectAssets") {
      const projectId = parse(CaseUuidSchema, route.projectId, "path.projectId");
      return { status: 200, body: await assets.listByProject(projectId, clientId, query("project", projectId)), resourceId: projectId };
    }
    if (action === "assetVersions") {
      const assetId = parse(CaseUuidSchema, route.assetId, "path.assetId");
      return { status: 200, body: await assets.versions(assetId, clientId), resourceId: assetId };
    }
    if (action === "preview") {
      const assetId = parse(CaseUuidSchema, route.assetId, "path.assetId");
      const assetVersionId = parse(CaseUuidSchema, route.assetVersionId, "path.assetVersionId");
      return { status: 200, body: await assets.preview(assetId, assetVersionId, clientId), resourceId: assetVersionId };
    }
    if (action === "asset") {
      const assetId = parse(CaseUuidSchema, route.assetId, "path.assetId");
      if (method === "GET") return { status: 200, body: await assets.detail(assetId, clientId), resourceId: assetId };
      const { operationId, traceId, operatorUserKey, expectedVersion, ...patch } = parse(
        CaseAssetPatchBodySchema, await readBody(request), "body",
      );
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey });
      return writeCaseOnce(pool, {
        clientId, operationId, method, path: `/api/v1/assets/${assetId}`,
        payload: { operatorUserKey, expectedVersion, ...patch },
      }, async (client) => ({ status: 200, body: await assets.patchInTransaction(client, assetId, clientId, expectedVersion, patch), resourceId: assetId }));
    }
    if (action === "link") {
      const assetId = parse(CaseUuidSchema, route.assetId, "path.assetId");
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      const { operationId, traceId, operatorUserKey, sortOrder } = parse(
        CaseAssetLinkBodySchema, await readBody(request), "body",
      );
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey });
      const linked = method === "PUT";
      return writeCaseOnce(pool, {
        clientId, operationId, method, path: `/api/v1/assets/${assetId}/cases/${caseId}`,
        payload: { operatorUserKey, ...(sortOrder === undefined ? {} : { sortOrder }) },
      }, async (client) => ({ status: 200,
        body: await assets.linkInTransaction(client, assetId, caseId, clientId, operatorUserKey, linked, sortOrder),
        resourceId: assetId }));
    }
    if (route.assetId) {
      const assetId = parse(CaseUuidSchema, route.assetId, "path.assetId");
      const versionId = parse(CaseUuidSchema, route.assetVersionId, "path.assetVersionId");
      if (action === "download-ticket") {
        return { status: 200, body: await assets.ticket(assetId, versionId, clientId), resourceId: versionId };
      }
      if (action === "media-input") return { status: 200, body: await media.ticket(assetId, versionId), resourceId: versionId };
      if (method === "GET") return { status: 200, body: await media.state(assetId, versionId) };
      const { operationId, traceId, ...input } = parse(CaseSaveAssetMediaBodySchema, await readBody(request), "body");
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
      const path = `/api/v1/assets/${assetId}/versions/${versionId}/media-state`;
      return writeCaseOnce(pool, { clientId, operationId, method, path, payload: input }, async (client) => ({
        status: 200, body: await saveAssetMedia(client, assetId, versionId, input), resourceId: versionId,
      }));
    }
    if (method === "GET") {
      const uploadId = parse(CaseUuidSchema, route.uploadId, "path.uploadId");
      if (action === "target") return { status: 200, body: await assets.target(uploadId, clientId), resourceId: uploadId };
      if (action === "parts") return { status: 200, body: await assets.parts(uploadId, clientId), resourceId: uploadId };
      const partNo = /^\d{1,2}$/.test(route.partNumber) ? Number(route.partNumber) : NaN;
      const partNumber = parse(CaseUploadPartNumberSchema, partNo, "path.partNumber");
      return { status: 200, body: await assets.partTarget(uploadId, clientId, partNumber), resourceId: uploadId };
    }
    const creating = action === "create" || action === "createProject";
    const schema = creating ? CaseCreateUploadBodySchema : CaseCompleteUploadBodySchema;
    const { operationId, traceId, ...input } = parse(schema, await readBody(request), "body");
    Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
    if (creating) {
      const target = action === "create" ? { caseId: parse(CaseUuidSchema, route.caseId, "path.caseId") } :
        { projectId: parse(CaseUuidSchema, route.projectId, "path.projectId") };
      const path = action === "create" ? `/api/v1/cases/${target.caseId}/uploads` :
        `/api/v1/projects/${target.projectId}/uploads`;
      return writeCaseOnce(pool, { clientId, operationId, method, path, payload: input }, async (client) => {
        const body = await createCaseUpload(client, storage, target, clientId, input);
        return { status: 201, body, resourceId: body.uploadId };
      });
    }
    const uploadId = parse(CaseUuidSchema, route.uploadId, "path.uploadId");
    const path = `/api/v1/uploads/${uploadId}/complete`;
    return writeCaseOnce(pool, { clientId, operationId, method, path, payload: input }, async (client) => {
      const body = await completeCaseUpload(client, storage, uploadId, clientId, input);
      return { status: 200, body, resourceId: body.assetVersionId };
    });
  };
}

export function createCaseHttp(pool, storage, releaseReads, publicEnabled, cursorKey) {
  const aggregate = createCaseAggregate(pool, cursorKey);
  const assets = createAssetHttp(pool, storage, cursorKey);
  const releases = createReleaseHttp(pool, storage, releaseReads, publicEnabled, { parse, readBody, cursorKey });
  const projectData = createProjectDataHttp(pool, { parse, readBody });
  return async (request, route, clientId, writeMetadata) => {
    const method = request.method;
    if (route.releaseAction) return releases(request, route, clientId, writeMetadata);
    if (route.projectData) return projectData(request, route, clientId, writeMetadata);
    if (route.projectCases) {
      const projectId = parse(CaseUuidSchema, route.projectId, "path.projectId");
      if (method === "GET") {
        const query = parseCaseListQuery(new URL(request.url, "http://case-gateway.local").searchParams, cursorKey);
        return { status: 200, body: await aggregate.listByProject(projectId, query), resourceId: projectId };
      }
      const rawBody = await readBody(request);
      const { operationId, traceId, externalProjectId, ...input } = parse(CaseCreateBodySchema, rawBody, "body");
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
      if (projectId !== externalProjectId) throw new CaseRequestError("路径项目 ID 与 externalProjectId 不一致");
      return writeCaseOnce(pool, {
        clientId, operationId, method, path: `/api/v1/projects/${projectId}/cases`, payload: input,
      }, async (client) => ({ status: 201, body: await aggregate.createInTransaction(client, { ...input, sourceProjectId: projectId }) }));
    }
    if (route.caseVersions) {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      const query = parseCaseVersionListQuery(new URL(request.url, "http://case-gateway.local").searchParams, cursorKey);
      return { status: 200, body: await aggregate.versions(caseId, query), resourceId: caseId };
    }
    if (route.caseVersionItem) {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      const versionId = parse(CaseUuidSchema, route.caseVersionId, "path.versionId");
      return { status: 200, body: await aggregate.version(caseId, versionId), resourceId: versionId };
    }
    if (route.caseRestore) {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      const versionId = parse(CaseUuidSchema, route.caseVersionId, "path.versionId");
      const { operationId, traceId, operatorUserKey, expectedVersion, changeSummary } = parse(
        CaseRestoreVersionBodySchema, await readBody(request), "body",
      );
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey });
      return writeCaseOnce(pool, {
        clientId, operationId, method, path: `/api/v1/cases/${caseId}/versions/${versionId}/restore`,
        payload: { operatorUserKey, expectedVersion, changeSummary },
      }, async (client) => ({ status: 200,
        body: await aggregate.restoreInTransaction(client, caseId, versionId, { expectedVersion, operatorUserKey, changeSummary }), resourceId: caseId }));
    }
    if (route.caseTranslations) {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      return { status: 200, body: await aggregate.translations(caseId), resourceId: caseId };
    }
    if (route.assetAction) {
      try {
        return await assets(request, route, clientId, writeMetadata);
      } catch (error) {
        if (error instanceof CaseAssetError) {
          return { status: error.status, body: { code: error.code, message: error.message, details: [] } };
        }
        return caseErrorResponse(error);
      }
    }
    if (route.operationId) {
      const operationId = parse(CaseOperationIdSchema, route.operationId, "path.operationId");
      writeMetadata.operationId = operationId;
      const operation = await readCaseOperation(pool, clientId, operationId);
      if (operation?.expired) {
        return { status: 410, body: { code: "OPERATION_EXPIRED",
          message: "操作结果已超过 30 天保留期，禁止使用同一标识再次执行", details: [] } };
      }
      if (operation) {
        delete operation.expired;
        return { status: 200, body: operation, resourceId: operation.resourceId };
      }
      return { status: 404, body: { code: "NOT_FOUND", message: "操作结果不存在", details: [] } };
    }
    if (method === "GET") {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      try {
        return { status: 200, body: await aggregate.get(caseId) };
      } catch (error) {
        return caseErrorResponse(error);
      }
    }
    const rawBody = await readBody(request);
    const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
    const { operationId, traceId, operatorUserKey, expectedVersion, ...patch } = parse(CasePatchBodySchema, rawBody, "body");
    Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey });
    return writeCaseOnce(pool, {
      clientId, operationId, method, path: `/api/v1/cases/${caseId}`,
      payload: { operatorUserKey, expectedVersion, ...patch },
    }, async (client) => ({ status: 200, body: await aggregate.patchInTransaction(client, caseId, expectedVersion, patch) }));
  };
}
