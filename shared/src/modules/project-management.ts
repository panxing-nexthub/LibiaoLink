import { z } from "../zod.ts";
import { UuidSchema } from "../common/conventions.ts";
import { STAGE_KEYS } from "../common/dicts.ts";

/**
 * 项目管理页：独立的项目准备记录。
 * 记录字段只落 project_management_records，与 projects / project_members / project_nodes 无外键、无写入联动；
 * code 与项目空间 projects.code 精确匹配时，服务端只读派生阶段 / 实施日期字段，不写回项目空间。
 * 项目经理候选复用现有项目经理资格名单；实施工程师候选使用启用账号目录，均支持多位。
 */
export const PROJECT_MANAGEMENT_METHODS = [
  "onsite_installation_guidance",
  "remote_installation_guidance",
  "installation_delivery",
  "remote_guidance",
  "onsite_guidance",
] as const;

export const ProjectManagementMethodSchema = z
  .enum(PROJECT_MANAGEMENT_METHODS)
  .openapi("ProjectManagementMethod", {
    description: "实施方式：On-site 安装指导 / Remote 安装指导 / 安装交付 / 远程-指导 / 现场-指导",
  });

export type ProjectManagementMethod = z.infer<typeof ProjectManagementMethodSchema>;

// 无组件 id 的模块内克隆：给这些字段附加描述时不会回写共享 DateOnly / StageKey 组件。
const ProjectManagementDateValueSchema = z.iso.date();
const ProjectManagementStageValueSchema = z.enum(STAGE_KEYS);
const ProjectManagementMethodValueSchema = z.enum(PROJECT_MANAGEMENT_METHODS);

export const PROJECT_MANAGEMENT_MANAGER_LIMIT = 200;
export const PROJECT_MANAGEMENT_ENGINEER_LIMIT = 50;
export const PROJECT_MANAGEMENT_CODE_MAX = 50;
export const PROJECT_MANAGEMENT_NAME_MAX = 200;
export const PROJECT_MANAGEMENT_RISK_MAX = 2000;
export const PROJECT_MANAGEMENT_REGION_MAX = 80;

export const ProjectManagementRecordSchema = z
  .object({
    id: UuidSchema,
    code: z.string().openapi({ description: "项目编号：手填，最长 50 字；允许空串以支持逐格保存" }),
    name: z.string().openapi({ description: "项目名称：手填，最长 200 字；允许空串以支持逐格保存" }),
    managerIds: z.array(UuidSchema).openapi({
      description: "项目经理账号 id 快照；候选复用现有项目经理资格名单，数组顺序 = 展示顺序",
    }),
    managerNames: z.array(z.string().nullable()).openapi({
      description: "项目经理姓名：按 managerIds 顺序解析；账号停用 / 删除后仍保留可解析的姓名，取不到为 null",
    }),
    implementationEngineerIds: z.array(UuidSchema).openapi({
      description: "实施工程师账号 id 快照（0-50 位）；仅允许启用账号，不建立项目成员关系",
    }),
    implementationEngineerNames: z.array(z.string().nullable()).openapi({
      description: "实施工程师姓名：按 implementationEngineerIds 顺序解析；取不到为 null",
    }),
    implementationHandedOver: z.boolean().openapi({
      description: "实施工程师已移交状态：true = 格子直接显示「已移交」，不再显示工程师姓名；前端与服务端均会清空 implementationEngineerIds，重新选择工程师会自动取消该状态",
    }),
    implementationMethod: ProjectManagementMethodValueSchema.nullable().openapi({ description: "实施方式；未填写 = null" }),
    riskReminder: z.string().nullable().openapi({ description: "风险提醒：手填，最长 2000 字；未填写 = null" }),
    region: z.string().openapi({ description: "项目地点字典值；清空时回落为未分类" }),
    currentStageOverride: ProjectManagementStageValueSchema.nullable().openapi({ description: "项目当前阶段人工覆盖值；null = 使用只读自动识别值" }),
    startupCompletedAtOverride: ProjectManagementDateValueSchema.nullable().openapi({ description: "启动时间人工覆盖值；null = 使用只读自动识别值" }),
    arrivalDateOverride: ProjectManagementDateValueSchema.nullable().openapi({ description: "到货日期人工覆盖值；null = 使用只读自动识别值" }),
    plannedStartDateOverride: ProjectManagementDateValueSchema.nullable().openapi({ description: "计划实施开始人工覆盖值；null = 使用只读自动识别值" }),
    plannedEndDateOverride: ProjectManagementDateValueSchema.nullable().openapi({ description: "计划实施完成人工覆盖值；null = 使用只读自动识别值" }),
    implementationDaysOverride: z.number().int().nonnegative().nullable().openapi({ description: "实施天数人工覆盖值；null = 按有效计划实施起止日期自动计算" }),
    currentStage: ProjectManagementStageValueSchema.nullable().openapi({ description: "项目当前阶段（只读派生）：按 code 匹配项目空间后，取已动工任务里阶段序最靠后的「最新阶段」；无匹配项目 = null" }),
    startupCompletedAt: ProjectManagementDateValueSchema.nullable().openapi({ description: "启动时间（只读派生）：项目空间「项目启动 / Project Startup」任务的实际完成日期；无匹配任务 = null" }),
    arrivalDate: ProjectManagementDateValueSchema.nullable().openapi({ description: "到货日期（只读派生）：组装发货阶段全部未删除任务中最晚的实际完成日期；无值 = null" }),
    plannedStartDate: ProjectManagementDateValueSchema.nullable().openapi({ description: "计划实施开始（只读派生）：硬件实施阶段全部未删除任务中最早的计划开始日期；无值 = null" }),
    plannedEndDate: ProjectManagementDateValueSchema.nullable().openapi({ description: "计划实施完成（只读派生）：硬件实施阶段全部未删除任务中最晚的预计完成日期；无值 = null" }),
    implementationDays: z.number().int().nonnegative().nullable().openapi({
      description: "实施天数（只读派生）：计划实施开始至计划实施完成含首尾天数；任一日期为空 = null",
    }),
    version: z.number().int().nonnegative().openapi({ description: "乐观锁版本：更新 / 删除时原样回传" }),
    createdAt: z.iso.datetime().describe("创建时间（ISO 8601）"),
    updatedAt: z.iso.datetime().describe("最后更新时间（ISO 8601）"),
  })
  .openapi("ProjectManagementRecord", {
    description: "项目管理页的独立准备记录：记录字段不进入项目空间；编号匹配项目时附项目空间只读派生字段",
  });

export const ProjectManagementRecordListSchema = z
  .object({
    items: z.array(ProjectManagementRecordSchema),
  })
  .openapi("ProjectManagementRecordList", {
    description: "项目管理记录清单（按创建时间正序，无分页；表格逐格保存后即回显）",
  });

export const ProjectManagementRecordCreateBodySchema = z
  .object({
    code: z.string().max(PROJECT_MANAGEMENT_CODE_MAX).optional(),
    name: z.string().max(PROJECT_MANAGEMENT_NAME_MAX).optional(),
    managerIds: z.array(UuidSchema).max(PROJECT_MANAGEMENT_MANAGER_LIMIT).optional(),
    implementationEngineerIds: z.array(UuidSchema).max(PROJECT_MANAGEMENT_ENGINEER_LIMIT).optional(),
    implementationHandedOver: z.boolean().optional(),
    currentStageOverride: ProjectManagementStageValueSchema.nullable().optional(),
    startupCompletedAtOverride: ProjectManagementDateValueSchema.nullable().optional(),
    arrivalDateOverride: ProjectManagementDateValueSchema.nullable().optional(),
    plannedStartDateOverride: ProjectManagementDateValueSchema.nullable().optional(),
    plannedEndDateOverride: ProjectManagementDateValueSchema.nullable().optional(),
    implementationDaysOverride: z.number().int().nonnegative().nullable().optional(),
    implementationMethod: ProjectManagementMethodValueSchema.nullable().optional(),
    riskReminder: z.string().max(PROJECT_MANAGEMENT_RISK_MAX).nullable().optional(),
    region: z.string().max(PROJECT_MANAGEMENT_REGION_MAX).optional(),
  })
  .openapi("ProjectManagementRecordCreateBody", {
    description: "新建记录：字段按需传入，支持第一笔输入即创建；全空请求返回 400，不生成空白行；项目经理 / 实施工程师由服务端校验账号资格；implementationHandedOver = true 时服务端强制清空实施工程师",
  });

export const ProjectManagementRecordUpdateBodySchema = z
  .object({
    code: z.string().max(PROJECT_MANAGEMENT_CODE_MAX).optional(),
    name: z.string().max(PROJECT_MANAGEMENT_NAME_MAX).optional(),
    managerIds: z.array(UuidSchema).max(PROJECT_MANAGEMENT_MANAGER_LIMIT).optional(),
    implementationEngineerIds: z.array(UuidSchema).max(PROJECT_MANAGEMENT_ENGINEER_LIMIT).optional(),
    implementationHandedOver: z.boolean().optional(),
    currentStageOverride: ProjectManagementStageValueSchema.nullable().optional(),
    startupCompletedAtOverride: ProjectManagementDateValueSchema.nullable().optional(),
    arrivalDateOverride: ProjectManagementDateValueSchema.nullable().optional(),
    plannedStartDateOverride: ProjectManagementDateValueSchema.nullable().optional(),
    plannedEndDateOverride: ProjectManagementDateValueSchema.nullable().optional(),
    implementationDaysOverride: z.number().int().nonnegative().nullable().optional(),
    implementationMethod: ProjectManagementMethodValueSchema.nullable().optional(),
    riskReminder: z.string().max(PROJECT_MANAGEMENT_RISK_MAX).nullable().optional(),
    region: z.string().max(PROJECT_MANAGEMENT_REGION_MAX).optional(),
    version: z.number().int().nonnegative(),
  })
  .openapi("ProjectManagementRecordUpdateBody", {
    description: "局部更新（必须带上 version）；全空结果返回 400，请改用 DELETE；项目经理 / 实施工程师变更时由服务端校验账号资格；已移交优先清空工程师，工程师非空则自动取消已移交",
  });

export const ProjectManagementRecordDeleteResponseSchema = z
  .object({
    id: UuidSchema,
    deleted: z.literal(true),
  })
  .openapi("ProjectManagementRecordDeleteResponse", {
    description: "删除结果：项目管理记录物理删除，不进入项目回收站",
  });

export type ProjectManagementRecord = z.infer<typeof ProjectManagementRecordSchema>;
export type ProjectManagementRecordList = z.infer<typeof ProjectManagementRecordListSchema>;
export type ProjectManagementRecordCreateBody = z.infer<typeof ProjectManagementRecordCreateBodySchema>;
export type ProjectManagementRecordUpdateBody = z.infer<typeof ProjectManagementRecordUpdateBodySchema>;
export type ProjectManagementRecordDeleteResponse = z.infer<typeof ProjectManagementRecordDeleteResponseSchema>;
