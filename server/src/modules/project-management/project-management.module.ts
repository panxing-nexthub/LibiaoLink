import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { ProjectManagementController } from "./project-management.controller.js";
import { ProjectManagementRepository } from "./project-management.repository.js";
import { ProjectManagementService } from "./project-management.service.js";
import { ProjectManagementSnapshotRepository } from "./project-management-snapshot.repository.js";

/**
 * project-management 模块：项目管理页的独立准备记录。
 * 只依赖 identity（登录 / 账号）与 permission（复用项目经理资格名单）；项目当前阶段 / 实施日期通过
 * ProjectManagementSnapshotRepository 直读 projects / tasks 的只读快照，不 import project / task 领域模块，
 * 不建立外键、不写项目空间。
 */
@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [ProjectManagementController],
  providers: [ProjectManagementRepository, ProjectManagementSnapshotRepository, ProjectManagementService],
})
export class ProjectManagementModule {}
