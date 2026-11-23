import { z } from "../zod.ts";
import { DateTimeSchema, UuidSchema } from "../common/conventions.ts";

export const DOCUMENT_ANALYSIS_PROMPT_VERSION = "project-file-summary-v1";

/** 项目文件 AI 分析状态：queued / running / succeeded / failed。 */
export const ProjectDocumentAnalysisRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]).openapi("ProjectDocumentAnalysisRunStatus");

/** 只允许四类可读文件；其它项目文件在 worker 侧跳过并计数。 */
export const ProjectFileAnalysisKindSchema = z.enum(["pdf", "image", "word", "excel"]).openapi("ProjectFileAnalysisKind");

export const ProjectFileAnalysisStatusSchema = z.enum(["succeeded", "failed", "skipped"]).openapi("ProjectFileAnalysisStatus");

export const ProjectFileAnalysisFactSchema = z.object({
  category: z.enum(["basic_info", "business", "performance", "scope", "responsibility", "site", "network", "power", "team", "schedule", "safety", "delivery", "other"]),
  key: z.string().max(120),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  unit: z.string().nullable().optional(),
  evidence: z.string().max(600),
  confidence: z.number().min(0).max(1),
  sourcePage: z.object({ pdfPage: z.number().int().positive(), printedPageLabel: z.string().nullable() }).optional(),
}).openapi("ProjectFileAnalysisFact");

export const ProjectFileAnalysisSummarySchema = z.object({
  documentType: z.string().max(120),
  purpose: z.string().max(600),
  summaries: z.array(z.string().max(1500)).max(30).default([]),
  keyFacts: z.array(ProjectFileAnalysisFactSchema).max(30).default([]),
  risks: z.array(z.string().max(600)).max(20).default([]),
  decisions: z.array(z.string().max(600)).max(20).default([]),
  warnings: z.array(z.string().max(500)).max(20).default([]),
  missing: z.array(z.string().max(300)).max(20).default([]),
}).openapi("ProjectFileAnalysisSummary");

export const ProjectFileAnalysisSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  fileId: UuidSchema,
  fileVersionId: UuidSchema,
  fileName: z.string().max(500),
  fileKind: ProjectFileAnalysisKindSchema,
  status: ProjectFileAnalysisStatusSchema,
  summary: ProjectFileAnalysisSummarySchema.nullable(),
  modelId: z.string().nullable(),
  promptVersion: z.string(),
  error: z.string().nullable(),
  generatedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).openapi("ProjectFileAnalysis");

export const ProjectFileAiSummarySchema = z.object({
  fileId: UuidSchema,
  fileVersionId: UuidSchema,
  fileName: z.string().max(500),
  fileKind: ProjectFileAnalysisKindSchema,
  summary: ProjectFileAnalysisSummarySchema,
}).openapi("ProjectFileAiSummary");

export const ProjectDocumentAnalysisRunSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  status: ProjectDocumentAnalysisRunStatusSchema,
  promptVersion: z.string(),
  fileCount: z.number().int().min(0),
  succeededCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  error: z.string().nullable(),
  startedAt: DateTimeSchema.nullable(),
  finishedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).openapi("ProjectDocumentAnalysisRun");

export const ProjectDocumentAnalysisViewSchema = z.object({
  run: ProjectDocumentAnalysisRunSchema.nullable(),
  analyses: z.array(ProjectFileAnalysisSchema),
}).openapi("ProjectDocumentAnalysisView", {
  description: "项目文件 AI 分析：最近一次 run + 当前文件版本的成功摘要",
});

export type ProjectDocumentAnalysisRun = z.infer<typeof ProjectDocumentAnalysisRunSchema>;
export type ProjectDocumentAnalysisView = z.infer<typeof ProjectDocumentAnalysisViewSchema>;
export type ProjectFileAnalysis = z.infer<typeof ProjectFileAnalysisSchema>;
export type ProjectFileAnalysisSummary = z.infer<typeof ProjectFileAnalysisSummarySchema>;
export type ProjectFileAiSummary = z.infer<typeof ProjectFileAiSummarySchema>;
