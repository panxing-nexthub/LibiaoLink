# dashboard 模块（平台 · B4 / M7-02）

| 字段 | 内容 |
|---|---|
| 类型 | 平台模块（platform） |
| 职责 | 跨项目统计读面（仪表盘 B4）：项目进度 / 任务状态 / 交付时间 / 问题分布 / 变更原因词频 |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | DashboardService / DashboardModule |

- 状态：已落地（2026-10-21，前端逐项目聚合收口到服务端）。
- HTTP：`GET /api/v1/dashboard/progress`（首屏任务聚合）、`GET /api/v1/dashboard/issues`（问题聚合 + 全部项目问题下钻行）、`GET /api/v1/dashboard/change-words`、`GET /api/v1/dashboard/project-insights`（2026-11-21，全部项目维度聚合：启动年份 × 类型 / 三类负责人 × 最新阶段 / 启动年份 × 最新阶段 + 项目下钻行）；均仅会话守卫，按 `PermissionService.projectScope` 裁剪可见项目。
- 口径：项目 = 未回收、归档仍计入、默认排序 `created_at desc, seq_no asc`；任务 = 未软删；展示态 / 按时交付与 `task.rules` 同形（平台模块不 import 任务领域模块，SQL 为独立副本并由回归测试守口径）；未归档项目「最新阶段」取已动工任务（进度 ≥ 1 格）中阶段序最靠后者，与项目空间 `ProjectSummary.latestStage` 同口径，无动工任务回落 `projects.stage_key`；归档项目仍按三类归档桶；问题按三态 × 多归类计数；词频沿用 B4 已确认的核心词最长匹配。
- 明细：任务与变更下钻仍按选中项目复用既有项目读面并缓存；`project-insights.projects` 提供项目类型 / 编号 / 名称 / 项目经理 / 启动时间 / 当前阶段 / 三类负责人，`issues.details` 提供全部可见项目的只读问题行（不含图片签名），供全部项目图表弹窗使用。
- 兼容性：`project-insights` 通过 `to_jsonb` 读取可选列 `projects.additional_project_types` 与 `project_archives.archive_kind`；测试机尚未应用多类型 / 归档类型迁移时，自动按空扩展类型 / 已验收归档兜底，不要求补 DDL。归档后未完成临时任务口径在 dashboard 内保留同形 SQL，避免依赖旧测试机 `db/task-scope` 的新导出。
- 结构：controller / service / repository + 纯规则 `dashboard.rules.ts`；跨模块只 import 对端 `index.ts`（`npm run check:boundaries`）。
- 验证：`server/test/dashboard.test.ts` 覆盖规则、可见性、空项目、问题下钻、词频、全部项目维度聚合与项目下钻、task 口径同形；无数据库迁移。
