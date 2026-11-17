import { describe, expect, it } from "vitest";
import { CaseTokenBucketRateLimiter } from "../src/modules/case-hub/case-rate-limit.js";

function createLimiter(overrides: Partial<ConstructorParameters<typeof CaseTokenBucketRateLimiter>[0]> = {}) {
  return new CaseTokenBucketRateLimiter({
    requestsPerMinute: 60,
    burst: 3,
    ...overrides,
  });
}

describe("Case Hub L2b 通用限流桶", () => {
  it("允许突发容量，耗尽后按每分钟补充速率计算 retryAfterMs", () => {
    const limiter = createLimiter({ burst: 3 });

    expect(limiter.tryConsume("client-a", 1, 0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.tryConsume("client-a", 1, 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.tryConsume("client-a", 1, 0)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.tryConsume("client-a", 1, 0)).toMatchObject({
      allowed: false,
      capacity: 3,
      remaining: 0,
      retryAfterMs: 1_000,
    });

    expect(limiter.tryConsume("client-a", 1, 500)).toMatchObject({ allowed: false, retryAfterMs: 500 });
    expect(limiter.tryConsume("client-a", 1, 1_000)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("长时间空闲只补满到 burst，不突破容量", () => {
    const limiter = createLimiter({ burst: 3 });
    expect(limiter.tryConsume("client-a", 1, 0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.tryConsume("client-a", 1, 3_600_000)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.tryConsume("client-a", 1, 3_600_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.tryConsume("client-a", 1, 3_600_000)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("支持按 cost 计量，拒绝时不部分扣减 token", () => {
    const limiter = createLimiter({ burst: 3 });
    expect(limiter.tryConsume("download", 2, 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.tryConsume("download", 2, 0)).toMatchObject({
      allowed: false,
      remaining: 1,
      retryAfterMs: 1_000,
    });
    expect(limiter.tryConsume("download", 2, 1_000)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("cost 大于桶容量时永久拒绝，不创建无法满足的桶", () => {
    const limiter = createLimiter({ burst: 2 });
    expect(limiter.tryConsume("oversized", 3, 0)).toEqual({
      allowed: false,
      capacity: 2,
      remaining: 2,
      retryAfterMs: null,
    });
    expect(limiter.tryConsume("oversized", 2, 0)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("不同 key 的桶完全隔离", () => {
    const limiter = createLimiter({ burst: 1 });
    expect(limiter.tryConsume("client-a", 1, 0).allowed).toBe(true);
    expect(limiter.tryConsume("client-b", 1, 0).allowed).toBe(true);
    expect(limiter.tryConsume("client-a", 1, 0).allowed).toBe(false);
  });

  it("时钟回退不补 token，也不把桶时间戳回拨", () => {
    const limiter = createLimiter({ burst: 2 });
    expect(limiter.tryConsume("client-a", 2, 1_000).allowed).toBe(true);
    expect(limiter.tryConsume("client-a", 1, 500)).toMatchObject({ allowed: false, retryAfterMs: 1_000 });
    expect(limiter.tryConsume("client-a", 1, 2_000)).toMatchObject({ allowed: true });
  });

  it("构造参数、key、cost 与时钟都做显式校验", () => {
    expect(() => createLimiter({ requestsPerMinute: 0 })).toThrow(RangeError);
    expect(() => createLimiter({ burst: 0 })).toThrow(RangeError);
    expect(() => createLimiter({ burst: 1.5 })).toThrow(RangeError);

    const limiter = createLimiter();
    expect(() => limiter.tryConsume("", 1, 0)).toThrow(RangeError);
    expect(() => limiter.tryConsume("client-a", 0, 0)).toThrow(RangeError);
    expect(() => limiter.tryConsume("client-a", 1.5, 0)).toThrow(RangeError);
    expect(() => limiter.tryConsume("client-a", 1, Number.NaN)).toThrow(RangeError);
    expect(() => limiter.tryConsume("x".repeat(1_025), 1, 0)).toThrow(RangeError);
  });
});
