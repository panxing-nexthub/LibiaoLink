# Case Hub

当前实现是 L0 运行骨架，不进入 `core-api` / `core-worker` 的依赖注入图。

## L0 范围

- `entry/case-api.ts`：独立 HTTP 进程，提供 `/healthz` / `/readyz`。
- `entry/case-worker.ts`：独立 worker 进程，保持心跳但暂不注册任何案例任务。
- `case-core.module.ts`、`case-http.module.ts`、`case-worker.module.ts`：独立装配。
- `CASE_*` 配置：由 Case Hub 自己读取，不复用 core 的 `DATABASE_URL` / `S3_BUCKET`。
- 日志服务名固定为 `case-api` / `case-worker`，请求 ID 沿用公共 Pino 配置。

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
