import { Module, type DynamicModule } from "@nestjs/common";
import { CaseConfigModule } from "./case-config.module.js";
import type { CaseEnv } from "./case-env.js";

/** Case Hub 领域 / 配置底座；L0 不注册领域服务，避免抢跑 M0 契约。 */
@Module({})
export class CaseCoreModule {
  static forRoot(env: CaseEnv): DynamicModule {
    return {
      module: CaseCoreModule,
      imports: [CaseConfigModule.forRoot(env)],
      exports: [CaseConfigModule],
    };
  }
}
