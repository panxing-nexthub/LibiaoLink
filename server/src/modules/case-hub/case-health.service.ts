import { Injectable } from "@nestjs/common";
import { CaseConfig } from "./case-config.module.js";
import { missingCaseConfig, type CaseRequiredConfigKey } from "./case-env.js";

export interface CaseReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface CaseReadinessReport {
  status: "ok" | "degraded";
  ok: boolean;
  checks: CaseReadinessCheck[];
}

@Injectable()
export class CaseHealthService {
  constructor(private readonly config: CaseConfig) {}

  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  /** L0 只检查配置是否齐备；真实 PG / 对象存储探针随 L5 适配器接入。 */
  readiness(): CaseReadinessReport {
    const missing = new Set<CaseRequiredConfigKey>(missingCaseConfig(this.config.env));
    const checks = [
      this.configCheck("case-storage:configured", "CASE_DATABASE_URL", missing),
      this.configCheck("object-storage:configured", "CASE_S3_BUCKET", missing),
      this.configCheck("auth:internal-token-configured", "CASE_INTERNAL_TOKEN", missing),
      this.configCheck("auth:client-jwks-configured", "CASE_CLIENT_JWKS_URL", missing),
    ];
    const ok = checks.every((check) => check.ok);
    return { status: ok ? "ok" : "degraded", ok, checks };
  }

  private configCheck(
    name: string,
    key: CaseRequiredConfigKey,
    missing: ReadonlySet<CaseRequiredConfigKey>,
  ): CaseReadinessCheck {
    return missing.has(key)
      ? { name, ok: false, detail: key + " 未配置" }
      : { name, ok: true };
  }
}
