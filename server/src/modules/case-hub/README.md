# Case Hub

当前实现是 L0 运行骨架，不进入 `core-api` / `core-worker` 的依赖注入图。

## L0 范围

- `entry/case-api.ts`：独立 HTTP 进程，提供 `/healthz` / `/readyz`。
- `entry/case-worker.ts`：独立 worker 进程，保持心跳但暂不注册任何案例任务。
- `case-core.module.ts`、`case-http.module.ts`、`case-worker.module.ts`：独立装配。
- `CASE_*` 配置：由 Case Hub 自己读取，不复用 core 的 `DATABASE_URL` / `S3_BUCKET`。
- 日志服务名固定为 `case-api` / `case-worker`，请求 ID 沿用公共 Pino 配置。

## L1 边界

- 只有 `entry/case-api.ts` / `entry/case-worker.ts` 可以装配 `case-hub`；core 入口、`AppModule`、`WorkerModule` 和其他业务模块不得依赖它。
- `case-hub` 只允许依赖本模块以及 `common` / `config` / `db` / `storage` 等基础设施，不得 import `project`、`task`、`file` 等领域模块或 core outbox。
- `case-api` / `case-worker` 的入口依赖同样限定为 `case-hub` 与基础设施，避免间接把 core 运行时带进独立进程。
- `npm run check:boundaries` 静态检查上述依赖方向；`case-hub-runtime.test.ts` 同时验证进程装配中不存在 core `DatabaseService`、`OutboxDispatcher` 与 `JobScheduler`。

## 明确未实现

- 草稿 controller、认证、Scope、案例授权、字段脱敏。
- 幂等、ETag / If-Match、限流和外部交换接口。
- SQL 仓储、案例对象存储、发布快照和案例任务。
- D01 / D02 / D03 / D06 的未冻结业务语义。

L0 的 `/readyz` 只检查关键配置是否齐备；真实案例数据库和对象存储探针随 L5 适配器接入。配置为空时进程仍可启动，但 `/readyz` 返回 503，避免把骨架误判为可接流量。

## 命令

```bash
cd server
npm run build
npm run start:case-api
npm run start:case-worker
```

开发模式分别使用 `npm run dev:case-api` / `npm run dev:case-worker`。
