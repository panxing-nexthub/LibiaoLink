import { CaseHubError } from "./case-hub.error.js";

/**
 * 案例状态机（纯函数，无 Nest / 数据库依赖）。
 *
 * 状态集合与主线流转来自《团队分工.md》§3 W0：
 *   draft → pending_review → approved → published → retired
 * `rejected` 的表示方式属待定项 D03：
 *   - 默认口径（`rejectedAsStatus: false`）= 主线五态，驳回表现为审核结果（错误码 / 审核记录）；
 *   - 若 D03 判定 `rejected` 为独立状态，传 `rejectedAsStatus: true`，走 pending_review → rejected → draft。
 */
export const CASE_STATUSES = ["draft", "pending_review", "approved", "published", "retired"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_REJECTED = "rejected" as const;
export type CaseStatusWithRejected = CaseStatus | typeof CASE_STATUS_REJECTED;

export interface CaseTransitionOptions {
  /** D03 待定：true 时 `rejected` 作为独立状态参与流转。 */
  rejectedAsStatus?: boolean;
}

type TransitionTable = Readonly<
  Partial<Record<CaseStatusWithRejected, readonly CaseStatusWithRejected[]>>
>;

const MAIN_TRANSITIONS: TransitionTable = {
  draft: ["pending_review"],
  pending_review: ["approved"],
  approved: ["published"],
  published: ["retired"],
  retired: [],
};

const REJECTED_TRANSITIONS: TransitionTable = {
  draft: ["pending_review"],
  pending_review: ["approved", CASE_STATUS_REJECTED],
  rejected: ["draft"],
  approved: ["published"],
  published: ["retired"],
  retired: [],
};

export function transitionsOf(
  from: CaseStatusWithRejected,
  options: CaseTransitionOptions = {},
): readonly CaseStatusWithRejected[] {
  const table = options.rejectedAsStatus === true ? REJECTED_TRANSITIONS : MAIN_TRANSITIONS;
  return table[from] ?? [];
}

export function canTransition(
  from: CaseStatusWithRejected,
  to: CaseStatusWithRejected,
  options: CaseTransitionOptions = {},
): boolean {
  return transitionsOf(from, options).includes(to);
}

/** 非法流转抛 `CASE_STATE_INVALID`（§9.2 表）。 */
export function assertTransition(
  from: CaseStatusWithRejected,
  to: CaseStatusWithRejected,
  options: CaseTransitionOptions = {},
): void {
  if (canTransition(from, to, options)) {
    return;
  }
  throw new CaseHubError("CASE_STATE_INVALID", `案例状态不允许从 ${from} 流转到 ${to}`, [
    { path: "status", message: `${from} -> ${to}` },
  ]);
}
