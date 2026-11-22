import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { UuidSchema, type ProjectAiContext } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard } from "../permission/index.js";
import { ProjectAiContextService } from "./project-ai.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * AI 项目总结读面（只读）：GET /api/v1/projects/{id}/ai-context。
 * 读接口只要登录 + 记录级可见（非成员 / 不可见项目 404，由 ProjectAccessGuard 判定），不额外加功能权限位。
 * 本接口只聚合并返回数据，不调用任何模型、不写库；后续总结生成另开写接口。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ProjectAiContextController {
  constructor(private readonly contexts: ProjectAiContextService) {}

  /** 项目 AI 上下文：项目 / 阶段 / 任务当前快照 / 变更 / 日报 / 问题。 */
  @Get(":id/ai-context")
  getContext(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectAiContext> {
    return this.contexts.build(id, actorId);
  }
}
