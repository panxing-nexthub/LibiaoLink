import { Injectable } from "@nestjs/common";
import type {
  ProjectAiChange,
  ProjectAiContext,
  ProjectAiIssue,
  ProjectAiMetrics,
  ProjectAiReport,
  ProjectAiStage,
  ProjectAiTask,
} from "@libiaolink/contracts";
import { ChangeService } from "../file/index.js";
import { UserService } from "../identity/index.js";
import { FlowService, ProjectService } from "../project/index.js";
import { IssueService, ReportService } from "../report-issue/index.js";
import { TaskService } from "../task/index.js";
import { DocumentAnalysisService } from "../document-analysis/index.js";

/** 单页读取条数：与导出批次同量级，避免一次拉全表。 */
const PAGE_LIMIT = 200;
/** 单集合读取上限：超出即截断并置 truncated，防止超大项目把上下文撑爆（后续 AI 总结同样有 token 预算）。 */
const MAX_PER_COLLECTION = 2000;
/** 项目启动任务的标题口径（用户确认：这条任务的开始日期 = 项目实际启动时间）。 */
const STARTUP_TITLE_ZH = "项目启动";
const STARTUP_TITLE_EN = "project startup";

type CollectResult<T> = { items: T[]; truncated: boolean };

/** 阶段日期兜底：只兜计划开始 / 计划结束 / 实际结束；实际开始没有可靠来源，保持原值（null）。 */
interface StageDateFallback {
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  used: boolean;
}

function isStartupTask(task: ProjectAiTask): boolean {
  if (task.title.trim() === STARTUP_TITLE_ZH) return true;
  return (task.titleEn ?? "").trim().toLowerCase() === STARTUP_TITLE_EN;
}

/** 日期是 YYYY-MM-DD 字符串，字典序即时间序，直接比较即可（不构造 Date，避免时区偏移）。 */
function minDate(values: readonly (string | null)[]): string | null {
  let result: string | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (result === null || value < result) result = value;
  }
  return result;
}

function maxDate(values: readonly (string | null)[]): string | null {
  let result: string | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (result === null || value > result) result = value;
  }
  return result;
}

/**
 * AI 项目总结读面（只读聚合，不触发任何模型调用）。
 *
 * 数据来源全部复用既有读口（与项目导出同一批 listForExport / FlowService.listStages），
 * 保证 AI 看到的内容与页面 / 导出完全同源，不另写一套 SQL。
 * 字段口径见 shared/src/modules/project-ai.ts 顶部注释与 docs 记录。
 */
@Injectable()
export class ProjectAiContextService {
  constructor(
    private readonly projects: ProjectService,
    private readonly flow: FlowService,
    private readonly tasks: TaskService,
    private readonly changes: ChangeService,
    private readonly reports: ReportService,
    private readonly issues: IssueService,
    private readonly users: UserService,
    private readonly documentAnalyses: DocumentAnalysisService,
  ) {}

  async build(projectId: string, actorId: string): Promise<ProjectAiContext> {
    // 记录级可见性由 ProjectAccessGuard 先判；这里再取一次项目视图（同时兜 404）。
    const project = await this.projects.getProject(projectId, actorId);

    const [stageList, taskResult, changeResult, reportResult, issueResult, fileAnalyses] = await Promise.all([
      this.flow.listStages(projectId),
      this.collect((page, limit) => this.tasks.listForExport(projectId, { page, limit })),
      this.collect((page, limit) => this.changes.listProjectChangesForExport(projectId, { page, limit })),
      this.collect((page, limit) => this.reports.listForExport(projectId, { page, limit })),
      this.collect((page, limit) => this.issues.listForExport(projectId, { page, limit })),
      this.documentAnalyses.forAi(projectId),
    ]);

    const tasks = taskResult.items.map((item): ProjectAiTask => ({
      taskId: item.id,
      stageKey: item.stageKey,
      title: item.title,
      titleEn: item.titleEn,
      note: item.note,
      ownerNames: item.ownerNames,
      managerNames: item.managerNames,
      status: item.status,
      displayStatus: item.displayStatus,
      progress: item.progress,
      plannedStart: item.plannedStart,
      plannedEnd: item.plannedEnd,
      actualEnd: item.actualEnd,
      estimatedDays: item.estimatedDays,
      headcount: item.headcount,
      priority: item.priority,
      deliverableTypes: item.deliverableTypes,
      onTime: item.onTime,
      finalizedAt: item.finalizedAt,
      changeLinks: item.changeLinks.map((link) => ({
        changeId: link.id,
        reason: link.reason,
        appliedAt: link.appliedAt,
      })),
    }));

    const stageSeq = new Map<string, number>();
    for (const stage of stageList.stages) stageSeq.set(stage.stageKey, stage.seq);
    tasks.sort((a, b) => {
      const seqA = a.stageKey === null ? Number.MAX_SAFE_INTEGER : (stageSeq.get(a.stageKey) ?? Number.MAX_SAFE_INTEGER);
      const seqB = b.stageKey === null ? Number.MAX_SAFE_INTEGER : (stageSeq.get(b.stageKey) ?? Number.MAX_SAFE_INTEGER);
      if (seqA !== seqB) return seqA - seqB;
      return a.taskId.localeCompare(b.taskId);
    });

    // 阶段推进 / 回退与变更申请人需要姓名；只在确有 id 时加载用户目录。
    const personIds = new Set<string>();
    for (const stage of stageList.stages) {
      if (stage.advancedBy !== null) personIds.add(stage.advancedBy);
      if (stage.rolledBackBy !== null) personIds.add(stage.rolledBackBy);
    }
    for (const change of changeResult.items) personIds.add(change.appliedBy);
    const personNames = await this.loadPersonNames(personIds);

    const stages = stageList.stages
      .map((stage): ProjectAiStage => {
        const stageTasks = tasks.filter((task) => task.stageKey === stage.stageKey);
        const fallback = this.stageDateFallback(stage, stageTasks);
        return {
          stageKey: stage.stageKey,
          name: stage.name,
          seq: stage.seq,
          status: stage.status,
          plannedStart: stage.plannedStart ?? fallback.plannedStart,
          plannedEnd: stage.plannedEnd ?? fallback.plannedEnd,
          actualStart: stage.actualStart,
          actualEnd: stage.actualEnd ?? fallback.actualEnd,
          taskDoneCount: stage.tasks.done,
          taskTotalCount: stage.tasks.total,
          datesFallback: fallback.used,
          advancedAt: stage.advancedAt,
          advancedByName: stage.advancedBy === null ? null : (personNames.get(stage.advancedBy) ?? null),
          rolledBackAt: stage.rolledBackAt,
          rolledBackByName: stage.rolledBackBy === null ? null : (personNames.get(stage.rolledBackBy) ?? null),
          rollbackReason: stage.rollbackReason,
        };
      })
      .sort((a, b) => a.seq - b.seq);

    const ungrouped = tasks.filter((task) => task.stageKey === null);

    const changes = changeResult.items
      .map((change): ProjectAiChange => ({
        changeId: change.id,
        stageKey: change.stageKey,
        changeType: change.changeType,
        reason: change.reason,
        beforeSummary: change.beforeSummary,
        afterSummary: change.afterSummary,
        appliedAt: change.appliedAt,
        appliedByName: personNames.get(change.appliedBy) ?? null,
        status: change.status,
      }))
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));

    const reports = reportResult.items
      .map((report): ProjectAiReport => ({
        reportId: report.id,
        date: report.date,
        authorName: report.authorName,
        state: report.state,
        doneWork: report.doneWork,
        plan: report.plan,
        headcount: report.headcount,
        stageNames: report.stageNames,
        submittedAt: report.submittedAt,
        // 只记数量：图片识别不在本期范围，问题附图在问题侧单独计数，避免同一张图算两次。
        photoCount: report.photos.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.reportId.localeCompare(b.reportId));

    const issues = issueResult.items
      .map((issue): ProjectAiIssue => ({
        issueId: issue.id,
        title: issue.title,
        categories: issue.categories,
        state: issue.state,
        reporterName: issue.reporterName,
        ownerName: issue.ownerName,
        ownerDepartment: issue.ownerDepartment,
        raisedAt: issue.raisedAt,
        solution: issue.solution,
        closedAt: issue.closedAt,
        sourceReportId: issue.sourceReportId,
        taskId: issue.taskId,
        photoCount: issue.photos.length,
      }))
      .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.issueId.localeCompare(b.issueId));

    // 采集器预先算好的统计：模型只引用、不重算（提示词硬约束）。
    const taskTotal = tasks.length;
    const taskDone = tasks.filter((task) => task.status === "done").length;
    const latestTask = tasks
      .filter((task) => task.stageKey !== null && task.progress >= 0.25)
      .sort((a, b) => (stageSeq.get(b.stageKey!) ?? 0) - (stageSeq.get(a.stageKey!) ?? 0))[0];
    const slowestStageEntry = stages.find(
      (stage) => stage.taskTotalCount > stage.taskDoneCount,
    );
    const metrics: ProjectAiMetrics = {
      taskDone,
      taskTotal,
      percent: taskTotal === 0 ? null : Math.round((taskDone / taskTotal) * 100),
      latestStageKey: latestTask?.stageKey ?? null,
      latestStage: latestTask === undefined ? null : (stages.find((stage) => stage.stageKey === latestTask.stageKey)?.name ?? null),
      slowestStageKey: slowestStageEntry?.stageKey ?? null,
      slowestStage: slowestStageEntry?.name ?? null,
      planStart: minDate(tasks.map((task) => task.plannedStart)),
      planEnd: maxDate(tasks.map((task) => task.plannedEnd)),
      reportStart: reports[0]?.date ?? null,
      reportEnd: reports[reports.length - 1]?.date ?? null,
      issueTotal: issues.length,
      issueDone: issues.filter((issue) => issue.state === "done").length,
      issueInProgress: issues.filter((issue) => issue.state === "in_progress").length,
      issueOpen: issues.filter((issue) => issue.state === "open").length,
      changeTotal: changes.length,
    };

    return {
      metrics,
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        region: project.region,
        projectTypes: project.projectTypes,
        status: project.status,
        managerNames: project.managerNames,
        startedAt: minDate(tasks.filter(isStartupTask).map((task) => task.plannedStart)),
      },
      stages,
      ungroupedTasks: {
        taskDoneCount: ungrouped.filter((task) => task.status === "done").length,
        taskTotalCount: ungrouped.length,
      },
      tasks,
      changes,
      reports,
      issues,
      fileAnalyses,
      generatedAt: new Date().toISOString(),
      truncated:
        taskResult.truncated ||
        changeResult.truncated ||
        reportResult.truncated ||
        issueResult.truncated,
    };
  }

  /** 按页拉取直到取完或触顶；触顶时置 truncated。 */
  private async collect<T>(
    load: (page: number, limit: number) => Promise<T[]>,
  ): Promise<CollectResult<T>> {
    const items: T[] = [];
    for (let page = 1; page <= Math.ceil(MAX_PER_COLLECTION / PAGE_LIMIT) + 1; page += 1) {
      const batch = await load(page, PAGE_LIMIT);
      items.push(...batch);
      if (batch.length < PAGE_LIMIT) break;
      if (items.length >= MAX_PER_COLLECTION) {
        items.length = MAX_PER_COLLECTION;
        return { items, truncated: true };
      }
    }
    if (items.length > MAX_PER_COLLECTION) {
      items.length = MAX_PER_COLLECTION;
      return { items, truncated: true };
    }
    return { items, truncated: false };
  }

  /** 阶段日期兜底：阶段表原值为空时，用该阶段任务的最早 / 最晚日期补位。 */
  private stageDateFallback(
    stage: { plannedStart: string | null; plannedEnd: string | null; actualEnd: string | null },
    stageTasks: readonly ProjectAiTask[],
  ): StageDateFallback {
    const plannedStart = minDate(stageTasks.map((task) => task.plannedStart));
    const plannedEnd = maxDate(stageTasks.map((task) => task.plannedEnd));
    const actualEnd = maxDate(stageTasks.map((task) => task.actualEnd));
    const used =
      (stage.plannedStart === null && plannedStart !== null) ||
      (stage.plannedEnd === null && plannedEnd !== null) ||
      (stage.actualEnd === null && actualEnd !== null);
    return { plannedStart, plannedEnd, actualEnd, used };
  }

  /** 目录姓名映射：用户量级很小（团队内部系统），按页拉全量即可；取不到姓名返回 null 由上层兜「—」。 */
  private async loadPersonNames(ids: ReadonlySet<string>): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (ids.size === 0) return names;
    const total = await this.users.countForExport();
    for (let page = 1; page <= Math.ceil(total / PAGE_LIMIT) + 1; page += 1) {
      const items = await this.users.listForExport({ page, limit: PAGE_LIMIT });
      for (const item of items) names.set(item.id, item.displayName);
      if (items.length < PAGE_LIMIT) break;
    }
    return names;
  }
}
