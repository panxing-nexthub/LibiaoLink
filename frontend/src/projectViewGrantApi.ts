import type { components } from "../../shared/generated/api-types.js";
import { apiRequest, apiSend } from "./api";

export type ProjectViewGrantPreview = components["schemas"]["ProjectViewGrantPreview"];
export type ProjectViewGrantList = components["schemas"]["ProjectViewGrantList"];

function grantPath(projectId: string): string {
  return "/api/v1/projects/" + encodeURIComponent(projectId) + "/view-grants";
}

export function listProjectViewGrants(projectId: string): Promise<ProjectViewGrantList> {
  return apiRequest(grantPath(projectId));
}

export function previewProjectViewGrants(projectId: string, text: string): Promise<ProjectViewGrantPreview> {
  return apiSend(grantPath(projectId) + "/preview", "POST", { text });
}

export function addProjectViewGrants(projectId: string, userIds: string[]): Promise<components["schemas"]["ProjectViewGrantAddResult"]> {
  return apiSend(grantPath(projectId), "POST", { userIds });
}

export function revokeProjectViewGrant(projectId: string, userId: string): Promise<void> {
  return apiSend(grantPath(projectId) + "/" + encodeURIComponent(userId), "DELETE");
}
