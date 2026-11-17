import { Global, Module, type DynamicModule } from "@nestjs/common";
import { missingCaseConfig, type CaseEnv, type CaseRequiredConfigKey } from "./case-env.js";

export class CaseConfig {
  constructor(readonly env: CaseEnv) {}

  get missingRequired(): CaseRequiredConfigKey[] {
    return missingCaseConfig(this.env);
  }
}

/** Case Hub 独立配置模块：入口加载版本化 env 后注入，不读取 core 的 AppConfig。 */
@Global()
@Module({})
export class CaseConfigModule {
  static forRoot(env: CaseEnv): DynamicModule {
    return {
      module: CaseConfigModule,
      providers: [{ provide: CaseConfig, useValue: new CaseConfig(env) }],
      exports: [CaseConfig],
    };
  }
}
