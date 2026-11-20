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
| 发布清单 | `/opt/libiaolink-case/CASE_DATA_RELEASE_MANIFEST.json`（以服务器当前文件 `sha256sum` 为准） |
| 配置包 | `/srv/case/staging/case-data-20261119-1526/case-data-config-20261119-1526.tar.gz`（SHA-256 `55db9e320e2671e7b354d32806c7afd0839672f1669fd96cb894836db759a017`，不含密钥） |
| 应用包 | `/srv/case/staging/case-data-20261120-1957/libiaolink-case-20261120-1957.tgz`（SHA-256 `d2197ab93678e71df463f1d802a746c56e5aeb305c2720a9e0b46edf9a6ac925`，648,970 B） |

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
- 测试机已应用迁移：`0001` 至 `0014`；`0014` 补齐本地项目软删除、案例版本与语言分组、项目级素材、素材版本、跨案例挂接和 `projects/*` 对象授权。迁移账本 14 项校验通过，`migrate.mjs --check` 通过。
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
- 2026-11-20 已部署 `0012`/`0013`/`0014` 与常驻 `watch`；投影水位持续前进，历史实测单轮滞后约 0.2 秒。离线双库 watch 用例新增项目后 904 ms 读回，远小于 5 分钟。

## 对象桶与服务身份

- 桶：`libiaolink-case`，私有，版本控制已启用。
- MinIO 父用户：`libiaolink-case-gateway`；service account：`case-gateway`。
- 生效策略：`libiaolink-case-gateway-v2`。允许 `GetBucketVersioning`；`ListBucketVersions` 前缀为 `cases/*`、`projects/*`；`GetObjectVersion` 覆盖两前缀；`PutObject`、`ListMultipartUploadParts`、`AbortMultipartUpload` 只允许 `projects/*`。旧策略 `libiaolink-case-gateway` 已从父用户解绑，保留用于回滚。
- 实测：经网关向 `projects/*` 上传 PNG 与 AVIF 成功；使用同一网关凭据写 `cases/*` 返回权限拒绝。新对象键为 `projects/{projectId}/assets/{assetId}/{assetVersionId}`。
- 网关只挂载 `secrets/gateway` 与 `secrets/public`；JWT 私钥在 `secrets/auth`，不进入网关容器。
- issuer：`https://test-pm.libiaorobot.com/case-data/issuer`；audience：`case-data-gateway`。
- 完整作者令牌：`secrets/tokens/case-authoring-test-remote-primary-20261120.jwt`，到期 `2026-12-20T11:58:09Z`；包含 `projects:read/write`、`project-data:read/write`、`cases:read/write`、`assets:read/write`、`releases:read/write`、`releases:history:read`、`operations:read`。不包含 `assets:process`。
- 媒体身份继续使用独立 `case-media-test` 的 `case-data:assets:process`；公开身份使用 `case-public-test` 的 `case-data:releases:read`。旧 `case-authoring-test-projects-write-20261120.jwt` 保留作短期回退。

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
- 2026-11-20 完整远端验收通过：本地项目 `01a1f8d4-4f30-72c2-8a12-bdbd0234a20e`（`REMOTE-P0-5176025525`）创建 `201`、按 ID 立即读取 `200`、profile 首次 `201`、重读 `200`、过期 profile `409`。
- 项目更新后 `sourceVersion` 2 → 归档 3 → 解档 4 → 软删除 5（GET 404）→ 恢复 6（GET 200）。重复编号 `409 PROJECT_CODE_EXISTS`、跨来源项目 ID `409 PROJECT_ID_EXISTS`、核心项目 PATCH `409 PROJECT_SOURCE_READ_ONLY`。
- 该本地项目在 `project_directory` 可读，`project_summary` 对应行数为 0；`project_code_claim` 有唯一编号占用。

## 备份与回滚

- 核心 Nginx 原配置：`/srv/data/backups/nginx-libiaolink.conf.before-case-data-20261119-1525`，SHA-256 `b5ffbf7c8917acf006cd85232c556a020f9d75426fe374a7edce6873f4253e22`。
- 部署后 Nginx：SHA-256 `34e6bb6905961103c862a147684ed1da5be238eaafdf6640ba6f612708d2e8d8`；`nginx -t` 通过。
- 分区前 fstab 备份：`/srv/data/backups/fstab-before-case-20261119-150459`、`/srv/data/backups/fstab-before-case-mount-20261119-150523`。
- 本次 `0014` 前应用备份：`/srv/case/staging/case-data-20261120-1957/app-before-0014.tgz`（SHA-256 `afb815bd91f7e0dbc6a11e4844cc5709a22ea6a6da96cdadfa9f74dfbe4d5c3f`）。
- 本次 `0014` 前数据库备份：`/srv/case/staging/case-data-20261120-1957/libiaolink_case-before-0014.dump`（SHA-256 `af87f96a1804c05c39185d6e4130e0b5e50a273819faf32180529c32d158c59f`）。
- 历史 `0012` 前备份：`/srv/case/staging/case-data-20261120-153010/app-before.tgz`、`/srv/case/staging/case-data-20261120-153010/libiaolink_case-before-0012.dump`。
- `0014` 回滚入口：停 `projection`、`gateway`，恢复 `app-before-0014.tgz` 到 `/opt/libiaolink-case/app`，再由数据库管理员恢复 `libiaolink_case-before-0014.dump`；`0014` 是 forward-only，不执行逆向 SQL。随后启动旧网关与投影，并复核健康检查。对象桶保留新 `projects/*` 对象与版本；如需撤销新策略，将 `libiaolink-case-gateway` 重新挂回父用户，再解绑 `libiaolink-case-gateway-v2`。
- 不得直接修改正式机；正式发布只走 `10.1.103.44` 与仓库发布流程。

## 已知事项

- MinIO 备用入口 `https://127.0.0.1:9443` 证书将于 `2026-12-01` 到期，需在到期前续签。
- LocalStack 社区版 4.8.1 不能稳定执行 IAM 拒绝断言；该项仅在离线测试用能力开关跳过，测试机已用真实 MinIO 做拒绝验收。
- 本轮未部署正式机；正式机仍需另立发布窗口，禁止复用测试消息中的任何临时对象或令牌。
- 测试机 Docker 本地镜像固定为：PostgreSQL `74935e722416`、Node `44fce696f38b`、Nginx `0985e772fb9f`。
- PostgreSQL 18 的挂载根为 `/var/lib/postgresql`，实际簇目录为版本化子目录，不要改回旧挂载点。
