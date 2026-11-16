import { Inject, Injectable } from "@nestjs/common";

import { CaseHubError } from "./case-hub.error.js";
import { assertPayloadShape } from "./case-payload-limits.js";
import type { CaseHubRecord, CaseListFilter, CaseRepository, CaseUpdateInput } from "./case.repository.js";
import { CASE_REPOSITORY } from "./case.repository.js";
import { assertTransition } from "./case-status.js";
import type { CaseStatusWithRejected } from "./case-status.js";
import { assertVersionShape } from "./case-version.js";

/**
 * Case Hub 草稿服务（W1 / S5）：草稿 CRUD 编排 + 版本条件更新 + 状态机调用。
 *
 * 本层只做领域编排：
 * - 写入前调用 `assertPayloadShape`（仓储保持哑存储，不重复校验）；
 * - 条件更新必须携带调用方读到的 `version`；形状先由 `assertVersionShape` 判一次（不依赖适配器口径），
 *   过期版本再由仓储原子判定为 `VERSION_CONFLICT`；
 * - 状态流转先走纯函数状态机（`case-status.ts`）判定合法性，再交给仓储原子写入。
 *
 * 明确不做（对应待定项，避免替业务或 lan 猜结论）：
 * - 不授权：本人 / 他人草稿与跨 client 访问由 S9 的 `CasePolicyPort` 在入口侧判定，本层不假装已校验；
 * - 不校验业务字段：六分组内的字段、必填与枚举属 D01，本步只校验形状与 extensions 限额；
 * - 不合并 payload：PATCH 的局部更新语义属 D01，当前按「整份 payload 替换」处理，不猜字段合并规则；
 * - 不拒绝空 patch：payload 与 sourceProjectId 都不传时仍推进 version（「PATCH 至少要改一个字段」属 D01 契约层）；
 * - 不实现 ETag / If-Match 的 HTTP 编码（D06，控制器与 lan 的适配约定后在 S6 接）；
 * - 不排序、不分页（D08）：`listCases` 直接透传仓储顺序。
 *
 * 错误码优先级：纯参数校验（版本形状 → payload 形状）最先，其次是状态可编辑性，最后才是版本是否一致。
 * 因此案例刚被提交审核时，携旧版本号的 PATCH 报 `CASE_STATE_INVALID` 而不是 `VERSION_CONFLICT`；
 * D06 定稿时需确认这个优先级。
 *
 * DI：构造函数要求 `CASE_REPOSITORY` 令牌，模块装配与正式适配器由 lan 负责（§9.6）。
 */
export interface CreateDraftInput {
  ownerId: string;
  payload: Record<string, unknown>;
  sourceProjectId?: string | null;
}

export interface UpdateDraftInput {
  /** 调用方读到的当前版本；与仓储当前值不一致即 `VERSION_CONFLICT`。 */
  version: number;
  payload?: Record<string, unknown>;
  sourceProjectId?: string | null;
}

/**
 * 可编辑状态白名单。D03 未定，因此只放开主线口径的草稿：
 * 「驳回后 PATCH 编辑即回落 draft」「已发布能否直接编辑」都还没冻结，扩展前先改这条常量并补用例。
 */
export const CASE_EDITABLE_STATUSES: readonly CaseStatusWithRejected[] = ["draft"];

function assertEditable(status: CaseStatusWithRejected): void {
  if (CASE_EDITABLE_STATUSES.includes(status)) {
    return;
  }
  throw new CaseHubError("CASE_STATE_INVALID", `案例当前状态 ${status} 不可编辑`, [
    { path: "status", message: `editable: ${CASE_EDITABLE_STATUSES.join(",")}` },
  ]);
}

@Injectable()
export class CaseService {
  constructor(@Inject(CASE_REPOSITORY) private readonly repository: CaseRepository) {}

  async createDraft(input: CreateDraftInput): Promise<CaseHubRecord> {
    assertPayloadShape(input.payload);
    return this.repository.create({
      ownerId: input.ownerId,
      payload: input.payload,
      sourceProjectId: input.sourceProjectId ?? null,
    });
  }

  /** 详情读面：返回仓储记录，字段投影（内 / 外视图）属 S9，不在服务层做。 */
  async getCase(id: string): Promise<CaseHubRecord> {
    return this.repository.get(id);
  }

  async listCases(filter: CaseListFilter = {}): Promise<CaseHubRecord[]> {
    return this.repository.list(filter);
  }

  async updateDraft(id: string, input: UpdateDraftInput): Promise<CaseHubRecord> {
    assertVersionShape(input.version);
    if (input.payload !== undefined) {
      assertPayloadShape(input.payload);
    }
    const current = await this.repository.get(id);
    assertEditable(current.status);
    const patch: CaseUpdateInput = {};
    if (input.payload !== undefined) {
      patch.payload = input.payload;
    }
    if (input.sourceProjectId !== undefined) {
      patch.sourceProjectId = input.sourceProjectId;
    }
    return this.repository.updateIfVersion(id, input.version, patch);
  }

  /**
   * 提交审核：draft → pending_review（§9.2）。
   * 「必填齐备」前置校验属 D01，字段冻结后在这里补；当前只校验状态合法性。
   * 并发两次提交由仓储在原子操作内重判状态，第二次报 `CASE_STATE_INVALID`。
   */
  async submitForReview(id: string): Promise<CaseHubRecord> {
    const current = await this.repository.get(id);
    assertTransition(current.status, "pending_review");
    return this.repository.transition(id, "pending_review");
  }
}
