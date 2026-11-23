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
| 项目文件 | `fileAnalyses[]`：fileId / fileVersionId / fileName / fileKind / summary（documentType / purpose / summaries / keyFacts / risks / decisions / warnings / missing） | `project_file_analyses` 当前文件版本成功摘要；来源仅项目详情「项目文件」视图的 PDF / 图片 / Word / Excel，日报现场图和问题图不进入 |

### 规则

1. **阶段日期兜底**：`plannedStart = min(阶段任务 plannedStart)`、`plannedEnd = max(plan)`、`actualEnd = max(actualEnd)`；
   `actualStart` 无可靠来源，保持 null。阶段表原值非空时优先原值。
2. **完成判定只用 `status = 'done'`**（存储基础态），不用 `displayStatus`（读时派生，会随 `status_override` 与日期漂移）。
3. **未分组任务**单独放在 `ungroupedTasks`，避免各阶段加总对不上项目任务总数。
4. **不取**：客户、项目创建时间、成员名册 / 角色、节点明细与节点计数、`task_events` 变更历史与变更原因、任务字段变更原因、图片内容；项目文件正文不直接进入 AI 上下文，只消费 document-analysis worker 的当前版本摘要。
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
| GET | `/api/v1/projects/{id}/document-analysis` | 登录 + 项目可见 | 最近 run + 当前文件版本成功摘要 |
| POST | `/api/v1/projects/{id}/document-analysis` | 额外要求 `project.export` | 只排队，由独立 document-analysis worker 消费，不在 HTTP 内转换或调模型 |

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
- 超时 120s；`max_tokens = 8000`（v3 字段多且包含文件摘要，4k 会截断 JSON）；返回必须是 JSON 对象，服务端按契约再校验一遍结构。
- 请求带 `response_format: {"type":"json_object"}`，压掉前后解释文字、降低截断概率；网关返回 400 / 422 时自动降级为纯文本 JSON 重发一次，并记住该网关不支持。
- 输出不合法最多尝试 3 次：首次 → 结构重试 → **压缩兜底**（system 追加【压缩输出模式】，硬压摘要 / 时间线 / 问题 / 交接条数）。
  每次只回灌校验失败原因和更紧的长度上限，不把上一次的畸形 / 截断输出塞回上下文；`finishReason=length` 时额外提示本次必须明显更短。
- 每次调用记一条日志：`finishReason`、`promptTokens`、`completionTokens`、`maxTokens`、`compact`、`jsonMode`、字符数 —— 用于判断网关是否把输出截断在上限。
- 3 次仍不合法才报错、不落库；截断失败返回「输出超出长度上限被截断，已自动压缩重试仍未完成」。
- 校验失败日志只记 `finishReason`、字符数、首尾是否为花括号，不记录项目正文。
- prompt 侧压缩：任务最多 300 条、日报 80 条、问题 200 条、变更 100 条，并递归去掉 null / 空数组。
  接口返回的 `ai-context` 不受影响（完整数据 + `truncated`）。

### Prompt 硬约束（v3）

1. 只用给定数据，缺数据写「未记录」/「暂无数据」；
2. 不编造日期 / 数量 / 人员 / 原因 / 进度，不把「系统已完成」写成客户验收通过；
3. 不评价个人绩效，不评论数据导入 / 补录 / 迁移；
4. 项目启动时间只用启动任务的最早 `plannedStart`，缺失写「未记录」；
5. 完成百分比 / 最新阶段 / 最慢阶段只引用 `metrics`，不得自行重算或改写措辞；
6. 正文、标题、来源均不得出现表名、字段名、SQL、接口名、内部 ID 或状态码；
7. 未解决 / 处理中问题必须逐条列出；交接建议固定标 `suggestion` 且 `needsHumanConfirmation: true`；
8. 项目文件摘要只作补充证据，不得覆盖任务 / 日报 / 问题 / 变更 / 统计中的数字、日期、责任边界与进度；文件 warnings 只能转述为待确认。

### 报告结构（v2，文件摘要进入上下文后 prompt v3）

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

- 历史报告的导出 / 下载与跨项目汇总（未实现；前端入口与报告弹窗已上线）。
- 文档正文提取 / 图片识别：**本期明确不做**。


## 7. 项目文件摘要链路（2026-11-23）

- 文件范围：项目详情「项目文件」视图（任务文件 + 变更文件）；只允许 PDF、图片、Word、Excel；图片排除日报现场图和问题图。
- worker：`server/document-analysis-worker/`，独立容器 + LibreOffice / Poppler / PyMuPDF / Pillow / CairoSVG。
- 表：`project_document_analysis_runs`（queued / running / succeeded / failed）、`project_file_analyses`（按 file_version_id + prompt_version 缓存）。
- API：`GET/POST /api/v1/projects/{id}/document-analysis`；POST 只入队，不等待转换。
- AI 上下文：只取当前文件版本的成功摘要，放入 `fileAnalyses[]`；PROJECT_AI_PROMPT_VERSION 升为 v3。
- 文件摘要每页最多 8 条 keyFacts，不逐行抄录长表；任务明细仍以结构化项目数据为主。
