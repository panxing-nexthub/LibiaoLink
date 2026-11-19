import { CaseUuidSchema } from "@libiaolink/contracts/case-data";
import { SaveCaseProjectProfileBodySchema, SaveCaseSubjectBodySchema } from "@libiaolink/contracts/case-data/project-data";
import { createProjectDataReads, saveProjectProfile, saveSubject } from "./project-data.mjs";
import { caseErrorResponse, writeCaseOnce } from "./case-write.mjs";

const read = "case-data:project-data:read";
const write = "case-data:project-data:write";

export function matchProjectDataRoute(pathname) {
  const profile = /^\/api\/v1\/projects\/([^/]+)\/profile$/.exec(pathname);
  if (profile) return { projectData: "profile", id: profile[1], path: "/api/v1/projects/{projectId}/profile",
    scopes: { GET: read, PUT: write } };
  if (pathname === "/api/v1/subjects") return { projectData: "subject", path: pathname, scopes: { POST: write } };
  const subject = /^\/api\/v1\/subjects\/([^/]+)$/.exec(pathname);
  if (subject) return { projectData: "subject", id: subject[1], path: "/api/v1/subjects/{subjectId}", scopes: { GET: read } };
  return null;
}

export function createProjectDataHttp(pool, { parse, readBody }) {
  const reads = createProjectDataReads(pool);
  return async (request, route, clientId, writeMetadata) => {
    try {
      const resource = route.projectData;
      const id = route.id === undefined ? undefined : parse(CaseUuidSchema, route.id, "path.id");
      if (request.method === "GET") return { status: 200, body: await reads[resource](id) };
      const profile = resource === "profile";
      const schema = profile ? SaveCaseProjectProfileBodySchema : SaveCaseSubjectBodySchema;
      const { operationId, traceId, ...input } = parse(schema, await readBody(request), "body");
      Object.assign(writeMetadata, { operationId, clientTraceId: traceId, operatorUserKey: input.operatorUserKey });
      const path = profile ? `/api/v1/projects/${id}/profile` : route.path;
      return await writeCaseOnce(pool, { clientId, operationId, method: request.method, path, payload: input },
        (client) => profile ? saveProjectProfile(client, id, input) : saveSubject(client, input));
    } catch (error) {
      return caseErrorResponse(error);
    }
  };
}
