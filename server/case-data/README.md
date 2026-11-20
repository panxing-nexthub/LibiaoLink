# 案例数据面迁移

迁移只在独立 PostgreSQL 实例的 `libiaolink_case` 数据库执行。首条迁移创建 `project_read.project_summary`，供项目投影任务写入；`0012` 新增本地项目、跨来源编号占用和合并目录视图，`0013` 修正本地项目写入触发器的字段读取，`0014` 补齐远端主存项目软删除、案例版本与语言分组、项目级素材、素材版本和跨案例挂接。迁移记录保存在案例库的 `"case".case_schema_migrations`。

## 角色与权限

由实例管理员创建案例库并配置专用 `case_migrator` 登录角色，授予案例库的 `CONNECT` 和 `CREATE` 权限以创建迁移所需的 schema。角色使用 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`，凭据通过受控渠道注入。

实例管理员在案例库执行运行角色脚本。空库初始化以及升级到新增角色的 `0007`、`0009` 时，都先运行该脚本再运行迁移器。

```sh
psql --dbname libiaolink_case -v ON_ERROR_STOP=1 -f server/case-data/roles/0001_project_read_roles.sql
```

运行角色使用各自独立凭据。`0002_project_read_permissions.sql` 按下表授予权限。

| 数据库角色 | 项目目录权限 |
|---|---|
| `case_project_projection_rw` | `project_summary` 的 `SELECT`、`INSERT`、`UPDATE`，用于更新核心摘要和对账标记 |
| `case_gateway_authoring_rw` | `project_summary` / `project_directory` 的 `SELECT`；`local_projects` 的 `SELECT`、`INSERT`、`UPDATE` |

两个运行角色均只获得 `project_read` 的 `USAGE`，表权限如上。项目缺失通过对账标记保留历史，表结构和迁移账本由 `case_migrator` 管理。`project_summary` 的字段、投影写入角色和网关读取权限保持不变；本地项目不写入该表。公开发布服务使用单独角色，按发布读面另行授权。

`project_code_claim` 只由迁移角色和 security definer 触发器维护，两个运行角色均无直接权限；`project_directory` 使用 `security_invoker`，继续按调用者权限读取两个来源。

## 运行迁移

在受控目录挂载 `case_migration_database_url`，文件为仅所有者可访问的普通文件。内容为 `case_migrator` 连接独立案例库的完整 PostgreSQL 连接串。生产连接使用 TLS。安装 `server/` 的锁定依赖后，用 Node 24 在仓库根目录运行。

```sh
CASE_MIGRATION_SECRET_DIR=/path/to/mounted/secrets node server/case-data/migrate.mjs
```

迁移器在写入前核验连接的数据库、角色和核心库标记。迁移文件按文件名顺序执行，使用数据库锁串行化。每个文件的 SQL 和校验和记录在同一个事务内提交。复跑只应用追加文件，已有文件发生内容或顺序漂移时停止执行。迁移 SQL 文件由迁移器管理事务边界。

恢复验收可加 `--check` 仅读迁移账本。账本缺失、落后或校验和漂移时退出失败，数据库保持原状态。

## 项目摘要投影

核心库管理员用 `psql -v ON_ERROR_STOP=1` 在核心 `libiaolink` 执行 `roles/core_project_read.sql`。该文件只配置 `case_project_ro` 和项目、经理字段的列级授权。账号默认只读，连接上限为 2，语句、锁及事务空闲超时分别为 5 秒、500 毫秒、10 秒。生产投影优先连接已有只读节点。

案例库应用 `0003_project_projection_state.sql` 后，为投影任务挂载两个独立连接串文件 `case_project_ro_database_url` 和 `case_project_projection_rw_database_url`。文件权限和 TLS 要求同迁移凭据。项目目录默认以常驻 `watch` 模式执行秒级增量，低频全量对账单独调度；`CASE_PROJECTION_OVERLAP_SECONDS` 只是长事务安全回看窗口，不是刷新周期。

```sh
CASE_PROJECTION_SECRET_DIR=/path/to/mounted/secrets node server/case-data/project-projection.mjs incremental
CASE_PROJECTION_SECRET_DIR=/path/to/mounted/secrets node server/case-data/project-projection.mjs watch
CASE_PROJECTION_SECRET_DIR=/path/to/mounted/secrets node server/case-data/project-projection.mjs reconcile
```

| 环境变量 | 缺省值 | 作用 |
|---|---:|---|
| `CASE_PROJECTION_BATCH_SIZE` | 100 | 增量与全量 ID 扫描的每页条数，允许 1–500 |
| `CASE_PROJECTION_BATCH_PAUSE_MS` | 25 | 满批后的暂停毫秒数，允许 0–1000 |
| `CASE_PROJECTION_WATCH_MS` | 1000 | `watch` 每轮增量间隔毫秒数，允许 250–60000 |
| `CASE_PROJECTION_OVERLAP_SECONDS` | 300 | 增量安全回看窗口秒数（不是刷新周期），允许 1–86400 |

增量以 `(updated_at, id)` 分页，分别维护项目和经理水位。每次运行读取同一核心只读快照，摘要和水位在案例库同事务提交。对账按 UUID 扫描源项目，补读缺失或版本、时间戳、归档和删除标志变化的摘要，并核对经理显示名。连续两次成功对账均缺失时写 `source_missing_at`，摘要继续保留。再次观察到项目时清除缺失标记。

`incremental` 适合外部定时器；`watch` 是生产默认的常驻模式，默认每 1 秒扫描一次，项目目录变更通常在秒级可见；`reconcile` 保持低频全量对账。两种一次性模式与 `watch` 共用案例库事务锁，同一时刻只运行一个任务。并发调用返回 `status: "busy"`。`watch` 对可恢复的 SQL 错误写结构化错误日志后继续下一轮；角色配置或连接故障以非零退出码结束，必须由 Docker / systemd 等进程守护立即重启。部署时必须持续运行 `watch`，不能只用一次性 `incremental` 代替。成功输出包含读取页数、行数、变更计数和耗时，增量另返回本次水位。调度周期和批次参数以运行环境的容量验收为准。

## 项目目录网关

`gateway.mjs` 是独立 HTTP 入口，默认监听 `127.0.0.1:34602`。它以 `case_gateway_authoring_rw` 连接案例库，每次目录查询运行在只读事务中。`GET /healthz` 检查进程，`GET /readyz` 检查案例库连接身份与目录查询权限。

在 `CASE_GATEWAY_SECRET_DIR` 指向的受控目录放置以下仅所有者可访问的文件。

| 文件 | 内容 |
|---|---|
| `case_gateway_authoring_rw_database_url` | 案例库作者角色的完整 PostgreSQL 连接串 |
| `case_gateway_public_jwks` | 测试签发方的 RS256 公钥集合，含唯一 `kid` |
| `case_gateway_cursor_key` | 独立生成的 32 字节随机密钥，用 64 个十六进制字符保存 |

```sh
CASE_GATEWAY_SECRET_DIR=/path/to/mounted/secrets \
CASE_GATEWAY_TOKEN_ISSUER=https://case-gateway.example.test/issuer \
CASE_GATEWAY_TOKEN_AUDIENCE=case-data-gateway \
node server/case-data/gateway.mjs
```

`GET /api/v1/projects` 要求 `Authorization: Bearer <access_token>` 和 `case-data:projects:read` Scope；`POST /api/v1/projects` 与 `PATCH /api/v1/projects/{projectId}` 要求 `case-data:projects:write`。当前本地签发方以 `sub == client_id` 表示服务账号。网关核对签名、令牌类型、签发方、受众和有效期。JWKS 在启动时加载，替换本地公钥后重启进程。实际签发方、密钥轮换接入和 mTLS 方式待 C02 冻结。[JWT access token profile](https://www.rfc-editor.org/rfc/rfc9068.html) · [JWT 验证实践](https://www.rfc-editor.org/rfc/rfc8725.html)

项目目录把核心只读投影与本地项目按 UUID 合并，使用绑定筛选条件的签名游标升序查询。归档项目可见，软删除和源缺失项目排除。本地项目只在 `libiaolink_case.project_read.local_projects` 保存，不进入核心库；`project_summary` 仍是核心单向投影。首次投影前的核心目录项为空，但已注册的本地项目仍可列出；数据库或查询权限不可用时返回 503。可用 `CASE_GATEWAY_PORT` 覆盖本地端口。

目录的参数和返回字段已纳入独立 [OpenAPI](../../shared/generated/case-data-openapi.json)，运行时复用 Zod 契约。本地项目注册沿用写入协议：请求体必须携带 UUIDv7 `operationId`、`operatorUserKey`，同一操作键重放首次结果。

```json
{
  "operationId": "0190d2e4-a020-7000-8000-000000000001",
  "operatorUserKey": "case-author-001",
  "projectCode": "LOCAL-2026-001",
  "projectName": "本地新建项目",
  "customerText": "示例客户",
  "region": "华南",
  "projectType": "分拣",
  "managerIds": [],
  "managerNames": [],
  "status": "active"
}
```

`externalProjectId` 可省略，由案例库生成 UUIDv7；若提供则同时参与全局唯一校验。项目 ID 在所有核心历史摘要与本地项目之间永久唯一；项目编号在目录可用项范围内跨来源唯一，即软删除或 `source_missing_at` 的历史摘要不占编号，核心在册/归档项目与全部本地项目（含归档）占编号。若源缺失的核心项目带同号重新出现，约束会让投影失败并保留冲突供人工处理，不会静默产生重号。冲突返回 409 `PROJECT_CODE_EXISTS`，项目 ID 冲突返回 409 `PROJECT_ID_EXISTS`。创建成功后返回 201 与目录项；核心 `project_summary` 不增加任何本地行。

`PATCH /api/v1/projects/{projectId}` 只更新本地项目；`externalProjectId` 不可变，可更新项目编号、名称、客户、区域、类型、经理和状态。请求必须带 `expectedVersion`（即目录项的 `sourceVersion`），命中后原子递增版本并更新 `updatedAt`/`syncedAt`；版本不一致返回 409 `PROJECT_VERSION_CONFLICT`。`status: "archived"` 会设置 `archivedAt`，改回其它状态会清空 `archivedAt`。核心投影项目返回 409 `PROJECT_SOURCE_READ_ONLY`；更新项目编号仍执行跨来源唯一校验，并沿用 `operationId` 幂等。`deleted: true` 软删除后按 ID 返回 404，`deleted: false` 恢复；归档仍占编号，软删除释放编号，恢复时若编号已被占用返回 409 `PROJECT_CODE_EXISTS`。

```json
{
  "operationId": "0190d2e4-a020-7000-8000-000000000002",
  "operatorUserKey": "case-author-001",
  "expectedVersion": 1,
  "projectName": "本地新建项目（已归档）",
  "status": "archived"
}
```

## 远端主存 P0 接口（OpenAPI 1.8.0）

`0014` 之后，项目、案例和素材均以 `libiaolink_case` 与案例版本化对象桶为主存。接口成功响应均表示业务事务已提交；随后按资源 ID 立即读取使用同一案例库，不依赖项目投影周期。核心项目摘要仍由常驻 `watch` 以 1 秒默认间隔进入 `project_summary`，300 秒只是晚提交事务回看窗口。

| 能力 | 接口 |
|---|---|
| 合并目录分页 | `GET /api/v1/projects` |
| 本地项目注册（仅创建） | `POST /api/v1/projects` |
| 按 ID 读取目录项 | `GET /api/v1/projects/{projectId}` |
| 更新、归档、软删除、恢复 | `PATCH /api/v1/projects/{projectId}` |
| 项目下案例分页与过滤 | `GET /api/v1/projects/{projectId}/cases` |
| 创建案例 | `POST /api/v1/projects/{projectId}/cases` |
| 案例读取与更新 | `GET/PATCH /api/v1/cases/{caseId}` |
| 案例历史版本 | `GET /api/v1/cases/{caseId}/versions`、`GET /api/v1/cases/{caseId}/versions/{versionId}` |
| 恢复历史版本 | `POST /api/v1/cases/{caseId}/versions/{versionId}/restore` |
| 同语言翻译组 | `GET /api/v1/cases/{caseId}/translations` |
| 项目级素材上传 | `POST /api/v1/projects/{projectId}/uploads` |
| 案例素材上传 | `POST /api/v1/cases/{caseId}/uploads` |
| 项目或案例素材列表 | `GET /api/v1/projects/{projectId}/assets`、`GET /api/v1/cases/{caseId}/assets` |
| 素材详情与版本 | `GET /api/v1/assets/{assetId}`、`GET /api/v1/assets/{assetId}/versions` |
| 素材元数据更新 | `PATCH /api/v1/assets/{assetId}` |
| 跨案例挂接与解除 | `PUT/DELETE /api/v1/assets/{assetId}/cases/{caseId}` |
| 作者预览与下载票据 | `GET /api/v1/assets/{assetId}/versions/{assetVersionId}/preview-ticket`、`.../download-ticket` |

- `POST /api/v1/projects` 仅创建，不承担更新或归档；更新、归档、软删除和恢复统一使用 `PATCH /api/v1/projects/{projectId}`。
- 项目目录没有独立 `rowVersion`；PATCH 的 `expectedVersion` 使用目录项 `sourceVersion`。项目 profile 有独立 `rowVersion`，首次保存传 `expectedVersion: 0`，成功返回 201，读取或冲突均不再返回 201。
- `externalProjectId` 在所有核心历史摘要与本地项目间永久唯一；`projectCode` 在目录可用项间跨来源唯一。`project_directory` 是唯一合并读取口径，`project_summary` 只保存核心只读投影。
- 案例调用方可预生成 `caseId`；`translationGroupId` 关联独立编辑、审核和发布的语言版本，一语言一案例。每次真实变更保存 `case_versions`，无实际变化的 PATCH 不递增 `rowVersion`、不新增历史版本。
- 素材是项目级稳定资产；同一 `assetId` 重新上传生成新 `assetVersionId`，可挂接同项目多个案例。历史 release 固定精确 `assetVersionId` 与 `objectVersionId`，后续编辑、归档、删除或解挂不改写历史快照。
- 图片、PDF 和 AVIF 可取得短时预览票据；票据不暴露桶名、`object_key` 或永久凭据。被 release 引用的素材删除返回 409 `ASSET_REFERENCED`，归档仍允许。

## 案例侧项目补充资料

`0010_case_project_data.sql` 接入主体、别名、项目主体关系和成员表，并授权写入既有的 `case.project_profiles`。项目校验读取核心投影与本地注册项目合并后的目录，案例侧资料写入独立的 `case` schema。

| 动作 | 本地接口 | Scope |
|---|---|---|
| 读取项目补充资料 | `GET /api/v1/projects/{projectId}/profile` | `case-data:project-data:read` |
| 保存项目补充资料 | `PUT /api/v1/projects/{projectId}/profile` | `case-data:project-data:write` |
| 保存客户、合作伙伴或 3PL 主体及别名 | `POST /api/v1/subjects` | `case-data:project-data:write` |
| 读取主体及其别名 | `GET /api/v1/subjects/{subjectId}` | `case-data:project-data:read` |

写请求通过 `operationId` 幂等。新建的 `expectedVersion` 为 0，更新用读取到的 `rowVersion`。保存项目资料另需与目录一致的 `sourceVersion`，并验证主体 ID 和类型。属性、主体关系、成员、主体别名均按传入的完整清单保存。清单为空表示清空对应集合。同内容回传保留版本，成员退出时间按 UTC 返回。案例写入使用此入口落库的 `attributes.solutionTypes` 验证方案范围。字段名称和集合更新语义以当前本地契约为准，待双方冻结。

## 案例聚合存取

`0004_case_aggregate.sql` 接入案例聚合。续迁移 `0005_case_v1_1_constraints.sql` 接入 v1.1 顶层 JSON 与保密约束，并建立案例侧项目补充属性表。`0006_case_write_idempotency.sql` 建立写入结果表。网关作者角色按列写入案例、读取项目补充属性，具备写入结果表的查询和插入权限。

| 本地 HTTP 接口 | 服务 Scope |
|---|---|
| `POST /api/v1/projects/{projectId}/cases` | `case-data:cases:write` |
| `GET /api/v1/cases/{caseId}` | `case-data:cases:read` |
| `PATCH /api/v1/cases/{caseId}` | `case-data:cases:write` |

新建校验项目 ID、可选性和 `sourceVersion`，支持调用方提供 `caseId`，省略时由案例库生成 UUIDv7。省略正文、方案参数或成果指标时写入对应空结构，`confidentiality` 必填。`private` 需要非空的 `internalScope`。非空方案组校验案例侧 `case.project_profiles.attributes.solutionTypes`，联调种子由案例库迁移角色准备。PATCH 按顶层字段替换 JSON 对象，校验案例的 `expectedVersion`，真实变化才递增 `rowVersion` 并更新 `updatedAt`。项目关联、语言和创建人由创建时确定。

写入的 `operationId` 通过 JSON 请求体传递，使用 UUIDv7。同一调用方原键重试返回首次结果，载荷变更返回 `409 IDEMPOTENCY_CONFLICT`，执行中的操作返回 `409 IDEMPOTENCY_IN_PROGRESS` 和 `Retry-After`。案例写入和结果记录在同一事务提交，结果至少留存 30 天。

在 `shared/` 运行 `npm run build` 构建网关使用的 Zod 契约，`npm run generate:case-data` 生成独立的 [OpenAPI](../../shared/generated/case-data-openapi.json) 和 [客户端类型](../../shared/generated/case-data-api-types.d.ts)，`npm run check:case-data` 校验产物。用 `server/test/case-data-gateway.integration.test.ts` 和 `server/test/case-data-case-aggregate.integration.test.ts` 对独立临时案例库执行 HTTP、权限、幂等和聚合回归。

## 操作结果恢复与清理

`GET /api/v1/operations/{operationId}` 使用 `case-data:operations:read`。结果按令牌中的 `client_id` 和原 UUIDv7 操作标识查询。已提交的结果返回 HTTP 200，原写入状态和响应体分别在 `statusCode` 和 `response`。响应也包含 `resourceId`、`createdAt` 和 `expiresAt`。操作结果尚未提交、已清理或属于其他调用方时均返回 404。收到响应前断连时，先查询原操作标识，查不到时用原标识和同一请求重试。

清理由独立任务调用 `0007_case_operation_cleanup.sql` 安装的函数。`case_operation_cleanup` 只具备调用清理函数所需的权限。由维护方接收案例小组 outbox 确认已全部结清的操作清单，每个文件对应一个服务 `clientId`，`operationIds` 最多包含 500 个 UUIDv7。过期且已留存至少 30 天的清单内记录才会删除。同键写入进行中时本次跳过，原清单可安全重跑。清单为空时删除数为零。

在受控目录挂载仅所有者可读的 `case_operation_cleanup_database_url`，凭据使用 `case_operation_cleanup` 登录。清理命令输出确认条数和实际删除条数。

```sh
CASE_OPERATION_CLEANUP_SECRET_DIR=/path/to/mounted/secrets \
node server/case-data/operation-cleanup.mjs /path/to/settled-outbox.json
```

本地通过已结清清单验收。生产调度依赖双方确认清单的交付和对账方式。

## 案例素材上传与下载

先应用 `0008_case_assets.sql` 和 `0011_case_asset_processing.sql`。配置 `CASE_GATEWAY_ASSET_BUCKET` 和 `CASE_GATEWAY_S3_ENDPOINT`，并在 `CASE_GATEWAY_SECRET_DIR` 挂载仅所有者可读的 `case_s3_access_key`、`case_s3_secret_key`。桶须独立、私有并启用版本控制。S3 地址须使用 HTTPS，开发环境允许 `127.0.0.1` 的 HTTP。区域由 `CASE_GATEWAY_S3_REGION` 指定，默认 `us-east-1`。配置后 `/readyz` 额外校验桶可访问且版本控制已开启。

网关凭据使用该桶的 `GetBucketVersioning`；`GetObjectVersion` 可读取历史 `cases/*` 和新 `projects/*`；`PutObject`、`ListMultipartUploadParts`、`AbortMultipartUpload` 只允许 `projects/*`；`ListBucketVersions` 的 `s3:prefix` 限制为 `cases/*` 与 `projects/*`。旧 `cases/*` 只保留读取，新的项目级与案例素材统一写入 `projects/{projectId}/assets/{assetId}/{assetVersionId}`。运行角色缺省拒绝无版本 GET、跨桶访问和删除对象版本。测试机 MinIO 策略 `libiaolink-case-gateway-v2` 已实测：`projects/*` 经网关上传成功，使用同一网关凭据写 `cases/*` 被拒绝。

| 顺序 | 本地接口 | Scope |
|---|---|---|
| 建立会话 | `POST /api/v1/cases/{caseId}/uploads` | `case-data:assets:write` |
| 取得单次 PUT 目标 | `GET /api/v1/uploads/{uploadId}/target` | `case-data:assets:write` |
| 查看分片进度 | `GET /api/v1/uploads/{uploadId}/parts` | `case-data:assets:write` |
| 取得指定分片目标 | `GET /api/v1/uploads/{uploadId}/parts/{partNumber}/target` | `case-data:assets:write` |
| 登记完成 | `POST /api/v1/uploads/{uploadId}/complete` | `case-data:assets:write` |
| 下载已登记版本 | `GET /api/v1/assets/{assetId}/versions/{assetVersionId}/download-ticket` | `case-data:assets:read` |

会话有效期 15 分钟，上传签名最长 120 秒。建会话和登记完成使用请求体 UUIDv7 `operationId`，可通过 C07 查回结果。签名 URL 单独返回，不进幂等回执。32 MiB 以内使用带 SHA-256 和 `If-None-Match: *` 的单次 PUT，正常登记时传 `x-amz-version-id`。PUT 回执丢失时，登记请求可省略 `objectVersionId`，由网关按独立会话键找回唯一版本。对象尚未出现时返回 `409 UPLOAD_OBJECT_MISSING`，稍后用原登记请求重试。超过 32 MiB 且最多 256 MiB 的文件走分片模式，每片 8 MiB，尾片按实际长度签名。重新打开会话时按对象存储返回的分片清单续传。分片完成请求省略 `objectVersionId`，网关校验片数、序号和大小后合并。合并成功而数据库回滚时，网关按会话独立键找回唯一的版本，原操作可继续完成。两种模式均在登记前按精确版本校验字节数、MIME、文件头和流式 SHA-256。

替换素材传原 `assetId`，由网关分配新 `assetVersionId` 与对象键。作者下载票据按服务身份签发，始终绑定已登记版本，使用 attachment 和 private、no-store 响应约束。票据默认有效 60 秒，`CASE_GATEWAY_ASSET_DOWNLOAD_SECONDS` 可设为 1–60 秒。上传完成后扫描状态为 `pending`，视频转码状态为 `pending`。

媒体服务使用独立 `case-data:assets:process` Scope，在 `/api/v1/assets/{assetId}/versions/{assetVersionId}` 下通过 `GET /media-input` 取得精确版本票据，通过 `GET /media-state` 读状态和媒体版本，再通过 `PUT /media-state` 回传。本地校验原对象版本、SHA-256、`expectedVersion` 和合法状态转移。扫描、预览、转码和宽高、时长分别可回传。发布仍使用对象完整性及扫描、转码门禁。C10 使用测试媒体身份走真实回传接口。

正式环境还需冻结桶地址、配额、备份、大小上限和媒体处理服务接线。对象自动清理依赖双方确认保留策略、派生物归属和引用对账方式。

## 发布版本与公开只读

先创建 `case_gateway_public_ro` 并应用 `0009_case_releases.sql`。启用公开读面时，将只读角色连接串挂载为 `CASE_GATEWAY_PUBLIC_SECRET_DIR` 目录下的 `case_gateway_public_ro_database_url`，权限仅所有者可读。角色只查询 `published_release_v` 与 `published_release_assets_v` 两个 active 视图。网关使用独立连接池和只读事务，`/readyz` 检查视图授权。部署侧将公开 Scope 只签发给案例小组公开后端。

| 动作 | 本地接口 | Scope |
|---|---|---|
| 固化 | `POST /api/v1/cases/{caseId}/releases` | `case-data:releases:write` |
| 激活 | `POST /api/v1/cases/{caseId}/releases/{releaseId}/activate` | `case-data:releases:write` |
| 撤回 | `POST /api/v1/cases/{caseId}/releases/{releaseId}/deactivate` | `case-data:releases:write` |
| 作者历史 | `GET /api/v1/cases/{caseId}/releases/{releaseId}` | `case-data:releases:history:read` |
| 读取已发布快照 | `GET /api/v1/public/cases/{caseId}/releases/{releaseId}` | `case-data:releases:read` |
| 读取已发布素材 | `GET /api/v1/public/cases/{caseId}/releases/{releaseId}/assets/{assetVersionId}/content` | `case-data:releases:read` |

固化使用指定的 `externalProjectId`、`sourceVersion`、已准备好的对外 `caseSnapshot` 和有序素材版本清单。当前本地快照包含语言、标题、摘要和文本段落，素材上限 12 个。事务保存当时的项目摘要、快照哈希以及素材 ID、素材版本 ID、对象版本 ID 的复合引用。正式快照字段随案例小组联调冻结。

激活与撤回显式携带 `expectedActiveReleaseId`，无 active 时使用 JSON `null`。激活另带案例小组提供的 `approvalRef`。同一案例在事务内串行切换，部分唯一索引限制单 active，锁忙返回可用原键重试的 409。激活要求已通过扫描、转码状态为 `not_required` 或 `ready`，并流式重验各锁定对象版本的大小、MIME 和 SHA-256。版本校验或媒体门禁冲突后，业务方继续推进时使用新的逻辑操作键。写入均接入 C07 回执。

公开读取精确匹配案例和发布 ID。草稿、历史快照、审批引用和内部项目字段留在作者面。公开素材由网关用短时签名按原对象版本取流，外部当前请求收到文件流。替换或撤回提交后，后续公开快照和素材请求均返回 404。作者历史保留原素材引用，可按 C08 票据读回历史字节。复合外键保护四态发布所引用的素材版本，网关桶凭据仍只支持写入及指定版本读取。

公开服务的分享授权、缓存键和失效由案例小组后端负责。实际媒体作业、外部缓存失效和生产读链路待联调验证。

## 存量迁移与故障语义

当前没有虚构的“批量单接口”。存量迁移使用稳定 ID 和稳定 `operationId` 分批调用现有单资源接口，顺序为项目 → 案例与语言版本 → 素材与版本 → 案例挂接 → release。项目保留原 `externalProjectId` 与 `projectCode`，案例保留调用方预生成 `caseId`；每批对账使用按 ID 读取、项目案例分页、素材版本和 `GET /api/v1/operations/{operationId}`，不依赖定时投影或人工猜测。

单服务身份默认每分钟 120 次请求，总并发 16、单身份并发 6；单次 PUT 上限 32 MiB，分片每片 8 MiB，单素材总上限 256 MiB。迁移应在限流范围内串行使用同一 `operationId` 重试，收到 429/503 时读取 `Retry-After`，收到 409 时先读回当前版本或业务码，不得用新键覆盖。

远端是唯一主存。网关不可用、数据库提交失败或对象存储不可用时，请求返回明确的 401/403/404/409/429/503 或超时；案例小组必须把本地 outbox 保持为 `pending`，不得在远端未确认时展示为成功或发布。查询原 `operationId` 再决定收敛或重试；没有本地业务兜底。

LocalStack 社区版 4.8.1 未执行部分 IAM 拒绝断言，因此本地素材测试可用 `CASE_DATA_ASSETS_TEST_ENFORCE_IAM=false` 跳过该环境能力检查；该开关不适用于正式环境，也不改变 MinIO 生产策略。测试机已用真实 MinIO 策略做 `projects/*` 成功写入和 `cases/*` 写入拒绝验收。

## C10 本地端到端联调

`server/test/case-data-gateway.integration.test.ts` 的 C10 用例从项目目录读取来源版本，经案例创建及更新、真实素材上传、staging、本地审批、outbox 激活、公开读取和撤回。案例库应用 `0001–0014`。另起仅监听回环地址的 PostgreSQL 实例，在 `case_partner_fixture` 库初始化案例小组 v0.2 的 `03-local-schema/001_local_schema_up.sql`。使用独立的作者、公开与媒体服务令牌，通过测试桶 `libiaolink-case-proof` 验证实际对象版本。媒体夹具通过 HTTP 回传合成结果，故障代理独立注入丢请求或丢响应。

测试沿用网关的 `CASE_DATA_GATEWAY_TEST_ADMIN_URL`、`CASE_DATA_GATEWAY_TEST_DATABASE_URL`、`CASE_DATA_PUBLIC_TEST_DATABASE_URL` 及 `CASE_DATA_ASSETS_TEST_ENDPOINT`、`CASE_DATA_ASSETS_TEST_BUCKET`、`CASE_DATA_ASSETS_TEST_ACCESS_KEY`、`CASE_DATA_ASSETS_TEST_SECRET_KEY`。新增 `CASE_DATA_PARTNER_TEST_DATABASE_URL` 用于夹具写业务决定，`CASE_DATA_PARTNER_OUTBOX_TEST_DATABASE_URL` 用于独立 worker 进程。worker 只接收后者、网关 HTTP 地址和作者服务令牌。worker 角色读审批记录，对本地 outbox、案例状态和分享链接拥有查询与更新权限。

在 `server/` 运行 `npm test -- test/case-data-gateway.integration.test.ts`。用例校验丢响应后先查询原操作、已有结果直接确认、无结果以原键和原载荷重发，并比对审批、审计、outbox 和网关回执。实际案例小组 worker、公开服务、媒体作业和部署网络仍需双方联调。

## C11 网关限额与恢复校验

网关同步处理请求，达到并发上限时立即拒绝。作者和公开读面数据库连接池上限分别为 4 和 2。网关数据库连接超时、语句超时和锁等待上限分别为 2 秒、2 秒和 500 毫秒。对象存储 API 连续三次依赖调用失败后暂停新调用 5 秒，冷却期结束后放行一个探测。请求日志记录请求 ID、调用方、路由、状态、耗时及可用的资源 ID。

| 环境变量 | 本地默认 | 行为 |
|---|---:|---|
| `CASE_GATEWAY_PROJECTS_PER_MINUTE` | 120 | 按服务身份分别计数。目录、案例作者、素材作者、媒体处理、公开读取各用独立计数器 |
| `CASE_GATEWAY_MAX_ACTIVE_REQUESTS` | 16 | 单进程总并发。达到上限返回 503 |
| `CASE_GATEWAY_MAX_ACTIVE_PER_CLIENT` | 6，受总上限约束 | 单服务身份并发。达到上限返回 429 |
| `CASE_GATEWAY_CAPACITY_PATHS` | 未配置 | 配置为 1–8 个绝对路径的 JSON 数组，取各文件系统使用率的最大值 |
| `CASE_GATEWAY_CAPACITY_WARN_PERCENT` | 75 | 记录容量水位变化 |
| `CASE_GATEWAY_CAPACITY_STOP_UPLOADS_PERCENT` | 85 | 暂停创建会话、签发上传与媒体输入票据、登记上传完成 |
| `CASE_GATEWAY_CAPACITY_STOP_WRITES_PERCENT` | 90 | 暂停案例写入和激活，保留读取、操作回执查询及撤回 |

429 与并发或容量过载的 503 带 `Retry-After`。已配置的容量路径不可用时暂停受限写入。容量阻断后使用原 `operationId` 与原载荷重试。已经签发的上传目标按有效期失效。部署时由 `px` 配置真实数据盘或配额的观测路径、桶侧容量控制与告警。

恢复时先确认版本化对象备份可用，再恢复独立案例库并保持写入暂停。迁移器仅读核对账本后，以恢复后的案例库和案例桶运行引用校验。

```sh
CASE_MIGRATION_SECRET_DIR=/path/to/migration-secrets node server/case-data/migrate.mjs --check

CASE_GATEWAY_SECRET_DIR=/path/to/gateway-secrets \
CASE_GATEWAY_ASSET_BUCKET=libiaolink-case \
CASE_GATEWAY_S3_ENDPOINT=https://objects.example.test \
node server/case-data/recovery-check.mjs
```

引用校验涵盖 `staged`、`active`、`superseded` 和 `withdrawn`，每个被引用的素材版本只查一次。它从案例库做分页只读查询，再按锁定的 `object_version_id` 检查字节数、MIME、文件头与 SHA-256。缺失或不符时以非零状态退出并报告对应素材版本 ID。两项校验通过后先验证网关只读链路，再恢复写入。C09/C10 本地集成覆盖有效历史版本和引用对象缺失，本地限额的独立检查可用 `node --test server/test/case-data-gateway-controls.test.mjs`。
