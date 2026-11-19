import { CaseCreateBodySchema, CaseOperationIdSchema, CasePatchBodySchema, CaseUuidSchema } from "@libiaolink/contracts/case-data";
import { CaseCompleteUploadBodySchema, CaseCreateUploadBodySchema, CaseSaveAssetMediaBodySchema,
  CaseUploadPartNumberSchema } from "@libiaolink/contracts/case-data/assets";
import { createCaseAggregate, insertCase, patchCase } from "./case-aggregate.mjs";
import { createAssetMediaReads, saveAssetMedia } from "./case-asset-media.mjs";
import { CaseAssetError } from "./case-asset-storage.mjs";
import { completeCaseUpload, createCaseAssets, createCaseUpload } from "./case-assets.mjs";
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
  const project = /^\/api\/v1\/projects\/([^/]+)\/cases$/.exec(pathname);
  if (project) return { path: "/api/v1/projects/{projectId}/cases", projectId: project[1],
    scopes: { POST: "case-data:cases:write" } };
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
  const asset = /^\/api\/v1\/assets\/([^/]+)\/versions\/([^/]+)\/(download-ticket|media-state|media-input)$/.exec(pathname);
  if (asset) {
    const action = asset[3];
    const processingScope = "case-data:assets:process";
    return { path: `/api/v1/assets/{assetId}/versions/{assetVersionId}/${action}`,
      assetAction: action, assetId: asset[1], assetVersionId: asset[2],
      scopes: action === "download-ticket" ? { GET: "case-data:assets:read" } :
        action === "media-state" ? { GET: processingScope, PUT: processingScope } : { GET: processingScope } };
  }
  return matchReleaseRoute(pathname) ?? matchProjectDataRoute(pathname);
}

function parse(schema, input, path) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CaseRequestError("请求字段无效", parsed.error.issues.slice(0, 20).map((issue) => ({
      code: issue.code, message: issue.message, path: [path, ...issue.path].join("."),
    })));
  }
  return parsed.data;
}

async function readBody(request) {
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

function createAssetHttp(pool, storage) {
  const assets = createCaseAssets(pool, storage);
  const media = createAssetMediaReads(pool, storage);
  return async (request, route, clientId, writeMetadata) => {
    if (!storage) throw new CaseAssetError(503, "ASSET_STORAGE_UNAVAILABLE", "案例对象存储暂不可用");
    const action = route.assetAction;
    const method = request.method;
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
    const creating = action === "create";
    const schema = creating ? CaseCreateUploadBodySchema : CaseCompleteUploadBodySchema;
    const { operationId, traceId, ...input } = parse(schema, await readBody(request), "body");
    Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
    if (creating) {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      const path = `/api/v1/cases/${caseId}/uploads`;
      return writeCaseOnce(pool, { clientId, operationId, method, path, payload: input }, async (client) => {
        const body = await createCaseUpload(client, storage, caseId, clientId, input);
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

export function createCaseHttp(pool, storage, releaseReads, publicEnabled) {
  const aggregate = createCaseAggregate(pool);
  const assets = createAssetHttp(pool, storage);
  const releases = createReleaseHttp(pool, storage, releaseReads, publicEnabled, { parse, readBody });
  const projectData = createProjectDataHttp(pool, { parse, readBody });
  return async (request, route, clientId, writeMetadata) => {
    const method = request.method;
    if (route.releaseAction) return releases(request, route, clientId, writeMetadata);
    if (route.projectData) return projectData(request, route, clientId, writeMetadata);
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
      return operation ? { status: 200, body: operation } :
        { status: 404, body: { code: "NOT_FOUND", message: "操作结果不存在", details: [] } };
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
    if (method === "POST") {
      const projectId = parse(CaseUuidSchema, route.projectId, "path.projectId");
      const { operationId, traceId, externalProjectId, ...input } = parse(CaseCreateBodySchema, rawBody, "body");
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
      if (projectId !== externalProjectId) throw new CaseRequestError("路径项目 ID 与 externalProjectId 不一致");
      return writeCaseOnce(pool, {
        clientId, operationId, method, path: `/api/v1/projects/${projectId}/cases`, payload: input,
      }, async (client) => ({ status: 201, body: await insertCase(client, { ...input, sourceProjectId: projectId }) }));
    }

    const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
    const { operationId, traceId, operatorUserKey, expectedVersion, ...patch } = parse(CasePatchBodySchema, rawBody, "body");
    Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey });
    return writeCaseOnce(pool, {
      clientId, operationId, method, path: `/api/v1/cases/${caseId}`, payload: { operatorUserKey, expectedVersion, ...patch },
    }, async (client) => ({ status: 200, body: await patchCase(client, caseId, expectedVersion, patch) }));
  };
}
