# LibiaoLink 案例数据面（测试机）

更新时间：2026-11-20

范围：仅测试机 `10.1.104.44`（`libiao-vm` / `test-pm.libiaorobot.com`）；正式机 `10.1.103.44` 未触碰。

## 边界

- 案例业务操作、状态机、审核发布、外部读取和后端归案例小组；LibiaoLink 只托管独立案例数据面与项目摘要投影。
- 独立 Compose 项目：`libiaolink-case`。
- 核心业务表、核心 API、核心 worker、核心对象存储零改动。
- 核心侧唯一新增：项目摘要只读账号 `case_project_ro`，仅列级读取 `projects` 与 `users` 所需字段。
- 案例网关不判断审核、发布或撤回；公开读面只读取已发布视图。

## 资源布局

| 资源 | 测试机位置 |
|---|---|
| 案例 PostgreSQL 数据 | `/srv/case/libiaolink-case-postgres/18/docker` |
| 案例对象桶底层数据 | `/srv/data/minio`（位于数据盘 `/srv/data`） |
| 案例应用 | `/opt/libiaolink-case/app` |
| Compose | `/opt/libiaolink-case/deploy/docker-compose.yml` |
| 投影常驻覆盖文件 | `/opt/libiaolink-case/deploy/docker-compose.projection.yml` |
| 网关配置 | `/opt/libiaolink-case/deploy/gateway.env` |
| 边缘 Nginx | `/opt/libiaolink-case/deploy/edge/nginx.conf` |
| MinIO 策略 | `/opt/libiaolink-case/deploy/minio/case-gateway-policy.json` |
| 密钥目录 | `/opt/libiaolink-case/secrets`（目录 700，文件 600） |
| 服务身份元数据 | `/opt/libiaolink-case/config/service-identities.json` |
| 发布清单 | `/opt/libiaolink-case/CASE_DATA_RELEASE_MANIFEST.json`（SHA-256 `868ddee60c26c2744fdede9622fa771c4ed9f0007e8b212b839b67090afd44be`） |
| 配置包 | `/srv/case/staging/case-data-20261119-1526/case-data-config-20261119-1526.tar.gz`（SHA-256 `55db9e320e2671e7b354d32806c7afd0839672f1669fd96cb894836db759a017`，不含密钥） |
| 应用包 | `/srv/case/staging/libiaolink-case-20261120-1543.tgz`（SHA-256 `08b6b6813144c9b3d79194e02e23887dc409c2de74d0c949a5fdb022ed7698a3`） |

/srv/case 为 30G 独立分区；/srv/data 为 295G 数据盘。结构化数据与媒体对象分离。

## 网络与入口

| 入口 | 地址 | 监听范围 |
|---|---|---|
| 案例 PostgreSQL | `127.0.0.1:55432` | 仅宿主回环 |
| 案例网关 | `127.0.0.1:34602` | 仅宿主回环 |
| 案例边缘 Nginx | `172.18.0.1:34602` | 仅核心 Docker 网络网关地址 |
| 网关 API | `https://test-pm.libiaorobot.com/case-data/` | 公网 443 |
| 独立案例桶 S3 门面 | `https://test-pm.libiaorobot.com/libiaolink-case/` | 公网 443，仅签名请求 |

核心 Nginx 仅新增两个 location：`^~ /case-data/` 转发到 `case_gateway_backend`；`/libiaolink-case/` 原样转发到现有 MinIO upstream。`172.18.0.1` 是当前 `libiaolink-prod` 网络网关；若 Docker 网络重建，需要同步检查该地址。

## 数据库与迁移

- 数据库：`libiaolink_case`。
- 迁移账号：`case_migrator`；运行账号：`case_project_projection_rw`、`case_gateway_authoring_rw`、`case_operation_cleanup`、`case_gateway_public_ro`。
- 测试机已应用迁移：`0001` 至 `0013`；`0012` 为本地项目与合并目录，`0013` 修复本地项目写入触发器。迁移账本校验通过。
- 连接上限：投影 4、作者 6、清理 2、公开读 3。
- 核心投影账号：`case_project_ro`，连接上限 2，默认只读，语句超时 5s、锁超时 500ms、事务空闲超时 10s。

```sh
cd /opt/libiaolink-case/deploy
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm migrate node case-data/migrate.mjs --check

# 常驻秒级投影；本版本部署时必须启动
docker compose --profile tools -f docker-compose.yml -f docker-compose.projection.yml up -d projection
docker compose --profile tools -f docker-compose.yml -f docker-compose.projection.yml ps projection
docker compose --profile tools -f docker-compose.yml -f docker-compose.projection.yml logs --tail=50 projection

# 低频全量对账按需执行；若返回 busy，等待下一轮 watch 后再重试
docker compose --profile tools run --rm projection node case-data/project-projection.mjs reconcile
```

## 项目摘要实时刷新

- 投影服务必须常驻运行 `node case-data/project-projection.mjs watch`，并配置 `restart: unless-stopped`；不能用每 5 分钟执行一次的 `incremental` 代替。
- 默认 `CASE_PROJECTION_WATCH_MS=1000`，健康运行时核心项目新增、修改通常在 1 秒左右进入 `project_read.project_summary`。`CASE_PROJECTION_OVERLAP_SECONDS=300` 只是晚提交事务的安全回看窗口，不是刷新周期。
- 本地项目注册由网关直接写 `project_read.local_projects`，请求成功后立即进入 `project_directory`，不依赖核心投影任务。
- `watch` 正常运行输出 `started`，仅在发生变更时输出本轮统计；可恢复 SQL 错误写 `status: "error"` 后继续。角色或连接故障会以非零状态退出，由 Compose 重启策略拉起。
- 检查服务状态和最近输出：
  ```sh
  docker compose --profile tools -f docker-compose.yml -f docker-compose.projection.yml ps projection
  docker compose --profile tools -f docker-compose.yml -f docker-compose.projection.yml logs --tail=50 projection
  ```
- 2026-11-20 已部署 `0012`/`0013` 与常驻 `watch`；投影水位实测持续前进，单轮滞后约 0.2 秒。

## 对象桶与服务身份

- 桶：`libiaolink-case`，私有，版本控制已启用。
- MinIO 父用户：`libiaolink-case-gateway`；service account：`case-gateway`。
- 策略只允许 `GetBucketVersioning`、`cases/*` 前缀的 `ListBucketVersions`，以及 `cases/*` 的 `PutObject`、`GetObjectVersion`、`ListMultipartUploadParts`、`AbortMultipartUpload`。
- 网关只挂载 `secrets/gateway` 与 `secrets/public`；JWT 私钥在 `secrets/auth`，不进入网关容器。
- issuer：`https://test-pm.libiaorobot.com/case-data/issuer`；audience：`case-data-gateway`。
- 测试令牌位于 `secrets/tokens/`；`case-authoring-test-projects-write-20261120.jwt` 含 `case-data:projects:write`，有效期至 `2026-12-20T07:41:55Z`。旧公共/媒体令牌仍至 `2026-12-19T07:11:33Z`；换发使用 `deploy/scripts/mint-service-token.mjs`。

## 健康检查

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://test-pm.libiaorobot.com/healthz
curl -sS -o /dev/null -w "%{http_code}\n" https://test-pm.libiaorobot.com/readyz
curl -sS -o /dev/null -w "%{http_code}\n" https://test-pm.libiaorobot.com/case-data/healthz
curl -sS -o /dev/null -w "%{http_code}\n" https://test-pm.libiaorobot.com/case-data/readyz
```

`/case-data/readyz` 会检查案例库作者连接、公开读视图、独立桶访问和版本控制。

## 本地项目联调验收

- `POST /api/v1/projects` 为仅创建；更新和归档使用 `PATCH /api/v1/projects/{projectId}`，请求必须带当前 `sourceVersion` 作为 `expectedVersion`。
- 2026-11-20 实测：创建 `201`、更新 `200`、过期版本 `409 PROJECT_VERSION_CONFLICT`、归档 `200`、原 `operationId` 重放 `200`；核心项目 PATCH 返回 `409 PROJECT_SOURCE_READ_ONLY`。
- 实测本地项目 `01a1f7e9-5deb-71fb-b260-c1602f35243b`（`LOCAL-CASE-TEST-20261120-154355`）已归档，出现在合并目录，`project_summary` 无对应行；重复编号和跨来源项目 ID 均返回 `409`。

## 备份与回滚

- 核心 Nginx 原配置：`/srv/data/backups/nginx-libiaolink.conf.before-case-data-20261119-1525`，SHA-256 `b5ffbf7c8917acf006cd85232c556a020f9d75426fe374a7edce6873f4253e22`。
- 部署后 Nginx：SHA-256 `34e6bb6905961103c862a147684ed1da5be238eaafdf6640ba6f612708d2e8d8`；`nginx -t` 通过。
- 分区前 fstab 备份：`/srv/data/backups/fstab-before-case-20261119-150459`、`/srv/data/backups/fstab-before-case-mount-20261119-150523`。
- 本次 `0012` 前应用备份：`/srv/case/staging/case-data-20261120-153010/app-before.tgz`、`/srv/case/staging/case-data-20261120-153010/libiaolink_case-before-0012.dump`。
- 回滚入口：先 `docker compose --profile tools -f docker-compose.yml -f docker-compose.projection.yml stop projection`，再停止 `libiaolink-case` Compose，恢复上述 Nginx 备份并 `nginx -t` / `nginx -s reload`；保留 `/srv/case` 与桶数据，按需再撤销 `case_project_ro` 与 MinIO 身份。
- 不得直接修改正式机；正式发布只走 `10.1.103.44` 与仓库发布流程。

## 已知事项

- MinIO 备用入口 `https://127.0.0.1:9443` 证书将于 `2026-12-01` 到期，需在到期前续签。
- 测试机 Docker 本地镜像固定为：PostgreSQL `74935e722416`、Node `44fce696f38b`、Nginx `0985e772fb9f`。
- PostgreSQL 18 的挂载根为 `/var/lib/postgresql`，实际簇目录为版本化子目录，不要改回旧挂载点。
