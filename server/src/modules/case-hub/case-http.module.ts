import { Module, type DynamicModule } from "@nestjs/common";
import { createLoggerModule } from "../../common/logging/logger.module.js";
import { CaseConfig } from "./case-config.module.js";
import { CaseCoreModule } from "./case-core.module.js";
import { CaseHealthController } from "./case-health.controller.js";
import { CaseHealthService } from "./case-health.service.js";
import type { CaseEnv } from "./case-env.js";
import { CaseTokenBucketRateLimiter } from "./case-rate-limit.js";

/** case-api 的 HTTP 进程装配；不导入 core AppModule。 */
@Module({})
export class CaseHttpModule {
  static forRoot(env: CaseEnv): DynamicModule {
    return {
      module: CaseHttpModule,
      imports: [createLoggerModule(env, "case-api"), CaseCoreModule.forRoot(env)],
      controllers: [CaseHealthController],
      providers: [
        CaseHealthService,
        {
          provide: CaseTokenBucketRateLimiter,
          inject: [CaseConfig],
          useFactory: (config: CaseConfig) =>
            new CaseTokenBucketRateLimiter({
              requestsPerMinute: config.env.CASE_RATE_LIMIT_REQUESTS_PER_MINUTE,
              burst: config.env.CASE_RATE_LIMIT_BURST,
            }),
        },
      ],
      exports: [CaseTokenBucketRateLimiter],
    };
  }
}
