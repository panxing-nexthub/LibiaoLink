/**
 * Case Hub 内存仓储（S4a 预做切片；S5 起实现 `CaseRepository` 的异步端口）：
 * 草稿创建、按 owner 过滤、版本条件更新（并发一成功一冲突）、状态流转与非法流转。
 * 内存语义通过不等于真实存储并发已验证（正式适配由 lan 负责）。
 */
import { describe, expect, it } from "vitest";

import { CaseHubError, InMemoryCaseRepository } from "../src/modules/case-hub/index.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const AT = new Date("2026-11-16T02:00:00Z");

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<CaseHubError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CaseHubError);
    expect((error as CaseHubError).code).toBe(code);
    return error as CaseHubError;
  }
  throw new Error("预期抛错但没有抛");
}

describe("Case Hub 内存仓储", () => {
  it("创建即草稿，version 从 0 开始", async () => {
    const repo = new InMemoryCaseRepository();
    const record = await repo.create({ ownerId: OWNER, payload: { profile: {} }, at: AT });
    expect(record.status).toBe("draft");
    expect(record.version).toBe(0);
    expect(record.ownerId).toBe(OWNER);
    expect(record.sourceProjectId).toBeNull();
    expect((await repo.get(record.id)).id).toBe(record.id);
  });

  it("读写两侧都隔离：改动入参或返回值都不会污染仓储存量", async () => {
    const repo = new InMemoryCaseRepository();
    const input = { profile: { title: "A" } };
    const created = await repo.create({ ownerId: OWNER, payload: input, at: AT });
    (input.profile as Record<string, unknown>).title = "改动入参";
    (created.payload.profile as Record<string, unknown>).title = "改动返回值";
    expect((await repo.get(created.id)).payload).toEqual({ profile: { title: "A" } });

    const patch = { profile: { title: "B" } };
    await repo.updateIfVersion(created.id, 0, { payload: patch }, AT);
    (patch.profile as Record<string, unknown>).title = "改动写入入参";
    expect((await repo.get(created.id)).payload).toEqual({ profile: { title: "B" } });
  });

  it("不存在抛 NOT_FOUND", async () => {
    const repo = new InMemoryCaseRepository();
    await expectCode(() => repo.get("missing"), "NOT_FOUND");
    await expectCode(() => repo.updateIfVersion("missing", 0, {}), "NOT_FOUND");
    await expectCode(() => repo.transition("missing", "pending_review"), "NOT_FOUND");
  });

  it("列表按 owner / 状态过滤", async () => {
    const repo = new InMemoryCaseRepository();
    const mine = await repo.create({ ownerId: OWNER, payload: {}, at: AT });
    await repo.create({ ownerId: OTHER_OWNER, payload: {}, at: AT });
    const mineList = await repo.list({ ownerId: OWNER });
    expect(mineList).toHaveLength(1);
    expect(mineList[0]?.id).toBe(mine.id);
    expect(await repo.list({ ownerId: OWNER, status: "published" })).toHaveLength(0);
    expect(await repo.list()).toHaveLength(2);
  });

  it("条件更新：同一版本两次写入，一次成功一次 VERSION_CONFLICT", async () => {
    const repo = new InMemoryCaseRepository();
    const record = await repo.create({ ownerId: OWNER, payload: { profile: {} }, at: AT });

    const first = await repo.updateIfVersion(record.id, 0, { payload: { profile: { title: "A" } } }, AT);
    expect(first.version).toBe(1);
    await expectCode(
      () => repo.updateIfVersion(record.id, 0, { payload: { profile: { title: "B" } } }, AT),
      "VERSION_CONFLICT",
    );
    expect((await repo.get(record.id)).payload).toEqual({ profile: { title: "A" } });
  });

  it("缺少版本号按校验失败处理", async () => {
    const repo = new InMemoryCaseRepository();
    const record = await repo.create({ ownerId: OWNER, payload: {}, at: AT });
    await expectCode(
      () => repo.updateIfVersion(record.id, undefined as unknown as number, {}),
      "VALIDATION_FAILED",
    );
  });

  it("状态流转成功会推进版本，非法流转抛 CASE_STATE_INVALID", async () => {
    const repo = new InMemoryCaseRepository();
    const record = await repo.create({ ownerId: OWNER, payload: {}, at: AT });
    const submitted = await repo.transition(record.id, "pending_review", { at: AT });
    expect(submitted.status).toBe("pending_review");
    expect(submitted.version).toBe(1);
    await expectCode(() => repo.transition(record.id, "published"), "CASE_STATE_INVALID");
    const approved = await repo.transition(record.id, "approved", { reviewNote: "通过", at: AT });
    expect(approved.reviewNote).toBe("通过");
  });

  it("reviewNote 三种口径：传 null 清空、传 undefined 保留、不传保留", async () => {
    const repo = new InMemoryCaseRepository();
    const record = await repo.create({ ownerId: OWNER, payload: {}, at: AT });
    await repo.transition(record.id, "pending_review", { at: AT });
    expect((await repo.transition(record.id, "approved", { reviewNote: "通过", at: AT })).reviewNote).toBe("通过");
    expect((await repo.transition(record.id, "published", { reviewNote: undefined, at: AT })).reviewNote).toBe("通过");
    expect((await repo.transition(record.id, "retired", { reviewNote: null, at: AT })).reviewNote).toBeNull();
  });

  it("D03 开关：仓储构造时开一次即可，不必每个调用点都传", async () => {
    const repo = new InMemoryCaseRepository({ rejectedAsStatus: true });
    const record = await repo.create({ ownerId: OWNER, payload: {}, at: AT });
    await repo.transition(record.id, "pending_review", { at: AT });
    expect((await repo.transition(record.id, "rejected", { reviewNote: "缺字段", at: AT })).status).toBe("rejected");
    expect((await repo.transition(record.id, "draft", { at: AT })).status).toBe("draft");
  });

  it("D03 开关：rejectedAsStatus=true 时驳回可用", async () => {
    const repo = new InMemoryCaseRepository();
    const record = await repo.create({ ownerId: OWNER, payload: {}, at: AT });
    await repo.transition(record.id, "pending_review", { at: AT });
    await expectCode(() => repo.transition(record.id, "rejected"), "CASE_STATE_INVALID");
    const rejected = await repo.transition(record.id, "rejected", {
      rejectedAsStatus: true,
      reviewNote: "缺字段",
      at: AT,
    });
    expect(rejected.status).toBe("rejected");
    expect((await repo.transition(record.id, "draft", { rejectedAsStatus: true, at: AT })).status).toBe("draft");
  });
});
