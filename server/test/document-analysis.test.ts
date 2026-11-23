import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/db/database.service.js";
import type { DocumentAnalysisRepository, ProjectDocumentAnalysisRunRow, ProjectFileAnalysisRow } from "../src/modules/document-analysis/document-analysis.repository.js";
import { DocumentAnalysisService } from "../src/modules/document-analysis/document-analysis.service.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-23T05:00:00.000Z");

function runRow(overrides: Partial<ProjectDocumentAnalysisRunRow> = {}): ProjectDocumentAnalysisRunRow {
  return {
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: "succeeded",
    promptVersion: "project-file-summary-v1",
    requestedBy: null,
    fileCount: 1,
    succeededCount: 1,
    failedCount: 0,
    skippedCount: 0,
    error: null,
    startedAt: NOW,
    finishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function analysisRow(): ProjectFileAnalysisRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    projectId: PROJECT_ID,
    fileId: FILE_ID,
    fileVersionId: VERSION_ID,
    contentHash: "a".repeat(64),
    fileName: "技术协议.pdf",
    fileKind: "pdf",
    status: "succeeded",
    summaryJson: {
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
    },
    modelId: "deepseek-test",
    promptVersion: "project-file-summary-v1",
    error: null,
    generatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function serviceWith(repo: Partial<DocumentAnalysisRepository>) {
  return new DocumentAnalysisService(
    repo as unknown as DocumentAnalysisRepository,
    { db: { transaction: async (callback: (tx: unknown) => unknown) => callback({}) } } as unknown as DatabaseService,
  );
}

describe("DocumentAnalysisService", () => {
  it("maps current file summaries and exposes them to AI context", async () => {
    const service = serviceWith({
      latestRun: async () => runRow(),
      listCurrentAnalyses: async () => [analysisRow()],
    });
    const view = await service.latest(PROJECT_ID);
    expect(view.run?.status).toBe("succeeded");
    expect(view.analyses[0]?.summary?.documentType).toBe("技术协议");
    expect(view.analyses[0]?.fileName).toBe("技术协议.pdf");

    const ai = await service.forAi(PROJECT_ID);
    expect(ai).toHaveLength(1);
    expect(ai[0]?.summary.keyFacts[0]?.key).toBe("分拣产能");
  });

  it("returns an existing active run instead of creating a duplicate", async () => {
    const service = serviceWith({
      lockProject: async () => {},
      findActiveRun: async () => runRow({ status: "queued", fileCount: 0, succeededCount: 0 }),
      insertRun: async () => { throw new Error("must not insert"); },
    });
    const run = await service.enqueue(PROJECT_ID, "66666666-6666-4666-8666-666666666666");
    expect(run.status).toBe("queued");
    expect(run.id).toBe(RUN_ID);
  });

  it("ignores malformed cached summaries", async () => {
    const bad = analysisRow();
    bad.summaryJson = { summary: { documentType: "x" } };
    const service = serviceWith({
      latestRun: async () => runRow(),
      listCurrentAnalyses: async () => [bad],
    });
    expect(await service.forAi(PROJECT_ID)).toEqual([]);
  });
});
