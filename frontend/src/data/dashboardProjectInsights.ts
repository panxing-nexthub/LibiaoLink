import { stageNameOf } from "../taskApi";

/**
 * 仪表盘「全部项目」维度数据（2026-11-21 业务口径）：
 * - 项目数量：启动年份 × T-sort / 3D分拣 / 飞箱；
 * - 负责人：项目经理 / 销售负责人 / 规划负责人 × 项目最新阶段；
 * - 启动年份 × 项目最新阶段（柱状图 + 饼图）。
 *
 * 「启动年份」= 标题为「项目启动 / Project Startup」的任务实际完成日期所属年份；
 * 「最新阶段」= 未归档且未暂停项目按项目空间同口径取任务派生最新阶段（已动工任务中阶段序最靠后者，无动工任务回落 projects.stage_key）；暂停项目统一为「暂停」，归档项目统一为「归档-移交售后」。
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
  "paused",
  "archive_handover",
] as const;
export type DashboardProjectStageBucket = (typeof DASHBOARD_PROJECT_STAGE_BUCKETS)[number];

export const DASHBOARD_PROJECT_ROLES = ["manager", "sales", "planning"] as const;
export type DashboardProjectRole = (typeof DASHBOARD_PROJECT_ROLES)[number];

/** 项目类型配色：沿用仪表盘蓝 / 黄 / 绿三色，且与项目空间卡片同口径 —— T-sort 蓝 / 3D分拣 绿 / 飞箱 黄（2026-11-26 对齐业务口径）。 */
export const DASHBOARD_PROJECT_TYPE_COLORS: Readonly<Record<DashboardProjectTypeCode, string>> = {
  "T-sort": "#5aa9f7",
  "3D分拣": "#6cc46a",
  飞箱: "#f5c443",
};

/** 十一个最新阶段桶的固定配色（暂停沿用项目状态橙色，归档移交售后用深蓝色）。 */
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
  paused: "#f29900",
  archive_handover: "#194c78",
};

/** 阶段桶中文名（再交给 i18n 的 stageText 做英 / 日 / 韩本地化）。 */
export function dashboardProjectStageLabel(bucket: string): string {
  if (bucket === "paused") return "暂停";
  if (bucket === "archive_handover") return "归档-移交售后";
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

export type DashboardProjectPerson = {
  readonly personId: string;
  readonly name: string | null;
};

export type DashboardProjectRoleOwners = Readonly<Record<DashboardProjectRole, readonly DashboardProjectPerson[]>>;

/** 全部项目图表下钻的一行项目。 */
export type DashboardProjectSummary = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly projectTypes: readonly string[];
  readonly stageBucket: DashboardProjectStageBucket;
  readonly startupAt: string | null;
  readonly startupYear: number | null;
  readonly owners: DashboardProjectRoleOwners;
};

export type DashboardProjectInsights = {
  readonly totalProjects: number;
  readonly projectTypes: readonly string[];
  readonly stageBuckets: readonly string[];
  readonly typeByYear: readonly DashboardProjectTypeYear[];
  readonly roles: readonly DashboardProjectRoleStats[];
  readonly startYearStages: readonly DashboardProjectStartYearStage[];
  readonly projects: readonly DashboardProjectSummary[];
};
