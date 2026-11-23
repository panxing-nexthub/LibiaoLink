import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { UuidSchema, type ProjectDocumentAnalysisRun, type ProjectDocumentAnalysisView } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectAccessGuard, RequirePermission } from "../permission/index.js";
import { DocumentAnalysisService } from "./document-analysis.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 项目文件 AI 分析读/排队入口。
 * - GET：项目可见即可读，返回最近 run + 当前文件版本成功摘要。
 * - POST：需 project.export；只排队，不在 HTTP 请求内执行转换或模型调用。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard, ProjectAccessGuard)
export class DocumentAnalysisController {
  constructor(private readonly analyses: DocumentAnalysisService) {}

  @Get(":id/document-analysis")
  get(@Param("id", uuidParam) id: string): Promise<ProjectDocumentAnalysisView> {
    return this.analyses.latest(id);
  }

  @Post(":id/document-analysis")
  @HttpCode(200)
  @RequirePermission("project.export")
  enqueue(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectDocumentAnalysisRun> {
    return this.analyses.enqueue(id, actorId);
  }
}
