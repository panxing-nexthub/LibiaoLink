import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { UuidSchema } from "@libiaolink/contracts";
import type { ProjectCompletionPosterSendResult, ProjectCompletionPosterStatus } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, RequirePermission } from "../permission/index.js";
import { ProjectCompletionPosterService } from "./completion-poster.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 项目完成喜报（R06）群同步接口（2026-11-25）：
 * 验收完成后由用户确认是否同步；归档接口不再自动发喜报；成功同步过一次后不再重复发送。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ProjectCompletionPosterController {
  constructor(private readonly posters: ProjectCompletionPosterService) {}

  /** 完成喜报同步状态：只有已成功送达群才返回 sent=true。 */
  @Get(":id/completion-poster")
  @RequirePermission("project.archive")
  status(@Param("id", uuidParam) id: string): Promise<ProjectCompletionPosterStatus> {
    return this.posters.status(id);
  }

  /** 同步完成喜报到项目群：已同步过返回 already_sent，不重复发送。 */
  @Post(":id/completion-poster")
  @HttpCode(200)
  @RequirePermission("project.archive")
  send(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectCompletionPosterSendResult> {
    return this.posters.send(id, actorId);
  }
}