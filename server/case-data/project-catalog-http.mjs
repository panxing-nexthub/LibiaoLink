import { PatchLocalCaseProjectBodySchema, RegisterLocalCaseProjectBodySchema } from "@libiaolink/contracts/case-data/project-catalog";
import { CaseUuidSchema } from "@libiaolink/contracts/case-data";
import { writeCaseOnce } from "./case-write.mjs";

export function createProjectCatalogHttp(pool, catalog, { parse, readBody }) {
  async function register(request, clientId, writeMetadata) {
    const { operationId, traceId, ...input } = parse(
      RegisterLocalCaseProjectBodySchema, await readBody(request), "body",
    );
    Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
    return writeCaseOnce(pool, {
      clientId, operationId, method: request.method, path: "/api/v1/projects", payload: input,
    }, (client) => catalog.registerLocal(client, input));
  }

  async function update(request, clientId, projectIdInput, writeMetadata) {
    const projectId = parse(CaseUuidSchema, projectIdInput, "path.projectId");
    const { operationId, traceId, operatorUserKey, expectedVersion, ...patch } = parse(
      PatchLocalCaseProjectBodySchema, await readBody(request), "body",
    );
    Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey });
    return writeCaseOnce(pool, {
      clientId, operationId, method: request.method, path: `/api/v1/projects/${projectId}`,
      payload: { operatorUserKey, expectedVersion, ...patch },
    }, (client) => catalog.updateLocal(client, projectId, expectedVersion, patch));
  }

  return { register, update };
}
