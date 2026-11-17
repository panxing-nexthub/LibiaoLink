import { Module, type DynamicModule } from "@nestjs/common";
import { createLoggerModule } from "../../common/logging/logger.module.js";
import { CaseCoreModule } from "./case-core.module.js";
import type { CaseEnv } from "./case-env.js";

/** case-worker 的进程装配；L0 不注册案例任务。 */
@Module({})
export class CaseWorkerModule {
  static forRoot(env: CaseEnv): DynamicModule {
    return {
      module: CaseWorkerModule,
      imports: [createLoggerModule(env, "case-worker"), CaseCoreModule.forRoot(env)],
    };
  }
}
