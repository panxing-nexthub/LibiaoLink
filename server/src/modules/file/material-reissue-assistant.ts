/**
 * 物料补发项目助理口径（2026-11-26）：
 * 项目内「运输及送仓 / 清关 / 送仓 / 运输」任一任务的负责人视为项目助理，
 * 可查看并登记本项目全部物料补发申请。
 * 与 frontend/src/materialReissue.ts 的 MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLES 保持同步；
 * 任务改名或新增物流任务时两处一起改。
 */
export const MATERIAL_REISSUE_PROJECT_ASSISTANT_TASK_TITLES = ["运输及送仓", "清关", "送仓", "运输"] as const;
