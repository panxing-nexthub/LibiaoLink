import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import {
  ProjectAiSummaryGenerateBodySchema,
  UuidSchema,
  type ProjectAiContext,
  type ProjectAiSummary,
  type ProjectAiSummaryGenerateBody,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, RequirePermission } from "../permission/index.js";
import { ProjectAiContextService } from "./project-ai-context.service.js";
import { ProjectAiSummaryService } from "./project-ai-summary.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);
const bodyPipe = new ZodValidationPipe(ProjectAiSummaryGenerateBodySchema);

/**
 * AI 项目总结接口。
 * - GET 读面 / 缓存：登录 + 项目记录级可见（不可见 404）。
 * - POST 生成：额外要求 project.export —— 生成会把项目数据发送到外部模型服务，属于数据出站动作，
 *   用「可导出项目数据」作权限门禁；不新增权限位、不改权限矩阵。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ProjectAiContextController {
  constructor(
    private readonly contexts: ProjectAiContextService,
    private readonly summaries: ProjectAiSummaryService,
  ) {}

  /** 项目 AI 上下文：项目 / 阶段 / 任务当前快照 / 变更 / 日报 / 问题（只取数，不调模型）。 */
  @Get(":id/ai-context")
  getContext(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectAiContext> {
    return this.contexts.build(id, actorId);
  }

  /** 最近一次 AI 总结（不调模型）；未生成过返回 404，stale=true 表示数据已变化。 */
  @Get(":id/ai-summary")
  getSummary(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectAiSummary> {
    return this.summaries.latest(id, actorId);
  }

  /** 生成 AI 总结：默认复用缓存，force=true 强制重新生成；模型失败不写缓存。 */
  @Post(":id/ai-summary")
  @HttpCode(200)
  @RequirePermission("project.export")
  generateSummary(
    @Param("id", uuidParam) id: string,
    @Body(bodyPipe) body: ProjectAiSummaryGenerateBody,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectAiSummary> {
    return this.summaries.generate(id, actorId, body.force);
  }
}
