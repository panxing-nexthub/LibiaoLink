/**
 * 仪表盘聚合回归（B4 / M7-02）：任务桶 / 状态 / 交付 / 问题 / 词频的纯规则，
 * 以及服务层可见性、空项目、逐项目聚合与下钻数据不下发。
 * 展示态 / onTime 与 task.rules 做同形校验，防止 dashboard SQL 与任务读面口径漂移。
 */
import { describe, expect, it } from "vitest";
import { DashboardChangeWordsResponseSchema, DashboardIssuesResponseSchema, DashboardProgressResponseSchema, DashboardProjectAnalyticsResponseSchema } from "@libiaolink/contracts";
import type { PermissionService, ProjectScopeFilter } from "../src/modules/permission/index.js";
import { deriveDisplayStatus, deriveOnTime, type TaskDerivationInput } from "../src/modules/task/task.rules.js";
import type {
  DashboardChangeRow,
  DashboardIssueDetailRow,
  DashboardIssueRow,
  DashboardAnalyticsProjectRow,
  DashboardProjectRoleTaskRow,
  DashboardProjectRow,
  DashboardProjectStartupRow,
  DashboardRepository,
  DashboardTaskBucketRow,
} from "../src/modules/dashboard/dashboard.repository.js";
import {
  addTaskBucket,
  buildChangeWords,
  buildProjectAnalytics,
  buildIssues,
  deliveryBucketOf,
  emptyTaskAggregate,
  taskSummaryOf,
  tokenizeChangeReason,
} from "../src/modules/dashboard/dashboard.rules.js";
import { DashboardService } from "../src/modules/dashboard/dashboard.service.js";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const P4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const P5 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TODAY = "2026-10-21";

class FakeDashboardRepository {
  projectRows: DashboardProjectRow[] = [];
  taskRows: DashboardTaskBucketRow[] = [];
  issueRows: DashboardIssueRow[] = [];
  issueDetailRows: DashboardIssueDetailRow[] = [];
  changeRows: DashboardChangeRow[] = [];
  analyticsProjectRows: DashboardAnalyticsProjectRow[] = [];
  roleTaskRows: DashboardProjectRoleTaskRow[] = [];
  startupRows: DashboardProjectStartupRow[] = [];
  lastTaskScope: ProjectScopeFilter | null = null;
  lastToday: string | null = null;

  async listProjects(): Promise<DashboardProjectRow[]> {
    return this.projectRows;
  }

  async listTaskBuckets(scope: ProjectScopeFilter, today: string): Promise<DashboardTaskBucketRow[]> {
    this.lastTaskScope = scope;
    this.lastToday = today;
    return this.taskRows;
  }

  async listIssueRows(): Promise<DashboardIssueRow[]> {
    return this.issueRows;
  }

  async listIssueDetails(): Promise<DashboardIssueDetailRow[]> {
    return this.issueDetailRows;
  }

  async listChangeReasons(): Promise<DashboardChangeRow[]> {
    return this.changeRows;
  }

  async listAnalyticsProjects(): Promise<DashboardAnalyticsProjectRow[]> {
    return this.analyticsProjectRows;
  }

  async listProjectRoleTasks(): Promise<DashboardProjectRoleTaskRow[]> {
    return this.roleTaskRows;
  }

  async listProjectStartupDates(): Promise<DashboardProjectStartupRow[]> {
    return this.startupRows;
  }
}

class FakePermissionService {
  scope: ProjectScopeFilter = { kind: "all" };

  async projectScope(): Promise<ProjectScopeFilter> {
    return this.scope;
  }
}

function makeService(repo: FakeDashboardRepository, permission: FakePermissionService): DashboardService {
  return new DashboardService(repo as unknown as DashboardRepository, permission as unknown as PermissionService);
}

function taskInput(overrides: Partial<TaskDerivationInput>): TaskDerivationInput {
  return {
    status: "pending",
    statusOverride: null,
    plannedEnd: null,
    actualEnd: null,
    storedOnTime: null,
    today: TODAY,
    ...overrides,
  };
}

describe("仪表盘任务聚合规则", () => {
  it("阶段行固定、未分组按需出现，状态按展示序，交付桶按任务口径", () => {
    const aggregate = emptyTaskAggregate(PROJECT_A);
    addTaskBucket(aggregate, { projectId: PROJECT_A, stageKey: "install", progressBin: 2, displayStatus: "active", deliveryBucket: null, count: 2 });
    addTaskBucket(aggregate, { projectId: PROJECT_A, stageKey: null, progressBin: 0, displayStatus: "pending", deliveryBucket: null, count: 1 });
    addTaskBucket(aggregate, { projectId: PROJECT_A, stageKey: "design", progressBin: 4, displayStatus: "done", deliveryBucket: 0, count: 1 });
    addTaskBucket(aggregate, { projectId: PROJECT_A, stageKey: "design", progressBin: 4, displayStatus: "early_done", deliveryBucket: 1, count: 1 });
    const summary = taskSummaryOf(aggregate);
    expect(summary.progress.totalTasks).toBe(5);
    expect(summary.progress.rows).toHaveLength(10);
    expect(summary.progress.rows.at(-1)).toMatchObject({ key: "ungrouped", isUngrouped: true, total: 1 });
    expect(summary.progress.rows.find((row) => row.key === "install")).toMatchObject({ counts: [0, 0, 2, 0, 0], total: 2 });
    expect(summary.status.slices).toEqual([
      { status: "active", count: 2 },
      { status: "done", count: 1 },
      { status: "pending", count: 1 },
      { status: "early_done", count: 1 },
    ]);
    expect(summary.delivery).toEqual({ counts: [1, 1, 0], total: 2, onTimeRate: 50, pendingCount: 3 });
  });

  it("展示态 + onTime → 交付桶与 task.rules 同形（覆盖 / 完成 / 逾期 / 未判定）", () => {
    const cases: TaskDerivationInput[] = [
      taskInput({ status: "active", plannedEnd: "2026-10-22" }),
      taskInput({ status: "active", plannedEnd: "2026-10-20" }),
      taskInput({ status: "active", plannedEnd: "2026-10-22", statusOverride: "overdue" }),
      taskInput({ status: "done", plannedEnd: "2026-10-22", actualEnd: "2026-10-21" }),
      taskInput({ status: "done", plannedEnd: "2026-10-20", actualEnd: "2026-10-21" }),
      taskInput({ status: "done", plannedEnd: "2026-10-20", actualEnd: null }),
      taskInput({ status: "done", plannedEnd: "2026-10-22", actualEnd: null, storedOnTime: true }),
      taskInput({ status: "done", plannedEnd: "2026-10-22", actualEnd: null, storedOnTime: null }),
      taskInput({ status: "done", plannedEnd: "2026-10-22", actualEnd: "2026-10-21", statusOverride: "early_done" }),
    ];
    for (const input of cases) {
      const status = deriveDisplayStatus(input);
      const onTime = deriveOnTime(input);
      expect(deliveryBucketOf(status, onTime)).toBe(
        status === "overdue" ? 2 : status === "done" || status === "early_done" ? (onTime === false ? 1 : onTime === true ? 0 : null) : null,
      );
    }
  });

  it("问题多归类逐项计数，状态 / 归类按契约序且 0 条不下发", () => {
    const summary = buildIssues([
      { state: "open", categories: ["客户原因", "采购部"] },
      { state: "done", categories: ["机械部"] },
      { state: "in_progress", categories: ["采购部"] },
    ]);
    expect(summary.totalIssues).toBe(3);
    expect(summary.states).toEqual(["done", "in_progress", "open"]);
    expect(summary.categories).toEqual(["机械部", "采购部", "客户原因"]);
    expect(summary.counts).toEqual([
      { state: "done", category: "机械部", count: 1 },
      { state: "in_progress", category: "采购部", count: 1 },
      { state: "open", category: "采购部", count: 1 },
      { state: "open", category: "客户原因", count: 1 },
    ]);
  });

  it("变更原因分词：数字 / 单位 / 核心词最长匹配，占位符剔除", () => {
    expect(tokenizeChangeReason("尺寸 1200mm 改为 1300 mm；原因：客户需求（内容待补）")).toEqual(["尺寸", "1200", "mm", "1300", "mm", "原因", "客户", "需求"]);
    expect(buildChangeWords([{ reason: "客户需求" }, { reason: "客户确认" }])).toEqual({
      words: [
        { word: "客户", count: 2 },
        { word: "确认", count: 1 },
        { word: "需求", count: 1 },
      ],
      totalChanges: 2,
    });
  });
});

describe("全部项目维度聚合", () => {
  it("按启动年份 / 类型 / 三类负责人 / 最新阶段聚合，多类型逐项计数、归档优先", () => {
    const projects: DashboardAnalyticsProjectRow[] = [
      {
        id: PROJECT_A,
        code: "DEMO-A",
        name: "项目 A",
        projectType: "T-sort",
        additionalProjectTypes: ["飞箱"],
        stageKey: "install",
        status: "active",
        managerIds: [P1, P2],
        managerNames: ["张三", "李四"],
        archiveKind: null,
        hasOpenPostArchiveTask: false,
      },
      {
        id: PROJECT_B,
        code: "DEMO-B",
        name: "项目 B",
        projectType: "飞箱",
        additionalProjectTypes: [],
        stageKey: "deploy",
        status: "archived",
        managerIds: [P1],
        managerNames: ["张三"],
        archiveKind: "accepted",
        hasOpenPostArchiveTask: false,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        code: "DEMO-C",
        name: "项目 C",
        projectType: "3D分拣",
        additionalProjectTypes: [],
        stageKey: "presale",
        status: "archived",
        managerIds: [P3],
        managerNames: ["王五"],
        archiveKind: "accepted",
        hasOpenPostArchiveTask: true,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        code: "DEMO-D",
        name: "项目 D",
        projectType: "T-sort",
        additionalProjectTypes: [],
        stageKey: "design",
        status: "archived",
        managerIds: [P2],
        managerNames: ["李四"],
        archiveKind: "unaccepted",
        hasOpenPostArchiveTask: false,
      },
    ];
    const roleTasks: DashboardProjectRoleTaskRow[] = [
      { projectId: PROJECT_A, title: "合同签署", titleEn: null, ownerIds: [P1], ownerNames: ["张三"] },
      { projectId: PROJECT_A, title: "技术协议定档", titleEn: null, ownerIds: [P2, P5], ownerNames: ["李四", "赵六"] },
      { projectId: PROJECT_B, title: "Contract signing", titleEn: "Contract signing", ownerIds: [P3], ownerNames: ["王五"] },
      {
        projectId: "33333333-3333-4333-8333-333333333333",
        title: "技术协议定档",
        titleEn: null,
        ownerIds: [P2],
        ownerNames: ["李四"],
      },
      {
        projectId: "44444444-4444-4444-8444-444444444444",
        title: "技术协议定档",
        titleEn: null,
        ownerIds: [P1],
        ownerNames: ["张三"],
      },
      { projectId: PROJECT_A, title: "合同签署", titleEn: null, ownerIds: [P1], ownerNames: ["张三"] },
    ];
    const startups: DashboardProjectStartupRow[] = [
      { projectId: PROJECT_A, startupCompletedAt: "2025-03-12" },
      { projectId: PROJECT_B, startupCompletedAt: "2025-08-01" },
      { projectId: "33333333-3333-4333-8333-333333333333", startupCompletedAt: "2026-01-20" },
      { projectId: "44444444-4444-4444-8444-444444444444", startupCompletedAt: null },
    ];
    const result = buildProjectAnalytics(projects, roleTasks, startups);
    expect(() => DashboardProjectAnalyticsResponseSchema.parse(result)).not.toThrow();
    expect(result.totalProjects).toBe(4);
    expect(result.projectTypes).toEqual(["T-sort", "3D分拣", "飞箱"]);
    expect(result.stageBuckets).toEqual([
      "presale", "design", "purchase", "assembly", "install", "deploy", "trial", "production", "acceptance",
      "archive_exception", "archive_accepted", "archive_temporary",
    ]);
    expect(result.projects).toHaveLength(4);
    expect(result.projects[0]).toMatchObject({
      id: PROJECT_A,
      code: "DEMO-A",
      name: "项目 A",
      projectTypes: ["T-sort", "飞箱"],
      stageBucket: "install",
      startupAt: "2025-03-12",
      startupYear: 2025,
    });
    expect(result.projects[0]?.owners.manager).toEqual([
      { personId: P1, name: "张三" },
      { personId: P2, name: "李四" },
    ]);
    expect(result.projects[0]?.owners.sales).toEqual([{ personId: P1, name: "张三" }]);
    expect(result.projects[0]?.owners.planning).toEqual([
      { personId: P2, name: "李四" },
      { personId: P5, name: "赵六" },
    ]);
    expect(result.typeByYear).toEqual([
      { year: 2025, counts: [1, 0, 2], total: 3 },
      { year: 2026, counts: [0, 1, 0], total: 1 },
      { year: null, counts: [1, 0, 0], total: 1 },
    ]);
    expect(result.startYearStages.find((row) => row.year === 2025)?.stageCounts).toMatchObject([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    ]);
    expect(result.startYearStages.find((row) => row.year === 2026)?.stageCounts[11]).toBe(1);
    expect(result.startYearStages.find((row) => row.year === null)?.stageCounts[9]).toBe(1);
    const manager = result.roles.find((role) => role.role === "manager");
    const sales = result.roles.find((role) => role.role === "sales");
    const planning = result.roles.find((role) => role.role === "planning");
    expect(manager?.people.find((person) => person.name === "张三")?.stageCounts[4]).toBe(1);
    expect(manager?.people.find((person) => person.name === "张三")?.stageCounts[10]).toBe(1);
    expect(sales?.people.find((person) => person.name === "张三")?.total).toBe(1);
    expect(sales?.people.find((person) => person.isUnassigned)?.stageCounts[9]).toBe(1);
    expect(planning?.people.find((person) => person.name === "李四")?.stageCounts[4]).toBe(1);
    expect(planning?.people.find((person) => person.name === "李四")?.stageCounts[11]).toBe(1);
    expect(planning?.people.find((person) => person.name === "赵六")?.total).toBe(1);
    expect(planning?.people.find((person) => person.isUnassigned)?.stageCounts[10]).toBe(1);
  });

  it("无可见项目返回固定阶段桶 / 类型 / 三类空角色", async () => {
    const repo = new FakeDashboardRepository();
    const permission = new FakePermissionService();
    permission.scope = { kind: "ids", ids: [] };
    const response = await makeService(repo, permission).projectInsights("actor-1");
    expect(() => DashboardProjectAnalyticsResponseSchema.parse(response)).not.toThrow();
    expect(response.totalProjects).toBe(0);
    expect(response.stageBuckets).toHaveLength(12);
    expect(response.roles.map((role) => role.role)).toEqual(["manager", "sales", "planning"]);
    expect(response.roles.every((role) => role.people.length === 0)).toBe(true);
    expect(response.projects).toEqual([]);
  });
});

describe("仪表盘聚合服务", () => {
  it("一次返回全部 / 逐项目任务聚合，保留项目顺序与经理姓名", async () => {
    const repo = new FakeDashboardRepository();
    repo.projectRows = [
      { id: PROJECT_A, name: "项目 A", managerNames: ["张三", null] },
      { id: PROJECT_B, name: "项目 B", managerNames: null },
    ];
    repo.taskRows = [
      { projectId: PROJECT_A, stageKey: "install", progressBin: 2, displayStatus: "active", deliveryBucket: null, count: 2 },
      { projectId: PROJECT_A, stageKey: null, progressBin: 0, displayStatus: "pending", deliveryBucket: null, count: 1 },
      { projectId: PROJECT_B, stageKey: "design", progressBin: 4, displayStatus: "done", deliveryBucket: 0, count: 1 },
    ];
    const permission = new FakePermissionService();
    permission.scope = { kind: "ids", ids: [PROJECT_A, PROJECT_B] };
    const response = await makeService(repo, permission).progress("actor-1");
    expect(() => DashboardProgressResponseSchema.parse(response)).not.toThrow();
    expect(repo.lastTaskScope).toEqual(permission.scope);
    expect(repo.lastToday).toBe(new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10));
    expect(response.byProject.map((project) => project.projectId)).toEqual([PROJECT_A, PROJECT_B]);
    expect(response.byProject[0]?.managerNames).toEqual(["张三", null]);
    expect(response.byProject[1]?.managerNames).toEqual([]);
    expect(response.byProject[0]?.summary.progress.totalTasks).toBe(3);
    expect(response.byProject[1]?.summary.delivery).toEqual({ counts: [1, 0, 0], total: 1, onTimeRate: 100, pendingCount: 0 });
    expect(response.all.progress.totalTasks).toBe(4);
    expect(response.all.status.slices).toEqual([
      { status: "active", count: 2 },
      { status: "done", count: 1 },
      { status: "pending", count: 1 },
    ]);
  });

  it("可见项目为空时直接返回空聚合（九阶段仍固定、无逐项目项）", async () => {
    const repo = new FakeDashboardRepository();
    const permission = new FakePermissionService();
    permission.scope = { kind: "ids", ids: [] };
    const response = await makeService(repo, permission).progress("actor-1");
    expect(response.byProject).toEqual([]);
    expect(response.all.progress.totalTasks).toBe(0);
    expect(response.all.progress.rows).toHaveLength(9);
    expect(repo.lastTaskScope).toBeNull();
  });

  it("没有任务的项目仍出现在逐项目结果里（项目选择器不丢项目）", async () => {
    const repo = new FakeDashboardRepository();
    repo.projectRows = [{ id: PROJECT_A, name: "空项目", managerNames: [] }];
    const response = await makeService(repo, new FakePermissionService()).progress("actor-1");
    expect(response.byProject).toHaveLength(1);
    expect(response.byProject[0]?.summary.progress.totalTasks).toBe(0);
    expect(response.all.progress.totalTasks).toBe(0);
  });

  it("问题图表携带下钻行，问题 / 词频聚合只保留有数据的项目", async () => {
    const repo = new FakeDashboardRepository();
    repo.projectRows = [
      { id: PROJECT_A, name: "项目 A", managerNames: [] },
      { id: PROJECT_B, name: "项目 B", managerNames: [] },
    ];
    repo.issueRows = [
      { projectId: PROJECT_A, state: "open", categories: ["采购部", "客户原因"] },
      { projectId: PROJECT_A, state: "done", categories: ["机械部"] },
    ];
    repo.issueDetailRows = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        projectId: PROJECT_A,
        projectCode: "DEMO-A",
        projectName: "项目 A",
        title: "采购件尺寸不符",
        state: "open",
        categories: ["采购部", "客户原因"],
        reporterName: "张三",
        ownerName: null,
        raisedAt: "2026-10-20",
        solution: null,
        photos: [
          { fileId: "88888888-8888-4888-8888-888888888888", name: "现场问题.jpg" },
        ],
      },
    ];
    repo.changeRows = [
      { projectId: PROJECT_A, reason: "客户需求 1200mm" },
      { projectId: PROJECT_A, reason: "客户确认" },
    ];
    const service = makeService(repo, new FakePermissionService());
    const issues = await service.issues("actor-1");
    expect(() => DashboardIssuesResponseSchema.parse(issues)).not.toThrow();
    expect(issues.all.totalIssues).toBe(2);
    expect(issues.byProject).toEqual([
      {
        projectId: PROJECT_A,
        issues: {
          states: ["done", "open"],
          categories: ["机械部", "采购部", "客户原因"],
          counts: [
            { state: "done", category: "机械部", count: 1 },
            { state: "open", category: "采购部", count: 1 },
            { state: "open", category: "客户原因", count: 1 },
          ],
          totalIssues: 2,
        },
      },
    ]);
    expect(issues.details).toEqual(repo.issueDetailRows);
    const words = await service.changeWords("actor-1");
    expect(() => DashboardChangeWordsResponseSchema.parse(words)).not.toThrow();
    expect(words.all.totalChanges).toBe(2);
    expect(words.all.words[0]).toEqual({ word: "客户", count: 2 });
    expect(words.byProject).toHaveLength(1);
    expect(words.byProject[0]?.projectId).toBe(PROJECT_A);
  });
});
