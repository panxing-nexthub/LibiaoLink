/**
 * AI 项目总结读面（GET /projects/{id}/ai-context）回归：
 * 项目启动时间口径、阶段日期兜底、未分组任务统计、姓名解析、图片只计数、排序与契约自校验。
 * 用假服务注入，不连数据库。
 */
import { describe, expect, it } from "vitest";
import { ProjectAiContextSchema } from "@libiaolink/contracts";
import type { ChangeService } from "../src/modules/file/index.js";
import type { UserService } from "../src/modules/identity/index.js";
import type { FlowService, ProjectService } from "../src/modules/project/index.js";
import type { IssueService, ReportService } from "../src/modules/report-issue/index.js";
import type { TaskService } from "../src/modules/task/index.js";
import { ProjectAiContextService } from "../src/modules/project-ai/project-ai-context.service.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADVANCER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_STARTUP_LATE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TASK_STARTUP_EARLY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TASK_STAGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TASK_UNGROUPED = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CHANGE_ID = "99999999-9999-4999-8999-999999999999";

function taskRow(overrides: Record<string, unknown>) {
  return {
    id: TASK_STAGE,
    projectId: PROJECT_ID,
    stageKey: "presale",
    sortIndex: 0,
    nodeId: null,
    sourceNodeId: null,
    title: "任务",
    titleEn: null,
    ownerIds: [MANAGER_ID],
    managerIds: [MANAGER_ID],
    status: "active",
    displayStatus: "active",
    progress: 0.5,
    plannedStart: "2026-01-10",
    plannedEnd: "2026-01-20",
    actualEnd: null,
    estimatedDays: 3,
    headcount: 2,
    priority: "中",
    deliverableTypes: [],
    note: null,
    onTime: null,
    finalizedAt: null,
    changeLinks: [],
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerNames: ["负责人甲"],
    managerNames: ["项目经理乙"],
    fileSummary: { total: 0, draft: 0, final: 0 },
    ...overrides,
  };
}

describe("ProjectAiContextService", () => {
  it("按定稿口径聚合项目 / 阶段 / 任务 / 变更 / 日报 / 问题", async () => {
    const tasks = [
      // 启动任务两条，取最早的 plannedStart；
      // 阶段兜底：plannedStart 取最早、plannedEnd / actualEnd 取最晚。
      taskRow({
        id: TASK_STARTUP_LATE,
        title: "项目启动",
        status: "done",
        displayStatus: "done",
        plannedStart: "2026-01-05",
        plannedEnd: "2026-01-08",
        actualEnd: "2026-01-09",
        changeLinks: [{ id: CHANGE_ID, reason: "客户要求提前", appliedAt: "2026-02-01T02:00:00.000Z" }],
      }),
      taskRow({
        id: TASK_STARTUP_EARLY,
        title: "Project Startup",
        titleEn: "Project Startup",
        status: "done",
        displayStatus: "early_done",
        plannedStart: "2026-01-03",
        plannedEnd: "2026-01-06",
        actualEnd: "2026-01-07",
      }),
      taskRow({
        id: TASK_STAGE,
        title: "现场安装",
        plannedStart: "2026-01-02",
        plannedEnd: "2026-01-25",
        actualEnd: "2026-01-28",
        note: "发现地面不平，已记录",
      }),
      taskRow({
        id: TASK_UNGROUPED,
        stageKey: null,
        title: "临时整改",
        status: "done",
        displayStatus: "done",
        plannedStart: null,
        plannedEnd: null,
        actualEnd: null,
      }),
    ];

    const changes = [
      {
        id: CHANGE_ID,
        projectId: PROJECT_ID,
        stageKey: "presale",
        changeType: "file_change",
        reason: "客户要求提前",
        beforeSummary: "旧版方案",
        afterSummary: "新版方案",
        appliedBy: ADVANCER_ID,
        appliedAt: "2026-02-01T02:00:00.000Z",
        status: "applied",
      },
    ];

    const issueId = "77777777-7777-4777-8777-777777777777";
    const reports = [
      {
        id: "88888888-8888-4888-8888-888888888888",
        projectId: PROJECT_ID,
        authorId: MANAGER_ID,
        authorName: "填写者甲",
        date: "2026-01-12",
        state: "submitted",
        headcount: 5,
        doneWork: "完成前段安装",
        plan: "继续后段",
        foundIssue: null,
        issueCategories: [],
        suggestion: null,
        stageKeys: ["presale"],
        stageNames: ["售前规划"],
        photos: [{ fileId: "a1", name: "1.jpg" }, { fileId: "a2", name: "2.jpg" }],
        issuePhotos: [],
        issueDrafts: [],
        submittedAt: "2026-01-12T10:00:00.000Z",
        createdAt: "2026-01-12T09:00:00.000Z",
        updatedAt: "2026-01-12T10:00:00.000Z",
        version: 1,
      },
    ];

    const issues = [
      {
        id: issueId,
        projectId: PROJECT_ID,
        taskId: TASK_STAGE,
        sourceReportId: reports[0]!.id,
        title: "地面不平",
        categories: ["项目部"],
        state: "open",
        reporterId: MANAGER_ID,
        reporterName: "填写者甲",
        ownerDepartment: "项目部",
        ownerId: null,
        ownerName: null,
        raisedAt: "2026-01-12",
        solution: null,
        photos: [
          { fileId: "b1", name: "1.jpg" },
          { fileId: "b2", name: "2.jpg" },
          { fileId: "b3", name: "3.jpg" },
        ],
        closedBy: null,
        closedAt: null,
        createdAt: "2026-01-12T10:00:00.000Z",
        updatedAt: "2026-01-12T10:00:00.000Z",
        version: 1,
      },
    ];

    const projects = {
      async getProject() {
        return {
          id: PROJECT_ID,
          code: "CNBJ-20260101-0001",
          name: "测试项目",
          region: "华东",
          projectTypes: ["T-sort"],
          status: "active",
          managerNames: ["项目经理乙"],
          stageKey: "presale",
          customer: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      },
    };
    const flow = {
      async listStages() {
        return {
          projectId: PROJECT_ID,
          stageKey: "presale",
          stages: [
            {
              id: "stage-1",
              stageKey: "presale",
              name: "售前规划",
              seq: 1,
              status: "active",
              plannedStart: null,
              plannedEnd: null,
              actualStart: null,
              actualEnd: null,
              nodes: { total: 0, done: 0 },
              tasks: { total: 3, done: 2 },
              advancedAt: "2026-01-09T00:00:00.000Z",
              advancedBy: ADVANCER_ID,
              rolledBackAt: null,
              rolledBackBy: null,
              rollbackReason: null,
              version: 2,
            },
          ],
        };
      },
    };
    const taskService = { async listForExport() { return tasks; } };
    const changeService = { async listProjectChangesForExport() { return changes; } };
    const reportService = { async listForExport() { return reports; } };
    const issueService = { async listForExport() { return issues; } };
    const userService = {
      async countForExport() { return 2; },
      async listForExport() {
        return [
          { id: MANAGER_ID, username: "manager", displayName: "项目经理乙" },
          { id: ADVANCER_ID, username: "advancer", displayName: "推进人甲" },
        ];
      },
    };

    const service = new ProjectAiContextService(
      projects as unknown as ProjectService,
      flow as unknown as FlowService,
      taskService as unknown as TaskService,
      changeService as unknown as ChangeService,
      reportService as unknown as ReportService,
      issueService as unknown as IssueService,
      userService as unknown as UserService,
    );

    const context = await service.build(PROJECT_ID, MANAGER_ID);
    // 契约自校验：任何字段漂移先在这里炸。
    expect(() => ProjectAiContextSchema.parse(context)).not.toThrow();

    expect(context.project.startedAt).toBe("2026-01-03");
    expect(context.project.managerNames).toEqual(["项目经理乙"]);

    const stage = context.stages[0]!;
    expect(stage.plannedStart).toBe("2026-01-02");
    expect(stage.plannedEnd).toBe("2026-01-25");
    expect(stage.actualEnd).toBe("2026-01-28");
    expect(stage.actualStart).toBeNull();
    expect(stage.datesFallback).toBe(true);
    expect(stage.taskDoneCount).toBe(2);
    expect(stage.taskTotalCount).toBe(3);
    expect(stage.advancedByName).toBe("推进人甲");

    expect(context.ungroupedTasks).toEqual({ taskDoneCount: 1, taskTotalCount: 1 });
    expect(context.tasks.map((task) => task.taskId)).toEqual([
      TASK_STARTUP_LATE,
      TASK_STARTUP_EARLY,
      TASK_STAGE,
      TASK_UNGROUPED,
    ]);
    expect(context.tasks[2]!.note).toBe("发现地面不平，已记录");
    expect(context.tasks[0]!.changeLinks).toEqual([
      { changeId: CHANGE_ID, reason: "客户要求提前", appliedAt: "2026-02-01T02:00:00.000Z" },
    ]);

    expect(context.changes[0]!.appliedByName).toBe("推进人甲");
    expect(context.reports[0]!.photoCount).toBe(2);
    expect(context.issues[0]!.photoCount).toBe(3);
    expect(context.truncated).toBe(false);
    expect(context.generatedAt).toMatch(/^2026-|^20\d\d-/);
  });

  it("没有「项目启动」任务时 startedAt 为 null，不回落创建时间", async () => {
    const projects = {
      async getProject() {
        return {
          id: PROJECT_ID,
          code: "C",
          name: "P",
          region: "华东",
          projectTypes: [],
          status: "active",
          managerNames: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      },
    };
    const flow = {
      async listStages() { return { projectId: PROJECT_ID, stageKey: "presale", stages: [] }; },
    };
    const empty = { async listForExport() { return []; } };
    const users = { async countForExport() { return 0; }, async listForExport() { return []; } };

    const service = new ProjectAiContextService(
      projects as unknown as ProjectService,
      flow as unknown as FlowService,
      empty as unknown as TaskService,
      { async listProjectChangesForExport() { return []; } } as unknown as ChangeService,
      empty as unknown as ReportService,
      empty as unknown as IssueService,
      users as unknown as UserService,
    );

    const context = await service.build(PROJECT_ID, MANAGER_ID);
    expect(context.project.startedAt).toBeNull();
    expect(context.tasks).toEqual([]);
    expect(context.stages).toEqual([]);
  });
});
