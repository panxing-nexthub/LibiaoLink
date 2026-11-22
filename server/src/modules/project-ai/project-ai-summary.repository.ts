import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { projectAiSummaries } from "../../db/schema/project-ai.js";

export type ProjectAiSummaryRow = typeof projectAiSummaries.$inferSelect;

export interface ProjectAiSummaryWrite {
  projectId: string;
  sourceHash: string;
  promptVersion: string;
  modelId: string | null;
  summaryText: string;
  summaryJson: Record<string, unknown>;
  generatedBy: string | null;
}

/** AI 项目总结缓存读写（0111）。只保存生成成功的结果；失败由调用方返回错误、不落库。 */
@Injectable()
export class ProjectAiSummaryRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 该项目在当前 prompt 版本下最近一次生成（不论数据是否已变化），用于 GET 展示与 stale 判定。
   * 必须按 promptVersion 过滤：不同版本的 summaryJson 结构不兼容，旧版本行不能被当成当前结构返回。
   */
  async findLatest(
    projectId: string,
    promptVersion: string,
    client: DbClient = this.database.db,
  ): Promise<ProjectAiSummaryRow | null> {
    const rows = await client
      .select()
      .from(projectAiSummaries)
      .where(
        and(eq(projectAiSummaries.projectId, projectId), eq(projectAiSummaries.promptVersion, promptVersion)),
      )
      .orderBy(desc(projectAiSummaries.generatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 命中同一上下文指纹 + prompt 版本 = 可直接复用缓存。 */
  async findBySource(
    projectId: string,
    sourceHash: string,
    promptVersion: string,
    client: DbClient = this.database.db,
  ): Promise<ProjectAiSummaryRow | null> {
    const rows = await client
      .select()
      .from(projectAiSummaries)
      .where(
        and(
          eq(projectAiSummaries.projectId, projectId),
          eq(projectAiSummaries.sourceHash, sourceHash),
          eq(projectAiSummaries.promptVersion, promptVersion),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** 同一指纹重复生成时覆盖原行（force=true 语义）；旧指纹的行保留可追溯。 */
  async upsert(input: ProjectAiSummaryWrite, client: DbClient = this.database.db): Promise<ProjectAiSummaryRow> {
    const now = new Date();
    const values = {
      projectId: input.projectId,
      sourceHash: input.sourceHash,
      promptVersion: input.promptVersion,
      modelId: input.modelId,
      summaryText: input.summaryText,
      summaryJson: input.summaryJson,
      generatedBy: input.generatedBy,
      generatedAt: now,
      updatedAt: now,
    };
    const rows = await client
      .insert(projectAiSummaries)
      .values(values)
      .onConflictDoUpdate({
        target: [
          projectAiSummaries.projectId,
          projectAiSummaries.sourceHash,
          projectAiSummaries.promptVersion,
        ],
        set: values,
      })
      .returning();
    return rows[0]!;
  }
}
