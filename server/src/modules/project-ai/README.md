# project-ai（AI 项目总结读面）

只读聚合接口：`GET /api/v1/projects/{id}/ai-context`。**只取数，不调用模型、不写库、不投递 outbox。**

## 1. 为什么单独开模块

- 复用既有读口（`ProjectService.getProject`、`FlowService.listStages`、各模块 `listForExport` / `listProjectChangesForExport`），
  与项目页面 / 导出**同源**，不另写一套 SQL，避免口径漂移。
- 与 `project-export` 同构：领域模块只读聚合并发，不改既有模块内部实现。
- 后续「AI 总结生成」会另开写接口与缓存表，本模块保持纯只读，便于单独验收。

## 2. 字段口径（2026-11-22 定稿）

| 区块 | 字段 | 来源 |
|---|---|---|
| 项目 | `id` `code` `name` `region` `projectTypes` `status` `managerNames` | `projects` |
| 项目 | `startedAt` | 派生：任务名「项目启动」或 `titleEn = Project Startup` 的最早 `planned_start`；无则 null，**不回落 `projects.created_at`** |
| 统计 | `metrics` | **采集器算好，模型只能引用不能重算**：`taskDone` / `taskTotal` / `percent`（0～100，total=0 为 null）/ `latestStageKey` / `latestStage`（已动工任务 progress ≥ 0.25 中阶段序最靠后者）/ `slowestStageKey` / `slowestStage`（阶段序中第一个仍有未完成任务的阶段）/ `planStart` / `planEnd` / `reportStart` / `reportEnd` / `issueTotal` / `issueDone` / `issueInProgress` / `issueOpen` / `changeTotal` |
| 阶段 | `stageKey` `name` `seq` `status` `plannedStart` `plannedEnd` `actualStart` `actualEnd` | `project_stages`（经 `FlowService.listStages`） |
| 阶段 | `taskDoneCount` / `taskTotalCount` | `tasks.status = 'done'` 计数；`stage_key IS NULL` 不计入任何阶段 |
| 阶段 | `advancedAt/By`、`rolledBackAt/By`、`rollbackReason` | 阶段最近一次推进 / 回退留痕，无则 null |
| 阶段 | `datesFallback` | true = 阶段日期至少一项由该阶段任务兜底 |
| 任务 | `taskId` `stageKey` `title` `titleEn` `note` `ownerNames` `managerNames` `status` `displayStatus` `progress` `plannedStart` `plannedEnd` `actualEnd` `estimatedDays` `headcount` `priority` `deliverableTypes` `onTime` `finalizedAt` `changeLinks` | `tasks` 当前快照 |
| 变更 | `changeId` `stageKey` `changeType` `reason` `beforeSummary` `afterSummary` `appliedAt` `appliedByName` `status` | `change_requests` |
| 日报 | `reportId` `date` `authorName` `state` `doneWork` `plan` `headcount` `stageNames` `submittedAt` `photoCount` | `daily_reports` |
| 问题 | `issueId` `title` `categories` `state` `reporterName` `ownerName` `ownerDepartment` `raisedAt` `solution` `closedAt` `sourceReportId` `taskId` `photoCount` | `issues` |

### 规则

1. **阶段日期兜底**：`plannedStart = min(阶段任务 plannedStart)`、`plannedEnd = max(plan)`、`actualEnd = max(actualEnd)`；
   `actualStart` 无可靠来源，保持 null。阶段表原值非空时优先原值。
2. **完成判定只用 `status = 'done'`**（存储基础态），不用 `displayStatus`（读时派生，会随 `status_override` 与日期漂移）。
3. **未分组任务**单独放在 `ungroupedTasks`，避免各阶段加总对不上项目任务总数。
4. **不取**：客户、项目创建时间、成员名册 / 角色、节点明细与节点计数、`task_events` 变更历史与变更原因、任务字段变更原因、图片内容、文件正文。
5. **图片只计数**：`photoCount` 是附图条数；日报只计现场工作附图，问题附图在问题侧单独计，同一张图不会算两次。
6. **截断**：单集合最多 2000 条，超出置 `truncated = true`（超大项目保护上下文长度）。

## 3. 鉴权

登录 + 项目记录级可见（`SessionGuard` + `ProjectAccessGuard`）。不可见 / 不存在统一 404。
不额外加功能权限位：能看项目的人就能取该项目的 AI 上下文。

## 4. 自测

```bash
cd server
npx vitest run test/project-ai-context.test.ts
```

覆盖：启动时间取最早、阶段日期兜底与 `datesFallback`、未分组统计、推进人 / 变更申请人姓名解析、
日报 / 问题只计数、任务排序、无启动任务时 `startedAt = null`、契约自校验。

## 5. 总结生成与缓存

### 接口

| 方法 | 路径 | 权限 | 行为 |
|---|---|---|---|
| GET | `/api/v1/projects/{id}/ai-context` | 登录 + 项目可见 | 只读聚合，不调模型 |
| GET | `/api/v1/projects/{id}/ai-summary` | 登录 + 项目可见 | 读最近一次结果（不调模型）；未生成 404；`stale=true` 表示数据已变化 |
| POST | `/api/v1/projects/{id}/ai-summary` | 额外要求 `project.export` | 生成；默认复用缓存，`force=true` 强制重生成 |

POST 用 `project.export` 而不是新增权限位：生成会把项目数据发到外部模型服务，属于数据出站动作，
用「可导出项目数据」作门禁，权限矩阵零改动。

### 缓存

表 `project_ai_summaries`（迁移 0111）：

```
project_id + source_hash + prompt_version 唯一
source_hash = sha256(上下文 JSON，去掉 generatedAt)
```

- 项目数据一变 → `source_hash` 变 → 下次生成写新行，旧行保留可追溯。
- 只缓存**成功**结果；模型超时 / 报错 / 返回非法 JSON 一律不落库，直接报错让调用方重试。
- 同一项目 + 同一指纹的并发请求在进程内合并，避免重复扣费。
- `prompt_version` 常量在 `project-ai-summary.service.ts`；改 prompt 结构时递增，旧缓存自动失效。

### 模型调用

- 用 `model-config` 当前启用的模型（OpenAI 兼容 `POST {baseUrl}/chat/completions`）。
- 未启用模型 → 400 `VALIDATION_FAILED`「尚未启用 AI 模型」。
- 超时 120s；`max_tokens = 8000`（v2 字段多，4k 会截断 JSON）；返回必须是 JSON 对象，服务端按契约再校验一遍结构。
- 首次输出不合法会自动重试一次：只回灌校验失败原因，不把上一次的畸形 / 截断输出塞回上下文；仍不合法才报错、不落库。
- 校验失败日志只记 `finishReason`、字符数、首尾是否为花括号，不记录项目正文。
- prompt 侧压缩：任务最多 300 条、日报 80 条、问题 200 条、变更 100 条，并递归去掉 null / 空数组。
  接口返回的 `ai-context` 不受影响（完整数据 + `truncated`）。

### Prompt 硬约束（v2）

1. 只用给定数据，缺数据写「未记录」/「暂无数据」；
2. 不编造日期 / 数量 / 人员 / 原因 / 进度，不把「系统已完成」写成客户验收通过；
3. 不评价个人绩效，不评论数据导入 / 补录 / 迁移；
4. 项目启动时间只用启动任务的最早 `plannedStart`，缺失写「未记录」；
5. 完成百分比 / 最新阶段 / 最慢阶段只引用 `metrics`，不得自行重算或改写措辞；
6. 正文、标题、来源均不得出现表名、字段名、SQL、接口名、内部 ID 或状态码；
7. 未解决 / 处理中问题必须逐条列出；交接建议固定标 `suggestion` 且 `needsHumanConfirmation: true`。

### 报告结构（v2）

模型输出严格遵循 `ProjectAiSummaryReportSchema`，写入 `summary_json`：

- `title`
- `summary { text, claims[] }`
- `overview { projectName, projectCode, status, managers[], startedAt, progress { done, total, percent, latestStage, slowestStage }, planRange, reportRange }`
- `timeline[]`（5～8 个关键节点）
- `issues { total, done, inProgress, open, summary, currentItems[] }`
- `resultsAndRisks { text, claims[], risks[] }`
- `handoff { existing[], suggestions[] }`
- `notes[]`

每条 claim 带 `type = fact | inference | suggestion` 与业务来源标签（如「任务记录 2026-10-20」）。
接口顶层 `summaryText = report.summary.text`，供列表展示。

## 6. 后续（未实现）

- 前端「AI 总结」入口与展示形态（`summaryText` + `report` 结构化字段已就绪）。
- 文档正文提取 / 图片识别：**本期明确不做**。
