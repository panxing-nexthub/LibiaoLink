import type {
  MaterialReissueApplicationDepartment,
  MaterialReissueApproval,
  MaterialReissueDepartment,
  MaterialReissueFreight,
  MaterialReissueReason,
  MaterialReissueSnapshot,
} from "./fileApi";
import { fieldText, type Locale } from "./i18n";

export const MATERIAL_REISSUE_REASON_OPTIONS: ReadonlyArray<{ value: MaterialReissueReason; label: string }> = [
  { value: "missing_list", label: "设备清单/机械清单漏出" },
  { value: "transport_damage", label: "运输过程损坏" },
  { value: "warehouse_shortage", label: "仓库漏发" },
  { value: "customer_misoperation", label: "客户误操作损坏" },
  { value: "customer_change", label: "客户需求变更" },
  { value: "warranty_damage", label: "物料损坏质保期内" },
  { value: "out_of_warranty_damage", label: "物料损坏质保期外" },
  { value: "research_upgrade", label: "产品研发升级更换" },
  { value: "other", label: "其他" },
];

export const MATERIAL_REISSUE_APPLICATION_DEPARTMENT_OPTIONS: ReadonlyArray<{ value: MaterialReissueApplicationDepartment; label: string }> = [
  { value: "project", label: "项目部" },
  { value: "after_sales", label: "售后部" },
  { value: "other", label: "其他" },
];

export const MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_OPTIONS: ReadonlyArray<{ value: MaterialReissueDepartment; label: string }> = [
  { value: "project", label: "项目部" },
  { value: "after_sales", label: "售后部" },
  { value: "warehouse", label: "仓库" },
  { value: "research", label: "研发" },
  { value: "customer", label: "客户" },
  { value: "supplier", label: "供应商" },
  { value: "other", label: "其他" },
];

export const MATERIAL_REISSUE_FREIGHT_OPTIONS: ReadonlyArray<{ value: MaterialReissueFreight; label: string }> = [
  { value: "customer", label: "客户" },
  { value: "libiao", label: "立镖" },
  { value: "with_other_goods", label: "随其他货物一并发出" },
  { value: "carried_by_staff", label: "立镖人员带过去" },
];

export const MATERIAL_REISSUE_APPROVAL_OPTIONS: ReadonlyArray<{ value: MaterialReissueApproval; label: string }> = [
  { value: "yes", label: "是" },
  { value: "no", label: "否" },
  { value: "not_applicable", label: "不涉及" },
];

/**
 * 项目助理任务口径（2026-11-26）：项目内「运输及送仓 / 清关 / 送仓 / 运输」任一任务的负责人
 * 视为项目助理，可查看并登记本项目全部物料补发申请。
 * 与 server/src/modules/file/material-reissue-assistant.ts 保持同步；任务改名或新增物流任务时两处一起改。
 */
export const MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLES = ["运输及送仓", "清关", "送仓", "运输"] as const;

const MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLE_SET: ReadonlySet<string> = new Set(
  MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLES,
);

export function findMaterialReissueProjectAssistantTask<T extends { title: string; ownerIds: readonly string[] }>(
  viewerId: string | null,
  tasks: readonly T[],
): T | null {
  if (viewerId === null) {
    return null;
  }
  return tasks.find(
    (task) => task.ownerIds.includes(viewerId) && MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLE_SET.has(task.title.trim()),
  ) ?? null;
}

export function isMaterialReissueProjectAssistant(
  viewerId: string | null,
  tasks: readonly { title: string; ownerIds: readonly string[] }[],
): boolean {
  return findMaterialReissueProjectAssistantTask(viewerId, tasks) !== null;
}

/**
 * 自动识别项目助理（物料补发表单页脚展示）：项目内「运输及送仓 / 清关 / 送仓 / 运输」任一任务的
 * 负责人去重后按任务顺序返回。与 isMaterialReissueProjectAssistant 同一口径，
 * 仅用于表单提示与本机草稿记忆，不改变服务端权限或提交快照。
 */
export function materialReissueProjectAssistantIds(
  tasks: readonly { title: string; ownerIds: readonly string[] }[],
): string[] {
  const ids: string[] = [];
  for (const task of tasks) {
    if (!MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLE_SET.has(task.title.trim())) {
      continue;
    }
    for (const ownerId of task.ownerIds) {
      if (ownerId !== "" && !ids.includes(ownerId)) {
        ids.push(ownerId);
      }
    }
  }
  return ids;
}

export function materialReissueDefaultEmailTitle(projectCode: string, projectName: string): string {
  return "项目【补发申请】" + projectCode + " " + projectName + "项目/ 紧急";
}

export function materialReissueReasonText(locale: Locale, snapshot: MaterialReissueSnapshot): string {
  const label = MATERIAL_REISSUE_REASON_OPTIONS.find((option) => option.value === snapshot.reason)?.label ?? snapshot.reason;
  const text = fieldText(locale, label);
  return snapshot.reason === "other" && snapshot.reasonOther ? text + "：" + snapshot.reasonOther : text;
}

export function materialReissueApplicationDepartmentText(
  locale: Locale,
  value: MaterialReissueApplicationDepartment,
  other?: string,
): string {
  const label = MATERIAL_REISSUE_APPLICATION_DEPARTMENT_OPTIONS.find((option) => option.value === value)?.label
    ?? MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_OPTIONS.find((option) => option.value === value)?.label
    ?? value;
  const text = fieldText(locale, label);
  return value === "other" && other ? text + "：" + other : text;
}

export function materialReissueDepartmentText(locale: Locale, value: MaterialReissueDepartment, other?: string): string {
  const label = MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_OPTIONS.find((option) => option.value === value)?.label ?? value;
  const text = fieldText(locale, label);
  return value === "other" && other ? text + "：" + other : text;
}

export function materialReissueFreightText(locale: Locale, value: MaterialReissueFreight): string {
  const label = MATERIAL_REISSUE_FREIGHT_OPTIONS.find((option) => option.value === value)?.label ?? value;
  return fieldText(locale, label);
}

export function materialReissueApprovalText(locale: Locale, value: MaterialReissueApproval): string {
  return fieldText(locale, value === "yes" ? "是" : value === "no" ? "否" : "不涉及");
}
