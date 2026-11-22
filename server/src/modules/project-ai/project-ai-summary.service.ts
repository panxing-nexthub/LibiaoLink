import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ProjectAiContext, ProjectAiSummary } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { AuditService } from "../admin/index.js";
import { UserService } from "../identity/index.js";
import { ProjectAiContextService } from "./project-ai-context.service.js";
import { ProjectAiModelClient } from "./project-ai.model.js";
import { ProjectAiSummaryRepository, type ProjectAiSummaryRow } from "./project-ai-summary.repository.js";

/** prompt 结构变更时递增：旧版本的缓存自动不再命中，不会被复用。 */
export const PROJECT_AI_PROMPT_VERSION = "v1";

/** 上下文指纹：去掉每次请求都会变的 generatedAt，其余字段按固定顺序序列化（构建时已排序）。 */
export function hashProjectAiContext(context: ProjectAiContext): string {
  const { generatedAt: _generatedAt, ...stable } = context;
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}

/**
 * AI 项目总结生成与缓存。
 *
 * - 缓存键 = 项目 + 上下文指纹 + prompt 版本；数据一变指纹就变，旧缓存自然失效。
 * - POST 默认先查缓存，命中直接返回；force=true 才重新调模型。
 * - 同一项目 + 同一指纹的并发请求在进程内合并，避免重复扣费。
 * - 模型失败不写库、不覆盖已有缓存，由调用方重试。
 */
@Injectable()
export class ProjectAiSummaryService {
  private readonly logger = new Logger(ProjectAiSummaryService.name);
  private readonly inFlight = new Map<string, Promise<ProjectAiSummary>>();

  constructor(
    private readonly contexts: ProjectAiContextService,
    private readonly repository: ProjectAiSummaryRepository,
    private readonly model: ProjectAiModelClient,
    private readonly audit: AuditService,
    private readonly users: UserService,
    private readonly database: DatabaseService,
  ) {}

  /** 最近一次生成（不调用模型）；stale=true 表示当前数据已变化。 */
  async latest(projectId: string, actorId: string): Promise<ProjectAiSummary> {
    const context = await this.contexts.build(projectId, actorId);
    const sourceHash = hashProjectAiContext(context);
    const row = await this.repository.findLatest(projectId);
    if (row === null) throw new AppError("NOT_FOUND", "尚未生成 AI 项目总结");
    return this.toView(row, sourceHash);
  }

  /** 生成或复用缓存。 */
  async generate(projectId: string, actorId: string, force: boolean): Promise<ProjectAiSummary> {
    const context = await this.contexts.build(projectId, actorId);
    const sourceHash = hashProjectAiContext(context);

    if (!force) {
      const cached = await this.repository.findBySource(projectId, sourceHash, PROJECT_AI_PROMPT_VERSION);
      if (cached !== null) return this.toView(cached, sourceHash);
    }

    const key = projectId + ":" + sourceHash;
    const running = this.inFlight.get(key);
    if (running !== undefined) return running;

    const task = this.generateAndStore(context, projectId, actorId, sourceHash).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async generateAndStore(
    context: ProjectAiContext,
    projectId: string,
    actorId: string,
    sourceHash: string,
  ): Promise<ProjectAiSummary> {
    const generated = await this.model.summarize(context);
    const row = await this.repository.upsert({
      projectId,
      sourceHash,
      promptVersion: PROJECT_AI_PROMPT_VERSION,
      modelId: generated.modelId,
      summaryText: generated.summaryText,
      summaryJson: generated.summary as unknown as Record<string, unknown>,
      generatedBy: actorId,
    });
    await this.audit.record(this.database.db, {
      actorId,
      action: "create",
      objectType: "project_ai_summary",
      objectId: row.id,
      projectId,
      summary: "生成项目 AI 总结：" + context.project.name,
      metadata: {
        sourceHash: sourceHash.slice(0, 16),
        promptVersion: PROJECT_AI_PROMPT_VERSION,
        modelId: generated.modelId,
        tasks: context.tasks.length,
        reports: context.reports.length,
        issues: context.issues.length,
      },
    });
    this.logger.log(
      "AI 项目总结已生成：project=" + projectId + " model=" + generated.modelId + " hash=" + sourceHash.slice(0, 12),
    );
    return this.toView(row, sourceHash);
  }

  private async toView(row: ProjectAiSummaryRow, currentSourceHash: string): Promise<ProjectAiSummary> {
    return {
      id: row.id,
      projectId: row.projectId,
      sourceHash: row.sourceHash,
      promptVersion: row.promptVersion,
      modelId: row.modelId,
      summaryText: row.summaryText,
      summary: row.summaryJson as unknown as ProjectAiSummary["summary"],
      generatedBy: row.generatedBy,
      generatedByName: await this.nameOf(row.generatedBy),
      generatedAt: row.generatedAt.toISOString(),
      stale: row.sourceHash !== currentSourceHash,
    };
  }

  /** 姓名取不到（账号删除 / 停用后仍保留快照语义）时返回 null，前端显示「—」。 */
  private async nameOf(userId: string | null): Promise<string | null> {
    if (userId === null) return null;
    try {
      const user = await this.users.getUser(userId);
      return user.displayName;
    } catch {
      return null;
    }
  }
}
