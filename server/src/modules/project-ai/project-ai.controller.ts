import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { readFile } from "node:fs/promises";
import { readMultipartFile } from "../../common/http/multipart.js";
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
import { ProjectAiAgreementService } from "./project-ai-agreement.service.js";
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
    private readonly agreements: ProjectAiAgreementService,
  ) {}

  /** 项目 AI 上下文：项目 / 阶段 / 任务当前快照 / 变更 / 日报 / 问题（只取数，不调模型）。 */
  @Get(":id/ai-context")
  getContext(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
  ): Promise<ProjectAiContext> {
    return this.contexts.build(id, actorId);
  }

  /**
   * 技术协议抽取页图（P1）：只读、受项目可见性保护；字节由服务端从对象存储读取，
   * 不向浏览器暴露对象键或预签名地址。
   */
  @Get(":id/ai-agreement-images/:kind")
  async agreementImage(
    @Param("id", uuidParam) id: string,
    @Param("kind") kind: string,
    @Query("imageId") imageId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (kind !== "layout" && kind !== "three_d") {
      throw new BadRequestException("图片类型仅支持 layout / three_d");
    }
    const image = await this.agreements.image(id, kind, imageId === undefined || imageId === "" ? undefined : imageId);
    if (image === null) throw new NotFoundException("图片不存在");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", "inline");
    return new StreamableFile(image.bytes, { type: image.contentType, length: image.bytes.byteLength });
  }

  /** 人工追加设备布局图 / 三维图（multipart 字段 file；PNG / JPEG / WebP，≤ 10 MB；每类最多 12 张）。 */
  @Post(":id/ai-agreement-images/:kind")
  @HttpCode(200)
  @RequirePermission("project.export")
  async replaceAgreementImage(
    @Param("id", uuidParam) id: string,
    @Param("kind") kind: string,
    @CurrentActorId() actorId: string,
    @Req() request: Request,
    @Headers("content-type") contentType: string | undefined,
  ): Promise<{ ok: boolean }> {
    if (kind !== "layout" && kind !== "three_d") {
      throw new BadRequestException("图片类型仅支持 layout / three_d");
    }
    const upload = await readMultipartFile(request, contentType ?? null, "file", 10 * 1024 * 1024);
    if (upload === null) throw new BadRequestException("缺少上传文件（multipart 字段 file）");
    try {
      const body = await readFile(upload.path);
      const bytes = upload.offset === 0 ? body : body.subarray(upload.offset, upload.offset + upload.sizeBytes);
      await this.agreements.replace(id, kind, actorId, bytes, upload.contentType ?? "application/octet-stream");
      return { ok: true };
    } finally {
      await upload.cleanup();
    }
  }

  /** 移除一张人工设备布局图 / 三维图；全部移除后回落到技术协议自动抽取图。 */
  @Delete(":id/ai-agreement-images/:kind/:imageId")
  @HttpCode(200)
  @RequirePermission("project.export")
  async removeAgreementImage(
    @Param("id", uuidParam) id: string,
    @Param("kind") kind: string,
    @Param("imageId", uuidParam) imageId: string,
    @CurrentActorId() actorId: string,
  ): Promise<{ ok: boolean }> {
    if (kind !== "layout" && kind !== "three_d") {
      throw new BadRequestException("图片类型仅支持 layout / three_d");
    }
    await this.agreements.remove(id, kind, actorId, imageId);
    return { ok: true };
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
