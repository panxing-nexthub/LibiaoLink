import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ProjectViewGrantAddBodySchema, ProjectViewGrantPreviewBodySchema, UuidSchema, type z } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectViewGrantService } from "./project-view-grant.service.js";

const uuidParam = new ZodValidationPipe(UuidSchema);

@Controller("api/v1/projects/:id/view-grants")
@UseGuards(SessionGuard, CsrfGuard)
export class ProjectViewGrantController {
  constructor(private readonly grants: ProjectViewGrantService) {}

  @Get()
  list(@Param("id", uuidParam) id: string, @CurrentActorId() actorId: string) {
    return this.grants.list(id, actorId);
  }

  @Post("preview")
  @HttpCode(200)
  preview(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
    @Body(new ZodValidationPipe(ProjectViewGrantPreviewBodySchema)) body: z.infer<typeof ProjectViewGrantPreviewBodySchema>,
  ) {
    return this.grants.preview(id, actorId, body.text);
  }

  @Post()
  @HttpCode(200)
  add(
    @Param("id", uuidParam) id: string,
    @CurrentActorId() actorId: string,
    @Body(new ZodValidationPipe(ProjectViewGrantAddBodySchema)) body: z.infer<typeof ProjectViewGrantAddBodySchema>,
  ) {
    return this.grants.add(id, actorId, body.userIds);
  }

  @Delete(":userId")
  @HttpCode(204)
  async revoke(
    @Param("id", uuidParam) id: string,
    @Param("userId", uuidParam) userId: string,
    @CurrentActorId() actorId: string,
  ): Promise<void> {
    await this.grants.revoke(id, actorId, userId);
  }
}
