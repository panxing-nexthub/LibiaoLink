/**
 * AI 项目总结模型调用回归：输出被截断时升级到压缩兜底；网关拒绝 response_format 时自动降级重发。
 * 只 mock fetch，不发真实网络请求。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectAiContext } from "@libiaolink/contracts";
import type { ModelConfigService } from "../src/modules/model-config/index.js";
import { ProjectAiModelClient } from "../src/modules/project-ai/project-ai.model.js";

const REPORT = {
  title: "测试项目总结",
  summary: { text: "项目整体按计划推进。", claims: [{ text: "项目当前为进行中。", type: "fact", sources: ["项目统计"] }] },
  overview: {
    projectName: "测试项目",
    projectCode: "CNBJ-20260101-0001",
    status: "进行中",
    managers: ["项目经理乙"],
    startedAt: "2026-01-03",
    progress: { done: 0, total: 0, percent: null, latestStage: "全部完成或暂无已动工任务", slowestStage: "全部完成或暂无任务" },
    planRange: { from: null, to: null },
    reportRange: { from: null, to: null },
  },
  timeline: [{ date: "2026-01-03", title: "项目启动", text: "任务记录显示项目启动。", type: "fact", sources: ["任务记录 2026-01-03"] }],
  issues: { total: 0, done: 0, inProgress: 0, open: 0, summary: "暂无问题记录", currentItems: [] },
  resultsAndRisks: { text: "暂无成果记录。", claims: [], risks: [] },
  handoff: { existing: [], suggestions: [] },
  notes: [{ text: "暂无交接事项", type: "fact", sources: ["项目统计"] }],
};

const TRUNCATED = "{title:";

function context(): ProjectAiContext {
  return {
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      code: "CNBJ-20260101-0001",
      name: "测试项目",
      region: "华东",
      projectTypes: ["T-sort"],
      status: "active",
      managerNames: ["项目经理乙"],
      startedAt: "2026-01-03",
    },
    metrics: {
      taskDone: 0, taskTotal: 0, percent: null,
      latestStageKey: null, latestStage: null, slowestStageKey: null, slowestStage: null,
      planStart: null, planEnd: null, reportStart: null, reportEnd: null,
      issueTotal: 0, issueDone: 0, issueInProgress: 0, issueOpen: 0, changeTotal: 0,
    },
    stages: [],
    ungroupedTasks: { taskDoneCount: 0, taskTotalCount: 0 },
    tasks: [], changes: [], reports: [], issues: [], fileAnalyses: [],
    generatedAt: "2026-11-22T12:00:00.000Z",
    truncated: false,
  };
}

function completion(content: string, finishReason: string): unknown {
  return { choices: [{ message: { content }, finish_reason: finishReason }], usage: { prompt_tokens: 1200, completion_tokens: 4096 } };
}

function client(): ProjectAiModelClient {
  const models = { active: async () => ({ baseUrl: "https://gateway.example/v1", apiKey: "key", modelId: "deepseek-test" }) };
  return new ProjectAiModelClient(models as unknown as ModelConfigService);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("ProjectAiModelClient", () => {
  it("输出被截断时升级到压缩兜底，第三次成功后返回报告", async () => {
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
      seen.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (seen.length < 3) return new Response(JSON.stringify(completion(TRUNCATED, "length")), { status: 200 });
      return new Response(JSON.stringify(completion(JSON.stringify(REPORT), "stop")), { status: 200 });
    }));

    const result = await client().summarize(context());
    expect(result.report.title).toBe("测试项目总结");
    expect(seen).toHaveLength(3);
    expect(seen[0]?.response_format).toEqual({ type: "json_object" });
    const third = seen[2]?.messages as Array<{ role: string; content: string }>;
    expect(third[0]?.content).toContain("【压缩输出模式】");
    expect(third.at(-1)?.content).toContain("压缩输出模式");
  });

  it("网关拒绝 response_format 时降级重发并成功", async () => {
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
      seen.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (seen.length === 1) return new Response("unsupported field response_format", { status: 400 });
      return new Response(JSON.stringify(completion(JSON.stringify(REPORT), "stop")), { status: 200 });
    }));

    const result = await client().summarize(context());
    expect(result.report.title).toBe("测试项目总结");
    expect(seen).toHaveLength(2);
    expect(seen[0]?.response_format).toEqual({ type: "json_object" });
    expect(seen[1]?.response_format).toBeUndefined();
  });
  it("把项目文件摘要送入模型输入", async () => {
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
      seen.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify(completion(JSON.stringify(REPORT), "stop")), { status: 200 });
    }));
    const withFiles = context();
    withFiles.fileAnalyses = [{
      fileId: "22222222-2222-4222-8222-222222222222",
      fileVersionId: "33333333-3333-4333-8333-333333333333",
      fileName: "技术协议.pdf",
      fileKind: "pdf",
      summary: {
        documentType: "技术协议",
        purpose: "说明项目性能",
        summaries: ["项目产能为 4200 件/H。"],
        keyFacts: [{ category: "performance", key: "分拣产能", value: "4200", unit: "件/H", evidence: "4200 件/H", confidence: 0.99 }],
        risks: [],
        decisions: [],
        warnings: [],
        missing: [],
      },
    }];
    await client().summarize(withFiles);
    const body = JSON.stringify(seen[0]);
    expect(body).toContain("技术协议.pdf");
    expect(body).toContain("分拣产能");
  });
});
