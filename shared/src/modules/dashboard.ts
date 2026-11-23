import { z } from "../zod.ts";
import { DateOnlySchema, UuidSchema } from "../common/conventions.ts";
import { StageKeySchema, TaskDisplayStatusSchema } from "../common/dicts.ts";
import { IssueCategorySchema, IssueStateSchema } from "./issues.ts";
import { FilePhotoRefSchema } from "./files.ts";

/**
 * 仪表盘聚合读面（B4 · M7-02）：服务端一次算好项目进度 / 任务状态 / 交付时间，
 * 前端不再逐项目拉任务后聚合；问题与词频图按视图懒加载对应聚合端点。
 *
 * 可见性口径与服务端 PermissionService.projectScope 一致：只统计当前会话可见、未进回收站的项目；
 * 任务只统计未软删行。归档项目仍按项目列表既有口径计入（与前端原逐项目聚合一致）。
 */

/** 项目进度：九阶段 + 未分组 × 五档；行顺序固定为契约 STAGE_KEYS 序，未分组只在有任务时落末行。 */
export const DashboardProgressRowSchema = z
  .object({
    key: z.union([StageKeySchema, z.literal("ungrouped")]).openapi({ description: "阶段 key；ungrouped = 临时任务（无阶段）" }),
    label: z.string().openapi({ description: "阶段中文展示名；ungrouped 行为空串，由前端 i18n 补文案" }),
    isUngrouped: z.boolean(),
    counts: z.array(z.number().int().min(0)).length(5).openapi({ description: "进度五档计数（0 / 0.25 / 0.5 / 0.75 / 1，与前端 DASHBOARD_BINS 同序）" }),
    total: z.number().int().min(0),
  })
  .openapi("DashboardProgressRow");

export const DashboardProgressSchema = z
  .object({
    rows: z.array(DashboardProgressRowSchema),
    totalTasks: z.number().int().min(0),
  })
  .openapi("DashboardProgress", { description: "阶段 × 进度五档分布（九阶段固定存在；未分组行按需出现）" });

/** 任务状态展示序：进行中 / 已完成 / 待开始 / 提前完成 / 已延期（0 条状态不下发）。 */
export const DASHBOARD_STATUS_ORDER = ["active", "done", "pending", "early_done", "overdue"] as const;

export const DashboardStatusSliceSchema = z
  .object({
    status: TaskDisplayStatusSchema,
    count: z.number().int().min(0),
  })
  .openapi("DashboardStatusSlice");

export const DashboardStatusSchema = z
  .object({
    slices: z.array(DashboardStatusSliceSchema),
    totalTasks: z.number().int().min(0),
  })
  .openapi("DashboardStatus", { description: "任务五态分布（只含 count > 0 的状态）" });

/** 交付结果展示序：按时交付 / 逾期已交付 / 逾期未交付。 */
export const DASHBOARD_DELIVERY_ORDER = ["on_time", "late_delivered", "late_pending"] as const;

export const DashboardDeliverySchema = z
  .object({
    counts: z.array(z.number().int().min(0)).length(3).openapi({ description: "三档计数，顺序 = 按时交付 / 逾期已交付 / 逾期未交付" }),
    total: z.number().int().min(0).openapi({ description: "已交付合计（三档之和，按时率分母）" }),
    onTimeRate: z.number().int().min(0).max(100).nullable().openapi({ description: "按时率百分比取整；分母 0 时为 null" }),
    pendingCount: z.number().int().min(0).openapi({ description: "未到交付节点任务数（进行中 / 待开始 / 完成但未判定）" }),
  })
  .openapi("DashboardDelivery");

export const DashboardTaskSummarySchema = z
  .object({
    progress: DashboardProgressSchema,
    status: DashboardStatusSchema,
    delivery: DashboardDeliverySchema,
  })
  .openapi("DashboardTaskSummary");

export const DashboardProjectProgressSchema = z
  .object({
    projectId: UuidSchema,
    projectName: z.string(),
    managerNames: z.array(z.string().nullable()).openapi({ description: "项目经理显示名（与 managerIds 同下标；取不到姓名该位为 null）" }),
    summary: DashboardTaskSummarySchema,
  })
  .openapi("DashboardProjectProgress");

export const DashboardProgressResponseSchema = z
  .object({
    all: DashboardTaskSummarySchema.openapi({ description: "全部可见项目合计" }),
    byProject: z.array(DashboardProjectProgressSchema).openapi({ description: "逐项目统计；顺序与项目列表默认排序一致（createdAt desc、seqNo asc）" }),
  })
  .openapi("DashboardProgressResponse", { description: "仪表盘任务聚合读面（项目进度 / 任务状态 / 交付时间）" });

export const DashboardIssueCountSchema = z
  .object({
    state: IssueStateSchema,
    category: IssueCategorySchema,
    count: z.number().int().min(0),
  })
  .openapi("DashboardIssueCount");

export const DashboardIssuesSchema = z
  .object({
    states: z.array(IssueStateSchema).openapi({ description: "有数据的问题状态（展示序：done / in_progress / open；0 条不出现）" }),
    categories: z.array(IssueCategorySchema).openapi({ description: "有数据的问题归类（契约 C9 原序；0 条不出现）" }),
    counts: z.array(DashboardIssueCountSchema).openapi({ description: "状态 × 归类计数；一条问题多归类时每个归类各计一次" }),
    totalIssues: z.number().int().min(0).openapi({ description: "问题总数（明细行数口径；与柱高合计可能不同）" }),
  })
  .openapi("DashboardIssues");

export const DashboardIssueProjectSchema = z
  .object({
    projectId: UuidSchema,
    issues: DashboardIssuesSchema,
  })
  .openapi("DashboardIssueProject");

/** 问题图表下钻行：只读展示用，不携带图片签名或写操作。 */
export const DashboardIssueRecordSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    projectCode: z.string(),
    projectName: z.string(),
    title: z.string(),
    state: IssueStateSchema,
    categories: z.array(IssueCategorySchema),
    reporterName: z.string().nullable(),
    ownerName: z.string().nullable(),
    raisedAt: DateOnlySchema,
    solution: z.string().nullable(),
    photos: z.array(FilePhotoRefSchema).openapi({ description: "问题附图引用；预览地址按需走文件预览接口" }),
  })
  .openapi("DashboardIssueRecord");

export const DashboardIssuesResponseSchema = z
  .object({
    all: DashboardIssuesSchema,
    byProject: z.array(DashboardIssueProjectSchema).openapi({ description: "只含有问题记录的项目；没有问题的项目由前端补空统计" }),
    details: z.array(DashboardIssueRecordSchema).openapi({ description: "全部可见项目的问题下钻行；一条问题只出现一次" }),
  })
  .openapi("DashboardIssuesResponse", { description: "仪表盘问题分布与问题图表下钻读面" });

/**
 * 全部项目维度统计（2026-11-21 业务口径）：项目数量按启动年份 × 项目类型、三类负责人 × 最新阶段、
 * 启动年份 × 最新阶段。只下发聚合结果，不下发项目明细。
 *
 * 口径：
 * - 启动年份 = 标题为「项目启动 / Project Startup」的任务实际完成日期所属年份；多条取最晚，未完成 = null。
 * - 最新阶段 = 未归档且未暂停项目取项目空间同一口径的任务派生「最新阶段」（已动工任务中阶段序最靠后者），无动工任务回落 projects.stage_key；暂停项目统一落 paused，归档项目统一落 archive_handover，不再按归档类型拆分。
 * - 三类负责人 = 项目经理（projects.manager_ids）、销售负责人（合同签署任务负责人）、
 *   规划负责人（技术协议定档任务负责人）。同一项目同一人多条命中只计一次。
 */
export const DashboardProjectStageBucketSchema = z
  .union([
    StageKeySchema,
    z.enum(["paused", "archive_handover"]),
  ])
  .openapi("DashboardProjectStageBucket", {
    description: "项目最新阶段桶：九阶段 key，或 paused（暂停）/ archive_handover（归档-移交售后）",
  });

export const DashboardProjectRoleSchema = z
  .enum(["manager", "sales", "planning"])
  .openapi("DashboardProjectRole", { description: "manager = 项目经理，sales = 销售负责人，planning = 规划负责人" });

export const DashboardProjectTypeYearSchema = z
  .object({
    year: z.number().int().min(1900).max(9999).nullable().openapi({ description: "启动年份；null = 项目启动任务未完成 / 无启动时间" }),
    counts: z.array(z.number().int().min(0)).length(3).openapi({ description: "与 projectTypes 同序的三类项目数量" }),
    total: z.number().int().min(0),
  })
  .openapi("DashboardProjectTypeYear");

export const DashboardProjectRolePersonSchema = z
  .object({
    personId: UuidSchema.nullable().openapi({ description: "人员账号 id；待分配 = null" }),
    name: z.string().nullable().openapi({ description: "人员显示名；账号姓名缺失 = null" }),
    isUnassigned: z.boolean(),
    stageCounts: z.array(z.number().int().min(0)).length(11).openapi({ description: "与 stageBuckets 同序的项目数量" }),
    total: z.number().int().min(0),
  })
  .openapi("DashboardProjectRolePerson");

export const DashboardProjectRoleStatsSchema = z
  .object({
    role: DashboardProjectRoleSchema,
    people: z.array(DashboardProjectRolePersonSchema).openapi({ description: "按项目总数降序；待分配行（若有）置末" }),
  })
  .openapi("DashboardProjectRoleStats");

export const DashboardProjectStartYearStageSchema = z
  .object({
    year: z.number().int().min(1900).max(9999).nullable().openapi({ description: "启动年份；null = 未记录启动时间" }),
    stageCounts: z.array(z.number().int().min(0)).length(11).openapi({ description: "与 stageBuckets 同序的项目数量" }),
    total: z.number().int().min(0),
  })
  .openapi("DashboardProjectStartYearStage");

export const DashboardProjectOwnerSchema = z
  .object({
    personId: UuidSchema,
    name: z.string().nullable(),
  })
  .openapi("DashboardProjectOwner");

/** 全部项目图表的项目下钻行。 */
export const DashboardProjectSummarySchema = z
  .object({
    id: UuidSchema,
    code: z.string(),
    name: z.string(),
    projectTypes: z.array(z.string()).openapi({ description: "项目命中的全部类型（去重，保留输入顺序）" }),
    stageBucket: DashboardProjectStageBucketSchema,
    startupAt: DateOnlySchema.nullable().openapi({ description: "项目启动任务实际完成日期；null = 未记录" }),
    startupYear: z.number().int().min(1900).max(9999).nullable(),
    owners: z
      .object({
        manager: z.array(DashboardProjectOwnerSchema),
        sales: z.array(DashboardProjectOwnerSchema),
        planning: z.array(DashboardProjectOwnerSchema),
      })
      .openapi({ description: "三类负责人的去重人员；空数组 = 待分配" }),
  })
  .openapi("DashboardProjectSummary");

export const DashboardProjectAnalyticsResponseSchema = z
  .object({
    totalProjects: z.number().int().min(0),
    projectTypes: z.array(z.string()).length(3).openapi({ description: "固定顺序：T-sort / 3D分拣 / 飞箱" }),
    stageBuckets: z.array(DashboardProjectStageBucketSchema).length(11).openapi({ description: "固定顺序：九阶段 + 暂停 / 归档-移交售后" }),
    typeByYear: z.array(DashboardProjectTypeYearSchema).openapi({ description: "年份升序，未记录启动时间置末；多类型项目在每个命中类型各计一次" }),
    roles: z.array(DashboardProjectRoleStatsSchema).length(3).openapi({ description: "固定顺序：项目经理 / 销售负责人 / 规划负责人" }),
    startYearStages: z.array(DashboardProjectStartYearStageSchema).openapi({ description: "年份升序，未记录启动时间置末" }),
    projects: z.array(DashboardProjectSummarySchema).openapi({ description: "全部可见项目的下钻行；顺序与项目列表默认排序一致" }),
  })
  .openapi("DashboardProjectAnalyticsResponse", { description: "全部项目维度聚合读面（项目数量 / 负责人 / 启动年份 × 最新阶段，附项目下钻行）" });

export const DashboardWordSchema = z
  .object({
    word: z.string(),
    count: z.number().int().min(1),
  })
  .openapi("DashboardWord");

export const DashboardChangeWordsSchema = z
  .object({
    words: z.array(DashboardWordSchema).openapi({ description: "核心词频（count 降序、同频按词面排序）" }),
    totalChanges: z.number().int().min(0),
  })
  .openapi("DashboardChangeWords");

export const DashboardWordProjectSchema = z
  .object({
    projectId: UuidSchema,
    words: DashboardChangeWordsSchema,
  })
  .openapi("DashboardWordProject");

export const DashboardChangeWordsResponseSchema = z
  .object({
    all: DashboardChangeWordsSchema,
    byProject: z.array(DashboardWordProjectSchema).openapi({ description: "只含有变更记录的项目；没有变更的项目由前端补空统计" }),
  })
  .openapi("DashboardChangeWordsResponse", { description: "仪表盘变更原因核心词频聚合读面" });

export type DashboardProgress = z.infer<typeof DashboardProgressSchema>;
export type DashboardProgressRow = z.infer<typeof DashboardProgressRowSchema>;
export type DashboardStatus = z.infer<typeof DashboardStatusSchema>;
export type DashboardStatusSlice = z.infer<typeof DashboardStatusSliceSchema>;
export type DashboardDelivery = z.infer<typeof DashboardDeliverySchema>;
export type DashboardTaskSummary = z.infer<typeof DashboardTaskSummarySchema>;
export type DashboardProjectProgress = z.infer<typeof DashboardProjectProgressSchema>;
export type DashboardProgressResponse = z.infer<typeof DashboardProgressResponseSchema>;
export type DashboardIssues = z.infer<typeof DashboardIssuesSchema>;
export type DashboardProjectStageBucket = z.infer<typeof DashboardProjectStageBucketSchema>;
export type DashboardProjectRole = z.infer<typeof DashboardProjectRoleSchema>;
export type DashboardProjectAnalyticsResponse = z.infer<typeof DashboardProjectAnalyticsResponseSchema>;
export type DashboardIssueCount = z.infer<typeof DashboardIssueCountSchema>;
export type DashboardIssuesResponse = z.infer<typeof DashboardIssuesResponseSchema>;
export type DashboardChangeWords = z.infer<typeof DashboardChangeWordsSchema>;
export type DashboardChangeWordsResponse = z.infer<typeof DashboardChangeWordsResponseSchema>;
