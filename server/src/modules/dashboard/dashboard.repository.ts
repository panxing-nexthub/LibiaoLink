import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { changeRequests } from "../../db/schema/change.js";
import { files, fileLinks } from "../../db/schema/files.js";
import { users } from "../../db/schema/identity.js";
import { projects } from "../../db/schema/projects.js";
import { issues } from "../../db/schema/reports.js";
import { tasks } from "../../db/schema/tasks.js";
import type { ProjectScopeFilter } from "../permission/index.js";

/**
 * 仪表盘聚合仓储（B4 / M7-02 · 平台只读面）：
 * - 只读 projects / tasks / issues / change_requests / users，不 import 任何业务模块；
 * - 一次查询聚合任务桶，避免前端逐项目扇出；可见性统一由 PermissionService.projectScope 传入；
 * - 项目口径与项目列表一致：未回收；归档项目仍计入；排序 createdAt desc → seqNo asc。
 */
export interface DashboardProjectRow {
  id: string;
  name: string;
  managerNames: (string | null)[] | null;
}

/** 全部项目维度统计的项目行（2026-11-21；只读；供聚合与图表下钻列表使用）。 */
export interface DashboardAnalyticsProjectRow {
  id: string;
  code: string;
  name: string;
  projectType: string;
  additionalProjectTypes: string[];
  stageKey: string;
  status: string;
  managerIds: string[];
  managerNames: (string | null)[] | null;
}

/** 合同签署 / 技术协议定档任务负责人行（用于销售负责人 / 规划负责人聚合）。 */
export interface DashboardProjectRoleTaskRow {
  projectId: string;
  title: string;
  titleEn: string | null;
  ownerIds: string[];
  ownerNames: (string | null)[] | null;
}

/** 项目启动任务实际完成日期（多条取最晚，用于启动年份）。 */
export interface DashboardProjectStartupRow {
  projectId: string;
  startupCompletedAt: string | null;
}

export interface DashboardTaskBucketRow {
  projectId: string;
  stageKey: string | null;
  progressBin: number;
  displayStatus: string;
  deliveryBucket: number | null;
  count: number;
}

export interface DashboardIssueRow {
  projectId: string;
  state: string;
  categories: string[];
}

/** 问题图表下钻行（全部可见项目）。 */
export interface DashboardIssueDetailRow {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  title: string;
  state: string;
  categories: string[];
  reporterName: string | null;
  ownerName: string | null;
  raisedAt: string;
  solution: string | null;
  photos: Array<{ fileId: string; name: string }>;
}

export interface DashboardChangeRow {
  projectId: string;
  reason: string;
}

/** 问题下钻的提出人 / 责任人显示名。 */
const DASHBOARD_ISSUE_REPORTER = alias(users, "dashboard_issue_reporter");
const DASHBOARD_ISSUE_OWNER = alias(users, "dashboard_issue_owner");

/** 项目经理姓名数组：与 manager_ids 同下标；缺失 / 停用用户该位为 null。 */
const MANAGER_NAMES_SQL = sql<(string | null)[] | null>`(
  select array_agg(u.display_name order by m.ord)
  from unnest(${projects.managerIds}) with ordinality as m(uid, ord)
  left join ${users} u on u.id = m.uid
)`;

/** 旧库没有 additional_project_types 列时按空数组返回；新库有列时正常展开。 */
const ADDITIONAL_PROJECT_TYPES_SQL = sql<string[]>`coalesce(
  (
    select array_agg(value order by ordinality)
    from jsonb_array_elements_text(to_jsonb(${projects}) -> 'additional_project_types') with ordinality as item(value, ordinality)
  ),
  array[]::text[]
)`;

/** 任务负责人姓名数组：与 owner_ids 同下标；缺失 / 停用用户该位为 null。 */
const OWNER_NAMES_SQL = sql<(string | null)[] | null>`(
  select array_agg(u.display_name order by o.ord)
  from unnest(${tasks.ownerIds}) with ordinality as o(uid, ord)
  left join ${users} u on u.id = o.uid
)`;

/**
 * 展示态派生（与 task.rules 的 deriveDisplayStatus 严格同形；dashboard 属平台模块，不能 import task 领域模块）。
 * 改口径必须同步 task.rules / task.repository / 本文件三处，并由 dashboard 回归测试做同形校验。
 */
function displayStatusExpression(today: string): SQL<string> {
  const early = "early_done";
  const done = "done";
  const overdue = "overdue";
  return sql<string>`case
    when ${tasks.statusOverride} = ${early} and ${tasks.status} = ${done} then ${early}
    when ${tasks.statusOverride} = ${overdue} and ${tasks.status} <> ${done} then ${overdue}
    when ${tasks.status} = ${done} then (case
      when ${tasks.actualEnd} is not null and ${tasks.plannedEnd} is not null and ${tasks.actualEnd} < ${tasks.plannedEnd} then ${early}
      else ${done}
    end)
    when ${tasks.plannedEnd} is not null and ${tasks.plannedEnd} < ${today}::date then ${overdue}
    else ${tasks.status}
  end`;
}

/** 是否按时交付（与 task.rules 的 deriveOnTime 严格同形）。 */
function onTimeExpression(today: string): SQL<boolean | null> {
  return sql<boolean | null>`case
    when ${tasks.status} = ${"done"} then (case
      when ${tasks.actualEnd} is not null and ${tasks.plannedEnd} is not null then ${tasks.actualEnd} <= ${tasks.plannedEnd}
      when ${tasks.actualEnd} is null and ${tasks.plannedEnd} is not null and ${tasks.plannedEnd} < ${today}::date then false
      else ${tasks.onTime}
    end)
    when ${tasks.plannedEnd} is not null and ${tasks.plannedEnd} < ${today}::date then false
    else ${tasks.onTime}
  end`;
}

/** 交付结果桶：0 按时交付 / 1 逾期已交付 / 2 逾期未交付；null = 未到交付节点。 */
function deliveryBucketExpression(today: string): SQL<number | null> {
  const displayStatus = displayStatusExpression(today);
  const onTime = onTimeExpression(today);
  return sql<number | null>`case
    when (${displayStatus}) = ${"overdue"} then 2
    when (${displayStatus}) in (${"done"}, ${"early_done"}) then (case
      when (${onTime}) = false then 1
      when (${onTime}) = true then 0
      else null
    end)
    else null
  end`;
}

function scopeCondition(column: typeof projects.id | typeof tasks.projectId | typeof issues.projectId | typeof changeRequests.projectId, scope: ProjectScopeFilter): SQL[] {
  return scope.kind === "ids" && scope.ids.length > 0 ? [inArray(column, scope.ids)] : [];
}

/** 仪表盘聚合数据访问（只读、跨项目；空可见集不查库）。 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 可见项目（未回收；归档仍计入）及项目经理姓名，顺序与项目列表默认排序一致。 */
  async listProjects(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardProjectRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [isNull(projects.deletedAt), ...scopeCondition(projects.id, scope)];
    return client
      .select({ id: projects.id, name: projects.name, managerNames: MANAGER_NAMES_SQL })
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.createdAt), asc(projects.seqNo));
  }

  /** 全部项目维度统计的项目行：编号 / 名称 / 类型 / 状态 / 项目经理。 */
  async listAnalyticsProjects(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardAnalyticsProjectRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [isNull(projects.deletedAt), ...scopeCondition(projects.id, scope)];
    return client
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        projectType: projects.projectType,
        additionalProjectTypes: ADDITIONAL_PROJECT_TYPES_SQL,
        stageKey: projects.stageKey,
        status: projects.status,
        managerIds: projects.managerIds,
        managerNames: MANAGER_NAMES_SQL,
      })
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.createdAt), asc(projects.seqNo));
  }

  /** 合同签署 / 技术协议定档任务的负责人；多任务、多负责人原样返回，由纯规则去重。 */
  async listProjectRoleTasks(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardProjectRoleTaskRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [
      isNull(tasks.deletedAt),
      isNull(projects.deletedAt),
      sql`(
        btrim(${tasks.title}) in ('合同签署', '技术协议定档')
        or lower(btrim(coalesce(${tasks.titleEn}, ''))) in ('contract signing', 'technical agreement finalization')
      )`,
      ...scopeCondition(tasks.projectId, scope),
    ];
    return client
      .select({
        projectId: tasks.projectId,
        title: tasks.title,
        titleEn: tasks.titleEn,
        ownerIds: tasks.ownerIds,
        ownerNames: OWNER_NAMES_SQL,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...conditions));
  }

  /** 每个项目的启动时间 =「项目启动 / Project Startup」任务实际完成日期最晚值。 */
  async listProjectStartupDates(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardProjectStartupRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [
      isNull(tasks.deletedAt),
      isNull(projects.deletedAt),
      sql`(
        btrim(${tasks.title}) = '项目启动'
        or lower(btrim(coalesce(${tasks.titleEn}, ''))) = 'project startup'
      )`,
      ...scopeCondition(tasks.projectId, scope),
    ];
    return client
      .select({
        projectId: tasks.projectId,
        startupCompletedAt: sql<string | null>`max(${tasks.actualEnd})`,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...conditions))
      .groupBy(tasks.projectId);
  }

  /** 任务桶：项目 × 阶段 × 进度档 × 展示态 × 交付桶一次 GROUP BY，任务只取未软删行。 */
  async listTaskBuckets(scope: ProjectScopeFilter, today: string, client: DbClient = this.database.db): Promise<DashboardTaskBucketRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const progressBin = sql<number>`(round(${tasks.progress} * 4))::int`;
    const displayStatus = displayStatusExpression(today);
    const deliveryBucket = deliveryBucketExpression(today);
    const conditions: SQL[] = [isNull(tasks.deletedAt), isNull(projects.deletedAt), ...scopeCondition(tasks.projectId, scope)];
    const rows = await client
      .select({
        projectId: tasks.projectId,
        stageKey: tasks.stageKey,
        progressBin,
        displayStatus,
        deliveryBucket,
        count: count(),
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...conditions))
      // 按选择列序号分组：展示态 / 交付桶表达式内含占位符，SELECT 与 GROUP BY 会各渲染一份不同参数，
      // PostgreSQL 不会把两段参数化表达式视作同一表达式（即使取值相同）。
      .groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`);
    return rows.map((row) => ({
      projectId: row.projectId,
      stageKey: row.stageKey,
      progressBin: Number(row.progressBin),
      displayStatus: row.displayStatus,
      deliveryBucket: row.deliveryBucket === null ? null : Number(row.deliveryBucket),
      count: Number(row.count),
    }));
  }

  /** 问题原始计数行（项目 × 状态 × 多归类由纯规则展开；不返回问题明细）。 */
  async listIssueRows(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardIssueRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [isNull(projects.deletedAt), ...scopeCondition(issues.projectId, scope)];
    return client
      .select({ projectId: issues.projectId, state: issues.state, categories: issues.categories })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(and(...conditions));
  }

  /** 问题图表下钻：按当前可见项目范围返回只读问题行，不在聚合结果里夹带图片签名。 */
  async listIssueDetails(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardIssueDetailRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [isNull(projects.deletedAt), ...scopeCondition(issues.projectId, scope)];
    const rows = await client
      .select({
        id: issues.id,
        projectId: issues.projectId,
        projectCode: projects.code,
        projectName: projects.name,
        title: issues.title,
        state: issues.state,
        categories: issues.categories,
        reporterName: DASHBOARD_ISSUE_REPORTER.displayName,
        ownerName: DASHBOARD_ISSUE_OWNER.displayName,
        raisedAt: issues.raisedAt,
        solution: issues.solution,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .leftJoin(DASHBOARD_ISSUE_REPORTER, eq(DASHBOARD_ISSUE_REPORTER.id, issues.reporterId))
      .leftJoin(DASHBOARD_ISSUE_OWNER, eq(DASHBOARD_ISSUE_OWNER.id, issues.ownerId))
      .where(and(...conditions))
      .orderBy(desc(issues.raisedAt), desc(issues.createdAt), asc(issues.id));
    if (rows.length === 0) return [];
    const photoRows = await client
      .select({ objectId: fileLinks.objectId, fileId: fileLinks.fileId, name: files.name })
      .from(fileLinks)
      .leftJoin(files, eq(files.id, fileLinks.fileId))
      .where(and(eq(fileLinks.objectType, "issue"), inArray(fileLinks.objectId, rows.map((row) => row.id))))
      .orderBy(fileLinks.createdAt, fileLinks.id);
    const photosByIssue = new Map<string, Array<{ fileId: string; name: string }>>();
    for (const photo of photoRows) {
      const bucket = photosByIssue.get(photo.objectId) ?? [];
      bucket.push({ fileId: photo.fileId, name: photo.name ?? "" });
      photosByIssue.set(photo.objectId, bucket);
    }
    return rows.map((row) => ({ ...row, photos: photosByIssue.get(row.id) ?? [] }));
  }

  /** 变更原因原文（只下发给词频计算；不返回变更明细）。 */
  async listChangeReasons(scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<DashboardChangeRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [isNull(projects.deletedAt), ...scopeCondition(changeRequests.projectId, scope)];
    return client
      .select({ projectId: changeRequests.projectId, reason: changeRequests.reason })
      .from(changeRequests)
      .innerJoin(projects, eq(projects.id, changeRequests.projectId))
      .where(and(...conditions));
  }
}
