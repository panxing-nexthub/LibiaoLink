import { z } from "../zod.ts";
import { DateOnlySchema, DateTimeSchema, UuidSchema } from "../common/conventions.ts";
import { ChangeStatusSchema, DeliverableTypeSchema, PrioritySchema, ProjectStatusSchema, StageStatusSchema, TaskBaseStatusSchema, TaskDisplayStatusSchema } from "../common/dicts.ts";
import { StageKeySchema } from "../common/dicts.ts";
import { ProjectTypesSchema } from "./projects.ts";
import { TaskProgressSchema } from "./tasks.ts";
import { IssueCategoryListSchema, IssueStateSchema } from "./issues.ts";
import { DailyReportStateSchema } from "./reports.ts";
import { ChangeTypeSchema } from "./files.ts";

/**
 * AI 项目总结读面（只读聚合）：项目 / 阶段 / 任务当前快照 / 变更 / 日报 / 问题。
 *
 * 口径（2026-11-22 定稿）：
 * - 项目不取客户、创建时间、成员名册；启动时间 = 任务名为「项目启动 / Project Startup」的最早 plannedStart（实际口径）。
 * - 阶段不取节点明细与节点计数；阶段日期为空时用该阶段任务日期兜底（plannedStart=min、plannedEnd=max、actualEnd=max；
 *   actualStart 无可靠来源，保持 null），datesFallback=true 表示至少一项来自任务兜底。
 * - 任务只给当前快照，不取 task_events 变更历史与变更原因；任务描述（note）只作自然语言补充。
 * - 日报 / 问题只取文字字段与附图数量，图片识别与文件正文提取不在本期范围。
 * - 所有字段为空时保持 null / 空数组，由下游总结明确写「暂无数据」，不得编造。
 */
export const ProjectAiProjectSchema = z
  .object({
    id: UuidSchema,
    code: z.string().openapi({ description: "项目编号" }),
    name: z.string().openapi({ description: "项目名称" }),
    region: z.string().openapi({ description: "项目落地地区（字典 region）" }),
    projectTypes: ProjectTypesSchema.openapi({ description: "项目类型（多选）" }),
    status: ProjectStatusSchema.openapi({ description: "项目状态" }),
    managerNames: z.array(z.string().nullable()).openapi({ description: "项目经理姓名（与 managerIds 同下标）" }),
    startedAt: DateOnlySchema.nullable().openapi({
      description:
        "项目启动时间：任务名 = 「项目启动」或 titleEn = 「Project Startup」的任务最早 plannedStart（用户确认口径 = 实际开始）；找不到为 null，不回落 projects.createdAt",
    }),
  })
  .openapi("ProjectAiProject");

export const ProjectAiStageSchema = z
  .object({
    stageKey: StageKeySchema,
    name: z.string(),
    seq: z.number().int().positive(),
    status: StageStatusSchema,
    plannedStart: DateOnlySchema.nullable(),
    plannedEnd: DateOnlySchema.nullable(),
    actualStart: DateOnlySchema.nullable(),
    actualEnd: DateOnlySchema.nullable(),
    taskDoneCount: z.number().int().min(0).openapi({ description: "本阶段 status=done 的任务数（不含「未分组」任务）" }),
    taskTotalCount: z.number().int().min(0).openapi({ description: "本阶段任务总数（不含「未分组」任务）" }),
    datesFallback: z.boolean().openapi({
      description: "true = plannedStart / plannedEnd / actualEnd 至少一项由该阶段任务日期兜底（阶段表原值为空）",
    }),
    advancedAt: DateTimeSchema.nullable().openapi({ description: "最近一次阶段推进时间（无留痕为 null）" }),
    advancedByName: z.string().nullable(),
    rolledBackAt: DateTimeSchema.nullable().openapi({ description: "最近一次阶段回退时间（无留痕为 null）" }),
    rolledBackByName: z.string().nullable(),
    rollbackReason: z.string().nullable().openapi({ description: "最近一次回退原因（无留痕为 null）" }),
  })
  .openapi("ProjectAiStage");

export const ProjectAiTaskChangeLinkSchema = z
  .object({
    changeId: UuidSchema,
    reason: z.string().nullable(),
    appliedAt: DateTimeSchema,
  })
  .openapi("ProjectAiTaskChangeLink");

export const ProjectAiTaskSchema = z
  .object({
    taskId: UuidSchema,
    stageKey: StageKeySchema.nullable().openapi({ description: "所属阶段；null = 未分组" }),
    title: z.string().openapi({ description: "任务名称" }),
    titleEn: z.string().nullable(),
    note: z.string().nullable().openapi({ description: "任务描述（自然语言补充，不解析结构化字段）" }),
    ownerNames: z.array(z.string().nullable()).openapi({ description: "任务负责人姓名；空数组 = 待分配" }),
    managerNames: z.array(z.string().nullable()).openapi({ description: "本任务项目经理姓名" }),
    status: TaskBaseStatusSchema.openapi({ description: "存储基础态（完成判定口径）" }),
    displayStatus: TaskDisplayStatusSchema.openapi({ description: "展示五态（读时派生）" }),
    progress: TaskProgressSchema,
    plannedStart: DateOnlySchema.nullable(),
    plannedEnd: DateOnlySchema.nullable(),
    actualEnd: DateOnlySchema.nullable(),
    estimatedDays: z.number().int().min(0).nullable(),
    headcount: z.number().int().min(0).nullable(),
    priority: PrioritySchema.nullable(),
    deliverableTypes: z.array(DeliverableTypeSchema),
    onTime: z.boolean().nullable(),
    finalizedAt: DateTimeSchema.nullable(),
    changeLinks: z.array(ProjectAiTaskChangeLinkSchema),
  })
  .openapi("ProjectAiTask");

export const ProjectAiChangeSchema = z
  .object({
    changeId: UuidSchema,
    stageKey: StageKeySchema.nullable(),
    changeType: ChangeTypeSchema,
    reason: z.string().openapi({ description: "变更原因（系统必填，真实数据）" }),
    beforeSummary: z.string().nullable(),
    afterSummary: z.string().nullable(),
    appliedAt: DateTimeSchema,
    appliedByName: z.string().nullable(),
    status: ChangeStatusSchema,
  })
  .openapi("ProjectAiChange");

export const ProjectAiReportSchema = z
  .object({
    reportId: UuidSchema,
    date: DateOnlySchema,
    authorName: z.string().nullable(),
    state: DailyReportStateSchema,
    doneWork: z.string(),
    plan: z.string().nullable(),
    headcount: z.number().int().min(0).nullable(),
    stageNames: z.array(z.string()),
    submittedAt: DateTimeSchema.nullable(),
    photoCount: z.number().int().min(0).openapi({ description: "现场工作附图数量（不识别图片内容）" }),
  })
  .openapi("ProjectAiReport");

export const ProjectAiIssueSchema = z
  .object({
    issueId: UuidSchema,
    title: z.string().openapi({ description: "问题描述" }),
    categories: IssueCategoryListSchema,
    state: IssueStateSchema,
    reporterName: z.string().nullable(),
    ownerName: z.string().nullable(),
    ownerDepartment: z.string().nullable(),
    raisedAt: DateOnlySchema,
    solution: z.string().nullable(),
    closedAt: DateTimeSchema.nullable(),
    sourceReportId: UuidSchema.nullable(),
    taskId: UuidSchema.nullable(),
    photoCount: z.number().int().min(0).openapi({ description: "问题附图数量（不识别图片内容）" }),
  })
  .openapi("ProjectAiIssue");

/**
 * 采集器预先算好的项目统计。模型**只能引用、不能重算**（提示词硬约束）：
 * 完成百分比不得由 done/total 反推、最新 / 最慢阶段不得由模型自行判断。
 */
export const ProjectAiMetricsSchema = z
  .object({
    taskDone: z.number().int().min(0),
    taskTotal: z.number().int().min(0),
    percent: z.number().int().min(0).max(100).nullable().openapi({ description: "完成百分比；total = 0 时为 null" }),
    latestStageKey: StageKeySchema.nullable().openapi({ description: "已动工任务（progress ≥ 0.25）中阶段序最靠后者；无则 null" }),
    latestStage: z.string().nullable().openapi({ description: "最新阶段中文名，与 latestStageKey 对应" }),
    slowestStageKey: StageKeySchema.nullable().openapi({ description: "阶段序中第一个仍有未完成任务的阶段；无则 null" }),
    slowestStage: z.string().nullable().openapi({ description: "最慢阶段中文名，与 slowestStageKey 对应" }),
    planStart: DateOnlySchema.nullable().openapi({ description: "任务计划开始的最早日期" }),
    planEnd: DateOnlySchema.nullable().openapi({ description: "任务计划结束的最晚日期" }),
    reportStart: DateOnlySchema.nullable().openapi({ description: "日报最早日期；无日报为 null" }),
    reportEnd: DateOnlySchema.nullable().openapi({ description: "日报最晚日期；无日报为 null" }),
    issueTotal: z.number().int().min(0),
    issueDone: z.number().int().min(0),
    issueInProgress: z.number().int().min(0),
    issueOpen: z.number().int().min(0),
    changeTotal: z.number().int().min(0),
  })
  .openapi("ProjectAiMetrics");

export const ProjectAiContextSchema = z
  .object({
    project: ProjectAiProjectSchema,
    metrics: ProjectAiMetricsSchema,
    stages: z.array(ProjectAiStageSchema),
    ungroupedTasks: z
      .object({ taskDoneCount: z.number().int().min(0), taskTotalCount: z.number().int().min(0) })
      .openapi({ description: "stageKey 为空的任务（不计入任何阶段，避免阶段加总对不上）" }),
    tasks: z.array(ProjectAiTaskSchema),
    changes: z.array(ProjectAiChangeSchema),
    reports: z.array(ProjectAiReportSchema),
    issues: z.array(ProjectAiIssueSchema),
    generatedAt: DateTimeSchema,
    truncated: z.boolean().openapi({ description: "true = 任务 / 日报 / 问题 / 变更任一集合超出读取上限被截断" }),
  })
  .openapi("ProjectAiContext", {
    description: "AI 项目总结读面（只读聚合；不触发任何模型调用）",
  });

export type ProjectAiContext = z.infer<typeof ProjectAiContextSchema>;
export type ProjectAiMetrics = z.infer<typeof ProjectAiMetricsSchema>;
export type ProjectAiProject = z.infer<typeof ProjectAiProjectSchema>;
export type ProjectAiStage = z.infer<typeof ProjectAiStageSchema>;
export type ProjectAiTask = z.infer<typeof ProjectAiTaskSchema>;
export type ProjectAiChange = z.infer<typeof ProjectAiChangeSchema>;
export type ProjectAiReport = z.infer<typeof ProjectAiReportSchema>;
export type ProjectAiIssue = z.infer<typeof ProjectAiIssueSchema>;

/* ------------------------------------------------------------------ *
 * AI 项目总结生成（POST /projects/{id}/ai-summary）· REPORT_SCHEMA v2
 * ------------------------------------------------------------------ */

/** 结论类型：事实 / 推断 / 建议（提示词要求逐条标注，推断与建议不得标成事实）。 */
export const ProjectAiClaimTypeSchema = z.enum(["fact", "inference", "suggestion"]).openapi("ProjectAiClaimType");

/** 来源标签：只用业务名称 + 日期（如「任务记录 2026-10-20」），不得出现表名 / 字段名 / 内部 ID。 */
export const ProjectAiSourceSchema = z.string().min(1).max(100).openapi("ProjectAiSource");

export const ProjectAiClaimSchema = z
  .object({
    text: z.string().min(1).max(1000),
    type: ProjectAiClaimTypeSchema,
    sources: z.array(ProjectAiSourceSchema).min(1).max(10),
  })
  .openapi("ProjectAiClaim");

export const ProjectAiTimelineItemSchema = z
  .object({
    date: z.string().max(20).openapi({ description: "业务日期 YYYY-MM-DD；仅记录已有日期" }),
    title: z.string().min(1).max(100),
    text: z.string().min(1).max(600),
    type: ProjectAiClaimTypeSchema,
    sources: z.array(ProjectAiSourceSchema).min(1).max(10),
  })
  .openapi("ProjectAiTimelineItem");

export const ProjectAiIssueItemSchema = z
  .object({
    text: z.string().min(1).max(600),
    owner: z.string().max(100).openapi({ description: "责任人；未记录写「未记录」" }),
    handling: z.string().max(600).openapi({ description: "已知处理情况；未记录写「未记录」" }),
    nextStep: z.string().max(300).openapi({ description: "已知下一步；未记录写「未记录」" }),
    type: ProjectAiClaimTypeSchema,
    sources: z.array(ProjectAiSourceSchema).min(1).max(10),
  })
  .openapi("ProjectAiIssueItem");

export const ProjectAiRangeSchema = z
  .object({ from: z.string().max(20).nullable(), to: z.string().max(20).nullable() })
  .openapi("ProjectAiRange");

/** 正式报告结构（提示词 REPORT_SCHEMA v2；summary_text = summary.text）。 */
export const ProjectAiSummaryReportSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.object({
      text: z.string().min(1).max(2000).openapi({ description: "250～400 字项目摘要" }),
      claims: z.array(ProjectAiClaimSchema).max(20),
    }),
    overview: z.object({
      projectName: z.string().max(200),
      projectCode: z.string().max(100),
      status: z.string().max(20).openapi({ description: "进行中 / 已暂停 / 已归档 / 已完成（中文，不输出状态码）" }),
      managers: z.array(z.string().max(100)).max(10),
      startedAt: z.string().max(20).openapi({ description: "YYYY-MM-DD 或「未记录」" }),
      progress: z.object({
        done: z.number().int().min(0),
        total: z.number().int().min(0),
        percent: z.number().int().min(0).max(100).nullable(),
        latestStage: z.string().max(50),
        slowestStage: z.string().max(50),
      }),
      planRange: ProjectAiRangeSchema,
      reportRange: ProjectAiRangeSchema,
    }),
    timeline: z.array(ProjectAiTimelineItemSchema).max(8),
    issues: z.object({
      total: z.number().int().min(0),
      done: z.number().int().min(0),
      inProgress: z.number().int().min(0),
      open: z.number().int().min(0),
      summary: z.string().max(1000),
      currentItems: z.array(ProjectAiIssueItemSchema).max(50),
    }),
    resultsAndRisks: z.object({
      text: z.string().max(1500),
      claims: z.array(ProjectAiClaimSchema).max(20),
      risks: z.array(ProjectAiClaimSchema).max(20),
    }),
    handoff: z.object({
      existing: z
        .array(
          z.object({
            text: z.string().min(1).max(600),
            owner: z.string().max(100),
            nextStep: z.string().max(300),
            type: ProjectAiClaimTypeSchema,
            sources: z.array(ProjectAiSourceSchema).min(1).max(10),
          }),
        )
        .max(20),
      suggestions: z
        .array(
          z.object({
            text: z.string().min(1).max(600),
            reason: z.string().max(600),
            nextStep: z.string().max(300),
            acceptance: z.string().max(300),
            type: ProjectAiClaimTypeSchema,
            needsHumanConfirmation: z.boolean(),
            sources: z.array(ProjectAiSourceSchema).min(1).max(10),
          }),
        )
        .max(20),
    }),
    notes: z.array(ProjectAiClaimSchema).max(20),
  })
  .openapi("ProjectAiSummaryReport");

export const ProjectAiSummarySchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    sourceHash: z.string().openapi({ description: "生成时的项目上下文指纹（sha256）" }),
    promptVersion: z.string(),
    modelId: z.string().nullable(),
    summaryText: z.string().openapi({ description: "= report.summary.text，列表展示用" }),
    report: ProjectAiSummaryReportSchema.openapi({ description: "结构化正式报告（REPORT_SCHEMA v2）" }),
    generatedBy: UuidSchema.nullable(),
    generatedByName: z.string().nullable(),
    generatedAt: DateTimeSchema,
    stale: z.boolean().openapi({ description: "true = 当前项目数据已变化，缓存结果落后；可重新生成" }),
  })
  .openapi("ProjectAiSummary");

/** 生成入参：force=true 忽略缓存强制重新生成（模型失败不覆盖已有缓存）。 */
export const ProjectAiSummaryGenerateBodySchema = z
  .object({
    force: z.boolean().default(false).openapi({ description: "true = 忽略缓存重新生成" }),
  })
  .openapi("ProjectAiSummaryGenerateBody");

export type ProjectAiSummaryReport = z.infer<typeof ProjectAiSummaryReportSchema>;
export type ProjectAiClaim = z.infer<typeof ProjectAiClaimSchema>;
export type ProjectAiSummary = z.infer<typeof ProjectAiSummarySchema>;
export type ProjectAiSummaryGenerateBody = z.infer<typeof ProjectAiSummaryGenerateBodySchema>;
