import { z } from "@libiaolink/contracts";

/** Case Hub 进程独立读取的环境变量；不复用 core 的 DATABASE_URL / S3_BUCKET。 */
export const CASE_REQUIRED_CONFIG_KEYS = [
  "CASE_DATABASE_URL",
  "CASE_S3_BUCKET",
  "CASE_INTERNAL_TOKEN",
  "CASE_CLIENT_JWKS_URL",
  "CASE_CLIENT_ISSUER",
  "CASE_CLIENT_AUDIENCE",
] as const;

export type CaseRequiredConfigKey = (typeof CASE_REQUIRED_CONFIG_KEYS)[number];

export const CaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CASE_API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  /** L0 允许为空：进程可以启动，/readyz 会把未配置项标成 degraded。 */
  CASE_DATABASE_URL: z.string().default(""),
  CASE_S3_BUCKET: z.string().default(""),
  CASE_INTERNAL_TOKEN: z.string().default(""),
  CASE_CLIENT_JWKS_URL: z.string().url().or(z.literal("")).default(""),
  CASE_CLIENT_ISSUER: z.string().url().or(z.literal("")).default(""),
  CASE_CLIENT_AUDIENCE: z.string().default(""),
  CASE_RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1_000_000).default(60),
  CASE_RATE_LIMIT_BURST: z.coerce.number().int().min(1).max(1_000_000).default(20),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type CaseEnv = z.infer<typeof CaseEnvSchema>;

export function missingCaseConfig(env: CaseEnv): CaseRequiredConfigKey[] {
  return CASE_REQUIRED_CONFIG_KEYS.filter((key) => env[key].trim() === "");
}

export function loadCaseEnv(source: Record<string, string | undefined> = process.env): CaseEnv {
  const parsed = CaseEnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => (issue.path.join(".") || "(root)") + "：" + issue.message)
      .join("；");
    throw new Error("Case Hub 环境变量校验失败 —— " + detail);
  }
  return parsed.data;
}
