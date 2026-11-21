import { stageNameOf } from "../taskApi";

/**
 * 仪表盘「全部项目」维度数据（2026-11-21 业务口径）：
 * - 项目数量：启动年份 × T-sort / 3D分拣 / 飞箱；
 * - 负责人：项目经理 / 销售负责人 / 规划负责人 × 项目最新阶段；
 * - 启动年份 × 项目最新阶段（柱状图 + 饼图）。
 *
 * 「启动年份」= 标题为「项目启动 / Project Startup」的任务实际完成日期所属年份；
 * 「最新阶段」= 未归档项目的 projects.stage_key；归档项目按异常归档 / 验收归档 / 归档-临时任务拆分。
 * 聚合在服务端完成，见 server/src/modules/dashboard/dashboard.rules.ts。
 */

export const DASHBOARD_PROJECT_TYPES = ["T-sort", "3D分拣", "飞箱"] as const;
export type DashboardProjectTypeCode = (typeof DASHBOARD_PROJECT_TYPES)[number];

export const DASHBOARD_PROJECT_STAGE_BUCKETS = [
  "presale",
  "design",
  "purchase",
  "assembly",
  "install",
  "deploy",
  "trial",
  "production",
  "acceptance",
  "archive_exception",
  "archive_accepted",
  "archive_temporary",
] as const;
export type DashboardProjectStageBucket = (typeof DASHBOARD_PROJECT_STAGE_BUCKETS)[number];

export const DASHBOARD_PROJECT_ROLES = ["manager", "sales", "planning"] as const;
export type DashboardProjectRole = (typeof DASHBOARD_PROJECT_ROLES)[number];

/** 项目类型配色：沿用现有仪表盘柱状图的蓝 / 黄 / 绿三色。 */
export const DASHBOARD_PROJECT_TYPE_COLORS: Readonly<Record<DashboardProjectTypeCode, string>> = {
  "T-sort": "#5aa9f7",
  "3D分拣": "#f5c443",
  飞箱: "#6cc46a",
};

/** 十二个最新阶段桶的固定配色（三类归档用项目卡片同族深色）。 */
export const DASHBOARD_PROJECT_STAGE_COLORS: Readonly<Record<DashboardProjectStageBucket, string>> = {
  presale: "#5aa9f7",
  design: "#22c55e",
  purchase: "#f5c443",
  assembly: "#f08a3c",
  install: "#8b5cf6",
  deploy: "#06b6d4",
  trial: "#ec4899",
  production: "#84cc16",
  acceptance: "#10b981",
  archive_exception: "#8c2d35",
  archive_accepted: "#194c78",
  archive_temporary: "#4338ca",
};

/** 阶段桶中文名（再交给 i18n 的 stageText 做英 / 日 / 韩本地化）。 */
export function dashboardProjectStageLabel(bucket: string): string {
  if (bucket === "archive_exception") return "异常归档";
  if (bucket === "archive_accepted") return "验收归档";
  if (bucket === "archive_temporary") return "归档-临时任务";
  return stageNameOf(bucket) || bucket;
}

export type DashboardProjectTypeYear = {
  readonly year: number | null;
  /** 与 DASHBOARD_PROJECT_TYPES 同序。 */
  readonly counts: readonly number[];
  readonly total: number;
};

export type DashboardProjectRolePerson = {
  readonly personId: string | null;
  readonly name: string | null;
  readonly isUnassigned: boolean;
  /** 与 DASHBOARD_PROJECT_STAGE_BUCKETS 同序。 */
  readonly stageCounts: readonly number[];
  readonly total: number;
};

export type DashboardProjectRoleStats = {
  readonly role: DashboardProjectRole;
  readonly people: readonly DashboardProjectRolePerson[];
};

export type DashboardProjectStartYearStage = {
  readonly year: number | null;
  /** 与 DASHBOARD_PROJECT_STAGE_BUCKETS 同序。 */
  readonly stageCounts: readonly number[];
  readonly total: number;
};

export type DashboardProjectInsights = {
  readonly totalProjects: number;
  readonly projectTypes: readonly string[];
  readonly stageBuckets: readonly string[];
  readonly typeByYear: readonly DashboardProjectTypeYear[];
  readonly roles: readonly DashboardProjectRoleStats[];
  readonly startYearStages: readonly DashboardProjectStartYearStage[];
};
