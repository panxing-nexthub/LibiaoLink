import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { projectDocumentAnalysisRuns, projectFileAnalyses } from "../../db/schema/document-analysis.js";
import { files } from "../../db/schema/files.js";

export type ProjectDocumentAnalysisRunRow = typeof projectDocumentAnalysisRuns.$inferSelect;
export type ProjectFileAnalysisRow = typeof projectFileAnalyses.$inferSelect;

@Injectable()
export class DocumentAnalysisRepository {
  constructor(private readonly database: DatabaseService) {}

  async latestRun(projectId: string, client: DbClient = this.database.db): Promise<ProjectDocumentAnalysisRunRow | null> {
    const rows = await client
      .select()
      .from(projectDocumentAnalysisRuns)
      .where(eq(projectDocumentAnalysisRuns.projectId, projectId))
      .orderBy(desc(projectDocumentAnalysisRuns.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveRun(projectId: string, client: DbClient = this.database.db): Promise<ProjectDocumentAnalysisRunRow | null> {
    const rows = await client
      .select()
      .from(projectDocumentAnalysisRuns)
      .where(and(eq(projectDocumentAnalysisRuns.projectId, projectId), inArray(projectDocumentAnalysisRuns.status, ["queued", "running"])))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertRun(
    projectId: string,
    promptVersion: string,
    requestedBy: string,
    client: DbClient = this.database.db,
  ): Promise<ProjectDocumentAnalysisRunRow> {
    const rows = await client
      .insert(projectDocumentAnalysisRuns)
      .values({ projectId, promptVersion, requestedBy, status: "queued" })
      .returning();
    return rows[0]!;
  }

  /**
   * 当前文件版本的成功摘要。files.current_version_id = project_file_analyses.file_version_id
   * 防止同一文件的旧版本摘要被 AI 总结重新带回来。
   */
  async listCurrentAnalyses(projectId: string, client: DbClient = this.database.db): Promise<ProjectFileAnalysisRow[]> {
    return client
      .select({ analysis: projectFileAnalyses })
      .from(projectFileAnalyses)
      .innerJoin(
        files,
        and(eq(files.id, projectFileAnalyses.fileId), eq(files.currentVersionId, projectFileAnalyses.fileVersionId)),
      )
      .where(and(eq(projectFileAnalyses.projectId, projectId), eq(projectFileAnalyses.status, "succeeded")))
      .orderBy(desc(projectFileAnalyses.generatedAt))
      .then((rows) => rows.map((row) => row.analysis));
  }

  async lockProject(projectId: string, client: DbClient): Promise<void> {
    await client.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
  }
}
