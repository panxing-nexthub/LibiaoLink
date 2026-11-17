import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DatabaseService } from "../src/db/database.service.js";
import { CaseConfig } from "../src/modules/case-hub/case-config.module.js";
import { loadCaseEnv, missingCaseConfig } from "../src/modules/case-hub/case-env.js";
import { CaseHttpModule } from "../src/modules/case-hub/case-http.module.js";
import { CaseWorkerModule } from "../src/modules/case-hub/case-worker.module.js";
import { OutboxDispatcher } from "../src/outbox/dispatcher.js";
import { JobScheduler } from "../src/outbox/scheduler.js";

const completeEnv = loadCaseEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  CASE_DATABASE_URL: "postgres://case@127.0.0.1:5432/case",
  CASE_S3_BUCKET: "case-test",
  CASE_INTERNAL_TOKEN: "test-token",
  CASE_CLIENT_JWKS_URL: "https://idp.example.test/jwks",
  CASE_CLIENT_ISSUER: "https://idp.example.test",
  CASE_CLIENT_AUDIENCE: "case-exchange",
});

async function createHttpApp(env = completeEnv) {
  const moduleRef = await Test.createTestingModule({
    imports: [CaseHttpModule.forRoot(env)],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  await app.init();
  return app;
}

describe("Case Hub L0 运行骨架", () => {
  it("只加载 CASE_* 配置并提供可诊断的默认值", () => {
    const env = loadCaseEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    expect(env.CASE_API_PORT).toBe(3100);
    expect(env.CASE_DATABASE_URL).toBe("");
    expect(missingCaseConfig(env)).toEqual([
      "CASE_DATABASE_URL",
      "CASE_S3_BUCKET",
      "CASE_INTERNAL_TOKEN",
      "CASE_CLIENT_JWKS_URL",
      "CASE_CLIENT_ISSUER",
      "CASE_CLIENT_AUDIENCE",
    ]);
  });

  it("/healthz 返回存活响应", async () => {
    const app = await createHttpApp();
    const response = await request(app.getHttpServer()).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    await app.close();
  });

  it("/readyz 在关键配置齐备时返回 200", async () => {
    const app = await createHttpApp();
    const response = await request(app.getHttpServer()).get("/readyz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      ok: true,
      checks: [
        { name: "case-storage:configured", ok: true },
        { name: "object-storage:configured", ok: true },
        { name: "auth:internal-token-configured", ok: true },
        { name: "auth:client-jwks-configured", ok: true },
        { name: "auth:client-issuer-configured", ok: true },
        { name: "auth:client-audience-configured", ok: true },
      ],
    });
    await app.close();
  });

  it("/readyz 在关键配置缺失时返回 503，且不回显配置值", async () => {
    const env = loadCaseEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const app = await createHttpApp(env);
    const response = await request(app.getHttpServer()).get("/readyz");
    expect(response.status).toBe(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.ok).toBe(false);
    expect(response.body.checks.filter((check: { ok: boolean }) => !check.ok)).toHaveLength(6);
    expect(JSON.stringify(response.body)).not.toContain("test-token");
    await app.close();
  });

  it("保留调用方 X-Request-Id", async () => {
    const app = await createHttpApp();
    const response = await request(app.getHttpServer())
      .get("/healthz")
      .set("X-Request-Id", "case-runtime-test");
    expect(response.headers["x-request-id"]).toBe("case-runtime-test");
    await app.close();
  });

  it("case-api 不注册 core 数据库与 worker 运行时", async () => {
    const app = await createHttpApp();
    expect(app.get(CaseConfig)).toBeInstanceOf(CaseConfig);
    expect(() => app.get(DatabaseService, { strict: false })).toThrow();
    expect(() => app.get(OutboxDispatcher, { strict: false })).toThrow();
    expect(() => app.get(JobScheduler, { strict: false })).toThrow();
    await app.close();
  });

  it("case-worker 模块可以独立编译，且不注册 core 数据库与现有 worker 任务", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CaseWorkerModule.forRoot(completeEnv)],
    }).compile();
    expect(moduleRef.get(CaseConfig).env.CASE_API_PORT).toBe(3100);
    expect(() => moduleRef.get(DatabaseService, { strict: false })).toThrow();
    expect(() => moduleRef.get(OutboxDispatcher, { strict: false })).toThrow();
    expect(() => moduleRef.get(JobScheduler, { strict: false })).toThrow();
    await moduleRef.close();
  });
});
