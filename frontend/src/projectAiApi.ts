/**
 * AI 项目总结接口（v2）：
 * - GET  /api/v1/projects/{id}/ai-summary  读最近一次结果（404 = 尚未生成）
 * - POST /api/v1/projects/{id}/ai-summary  生成 / 强制重新生成（需 project.export）
 *
 * 契约见 shared/src/modules/project-ai.ts（ProjectAiSummary / ProjectAiSummaryReport）。
 * 页面只做展示：完成率、最新 / 最慢阶段等数字全部由服务端采集器算好，前端不重算。
 */
import { ApiError, apiRequest, apiSend } from "./api";

export type ProjectAiClaimType = "fact" | "inference" | "suggestion";

export type ProjectAiClaim = {
  text: string;
  type: ProjectAiClaimType;
  sources: string[];
};

export type ProjectAiTimelineItem = ProjectAiClaim & {
  date: string;
  title: string;
};

export type ProjectAiIssueItem = {
  text: string;
  owner: string;
  handling: string;
  nextStep: string;
  type: ProjectAiClaimType;
  sources: string[];
};

export type ProjectAiRange = { from: string | null; to: string | null };

export type ProjectAiSummaryReport = {
  title: string;
  summary: { text: string; claims: ProjectAiClaim[] };
  overview: {
    projectName: string;
    projectCode: string;
    status: string;
    managers: string[];
    startedAt: string;
    progress: {
      done: number;
      total: number;
      percent: number | null;
      latestStage: string;
      slowestStage: string;
    };
    planRange: ProjectAiRange;
    reportRange: ProjectAiRange;
  };
  timeline: ProjectAiTimelineItem[];
  issues: {
    total: number;
    done: number;
    inProgress: number;
    open: number;
    summary: string;
    currentItems: ProjectAiIssueItem[];
  };
  resultsAndRisks: {
    text: string;
    claims: ProjectAiClaim[];
    risks: ProjectAiClaim[];
  };
  handoff: {
    existing: Array<{
      text: string;
      owner: string;
      nextStep: string;
      type: ProjectAiClaimType;
      sources: string[];
    }>;
    suggestions: Array<{
      text: string;
      reason: string;
      nextStep: string;
      acceptance: string;
      type: ProjectAiClaimType;
      needsHumanConfirmation: boolean;
      sources: string[];
    }>;
  };
  notes: ProjectAiClaim[];
};

export type ProjectAiSummary = {
  id: string;
  projectId: string;
  sourceHash: string;
  promptVersion: string;
  modelId: string | null;
  summaryText: string;
  report: ProjectAiSummaryReport;
  generatedBy: string | null;
  generatedByName: string | null;
  generatedAt: string;
  stale: boolean;
};

/** 404 = 尚未生成过总结；其它错误照常抛出，由弹窗显示重试。 */
export async function fetchProjectAiSummary(projectId: string): Promise<ProjectAiSummary | null> {
  try {
    return await apiRequest<ProjectAiSummary>("/api/v1/projects/" + encodeURIComponent(projectId) + "/ai-summary");
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function generateProjectAiSummary(projectId: string, force: boolean): Promise<ProjectAiSummary> {
  return apiSend<ProjectAiSummary>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/ai-summary",
    "POST",
    { force },
  );
}

export type ProjectDocumentAnalysisRun = {
  id: string;
  projectId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  promptVersion: string;
  fileCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDocumentAnalysisView = {
  run: ProjectDocumentAnalysisRun | null;
  analyses: Array<{
    id: string;
    fileName: string;
    fileKind: "pdf" | "image" | "word" | "excel";
    status: "succeeded" | "failed" | "skipped";
    summary: unknown;
  }>;
};

export function enqueueProjectDocumentAnalysis(projectId: string): Promise<ProjectDocumentAnalysisRun> {
  return apiSend<ProjectDocumentAnalysisRun>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/document-analysis",
    "POST",
  );
}

export function fetchProjectDocumentAnalysis(projectId: string): Promise<ProjectDocumentAnalysisView> {
  return apiRequest<ProjectDocumentAnalysisView>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/document-analysis",
  );
}
