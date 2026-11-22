import { Module } from "@nestjs/common";
import { FileModule } from "../file/index.js";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { ProjectModule } from "../project/index.js";
import { ReportIssueModule } from "../report-issue/index.js";
import { TaskModule } from "../task/index.js";
import { ProjectAiContextController } from "./project-ai.controller.js";
import { ProjectAiContextService } from "./project-ai.service.js";

/**
 * AI 项目总结读面（领域模块）：只读聚合 project / flow / task / file(change) / report-issue + 用户目录姓名。
 * 不引入模型调用、不写库、不投递 outbox —— 后续总结生成再单独接 model-config 与缓存表。
 * 依赖方向 = 领域 → 领域（与 project-export 同构）；不改动任何既有模块的内部实现。
 */
@Module({
  imports: [IdentityModule, PermissionModule, ProjectModule, TaskModule, ReportIssueModule, FileModule],
  controllers: [ProjectAiContextController],
  providers: [ProjectAiContextService],
  exports: [ProjectAiContextService],
})
export class ProjectAiModule {}
