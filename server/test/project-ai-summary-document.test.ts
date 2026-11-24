import { describe, expect, it } from "vitest";
import type { ProjectAiContext, ProjectAiSummaryReport } from "@libiaolink/contracts";
import { ProjectAiContextSchema } from "@libiaolink/contracts";
import { buildSummaryDocument } from "../src/modules/project-ai/project-ai-summary-document.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "a1000000-0000-4000-8000-000000000001";

function context(): ProjectAiContext {
  return {
    project: {
      id: PROJECT_ID,
      code: "C-001",
      name: "测试项目",
      region: "华东",
      projectTypes: ["分拣"],
      status: "active",
      managerNames: ["张三"],
      startedAt: "2026-01-05",
      customer: null,
      description: null,
      partyA: "甲方A",
      projectAddress: "广州市",
      period: {
        planFrom: "2026-01-01",
        planTo: "2026-02-01",
        actualFrom: "2026-01-05",
        actualTo: null,
        actualOngoing: true,
      },
      members: [
        { name: "张三", role: "manager" },
        { name: "李四", role: "task_owner" },
      ],
    },
    metrics: {
      taskDone: 1,
      taskTotal: 2,
      percent: 50,
      latestStageKey: "presale",
      latestStage: "售前规划",
      slowestStageKey: "presale",
      slowestStage: "售前规划",
      planStart: "2026-01-01",
      planEnd: "2026-02-01",
      reportStart: "2026-01-10",
      reportEnd: "2026-01-10",
      issueTotal: 1,
      issueDone: 0,
      issueInProgress: 0,
      issueOpen: 1,
      changeTotal: 0,
    },
    stages: [
      {
        stageKey: "presale",
        name: "售前规划",
        seq: 1,
        status: "active",
        plannedStart: "2026-01-01",
        plannedEnd: "2026-01-15",
        actualStart: "2026-01-05",
        actualEnd: null,
        taskDoneCount: 1,
        taskTotalCount: 2,
        datesFallback: false,
        advancedAt: null,
        advancedByName: null,
        rolledBackAt: null,
        rolledBackByName: null,
        rollbackReason: null,
      },
    ],
    ungroupedTasks: { taskDoneCount: 0, taskTotalCount: 0 },
    tasks: [],
    changes: [],
    reports: [],
    issues: [
      {
        issueId: "22222222-2222-4222-8222-222222222222",
        title: "地面不平",
        categories: ["规划部"],
        state: "open",
        reporterName: "张三",
        ownerName: null,
        ownerDepartment: "规划部",
        raisedAt: "2026-01-10",
        solution: null,
        closedAt: null,
        sourceReportId: null,
        taskId: null,
        photoCount: 1,
        photos: [{ fileId: PHOTO_ID, name: "1.jpg" }],
      },
    ],
    agreement: {
      fileName: "技术协议.docx",
      fileVersionId: "33333333-3333-4333-8333-333333333333",
      partyA: { status: "found", value: "甲方A", evidence: "甲方名称：甲方A", sourcePage: 1, confidence: 0.8 },
      customer: { status: "not_found", value: null, evidence: null, sourcePage: null, confidence: 0 },
      projectAddress: { status: "found", value: "广州市", evidence: "项目地址：广州市", sourcePage: 2, confidence: 0.8 },
      background: { status: "found", value: "背景摘要", evidence: "背景", sourcePage: 2, confidence: 0.6 },
      layout: [{ id: "auto-0", manual: false, pageNo: 12, url: "/api/v1/projects/" + PROJECT_ID + "/ai-agreement-images/layout", caption: "技术协议第 12 页" }],
      threeD: [],
      extractedAt: "2026-01-01T00:00:00.000Z",
    },
    equipment: {
      sourceFileName: "设备清单.xlsx",
      categories: [{ name: "桌子", itemCount: 2, quantities: [{ value: 5, unit: "套" }], representativeItems: ["A", "B"] }],
    },
    reportPhotos: [{ fileId: PHOTO_ID, name: "1.jpg", date: "2026-01-10", authorName: "张三" }],
    issueCategoryStats: [{ category: "规划部", count: 1 }],
    fileAnalyses: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    truncated: false,
  };
}

function report(): ProjectAiSummaryReport {
  return { issues: { summary: "问题总结" } } as unknown as ProjectAiSummaryReport;
}

describe("总结文档确定性补齐（P4）", () => {
  it("基本信息、设备、进度、问题表与来源按采集器数据生成", () => {
    const input = context();
    expect(() => ProjectAiContextSchema.parse(input)).not.toThrow();

    const document = buildSummaryDocument(input, report());

    expect(document.basicInfo).toMatchObject({
      projectCode: "C-001",
      projectName: "测试项目",
      periodText: "2026-01-05 ~ 进行中",
      partyA: "甲方A",
      customer: "未识别",
      address: "广州市",
      members: "张三（项目经理）、李四",
    });
    expect(document.equipmentLayout?.cadImage.url).toContain("/ai-agreement-images/layout");
    expect(document.background).toEqual({ text: "背景摘要" });
    expect(document.equipmentList?.rows).toEqual([
      { category: "桌子", itemCount: 2, quantityText: "5 套", representative: "A、B" },
    ]);
    expect(document.progressDetail).toMatchObject({
      text: "已完成 1 / 2 项任务（50%），最新阶段：售前规划，最慢阶段：售前规划。",
      percent: 50,
    });
    expect(document.progressDetail?.table[0]).toMatchObject({ stage: "售前规划", status: "active", done: 1, total: 2, percent: 50 });
    expect(document.sitePhotos).toEqual([{ fileId: PHOTO_ID, caption: "2026-01-10 · 张三" }]);
    expect(document.issueTable?.rows[0]).toMatchObject({ index: 1, title: "地面不平", owner: "", closedAt: "" });
    expect(document.issueTable?.categoryStats).toEqual([{ category: "规划部", count: 1 }]);
    expect(document.personalSummary).toBeUndefined();
  });
  it("全部完成且最新 / 最慢阶段为空时写全部完成", () => {
    const input = context();
    input.metrics = { ...input.metrics, taskDone: input.metrics.taskTotal, percent: 100, latestStage: null, slowestStage: null };
    input.stages = [{ ...input.stages[0]!, taskDoneCount: 2, taskTotalCount: 2 }];
    const document = buildSummaryDocument(input, report());
    expect(document.progressDetail?.text).toBe("已完成 2 / 2 项任务（100%），最新阶段：全部完成，最慢阶段：全部完成。");
    expect(document.progressDetail?.table[0]?.status).toBe("done");
  });

});
