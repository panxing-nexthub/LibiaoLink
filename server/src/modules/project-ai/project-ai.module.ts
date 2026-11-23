import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/index.js";
import { FileModule } from "../file/index.js";
import { IdentityModule } from "../identity/index.js";
import { ModelConfigModule } from "../model-config/index.js";
import { PermissionModule } from "../permission/index.js";
import { ProjectModule } from "../project/index.js";
import { ReportIssueModule } from "../report-issue/index.js";
import { TaskModule } from "../task/index.js";
import { ProjectAiContextController } from "./project-ai.controller.js";
import { ProjectAiContextService } from "./project-ai-context.service.js";
import { ProjectAiModelClient } from "./project-ai.model.js";
import { ProjectAiSummaryRepository } from "./project-ai-summary.repository.js";
import { ProjectAiSummaryService } from "./project-ai-summary.service.js";

/**
 * AI 项目总结（领域模块）：
 * - 读面：只读聚合 project / flow / task / file(change) / report-issue + 用户目录姓名。
 * - 生成：读面 → 模型（model-config 当前启用模型）→ project_ai_summaries 缓存 + 审计。
 * 依赖方向 = 领域 → 领域 + 平台（model-config / admin 审计）；不改动既有模块内部实现。
 */
@Module({
  imports: [
    IdentityModule,
    PermissionModule,
    AdminModule,
    ModelConfigModule,
    ProjectModule,
    TaskModule,
    ReportIssueModule,
    FileModule,
  ],
  controllers: [ProjectAiContextController],
  providers: [ProjectAiContextService, ProjectAiSummaryRepository, ProjectAiModelClient, ProjectAiSummaryService],
  exports: [ProjectAiContextService, ProjectAiSummaryService],
})
export class ProjectAiModule {}
