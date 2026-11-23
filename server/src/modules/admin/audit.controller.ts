import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditLogListQuerySchema, canUseProjectManagement, z } from "@libiaolink/contracts";
import type { AuditLogListQuery, AuditLogListResponse } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, CurrentUser, SessionGuard, type MeUser } from "../identity/index.js";
import { GroupAccessGuard, PermissionService, RequireAccessPage } from "../permission/index.js";
import { AuditService } from "../audit/index.js";

/**
 * 审计接口（h7 · C7-04 服务端）：按对象（objectType + objectId）/ 操作人（actorId）/ 动作 / 结果 / 项目 / 时间区间检索。
 * 所有登录账号至少可查本人记录；项目经理追加当前有效管理项目的全部记录；系统管理员全量。
 * 页面与导出随 u12（px 线）；越权尝试用 result=denied 筛出（C7-03，告警随 M5 通知）。
 */
@Controller("api/v1/audit-logs")
@UseGuards(SessionGuard, CsrfGuard, GroupAccessGuard)
@RequireAccessPage("audit")
export class AuditLogsController {
  constructor(
    private readonly audits: AuditService,
    private readonly permission: PermissionService,
  ) {}

  /** 审计列表：occurredAt 降序（同毫秒按 id 降序）；管理员全量，其余按本人 / 有效管理项目复合过滤。 */
  @Get()
  async list(
    @Query(new ZodValidationPipe(AuditLogListQuerySchema)) query: AuditLogListQuery,
    @CurrentActorId() actorId: string,
    @CurrentUser() user: MeUser,
  ): Promise<AuditLogListResponse> {
    const access = await this.permission.auditAccessOf(actorId);
    return this.audits.list(query, {
      actorId,
      scope: access.scope,
      managedProjectIds: access.scope === "project_manager" ? access.managedProjectIds : [],
      canViewProjectManagement: canUseProjectManagement(user.email),
    });
  }
}
