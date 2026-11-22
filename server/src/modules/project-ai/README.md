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

## 5. 后续（未实现）

- 项目总结生成接口（调用模型）与 `project_ai_summaries` 缓存表。
- 前端「AI 总结」入口与展示形态。
- 文档正文提取 / 图片识别：**本期明确不做**。
