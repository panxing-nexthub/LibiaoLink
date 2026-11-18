import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ProjectManagementRecordCreateBodySchema,
  ProjectManagementRecordUpdateBodySchema,
  UuidSchema,
  z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ProjectManagementAccessGuard } from "./project-management-access.guard.js";
import { ProjectManagementService } from "./project-management.service.js";

type ProjectManagementRecordCreateBody = z.infer<typeof ProjectManagementRecordCreateBodySchema>;
type ProjectManagementRecordUpdateBody = z.infer<typeof ProjectManagementRecordUpdateBodySchema>;

const uuidParam = new ZodValidationPipe(UuidSchema);

function parseVersionHeader(value: string | undefined): number {
  const raw = (value ?? "").trim().replace(/^W\/|^"|"$/g, "");
  const version = Number(raw);
  if (value === undefined || raw === "" || !Number.isInteger(version) || version < 0) {
    throw new AppError("VALIDATION_FAILED", "删除记录需要 If-Match: <version>");
  }
  return version;
}

/**
 * 项目管理独立准备记录接口（2026-11-17）。
 * 只要求登录 + CSRF，并叠加项目管理首批上线白名单；不读写任何项目空间数据。
 * 数据隔离：project_management_records；账号只用于经理 / 工程师候选与姓名解析。
 */
@Controller("api/v1/project-management-records")
@UseGuards(SessionGuard, CsrfGuard, ProjectManagementAccessGuard)
export class ProjectManagementController {
  constructor(private readonly records: ProjectManagementService) {}

  @Get()
  list() {
    return this.records.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(ProjectManagementRecordCreateBodySchema)) body: ProjectManagementRecordCreateBody,
    @CurrentActorId() _actorId: string,
  ) {
    return this.records.create(body);
  }

  @Patch(":id")
  update(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(ProjectManagementRecordUpdateBodySchema)) body: ProjectManagementRecordUpdateBody,
    @CurrentActorId() _actorId: string,
  ) {
    return this.records.update(id, body);
  }

  @Delete(":id")
  remove(
    @Param("id", uuidParam) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @CurrentActorId() _actorId: string,
  ) {
    return this.records.remove(id, parseVersionHeader(ifMatch));
  }
}
