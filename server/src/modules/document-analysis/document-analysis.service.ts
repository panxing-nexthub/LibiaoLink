import { Injectable, Logger } from "@nestjs/common";
import {
  DOCUMENT_ANALYSIS_PROMPT_VERSION,
  ProjectFileAnalysisSummarySchema,
  type ProjectDocumentAnalysisRun,
  type ProjectDocumentAnalysisView,
  type ProjectFileAiSummary,
  type ProjectFileAnalysis,
  type ProjectFileAnalysisSummary,
} from "@libiaolink/contracts";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { DocumentAnalysisRepository, type ProjectDocumentAnalysisRunRow, type ProjectFileAnalysisRow } from "./document-analysis.repository.js";

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function asRunView(row: ProjectDocumentAnalysisRunRow): ProjectDocumentAnalysisRun {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as ProjectDocumentAnalysisRun["status"],
    promptVersion: row.promptVersion,
    fileCount: row.fileCount,
    succeededCount: row.succeededCount,
    failedCount: row.failedCount,
    skippedCount: row.skippedCount,
    error: row.error,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

function summaryOf(row: ProjectFileAnalysisRow): ProjectFileAnalysisSummary | null {
  const raw = row.summaryJson;
  if (raw === null) return null;
  const candidate = (raw as { summary?: unknown }).summary ?? raw;
  const parsed = ProjectFileAnalysisSummarySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function asAnalysisView(row: ProjectFileAnalysisRow): ProjectFileAnalysis {
  return {
    id: row.id,
    projectId: row.projectId,
    fileId: row.fileId,
    fileVersionId: row.fileVersionId,
    fileName: row.fileName,
    fileKind: row.fileKind as ProjectFileAnalysis["fileKind"],
    status: row.status as ProjectFileAnalysis["status"],
    summary: summaryOf(row),
    modelId: row.modelId,
    promptVersion: row.promptVersion,
    error: row.error,
    generatedAt: iso(row.generatedAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

@Injectable()
export class DocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    private readonly repository: DocumentAnalysisRepository,
    private readonly database: DatabaseService,
  ) {}

  async latest(projectId: string): Promise<ProjectDocumentAnalysisView> {
    const [run, analyses] = await Promise.all([
      this.repository.latestRun(projectId),
      this.repository.listCurrentAnalyses(projectId),
    ]);
    return { run: run === null ? null : asRunView(run), analyses: analyses.map(asAnalysisView) };
  }

  async enqueue(projectId: string, actorId: string): Promise<ProjectDocumentAnalysisRun> {
    const row = await this.database.db.transaction(async (tx: DbClient) => {
      await this.repository.lockProject(projectId, tx);
      const active = await this.repository.findActiveRun(projectId, tx);
      if (active !== null) return active;
      return this.repository.insertRun(projectId, DOCUMENT_ANALYSIS_PROMPT_VERSION, actorId, tx);
    });
    this.logger.log("项目文件 AI 分析已排队：project=" + projectId + " run=" + row.id);
    return asRunView(row);
  }

  /**
   * 技术协议定向抽取（P1）：worker 把抽取结果写在 summary_json.extraction，
   * 这里只取当前文件版本、最新生成的一条；没有返回 null。
   */
  async extractionForProject(projectId: string): Promise<{
    fileName: string;
    fileVersionId: string;
    extraction: unknown;
    generatedAt: Date | null;
  } | null> {
    const rows = await this.repository.listCurrentAnalyses(projectId);
    for (const row of rows) {
      const raw = row.summaryJson as Record<string, unknown> | null;
      if (raw === null) continue;
      const version = raw["extractionVersion"];
      const extraction = raw["extraction"];
      if (typeof version !== "string" || extraction === null || extraction === undefined) continue;
      return { fileName: row.fileName, fileVersionId: row.fileVersionId, extraction, generatedAt: row.generatedAt };
    }
    return null;
  }

  /** 供 AI 项目总结读面消费；只返回当前文件版本的成功摘要。 */
  async forAi(projectId: string): Promise<ProjectFileAiSummary[]> {
    const rows = await this.repository.listCurrentAnalyses(projectId);
    const result: ProjectFileAiSummary[] = [];
    for (const row of rows) {
      const summary = summaryOf(row);
      if (summary === null) continue;
      result.push({
        fileId: row.fileId,
        fileVersionId: row.fileVersionId,
        fileName: row.fileName,
        fileKind: row.fileKind as ProjectFileAiSummary["fileKind"],
        summary,
      });
    }
    return result;
  }
}
