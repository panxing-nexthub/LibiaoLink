import type { CaseStatusWithRejected, CaseTransitionOptions } from "./case-status.js";

/**
 * Case Hub 仓储端口与记录形状（**线内定义，S3 再决定是否搬进 shared**）。
 *
 * 端口只表达存储语义，不含状态机与 payload 字段规则：
 * - 记录形状 = 元数据 + 六分组 payload + 乐观锁 version，字段口径见团队分工 §3 W0；
 * - 条件更新（`updateIfVersion`）必须由适配器以单条条件写完成（compare-and-set），
 *   不能实现成「先读再比再写」；版本不一致返回 `VERSION_CONFLICT`；
 * - 状态流转（`transition`）由适配器在对当前行的原子操作内校验合法性后写入，
 *   非法流转返回 `CASE_STATE_INVALID`；
 * - **任何成功写入（`create` / `updateIfVersion` / `transition`）都必须推进同一个 version 序列（+1）**。
 *   这是不变量，不是建议：服务层拿 version 当跨字段的 CAS 闸门（例如「读到 draft → 断言可编辑 →
 *   条件写 payload」），如果中间的写入（含状态流转）没有推进 version，这次写就会静默覆盖新状态。
 *
 * 内存实现仅用于本线语义验证与早期联调；真实存储（SQL）适配由 lan 接入（§9.6 `CaseRepository`）。
 */
export interface CaseHubRecord {
  id: string;
  status: CaseStatusWithRejected;
  version: number;
  ownerId: string;
  payload: Record<string, unknown>;
  sourceProjectId: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseCreateInput {
  ownerId: string;
  payload: Record<string, unknown>;
  sourceProjectId?: string | null;
  at?: Date;
}

export interface CaseUpdateInput {
  payload?: Record<string, unknown>;
  /** undefined = 保留原值；null = 显式清空弱引用。与 `transition` 的 `reviewNote` 同口径。 */
  sourceProjectId?: string | null;
  /** undefined = 保留原值；null = 显式清空（例如驳回后回落草稿要清掉上一次审核意见）。 */
  reviewNote?: string | null;
}

export interface CaseListFilter {
  ownerId?: string;
  status?: CaseStatusWithRejected;
}

export interface CaseTransitionInput extends CaseTransitionOptions {
  /** undefined = 保留原值；null = 显式清空（例如驳回后回落草稿时清掉上一次审核意见）。 */
  reviewNote?: string | null;
  at?: Date;
}

/**
 * DI 令牌：模块装配（lan）用 `{ provide: CASE_REPOSITORY, useClass: ... }` 接正式适配器。
 *
 * 内存实现 `InMemoryCaseRepository` 故意不加 `@Injectable()`：它的构造函数参数是 options 对象，
 * 加装饰器会生成 `design:paramtypes=[Object]`，Nest 解析 `Object` 会直接报依赖错误；
 * 需要时按 `useFactory: () => new InMemoryCaseRepository(...)` 装配。
 */
export const CASE_REPOSITORY = Symbol("CASE_REPOSITORY");

export interface CaseRepository {
  create(input: CaseCreateInput): Promise<CaseHubRecord>;
  /** 不存在（或无权访问）统一抛 `NOT_FOUND`，不区分两种原因（防枚举，§9.5）。 */
  get(id: string): Promise<CaseHubRecord>;
  /** 无排序、无分页：排序与游标属契约层（D08），不在仓储里做。 */
  list(filter?: CaseListFilter): Promise<CaseHubRecord[]>;
  updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: CaseUpdateInput,
    at?: Date,
  ): Promise<CaseHubRecord>;
  transition(id: string, to: CaseStatusWithRejected, input?: CaseTransitionInput): Promise<CaseHubRecord>;
}
