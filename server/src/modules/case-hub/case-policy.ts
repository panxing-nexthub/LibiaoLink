/**
 * 案例策略矩阵（W3 / S9）：四个维度的取值直接来自《团队分工.md》§3 W3 的给定选项，
 * 属于已冻结内容；本文件只做纯决策，不读仓储、不依赖 Nest。
 *
 * 分工边界：
 * - 决策只消费「事实」，不消费身份。「谁属于本区域」「谁在项目名册里」属待定项 D04
 *   （主体与 Scope 映射），由入口侧 Guard 算成 `CaseViewerFacts` 后传入；
 * - 字段投影（未授权字段直接不返回）依赖 D01 的分组字段表，因此只在视图层做，不在这里；
 * - `policyVersion` 的来源与旧 release 的策略留档属 D09，本文件不定义版本号。
 *
 * 枚举的标识符命名是线内提案（团队分工只给了中文选项），S3 并入 `shared` 时随契约冻结。
 */

/** 内部可见范围：全公司 / 本区域或团队 / 项目相关人员 / 严格保密 */
export const CASE_INTERNAL_VISIBILITIES = [
  "company",
  "region_or_team",
  "project_members",
  "strict",
] as const;
export type CaseInternalVisibility = (typeof CASE_INTERNAL_VISIBILITIES)[number];

/** 外部访问：不允许 / 仅脱敏后允许 / 仅指定合作伙伴 / 待确认 */
export const CASE_EXTERNAL_ACCESS = ["denied", "masked_only", "partners_only", "pending"] as const;
export type CaseExternalAccess = (typeof CASE_EXTERNAL_ACCESS)[number];

/** 素材权限：图片视频可内部查看 / 图片可看·视频需审批 / 素材均需审批 / 不展示素材 */
export const CASE_ASSET_POLICIES = [
  "all_internal",
  "image_ok_video_approval",
  "all_require_approval",
  "hidden",
] as const;
export type CaseAssetPolicy = (typeof CASE_ASSET_POLICIES)[number];

export const CASE_ASSET_KINDS = ["image", "video"] as const;
export type CaseAssetKind = (typeof CASE_ASSET_KINDS)[number];

/**
 * 入口侧算出的可见性事实。D04 冻结前不定义主体形状，这里只要判定所需的最小布尔事实。
 * 缺省一律按「不成立」处理：事实没算出来就不能当成已授权。
 */
export interface CaseViewerFacts {
  sameRegionOrTeam?: boolean;
  projectMember?: boolean;
  partnerAllowlisted?: boolean;
}

/**
 * 内部可见性判定。
 *
 * `strict`（严格保密）恒不放宽：案例负责人与显式授权名单属 D04，冻结前不给通用路径开后门，
 * 否则「严格保密」会退化成公司内全员可见。
 */
export function canInternalRead(
  visibility: CaseInternalVisibility,
  facts: CaseViewerFacts = {},
): boolean {
  switch (visibility) {
    case "company":
      return true;
    case "region_or_team":
      return facts.sameRegionOrTeam === true;
    case "project_members":
      return facts.projectMember === true;
    case "strict":
      return false;
  }
}

/** `masked` = 可见但内容脱敏，`granted` = 原件可见。 */
export type CaseExternalDecision = "granted" | "masked" | "denied";

/**
 * 外部访问判定。
 *
 * `pending`（待确认）不是授权，按拒绝处理：业务没给出结论前，外部拿不到案例。
 */
export function decideExternalAccess(
  policy: CaseExternalAccess,
  facts: CaseViewerFacts = {},
): CaseExternalDecision {
  switch (policy) {
    case "denied":
      return "denied";
    case "masked_only":
      return "masked";
    case "partners_only":
      return facts.partnerAllowlisted === true ? "granted" : "denied";
    case "pending":
      return "denied";
  }
}

/** `approval_required` = 需走素材审批；本期是否上线审批流程属 D09。 */
export type CaseAssetDecision = "grant" | "approval_required" | "deny";

/**
 * 素材权限判定（对外暴露口径）。
 *
 * 取值按字面解释：`all_internal` = 「素材只在内部可看」，对外不签发；
 * `hidden` =「不展示素材」，对内对外都不签发。
 * 对内取用不受 policy 约束，只有 `hidden` 连内部一起关掉。
 * 「图片可看·视频需审批」「素材均需审批」中的审批动作只作用于对外。
 */
export function decideAssetAccess(input: {
  policy: CaseAssetPolicy;
  kind: CaseAssetKind;
  scope: "internal" | "external";
}): CaseAssetDecision {
  const { policy, kind, scope } = input;
  if (policy === "hidden") {
    return "deny";
  }
  if (scope === "internal") {
    return "grant";
  }
  switch (policy) {
    case "all_internal":
      return "deny";
    case "image_ok_video_approval":
      return kind === "video" ? "approval_required" : "grant";
    case "all_require_approval":
      return "approval_required";
  }
}
