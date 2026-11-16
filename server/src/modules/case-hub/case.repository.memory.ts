import { randomUUID } from "node:crypto";

import { CaseHubError } from "./case-hub.error.js";
import type {
  CaseCreateInput,
  CaseHubRecord,
  CaseListFilter,
  CaseRepository,
  CaseTransitionInput,
  CaseUpdateInput,
} from "./case.repository.js";
import { assertTransition } from "./case-status.js";
import type { CaseStatusWithRejected } from "./case-status.js";
import { assertVersionMatch, nextVersion } from "./case-version.js";

/**
 * 内存仓储：用于本线语义验证与早期联调（正式存储由 lan 的适配器实现，见 `case.repository.ts` 端口）。
 *
 * 条件更新与状态流转都由「读当前行 → 比对 → 写回」在**同一个同步段**内完成（方法体内没有 await），
 * 因此并发两次写入只有一个能成功——与真实存储需要的原子条件更新语义一致。
 * 内存通过不代表真实存储并发已验证。
 *
 * 写入侧与读取侧都做深拷贝：调用方传进来的 payload 对象不会被存进 Map，返回值也改不到仓储存量。
 *
 * 本类只做存储语义，**不校验 payload 形状**：写入前请由服务层调用 `assertPayloadShape`
 * （`case-payload-limits.ts`）。在这里重复校验会让两层各有一套规则。
 */
function cloneRecord(row: CaseHubRecord): CaseHubRecord {
  return { ...row, payload: structuredClone(row.payload) };
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly rows = new Map<string, CaseHubRecord>();
  private readonly rejectedAsStatus: boolean;

  /**
   * `rejectedAsStatus` 给 D03 的开关一个默认值，避免每个调用点各传一次（漏传会静默走主线口径）；
   * 单次调用仍可用 `transition(id, to, { rejectedAsStatus })` 覆盖。
   */
  constructor(options: { rejectedAsStatus?: boolean } = {}) {
    this.rejectedAsStatus = options.rejectedAsStatus === true;
  }

  async create(input: CaseCreateInput): Promise<CaseHubRecord> {
    const at = (input.at ?? new Date()).toISOString();
    const row: CaseHubRecord = {
      id: randomUUID(),
      status: "draft",
      version: 0,
      ownerId: input.ownerId,
      payload: structuredClone(input.payload),
      sourceProjectId: input.sourceProjectId ?? null,
      reviewNote: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.set(row.id, row);
    return cloneRecord(row);
  }

  async get(id: string): Promise<CaseHubRecord> {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new CaseHubError("NOT_FOUND", "案例不存在或无权访问", [{ path: "id", message: id }]);
    }
    return cloneRecord(row);
  }

  /** 返回值按插入顺序，**不排序**；排序与分页 / 游标属于契约层（D08），不在仓储里做。 */
  async list(filter: CaseListFilter = {}): Promise<CaseHubRecord[]> {
    return [...this.rows.values()]
      .filter((row) => {
        if (filter.ownerId !== undefined && row.ownerId !== filter.ownerId) {
          return false;
        }
        return filter.status === undefined || row.status === filter.status;
      })
      .map(cloneRecord);
  }

  /** 条件更新：版本不一致抛 `VERSION_CONFLICT`，成功则 version + 1。 */
  async updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: CaseUpdateInput,
    at: Date = new Date(),
  ): Promise<CaseHubRecord> {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new CaseHubError("NOT_FOUND", "案例不存在或无权访问", [{ path: "id", message: id }]);
    }
    assertVersionMatch(row.version, expectedVersion);
    const updated: CaseHubRecord = {
      ...row,
      payload: structuredClone(patch.payload ?? row.payload),
      sourceProjectId: patch.sourceProjectId === undefined ? row.sourceProjectId : patch.sourceProjectId,
      reviewNote: patch.reviewNote === undefined ? row.reviewNote : patch.reviewNote,
      version: nextVersion(row.version),
      updatedAt: at.toISOString(),
    };
    this.rows.set(id, updated);
    return cloneRecord(updated);
  }

  /** 状态流转：非法流转抛 `CASE_STATE_INVALID`，成功则 version + 1。 */
  async transition(
    id: string,
    to: CaseStatusWithRejected,
    input: CaseTransitionInput = {},
  ): Promise<CaseHubRecord> {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new CaseHubError("NOT_FOUND", "案例不存在或无权访问", [{ path: "id", message: id }]);
    }
    assertTransition(row.status, to, { rejectedAsStatus: input.rejectedAsStatus ?? this.rejectedAsStatus });
    const updated: CaseHubRecord = {
      ...row,
      status: to,
      reviewNote: input.reviewNote === undefined ? row.reviewNote : input.reviewNote,
      version: nextVersion(row.version),
      updatedAt: (input.at ?? new Date()).toISOString(),
    };
    this.rows.set(id, updated);
    return cloneRecord(updated);
  }
}
