/**
 * Case Hub 外部接入的进程内 token bucket（L2b）。
 *
 * 这里只处理「字符串 key -> 配额」：不解释 clientId / scope / route / caseId，也不接 HTTP。
 * 后续 CaseRateLimitGuard 在 D04 冻结后组合 key，并负责 429 / Retry-After 映射。
 * 单实例有效；多实例部署时必须替换为共享存储，不能把本地桶当成全局配额。
 */
const MS_PER_MINUTE = 60_000;
const MAX_KEY_LENGTH = 1_024;
const TOKEN_EPSILON = 1e-9;

export interface CaseTokenBucketRateLimitOptions {
  /** 每分钟补充的 token 数（对应 CASE_RATE_LIMIT_REQUESTS_PER_MINUTE）。 */
  requestsPerMinute: number;
  /** 桶容量（对应 CASE_RATE_LIMIT_BURST）。 */
  burst: number;
  now?: () => number;
}

export interface CaseTokenBucketRateLimitDecision {
  allowed: boolean;
  /** 桶容量；调用方可用于后续 X-RateLimit-Limit 映射。 */
  capacity: number;
  /** 本次判定后剩余的完整 token 数。 */
  remaining: number;
  /** 拒绝后至少等待多久可重试；cost 大于桶容量时恒为 null。 */
  retryAfterMs: number | null;
}

interface TokenBucketState {
  tokens: number;
  updatedAtMs: number;
}

/**
 * 单进程 token bucket。`tryConsume` 同步执行，单事件循环内一次判定原子完成。
 *
 * key 的业务含义完全由调用方决定；Guard 必须使用有界 key 空间，避免把外部可控的任意字符串
 * 直接当作无限增长的桶键。当前切片不做过期清理，缓存生命周期随未来共享存储实现一起收口。
 */
export class CaseTokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly requestsPerMinute: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, TokenBucketState>();

  constructor(options: CaseTokenBucketRateLimitOptions) {
    this.requestsPerMinute = requirePositiveInteger(options.requestsPerMinute, "requestsPerMinute");
    this.capacity = requirePositiveInteger(options.burst, "burst");
    this.refillPerMs = this.requestsPerMinute / MS_PER_MINUTE;
    this.now = options.now ?? Date.now;
  }

  tryConsume(key: string, cost = 1, nowMs?: number): CaseTokenBucketRateLimitDecision {
    assertKey(key);
    assertCost(cost);
    const timestamp = nowMs ?? this.now();
    if (!Number.isFinite(timestamp)) {
      throw new RangeError("nowMs 必须是有限数值");
    }

    const existing = this.buckets.get(key);
    if (existing === undefined && cost > this.capacity) {
      return { allowed: false, capacity: this.capacity, remaining: this.capacity, retryAfterMs: null };
    }

    const bucket = existing ?? { tokens: this.capacity, updatedAtMs: timestamp };
    const effectiveNow = Math.max(timestamp, bucket.updatedAtMs);
    const elapsedMs = effectiveNow - bucket.updatedAtMs;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedMs * this.refillPerMs);
    bucket.updatedAtMs = effectiveNow;
    if (existing === undefined) {
      this.buckets.set(key, bucket);
    }

    if (cost > this.capacity) {
      return {
        allowed: false,
        capacity: this.capacity,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: null,
      };
    }
    if (bucket.tokens + TOKEN_EPSILON >= cost) {
      bucket.tokens = Math.max(0, bucket.tokens - cost);
      return {
        allowed: true,
        capacity: this.capacity,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    const deficit = cost - bucket.tokens;
    return {
      allowed: false,
      capacity: this.capacity,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: Math.max(1, Math.ceil(deficit / this.refillPerMs)),
    };
  }
}

function assertKey(key: string): void {
  if (typeof key !== "string" || key.trim() === "") {
    throw new RangeError("限流 key 不能为空");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new RangeError("限流 key 不能超过 " + String(MAX_KEY_LENGTH) + " 个字符");
  }
}

function assertCost(cost: number): void {
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw new RangeError("限流 cost 必须是正整数");
  }
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(name + " 必须是正整数");
  }
  return value;
}
