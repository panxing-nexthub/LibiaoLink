import { CaseUuidSchema } from "@libiaolink/contracts/case-data";
import { ActivateCaseReleaseBodySchema, DeactivateCaseReleaseBodySchema,
  StageCaseReleaseBodySchema } from "@libiaolink/contracts/case-data/releases";
import { CaseAssetError } from "./case-asset-storage.mjs";
import { activateCaseRelease, CasePublicReleaseReadError, CaseReleaseBusyError,
  deactivateCaseRelease, parseReleaseListQuery, stageCaseRelease } from "./case-releases.mjs";
import { caseErrorResponse, writeCaseOnce } from "./case-write.mjs";
import { errorCode } from "./database-credentials.mjs";

const releaseWrite = "case-data:releases:write";
const releasePublic = "case-data:releases:read";

export function matchReleaseRoute(pathname) {
  const collection = /^\/api\/v1\/cases\/([^/]+)\/releases$/.exec(pathname);
  if (collection) return { path: "/api/v1/cases/{caseId}/releases",
    scopes: { GET: "case-data:releases:history:read", POST: releaseWrite },
    releaseAction: "collection", allowQuery: true, caseId: collection[1] };
  const author = /^\/api\/v1\/cases\/([^/]+)\/releases\/([^/]+)(?:\/(activate|deactivate))?$/.exec(pathname);
  if (author) {
    const action = author[3];
    const common = { caseId: author[1], releaseId: author[2] };
    if (action) return { ...common, path: `/api/v1/cases/{caseId}/releases/{releaseId}/${action}`,
      scopes: { POST: releaseWrite }, releaseAction: action };
    return { ...common, path: "/api/v1/cases/{caseId}/releases/{releaseId}",
      scopes: { GET: "case-data:releases:history:read" }, releaseAction: "history" };
  }
  const published = /^\/api\/v1\/public\/cases\/([^/]+)\/releases\/([^/]+)(?:\/assets\/([^/]+)\/content)?$/.exec(pathname);
  if (published) {
    const common = { caseId: published[1], releaseId: published[2], scopes: { GET: releasePublic }, publicRelease: true };
    if (published[3]) return { ...common, path: "/api/v1/public/cases/{caseId}/releases/{releaseId}/assets/{assetVersionId}/content",
      releaseAction: "publishedAsset", assetVersionId: published[3] };
    return { ...common, path: "/api/v1/public/cases/{caseId}/releases/{releaseId}", releaseAction: "published" };
  }
  return null;
}

const requestSchemas = { stage: StageCaseReleaseBodySchema, activate: ActivateCaseReleaseBodySchema,
  deactivate: DeactivateCaseReleaseBodySchema };

function releaseFailure(status, code, message, headers) {
  return { status, body: { code, message, details: [] }, headers };
}

async function readPublishedAsset(storage, asset) {
  const unavailable = () => new CaseAssetError(503, "ASSET_STORAGE_UNAVAILABLE", "案例对象存储暂不可用");
  if (!storage) throw unavailable();
  const ticket = await storage.downloadTicket({ ...asset, fileName: "asset" });
  // S3 票据仅供网关取流。下一次公开请求仍须经过 active 读面。
  const upstream = await fetch(ticket.url, {
    redirect: "error", headers: { "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(15_000),
  })
    .catch(() => { throw unavailable(); });
  if (upstream.status !== 200 || !upstream.body || upstream.headers.get("x-amz-version-id") !== asset.objectVersionId
      || Number(upstream.headers.get("content-length")) !== asset.sizeBytes
      || ![null, "identity"].includes(upstream.headers.get("content-encoding"))) {
    await upstream.body?.cancel();
    if (upstream.status === 404) throw new CaseAssetError(404, "NOT_FOUND", "发布素材对象版本不存在");
    throw unavailable();
  }
  return { status: 200, stream: upstream.body, headers: { "Content-Type": "application/octet-stream",
    "Content-Disposition": "attachment", "Content-Length": String(asset.sizeBytes), "X-Content-Type-Options": "nosniff" } };
}

export function createReleaseHttp(pool, storage, reads, publicEnabled, { parse, readBody, cursorKey }) {
  return async (request, route, clientId, writeMetadata) => {
    try {
      const caseId = parse(CaseUuidSchema, route.caseId, "path.caseId");
      const action = route.releaseAction === "collection" ?
        (request.method === "GET" ? "list" : "stage") : route.releaseAction;
      const releaseId = action === "stage" || action === "list" ? null :
        parse(CaseUuidSchema, route.releaseId, "path.releaseId");
      if (route.publicRelease) {
        if (!publicEnabled) return releaseFailure(503, "PUBLIC_RELEASE_UNAVAILABLE", "发布读面暂不可用");
        if (action === "published") return { status: 200, body: await reads.published(caseId, releaseId) };
        const assetVersionId = parse(CaseUuidSchema, route.assetVersionId, "path.assetVersionId");
        const result = await readPublishedAsset(storage, await reads.publishedAsset(caseId, releaseId, assetVersionId));
        return { ...result, resourceId: assetVersionId };
      }
      if (action === "list") {
        const query = parseReleaseListQuery(new URL(request.url, "http://case-gateway.local").searchParams, cursorKey);
        return { status: 200, body: await reads.list(caseId, query), resourceId: caseId };
      }
      if (action === "history") return { status: 200, body: await reads.history(caseId, releaseId) };
      if (action === "stage" && new URL(request.url, "http://case-gateway.local").searchParams.size !== 0) {
        return releaseFailure(422, "VALIDATION_FAILED", "发布 staging 不接受查询参数");
      }

      const { operationId, traceId, ...input } = parse(requestSchemas[action], await readBody(request), "body");
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
      const collection = `/api/v1/cases/${caseId}/releases`;
      const path = action === "stage" ? collection : `${collection}/${releaseId}/${action}`;
      return await writeCaseOnce(pool, { clientId, operationId, method: request.method, path, payload: input }, async (client) => {
        if (action === "stage") {
          const body = await stageCaseRelease(client, caseId, clientId, input);
          return { status: 201, body, resourceId: body.releaseId };
        }
        const body = action === "activate" ? await activateCaseRelease(client, storage, caseId, releaseId, input) :
          await deactivateCaseRelease(client, caseId, releaseId, input);
        return { status: 200, body, resourceId: body.releaseId };
      });
    } catch (error) {
      if (error instanceof CaseReleaseBusyError) return releaseFailure(409, "RELEASE_SWITCH_IN_PROGRESS", error.message, { "Retry-After": 1 });
      if (error instanceof CasePublicReleaseReadError) {
        console.error(JSON.stringify({ event: "published_release_read_failed", databaseCode: errorCode(error.cause) }));
        return releaseFailure(503, "PUBLIC_RELEASE_UNAVAILABLE", error.message);
      }
      if (error instanceof CaseAssetError) return releaseFailure(error.status, error.code, error.message);
      return caseErrorResponse(error);
    }
  };
}
