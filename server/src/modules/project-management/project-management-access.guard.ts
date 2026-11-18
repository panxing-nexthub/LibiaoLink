import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { canUseProjectManagement } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import type { RequestWithUser } from "../identity/index.js";

/** 项目管理首批上线白名单守卫：必须在 SessionGuard 之后执行。 */
@Injectable()
export class ProjectManagementAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user !== undefined && canUseProjectManagement(request.user.email)) {
      return true;
    }
    throw new AppError("FORBIDDEN", "当前账号无权访问项目管理");
  }
}
