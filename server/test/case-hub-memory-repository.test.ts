/**
 * Case Hub 内存仓储（S4a 预做切片）：草稿创建、按 owner 过滤、
 * 版本条件更新（并发一成功一冲突）、状态流转与非法流转。
 * 内存语义通过不等于真实存储并发已验证（正式适配由 lan 负责）。
 */
import { describe, expect, it } from "vitest";

import { CaseHubError, InMemoryCaseRepository } from "../src/modules/case-hub/index.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const AT = new Date("2026-11-16T02:00:00Z");

function expectCode(fn: () => unknown, code: string): CaseHubError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CaseHubError);
    expect((error as CaseHubError).code).toBe(code);
    return error as CaseHubError;
  }
  throw new Error("预期抛错但没有抛");
}

describe("Case Hub 内存仓储", () => {
  it("创建即草稿，version 从 0 开始", () => {
    const repo = new InMemoryCaseRepository();
    const record = repo.create({ ownerId: OWNER, payload: { profile: {} }, at: AT });
    expect(record.status).toBe("draft");
    expect(record.version).toBe(0);
    expect(record.ownerId).toBe(OWNER);
    expect(record.sourceProjectId).toBeNull();
    expect(repo.get(record.id).id).toBe(record.id);
  });

  it("返回的记录与仓储隔离：改动返回值不会污染仓储存量", () => {
    const repo = new InMemoryCaseRepository();
    const created = repo.create({ ownerId: OWNER, payload: { profile: { title: "A" } }, at: AT });
    (created.payload.profile as Record<string, unknown>).title = "被外部改掉";
    const fetched = repo.get(created.id);
    (fetched.payload.profile as Record<string, unknown>).title = "又改一次";
    expect((repo.get(created.id).payload.profile as Record<string, unknown>).title).toBe("A");
  });

  it("不存在抛 NOT_FOUND", () => {
    const repo = new InMemoryCaseRepository();
    expectCode(() => repo.get("missing"), "NOT_FOUND");
    expectCode(() => repo.updateIfVersion("missing", 0, {}), "NOT_FOUND");
    expectCode(() => repo.transition("missing", "pending_review"), "NOT_FOUND");
  });

  it("列表按 owner / 状态过滤", () => {
    const repo = new InMemoryCaseRepository();
    const mine = repo.create({ ownerId: OWNER, payload: {}, at: AT });
    repo.create({ ownerId: OTHER_OWNER, payload: {}, at: AT });
    expect(repo.list({ ownerId: OWNER })).toHaveLength(1);
    expect(repo.list({ ownerId: OWNER })[0]?.id).toBe(mine.id);
    expect(repo.list({ ownerId: OWNER, status: "published" })).toHaveLength(0);
    expect(repo.list()).toHaveLength(2);
  });

  it("条件更新：同一版本两次写入，一次成功一次 VERSION_CONFLICT", () => {
    const repo = new InMemoryCaseRepository();
    const record = repo.create({ ownerId: OWNER, payload: { profile: {} }, at: AT });

    const first = repo.updateIfVersion(record.id, 0, { payload: { profile: { title: "A" } } }, AT);
    expect(first.version).toBe(1);
    expectCode(() => repo.updateIfVersion(record.id, 0, { payload: { profile: { title: "B" } } }, AT), "VERSION_CONFLICT");
    expect(repo.get(record.id).payload).toEqual({ profile: { title: "A" } });
  });

  it("缺少版本号按校验失败处理", () => {
    const repo = new InMemoryCaseRepository();
    const record = repo.create({ ownerId: OWNER, payload: {}, at: AT });
    expectCode(() => repo.updateIfVersion(record.id, undefined as unknown as number, {}), "VALIDATION_FAILED");
  });

  it("状态流转成功会推进版本，非法流转抛 CASE_STATE_INVALID", () => {
    const repo = new InMemoryCaseRepository();
    const record = repo.create({ ownerId: OWNER, payload: {}, at: AT });
    const submitted = repo.transition(record.id, "pending_review", { at: AT });
    expect(submitted.status).toBe("pending_review");
    expect(submitted.version).toBe(1);
    expectCode(() => repo.transition(record.id, "published"), "CASE_STATE_INVALID");
    const approved = repo.transition(record.id, "approved", { reviewNote: "通过", at: AT });
    expect(approved.reviewNote).toBe("通过");
  });

  it("显式传 reviewNote: null 可清空备注，不传则保留", () => {
    const repo = new InMemoryCaseRepository();
    const record = repo.create({ ownerId: OWNER, payload: {}, at: AT });
    repo.transition(record.id, "pending_review", { at: AT });
    expect(repo.transition(record.id, "approved", { reviewNote: "通过", at: AT }).reviewNote).toBe("通过");
    expect(repo.transition(record.id, "published", { at: AT }).reviewNote).toBe("通过");
    expect(repo.transition(record.id, "retired", { reviewNote: null, at: AT }).reviewNote).toBeNull();
  });

  it("D03 开关：仓储构造时开一次即可，不必每个调用点都传", () => {
    const repo = new InMemoryCaseRepository({ rejectedAsStatus: true });
    const record = repo.create({ ownerId: OWNER, payload: {}, at: AT });
    repo.transition(record.id, "pending_review", { at: AT });
    expect(repo.transition(record.id, "rejected", { reviewNote: "缺字段", at: AT }).status).toBe("rejected");
    expect(repo.transition(record.id, "draft", { at: AT }).status).toBe("draft");
  });

  it("D03 开关：rejectedAsStatus=true 时驳回可用", () => {
    const repo = new InMemoryCaseRepository();
    const record = repo.create({ ownerId: OWNER, payload: {}, at: AT });
    repo.transition(record.id, "pending_review", { at: AT });
    expectCode(() => repo.transition(record.id, "rejected"), "CASE_STATE_INVALID");
    const rejected = repo.transition(record.id, "rejected", { rejectedAsStatus: true, reviewNote: "缺字段", at: AT });
    expect(rejected.status).toBe("rejected");
    expect(repo.transition(record.id, "draft", { rejectedAsStatus: true, at: AT }).status).toBe("draft");
  });
});
