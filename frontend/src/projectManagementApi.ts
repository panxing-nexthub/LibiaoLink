import { apiRequest, apiSend } from "./api";

/**
 * 项目管理页使用独立接口 /api/v1/project-management-records，不调用 projectApi。
 * projectId / currentStage / startupCompletedAt / arrivalDate / plannedStartDate / plannedEndDate / implementationDays
 * 为服务端按 code 从项目空间实时只读派生的字段，不进入写请求；projectId 用于跳转项目详情。
 * implementationHandedOver 是实施工程师选择器顶部「已移交」按钮的可持久化状态。
 */
export type ProjectManagementMethod =
  | "onsite_installation_guidance"
  | "remote_installation_guidance"
  | "installation_delivery"
  | "remote_guidance"
  | "onsite_guidance";

export type ProjectManagementRecord = {
  id: string;
  code: string;
  name: string;
  projectId: string | null;
  managerIds: string[];
  managerNames: Array<string | null>;
  implementationEngineerIds: string[];
  implementationEngineerNames: Array<string | null>;
  implementationHandedOver: boolean;
  implementationMethod: ProjectManagementMethod | null;
  riskReminder: string | null;
  region: string;
  currentStageOverride: string | null;
  startupCompletedAtOverride: string | null;
  arrivalDateOverride: string | null;
  plannedStartDateOverride: string | null;
  plannedEndDateOverride: string | null;
  implementationDaysOverride: number | null;
  currentStage: string | null;
  startupCompletedAt: string | null;
  arrivalDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  implementationDays: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectManagementWriteInput = {
  code: string;
  name: string;
  managerIds: string[];
  implementationEngineerIds: string[];
  implementationHandedOver: boolean;
  implementationMethod: ProjectManagementMethod | null;
  riskReminder: string | null;
  region: string;
  currentStageOverride: string | null;
  startupCompletedAtOverride: string | null;
  arrivalDateOverride: string | null;
  plannedStartDateOverride: string | null;
  plannedEndDateOverride: string | null;
  implementationDaysOverride: number | null;
};

export async function fetchProjectManagementRecords(): Promise<ProjectManagementRecord[]> {
  const payload = await apiRequest<{ items: ProjectManagementRecord[] }>("/api/v1/project-management-records");
  return payload.items;
}

export function createProjectManagementRecord(input: ProjectManagementWriteInput): Promise<ProjectManagementRecord> {
  return apiSend<ProjectManagementRecord>("/api/v1/project-management-records", "POST", input);
}

export function updateProjectManagementRecord(
  id: string,
  input: ProjectManagementWriteInput,
  version: number,
): Promise<ProjectManagementRecord> {
  return apiSend<ProjectManagementRecord>(
    "/api/v1/project-management-records/" + encodeURIComponent(id),
    "PATCH",
    { ...input, version },
  );
}

export function deleteProjectManagementRecord(id: string, version: number): Promise<{ id: string; deleted: true }> {
  return apiRequest<{ id: string; deleted: true }>("/api/v1/project-management-records/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: { "If-Match": String(version) },
  });
}
