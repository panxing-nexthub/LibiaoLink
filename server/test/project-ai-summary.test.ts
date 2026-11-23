/**
 * AI 项目总结生成 / 缓存回归：
 * 上下文指纹、缓存命中、force 重新生成、模型失败不落库、stale 判定、审计留痕。
 * 用假仓库 + 假模型注入，不连数据库、不发网络请求。
 */
import { describe, expect, it, vi } from "vitest";
import type { ProjectAiContext, ProjectAiSummary } from "@libiaolink/contracts";
import type { AuditService } from "../src/modules/admin/index.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { UserService } from "../src/modules/identity/index.js";
import type { ProjectAiContextService } from "../src/modules/project-ai/project-ai-context.service.js";
import type { ProjectAiModelClient } from "../src/modules/project-ai/project-ai.model.js";
import type { ProjectAiSummaryRepository, ProjectAiSummaryRow, ProjectAiSummaryWrite } from "../src/modules/project-ai/project-ai-summary.repository.js";
import { hashProjectAiContext, ProjectAiSummaryService, PROJECT_AI_PROMPT_VERSION } from "../src/modules/project-ai/project-ai-summary.service.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function baseContext(overrides: Partial<ProjectAiContext> = {}): ProjectAiContext {
  return {
    project: {
      id: PROJECT_ID,
      code: "CNBJ-20260101-0001",
      name: "测试项目",
      region: "华东",
      projectTypes: ["T-sort"],
      status: "active",
      managerNames: ["项目经理乙"],
      startedAt: "2026-01-03",
    },
    metrics: {
      taskDone: 0,
      taskTotal: 0,
      percent: null,
      latestStageKey: null,
      latestStage: null,
      slowestStageKey: null,
      slowestStage: null,
      planStart: null,
      planEnd: null,
      reportStart: null,
      reportEnd: null,
      issueTotal: 0,
      issueDone: 0,
      issueInProgress: 0,
      issueOpen: 0,
      changeTotal: 0,
    },
    stages: [],
    ungroupedTasks: { taskDoneCount: 0, taskTotalCount: 0 },
    tasks: [],
    changes: [],
    reports: [],
    issues: [],
    generatedAt: "2026-11-22T12:00:00.000Z",
    truncated: false,
    ...overrides,
  };
}

const MODEL_OUTPUT = {
  modelId: "deepseek-test",
  report: {
    title: "测试项目总结",
    summary: {
      text: "项目整体按计划推进，暂无异常。",
      claims: [{ text: "项目当前为进行中。", type: "fact", sources: ["项目统计"] }],
    },
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
    timeline: [
      { date: "2026-01-03", title: "项目启动", text: "任务记录显示项目启动。", type: "fact", sources: ["任务记录 2026-01-03"] },
    ],
    issues: { total: 0, done: 0, inProgress: 0, open: 0, summary: "暂无问题记录", currentItems: [] },
    resultsAndRisks: { text: "暂无成果记录。", claims: [], risks: [] },
    handoff: { existing: [], suggestions: [] },
    notes: [{ text: "暂无交接事项", type: "fact", sources: ["项目统计"] }],
  },
};

class FakeRepository {
  rows: ProjectAiSummaryRow[] = [];
  async findLatest(projectId: string, promptVersion: string): Promise<ProjectAiSummaryRow | null> {
    return (
      this.rows
        .filter((row) => row.projectId === projectId && row.promptVersion === promptVersion)
        .at(-1) ?? null
    );
  }
  async findBySource(projectId: string, sourceHash: string, promptVersion: string): Promise<ProjectAiSummaryRow | null> {
    return this.rows.find((row) => row.projectId === projectId && row.sourceHash === sourceHash && row.promptVersion === promptVersion) ?? null;
  }
  async upsert(input: ProjectAiSummaryWrite): Promise<ProjectAiSummaryRow> {
    const existing = this.rows.find(
      (row) => row.projectId === input.projectId && row.sourceHash === input.sourceHash && row.promptVersion === input.promptVersion,
    );
    const now = new Date("2026-11-22T12:30:00.000Z");
    if (existing !== undefined) {
      Object.assign(existing, { ...input, generatedAt: now, updatedAt: now });
      return existing;
    }
    const row: ProjectAiSummaryRow = {
      id: "33333333-3333-4333-8333-333333333333",
      projectId: input.projectId,
      sourceHash: input.sourceHash,
      promptVersion: input.promptVersion,
      modelId: input.modelId,
      summaryText: input.summaryText,
      summaryJson: input.summaryJson,
      generatedBy: input.generatedBy,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }
}

function buildService(options: { context?: ProjectAiContext; model?: { summarize: () => Promise<typeof MODEL_OUTPUT> } } = {}) {
  const repository = new FakeRepository();
  const context = options.context ?? baseContext();
  const summarize = options.model?.summarize ?? vi.fn(async () => MODEL_OUTPUT);
  const auditRecord = vi.fn(async () => undefined);
  const service = new ProjectAiSummaryService(
    { build: async () => context } as unknown as ProjectAiContextService,
    repository as unknown as ProjectAiSummaryRepository,
    { summarize } as unknown as ProjectAiModelClient,
    { record: auditRecord } as unknown as AuditService,
    { getUser: async () => ({ displayName: "操作人甲" }) } as unknown as UserService,
    { db: {} } as unknown as DatabaseService,
  );
  return { service, repository, summarize, auditRecord, context };
}

describe("ProjectAiSummaryService", () => {
  it("首次生成调用模型并落库，同时写审计", async () => {
    const { service, repository, summarize, auditRecord } = buildService();
    const result = await service.generate(PROJECT_ID, ACTOR_ID, false);

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(repository.rows).toHaveLength(1);
    expect(result.summaryText).toBe(MODEL_OUTPUT.report.summary.text);
    expect(result.report.title).toBe("测试项目总结");
    expect(result.modelId).toBe("deepseek-test");
    expect(result.stale).toBe(false);
    expect(result.generatedByName).toBe("操作人甲");
    expect(result.promptVersion).toBe(PROJECT_AI_PROMPT_VERSION);
    expect(auditRecord).toHaveBeenCalledTimes(1);
  });

  it("同一上下文第二次生成命中缓存，不再调用模型", async () => {
    const { service, summarize } = buildService();
    await service.generate(PROJECT_ID, ACTOR_ID, false);
    await service.generate(PROJECT_ID, ACTOR_ID, false);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("force=true 无视缓存重新生成，同一指纹覆盖原行", async () => {
    const { service, repository, summarize } = buildService();
    await service.generate(PROJECT_ID, ACTOR_ID, false);
    await service.generate(PROJECT_ID, ACTOR_ID, true);
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(repository.rows).toHaveLength(1);
  });

  it("上下文变化后生成新指纹，latest 把旧结果标为 stale", async () => {
    const { service, context } = buildService();
    await service.generate(PROJECT_ID, ACTOR_ID, false);

    context.project.name = "测试项目（改名）";
    const latest = await service.latest(PROJECT_ID, ACTOR_ID);
    expect(latest.stale).toBe(true);

    const regenerated = await service.generate(PROJECT_ID, ACTOR_ID, false);
    expect(regenerated.stale).toBe(false);
  });

  it("模型失败不写库，错误向上抛出", async () => {
    const { service, repository } = buildService({
      model: { summarize: async () => { throw new Error("模型炸了"); } },
    });
    await expect(service.generate(PROJECT_ID, ACTOR_ID, false)).rejects.toThrow("模型炸了");
    expect(repository.rows).toHaveLength(0);
  });

  it("尚未生成时 latest 返回 NOT_FOUND", async () => {
    const { service } = buildService();
    await expect(service.latest(PROJECT_ID, ACTOR_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("指纹忽略 generatedAt，只随业务数据变化", () => {
    const a = hashProjectAiContext(baseContext({ generatedAt: "2026-11-22T12:00:00.000Z" }));
    const b = hashProjectAiContext(baseContext({ generatedAt: "2026-11-22T23:59:59.000Z" }));
    const c = hashProjectAiContext(baseContext({ project: { ...baseContext().project, name: "别的项目" } }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
