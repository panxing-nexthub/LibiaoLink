# project-management（项目管理独立准备记录）

> 2026-11-17 口径：项目管理页是**独立准备记录页**。记录字段只落 `project_management_records`，不创建 / 修改业务项目；当记录的项目编号与项目空间 `projects.code` 精确匹配时，列表额外**只读**带出项目空间实时派生字段。项目空间没有被项目管理页写入，也没有外键或回收站联动。

> **2026-11-19 口径补充**：项目编号与项目空间未删除项目精确匹配时，响应额外返回只读 `projectId`；项目管理表格的项目编号与项目名称据此跳转 `#/project/{id}`。无匹配为 null，不新增数据库列或迁移。

> **2026-11-18 口径补充**：表格所有列均可编辑。项目空间自动识别字段（项目当前阶段、启动时间、到货日期、计划实施开始 / 完成、实施天数）以实时派生值为默认值；用户写入后存为 `*_override` 人工覆盖值并优先展示，清空覆盖值即恢复自动值。项目空间仍只读、不反向写入。实施工程师「已移交」为可持久化状态按钮：`implementationHandedOver = true` 时清空工程师列表且格子只显示「已移交」；重新选择工程师时服务端与前端同时取消该状态。

## 边界

- 自有数据表：`project_management_records`（迁移 `0102_project_management_records.sql`；`0103` 增加已移交状态，`0104` 增加六个自动字段的人工覆盖列）。
- 不 import `project` / `workspace` / `task` 领域模块，不调用 `ProjectService` / `ProjectRepository` / 任务写服务。
- `ProjectManagementSnapshotRepository` 直读 `projects` / `tasks` 的有限列，只用于列表 / 写入响应的展示快照，不产生业务副作用。
- 匹配条件：`project_management_records.code = projects.code`，两边先 `trim()`；只接受未进入项目回收站（`projects.deleted_at is null`）的项目。无匹配或任务无值时派生字段返回 `null`。
- 0101 曾把准备字段写入 `projects`；0102 已回撤这些列，项目主数据恢复原状。
- 账号只做两件事：给项目经理 / 实施工程师选择器提供目录数据；按 uuid 解析姓名。
- 项目经理候选复用现有 `ProjectManagerEligibilityService`（有效项目部成员 ∪ 有效系统管理员）。
- 实施工程师候选使用启用账号目录；服务端二次校验账号启用且未离职，支持多位并按选择顺序展示。

## 只读派生字段

| API 字段 | 项目空间来源 | 口径 |
|---|---|---|
| `projectId` | `projects.id` | 按记录 `code` 精确匹配到的未删除项目 id；无匹配 = null。只用于前端跳转，不写回项目空间 |
| `currentStage` | `tasks.stage_key` / `tasks.status` | 与项目总览汇总卡「最新阶段」一致：未删除且基础态为 `active` / `done` 的任务中，按九阶段顺序取最靠后的阶段；无已动工任务 = null |
| `startupCompletedAt` | `tasks.actual_end` | 标题为「项目启动」或英文标题为「Project Startup」的任务实际完成日期；多条取最晚；未完成 = null |
| `arrivalDate` | `tasks.actual_end` | `stage_key = assembly`（组装发货）的全部未删除任务中，最晚的实际完成日期 |
| `plannedStartDate` | `tasks.planned_start` | `stage_key = install`（硬件实施）的全部未删除任务中，最早的计划开始日期 |
| `plannedEndDate` | `tasks.planned_end` | `stage_key = install`（硬件实施）的全部未删除任务中，最晚的预计完成日期 |
| `implementationDays` | 上两字段 | 计划实施开始至计划实施完成的**含首尾**天数（与任务表「预计所需天数」同口径）；任一为空 = null |

- 派生字段不进入创建 / 更新请求体的同名字段；`currentStage` 等仍为只读快照，客户端的人工值写入独立的 `currentStageOverride` / `startupCompletedAtOverride` / `arrivalDateOverride` / `plannedStartDateOverride` / `plannedEndDateOverride` / `implementationDaysOverride`，不写回 0102 预留列。
- 每次 GET 均重新查询项目空间；POST / PATCH 的响应也返回该编号的最新快照。前端在页面加载、窗口重新聚焦、标签页重新可见及每 30 秒静默刷新派生字段，只合并自动快照，不覆盖人工覆盖值或正在编辑的记录文本。
- 人工覆盖值随记录持久化；日期覆盖后，前端的「实施天数」按有效起止日期重新计算，除非另有 `implementationDaysOverride`。

## HTTP

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/project-management-records` | 全部记录，按创建时间正序，并附带项目空间只读快照 |
| POST | `/api/v1/project-management-records` | 首笔输入即创建；字段允许空串 / 空数组 |
| PATCH | `/api/v1/project-management-records/{id}` | 局部更新 + `version` 乐观锁 |
| DELETE | `/api/v1/project-management-records/{id}` | 物理删除；`If-Match: <version>` |

所有接口要求登录 + CSRF，并叠加项目管理首批上线白名单守卫；非白名单账号返回 403。记录不进入项目回收站。

## 字段

- `code`：项目编号，最长 50 字，允许空串；用于精确匹配项目空间。
- `name`：项目名称，最长 200 字，允许空串。
- `managerIds` / `managerNames`：项目经理账号快照与只读姓名。
- `implementationEngineerIds` / `implementationEngineerNames`：实施工程师账号快照与只读姓名，支持多位。
- `implementationHandedOver`：实施工程师已移交状态；true 时服务端强制 `implementationEngineerIds = []`，格子只显示「已移交」。
- `implementationMethod`：五种实施方式枚举，未填为 null。
- `riskReminder`：风险提醒，最长 2000 字，未填为 null。
- `region`：项目地点字典值，空值回落为 `未分类`。
- `currentStageOverride` / `startupCompletedAtOverride` / `arrivalDateOverride` / `plannedStartDateOverride` / `plannedEndDateOverride` / `implementationDaysOverride`：人工覆盖值；null = 使用自动识别 / 自动计算值。
- `projectId` / `currentStage` / `startupCompletedAt` / `arrivalDate` / `plannedStartDate` / `plannedEndDate` / `implementationDays`：项目空间只读派生快照，不接收客户端写入；前端按「覆盖值 ?? 自动值」展示，`projectId` 用于项目详情跳转。
- `version` / `createdAt` / `updatedAt`：乐观锁与时间戳。

## 前端交互

- 文本输入停顿约 450ms 自动 PATCH / POST；失焦立即冲刷待保存内容。
- 人员、实施方式、地点选择后立即保存。
- 每行保存队列串行执行，避免同一行请求乱序；冲突返回 409 `VERSION_CONFLICT`。
- 项目编号 / 名称在 `projectId` 非空时显示为项目详情链接；单击或 Enter 打开项目，双击或 F2 进入原有文本编辑。
- 项目当前阶段 / 启动时间 / 到货日期 / 计划实施日期 / 实施天数均可点击编辑：阶段走九阶段下拉（含「自动识别」），日期走日历（清除即恢复自动），天数走数字编辑（「恢复自动」清除覆盖）。项目编号变化后先清空旧自动快照，保存成功立即回填；人工覆盖值不因编号变化自动清空。
- 后台刷新仅合并派生字段，并按 `record.id` 与当前 `code` 双重校验，避免覆盖未保存文本、人工覆盖值或其它字段。
- 表格初始 6 行；出现数据后，最末数据行下方固定只保留 5 个空行，多余尾部空白行收敛。点击空白格或空白行失焦不会创建记录。
- POST 拒绝全空请求；PATCH 拒绝保存为全空结果。前端在已有记录被清空后调用 DELETE，服务端列表过滤历史全空记录，刷新不再显示空白记录。
