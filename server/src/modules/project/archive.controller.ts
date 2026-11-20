import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ProjectArchiveBodySchema, ProjectUnarchiveBodySchema, UuidSchema } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, RequirePermission } from "../permission/index.js";
import { ArchiveService } from "./archive.service.js";
import type { ArchiveRequestBody, UnarchiveRequestBody, ProjectArchiveView } from "./archive.service.js";
import type { ProjectView } from "./project.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 归档接口（M7-04 · C4-02 / C4-03 · ADR-027）：契约 shared/src/modules/projects.ts。
 * 读接口要求登录 + 记录级可见（不可见 404）；归档写接口叠加 CsrfGuard + 功能权限位 project.archive，
 * 服务层再按最终项目编辑权判定（与阶段推进同口径；所管项目经理已计入，非所管项目不提升）。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  /** 归档：按验收结果校验，生成带归档类型的清单。 */
  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermission("project.archive")
  archiveProject(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(ProjectArchiveBodySchema)) body: ArchiveRequestBody,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectArchiveView> {
    return this.archive.archiveProject(id, body, actorId);
  }

  /** 恢复为进行中：仅归档项目可恢复；保留最近一次归档清单，写审计并递增 version。 */
  @Post(":id/unarchive")
  @HttpCode(200)
  @RequirePermission("project.archive")
  restoreArchivedProject(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(ProjectUnarchiveBodySchema)) body: UnarchiveRequestBody,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectView> {
    return this.archive.restoreArchivedProject(id, body, actorId);
  }

  /** 归档清单读面（C4-03）：归档时点 + 统计口径 + 文件清单含版本；未归档 404。 */
  @Get(":id/archive")
  getArchive(@Param("id", uuidParam) id: string): Promise<ProjectArchiveView> {
    return this.archive.getArchive(id);
  }
}
