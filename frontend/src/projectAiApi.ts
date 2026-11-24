/**
 * AI 项目总结接口（v2）：
 * - GET  /api/v1/projects/{id}/ai-summary  读最近一次结果（404 = 尚未生成）
 * - POST /api/v1/projects/{id}/ai-summary  生成 / 强制重新生成（需 project.export）
 *
 * 契约见 shared/src/modules/project-ai.ts（ProjectAiSummary / ProjectAiSummaryReport）。
 * 页面只做展示：完成率、最新 / 最慢阶段等数字全部由服务端采集器算好，前端不重算。
 */
import { ApiError, apiRequest, apiSend, readAllPages } from "./api";

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
  report: ProjectAiSummaryReportV4;
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


/* ------------------------------------------------------------------ *
 * 项目总结文档视图数据：P3/P4 前后兼容
 * - 旧接口只有 project / metrics / stages / tasks / reports / issues / fileAnalyses；
 * - 新接口在 project / equipment / layout 上补字段，老字段保持不变。
 * ------------------------------------------------------------------ */

export type ProjectAiContextMember = { name: string; role: "manager" | "task_owner" };

export type ProjectAiPeriod = {
  planFrom: string | null;
  planTo: string | null;
  actualFrom: string | null;
  actualTo: string | null;
  actualOngoing: boolean;
};

export type ProjectAiExtractedField = {
  status: "found" | "not_found" | "conflict" | "failed";
  value: string | null;
  evidence: string | null;
  sourcePage: number | null;
  confidence: number;
};

export type ProjectAiAgreementImage = { pageNo: number | null; url: string | null; caption: string | null };

export type ProjectAiAgreement = {
  fileName: string;
  fileVersionId: string;
  partyA: ProjectAiExtractedField;
  customer: ProjectAiExtractedField;
  projectAddress: ProjectAiExtractedField;
  background: ProjectAiExtractedField;
  layout: ProjectAiAgreementImage;
  threeD: ProjectAiAgreementImage;
  extractedAt: string;
};

export type ProjectAiEquipmentQuantity = { value: number; unit: string };

export type ProjectAiEquipmentCategory = {
  name: string;
  itemCount: number;
  quantities: ProjectAiEquipmentQuantity[];
  representativeItems: string[];
};

export type ProjectAiEquipment = { sourceFileName: string | null; categories: ProjectAiEquipmentCategory[] };

export type ProjectAiPhotoRef = { fileId: string; name: string; date: string; authorName: string | null };

export type ProjectAiIssueCategoryStat = { category: string; count: number };

export type ProjectAiContext = {
  project: {
    id: string;
    code: string;
    name: string;
    region: string;
    projectTypes: string[];
    status: string;
    managerNames: Array<string | null>;
    startedAt: string | null;
    /** P3 扩展：技术协议抽取（缺失 = 未接入 / 未识别）。 */
    partyA?: string | null;
    customer?: string | null;
    projectAddress?: string | null;
    description?: string | null;
    period?: ProjectAiPeriod | null;
    members?: ProjectAiContextMember[] | null;
  };
  metrics: {
    taskDone: number;
    taskTotal: number;
    percent: number | null;
    latestStage: string | null;
    slowestStage: string | null;
    planStart: string | null;
    planEnd: string | null;
    reportStart: string | null;
    reportEnd: string | null;
    issueTotal: number;
    issueDone: number;
    issueInProgress: number;
    issueOpen: number;
    changeTotal: number;
  };
  stages: Array<{
    stageKey: string;
    name: string;
    seq: number;
    status: string;
    plannedStart: string | null;
    plannedEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    taskDoneCount: number;
    taskTotalCount: number;
    datesFallback: boolean;
  }>;
  ungroupedTasks?: { taskDoneCount: number; taskTotalCount: number };
  tasks: Array<{
    taskId: string;
    stageKey: string | null;
    title: string;
    titleEn: string | null;
    ownerNames: Array<string | null>;
    managerNames: Array<string | null>;
    status: string;
    displayStatus: string;
    progress: number;
    plannedStart: string | null;
    plannedEnd: string | null;
    actualEnd: string | null;
  }>;
  reports?: Array<{ reportId: string; date: string; authorName: string | null; state: string; photoCount: number }>;
  issues?: Array<{
    issueId: string;
    title: string;
    categories: string[];
    state: string;
    reporterName: string | null;
    ownerName: string | null;
    ownerDepartment: string | null;
    raisedAt: string;
    solution: string | null;
    closedAt: string | null;
    photoCount: number;
    photos?: Array<{ fileId: string; name: string | null }>;
  }>;
  fileAnalyses?: ProjectAiFileAnalysis[];
  /** P3 扩展：设备清单分类聚合（缺失 = 未接入 / 未识别）。 */
  equipment?: ProjectAiEquipment | null;
  /** P3 扩展：设备布局页图（缺失 = 未接入 / 未识别）。 */
  layout?: {
    cad?: { fileId: string | null; source: "agreement" | "manual"; sourcePage: number | null } | null;
    threeD?: { fileId: string | null; source: "agreement" | "manual"; sourcePage: number | null } | null;
  } | null;
  /** P1：技术协议定向抽取。 */
  agreement?: ProjectAiAgreement | null;
  /** P3：现场附图抽样。 */
  reportPhotos?: ProjectAiPhotoRef[];
  /** P3：问题归类统计。 */
  issueCategoryStats?: ProjectAiIssueCategoryStat[];
  generatedAt: string;
  truncated: boolean;
};

export type ProjectAiFileAnalysis = {
  fileId: string;
  fileVersionId: string;
  fileName: string;
  fileKind: "pdf" | "image" | "word" | "excel";
  summary: {
    documentType: string;
    purpose: string;
    summaries: string[];
    keyFacts: Array<{
      category: string;
      key: string;
      value: unknown;
      unit?: string | null;
      evidence: string;
      confidence: number;
      sourcePage?: { pdfPage: number; printedPageLabel: string | null };
    }>;
    risks: string[];
    decisions: string[];
    warnings: string[];
    missing: string[];
  };
};

export type ProjectAiSummaryLayoutImage = { fileId: string | null; url: string | null; caption: string };

export type ProjectAiSummaryEquipmentRow = {
  category: string;
  itemCount: number;
  quantityText: string;
  representative: string;
};

export type ProjectAiSummaryProgressRow = {
  stage: string;
  status: string;
  planText: string;
  actualText: string;
  done: number;
  total: number;
  percent: number | null;
};

export type ProjectAiSummaryIssueRowV4 = {
  index: number;
  title: string;
  categories: string[];
  state: string;
  owner: string;
  raisedAt: string;
  solution: string;
  closedAt: string;
  photos: Array<{ fileId: string; name: string | null }>;
};

/** P4 文档结构（后端未上线时这些字段全部缺失，页面按现有数据降级展示）。 */
export type ProjectAiSummaryReportV4 = ProjectAiSummaryReport & {
  basicInfo?: {
    projectCode: string;
    projectName: string;
    periodText: string;
    partyA: string;
    customer: string;
    address: string;
    members: string;
    sources: string[];
  };
  equipmentLayout?: {
    cadImage?: ProjectAiSummaryLayoutImage;
    threeDImage?: ProjectAiSummaryLayoutImage;
  };
  background?: { text: string };
  equipmentList?: { rows: ProjectAiSummaryEquipmentRow[] };
  progressDetail?: { text: string; table: ProjectAiSummaryProgressRow[]; percent: number | null };
  sitePhotos?: Array<{ fileId: string; caption: string }>;
  issueTable?: {
    rows: ProjectAiSummaryIssueRowV4[];
    summary: string;
    categoryStats: Array<{ category: string; count: number }>;
  };
  personalSummary?: string;
  sourceAppendix?: Array<{ fileName: string; docType: string; version: string; date: string }>;
};

/** 人工替换设备布局图 / 三维图（multipart 字段 file；PNG / JPEG / WebP，≤ 10 MB）。 */
export function uploadProjectAiAgreementImage(
  projectId: string,
  kind: "layout" | "three_d",
  file: File,
): Promise<{ ok: boolean }> {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiRequest<{ ok: boolean }>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/ai-agreement-images/" + kind,
    { method: "POST", body: form },
  );
}

/** 项目 AI 上下文：只读聚合，不触发模型。 */
export function fetchProjectAiContext(projectId: string): Promise<ProjectAiContext> {
  return apiRequest<ProjectAiContext>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/ai-context",
  );
}

/** 总结文档用的问题行（含关闭时间与附图；问题列表接口一次取全）。 */
export type ProjectAiSummaryIssue = {
  id: string;
  title: string;
  categories: string[];
  state: string;
  reporterName: string | null;
  ownerName: string | null;
  raisedAt: string;
  solution: string | null;
  closedAt: string | null;
  photos: Array<{ fileId: string; name: string | null }>;
};

export function fetchProjectAiSummaryIssues(projectId: string): Promise<ProjectAiSummaryIssue[]> {
  return readAllPages<ProjectAiSummaryIssue>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/issues",
  ).then((response) =>
    response.items
      .slice()
      .sort((a, b) => (a.raisedAt === b.raisedAt ? a.id.localeCompare(b.id) : a.raisedAt.localeCompare(b.raisedAt))),
  );
}

/** 总结文档用的日报行（只要日期、作者、状态与现场附图）。 */
export type ProjectAiSummaryReportEntry = {
  id: string;
  date: string;
  state: string;
  authorName: string | null;
  photos: Array<{ fileId: string; name: string | null }>;
};

export function fetchProjectAiSummaryReports(projectId: string): Promise<ProjectAiSummaryReportEntry[]> {
  return readAllPages<ProjectAiSummaryReportEntry>(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/reports",
  ).then((response) =>
    response.items
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date)),
  );
}
