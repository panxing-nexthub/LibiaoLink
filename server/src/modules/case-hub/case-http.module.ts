import { Module, type DynamicModule } from "@nestjs/common";
import { createLoggerModule } from "../../common/logging/logger.module.js";
import { CaseCoreModule } from "./case-core.module.js";
import { CaseHealthController } from "./case-health.controller.js";
import { CaseHealthService } from "./case-health.service.js";
import type { CaseEnv } from "./case-env.js";

/** case-api 的 HTTP 进程装配；不导入 core AppModule。 */
@Module({})
export class CaseHttpModule {
  static forRoot(env: CaseEnv): DynamicModule {
    return {
      module: CaseHttpModule,
      imports: [createLoggerModule(env, "case-api"), CaseCoreModule.forRoot(env)],
      controllers: [CaseHealthController],
      providers: [CaseHealthService],
    };
  }
}
