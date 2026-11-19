# 离职人员账号回收 API 对接说明

> 版本：v1.2（2026-11-19 11:45 CST）
> 适用系统：LibiaoLink 项目管理平台
> 接口状态：正式机已开通（2026-11-19 11:42 CST），仅允许来源 IP `10.1.100.3` 调用；IT 可立即联调。

## 1. 给 IT 的结论

> 正式机已就绪：`https://pm.libiaorobot.com` 的三个离职回收路径已完成白名单开通与 reload；非白名单来源返回 HTTP 403。

LibiaoLink 使用现有 3 个单账号接口处理离职回收：

| 动作 | 路径 | 用途 |
|---|---|---|
| 禁用 | `POST /internal/users/disable` | 离职默认动作；账号立即失效并踢掉全部在线会话 |
| 恢复 | `POST /internal/users/enable` | 复职或误操作恢复；不恢复旧会话 |
| 删除 | `POST /internal/users/delete` | 软删除；保留用户行和历史引用，不物理删库 |

建议离职统一调用 `disable`。只有确认该人员无数据留存、审计追溯等要求后，才调用 `delete`。

接口具备幂等性：同一人员重复调用、账号不存在、账号已删除，均返回 HTTP 200，自动化可以安全重试。

> 对接口径：请勿按另一份 `POST /api/user/resign` + `X-API-Key` + `accountNums` 的批量方案接入；该方案未启用。当前以本说明的 3 个路径和 `X-Internal-Token` 为准。

## 2. 调用地址与来源 IP 白名单

### 2.1 已开通的生产地址

- 域名：`https://pm.libiaorobot.com`
- 仅开放以下 3 个精确路径，且仅接受 `POST`：
  - `https://pm.libiaorobot.com/internal/users/disable`
  - `https://pm.libiaorobot.com/internal/users/enable`
  - `https://pm.libiaorobot.com/internal/users/delete`
- 不开放 `/internal/` 前缀下的其他路径，特别是不开放 `/internal/org-sync/run`。
- API 容器内地址为 `http://api:3000`；宿主未发布 3000 端口，不要绕过域名直连。

### 2.2 当前白名单

- 当前仅允许来源 IP：`10.1.100.3`。
- 白名单按连接源 IP 精确匹配，不是按请求头里的 `X-Forwarded-For` 判断。
- 其他来源 IP 调用上述 3 个路径会在 Nginx 层直接返回 HTTP 403，不会到达 API。
- 如果 IT 自动化任务的出口 IP、NAT 或代理发生变化，必须提前通知项目侧更新白名单；否则会出现 403。

### 2.3 当前网络口径

- 请求体编码必须是未压缩的 `identity`（通常就是不设置 `Content-Encoding`）；压缩请求体会在边缘返回 415。
- 单个请求体上限为 1 MiB；本接口正常请求体远小于该上限。
- 接口不使用 Cookie、不使用 CSRF Token，也不依赖用户登录态，适合服务端自动化调用。

## 3. 鉴权

每次请求必须携带固定请求头：

```http
X-Internal-Token: <生产内部调用密钥>
```

- 密钥对应生产环境 `INTERNAL_SYNC_TOKEN`，由部署侧通过密码管理器或其他安全渠道单独交付。
- 请求头名称是 `X-Internal-Token`，不是 `X-API-Key`。
- 不要把密钥写入代码仓库、前端、工单正文或聊天记录。
- 缺失或错误密钥返回 HTTP 401；来源 IP 不在白名单时先返回 HTTP 403。

## 4. 请求格式

### 4.1 方法与路径

```text
POST /internal/users/disable
POST /internal/users/enable
POST /internal/users/delete
Content-Type: application/json
```

### 4.2 请求体

```json
{
  "name": "zhangsan",
  "email": "zhangsan@libiaorobot.com"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 二选一 | 系统登录名 / 工号，对应 `users.username`，通常为 Casdoor 的 `Name`；**不是中文显示名**。按数据库原值精确匹配，优先使用 |
| `email` | 二选一 | 企业邮箱；`name` 未命中时兜底，大小写不敏感 |

规则：

- `name` 与 `email` 至少提供一个；两个都为空返回 HTTP 400。
- 两个都传时，先按 `name` 匹配；未命中再按 `email` 匹配。
- 建议两个都传，降低改名、工号变更或邮箱别名导致的漏匹配。
- 如果 IT 侧只有中文姓名，必须同时提供企业邮箱；系统不会按 `display_name` 模糊匹配。
- 请求体很小，单次调用建议超时 10 秒。

## 5. 成功响应

HTTP 200：

```json
{
  "ok": true,
  "name": "zhangsan",
  "action": "disable",
  "affectedSessions": 1
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `ok` | 固定为 `true` |
| `name` | 实际命中的 `users.username`；未命中时回显请求里的 `name`；只传 `email` 且未命中时为空字符串 |
| `action` | `disable` / `enable` / `delete` |
| `affectedSessions` | 本次撤销的在线会话数；`enable` 恒为 0 |

重要：`name` 为空字符串或 `affectedSessions` 为 0 **不一定代表失败**，可能是该账号尚未进入本地用户表、已经删除或本来没有在线会话。以 HTTP 200 和 `ok: true` 为准。

## 6. 三个动作的业务语义

| 动作 | 对本地账号的影响 | 在线会话 | 是否可恢复 | 推荐场景 |
|---|---|---|---|---|
| `disable` | `status = disabled`；不修改 `removed_at` | 立即撤销全部会话 | 可调用 `enable` 恢复 | 离职默认动作 |
| `enable` | `status = active`，清空 `removed_at` | 不恢复旧会话，需要重新登录 | — | 复职、误禁用纠正 |
| `delete` | `status = disabled`，写入 `removed_at`（软删，不物理删行） | 立即撤销全部会话 | 可调用 `enable` 恢复 | 确认无留存要求后的删除 |

补充：

- `disable` / `delete` 会在同一事务内完成状态写入、会话撤销和审计留痕。
- 审计对象类型为 `user`，`entry = system`，`actorId = null`，可在系统审计日志中追溯。
- 账号不存在时不会创建账号，也不会写业务审计；接口仍返回 200。
- 不要在离职流程里调用 `delete` 代替 `disable`，除非已经明确数据留存和恢复口径。

## 7. 错误码与重试

| HTTP | code | 含义 | 自动化处理 |
|---|---|---|---|
| 403 | Nginx 错误页 | 来源 IP 不在白名单 | 停止调用，核对出口 IP / NAT；联系项目侧更新白名单 |
| 401 | `AUTH_REQUIRED` | 缺少或错误的 `X-Internal-Token` | 停止重试，检查 / 轮换密钥 |
| 400 | `VALIDATION_FAILED` | `name` / `email` 都为空，或 email 格式错误 | 修正请求后再试 |
| 500 | `INTERNAL` | 服务端异常 | 指数退避重试 3～5 次，仍失败则告警 |
| 404 / 405 | Nginx 错误页 | 路径写错、方法不是 POST，或调用了未开放的内部接口 | 核对第 2 节路径，不要重试 |
| 415 | Nginx 错误页 | 请求体使用了非 `identity` 的 `Content-Encoding` | 去掉压缩请求体后重试 |

错误响应统一为：

```json
{
  "code": "VALIDATION_FAILED",
  "message": "name 与 email 至少提供一个",
  "details": [],
  "traceId": "请求追踪号"
}
```

`traceId` 可用于服务端日志排查。403 / 415 / 404 / 405 由 Nginx 返回，可能没有上述 JSON 结构。

## 8. 调用示例

### 8.1 从白名单机器调用

```bash
export LIBIAOLINK_INTERNAL_TOKEN='由部署侧安全提供'

curl -sS -X POST 'https://pm.libiaorobot.com/internal/users/disable' \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $LIBIAOLINK_INTERNAL_TOKEN" \
  --data '{"name":"zhangsan","email":"zhangsan@libiaorobot.com"}'
```

### 8.2 API 容器内验证

进入 `libiaolink-api` 容器后执行：

```bash
curl -sS -X POST 'http://127.0.0.1:3000/internal/users/disable' \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $LIBIAOLINK_INTERNAL_TOKEN" \
  --data '{"name":"zhangsan"}'
```

也可以从宿主机执行 `docker exec libiaolink-api ...`，不要在宿主机上直接访问 3000 端口。

### 8.3 批量离职的处理建议

对每个人逐个调用 `disable`，不要拼接批量请求。每个请求单独记录：

- 人员工号 / 登录名
- HTTP 状态码
- `traceId`（失败时）
- `affectedSessions`
- 调用时间

失败人员进入重试队列，避免整批因一条数据失败而中断。

## 9. 联调与验收清单

- [x] IT 提供固定出口 IP：`10.1.100.3`
- [x] 运维开通 `/internal/users/{disable,enable,delete}` 精确路径白名单
- [x] 非白名单来源验证为 HTTP 403
- [x] 生产密钥已准备安全交付文件，不落仓库 / 工单正文
- [ ] IT 已通过安全渠道收到密钥并确认保存
- [ ] IT 从 `10.1.100.3` 调用一个不存在账号，确认返回 200 且 `affectedSessions: 0`
- [ ] 联调一个测试账号，确认 `disable` 后原会话立即 401
- [ ] 联调 `enable` 恢复测试账号
- [ ] 确认审计日志出现 `entry=system` 的 `user` 记录
- [ ] 确认 403 / 401 / 400 / 500 的告警和重试策略

## 10. 生产验证记录（2026-11-19）

- 生产 API 容器 `libiaolink-api` 状态 healthy。
- 容器内无 token 调用 `POST /internal/users/disable`：HTTP 401。
- 容器内使用生产密钥调用 `POST /internal/users/enable`，传入不存在的测试名：HTTP 200，返回 `{"ok":true,"name":"__libiaolink_probe_nonexistent__","action":"enable","affectedSessions":0}`。
- Nginx 候选配置已通过 `nginx -t`；正式机于 11:42（北京时间）原地替换并 reload，原配置已备份。
- 非白名单来源 `POST https://pm.libiaorobot.com/internal/users/disable`：Nginx 返回 HTTP 403。
- `POST /internal/org-sync/run`：HTTP 405，未开放反代。
- Nginx 容器 reload 后状态 healthy。
- `/healthz` 200、`/readyz` 200、站点根 200、`/auth/login` 302，主链路未受影响。
- 尚待 IT 从 `10.1.100.3` 发起首次 200 联调，并核对 Nginx 访问日志中的真实源 IP。

## 11. 代码位置

- HTTP 控制器：`server/src/modules/identity/internal.controller.ts`
- 业务服务：`server/src/modules/identity/internal-user.service.ts`
- 内部凭证守卫：`server/src/modules/identity/internal-token.guard.ts`
- 单元测试：`server/test/identity-internal.test.ts`
- 服务说明：`server/README.md`（内部作业接口一节）
