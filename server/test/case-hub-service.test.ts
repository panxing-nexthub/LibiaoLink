/**
 * Case Hub 草稿服务（S5）：创建 / 读取 / 列表 / 版本条件更新 / 提交审核编排。
 *
 * 覆盖口径：
 * - payload 形状与 extensions 限额由服务写入前校验，仓储保持哑存储；
 * - 条件更新必须携带当前 version，过期版本抛 VERSION_CONFLICT；
 * - 状态约束（仅 draft 可编辑）与非法流转抛 CASE_STATE_INVALID；
 * - 同案例并发更新一成功一冲突、并发提交一成功一状态非法；
 * - 授权（本人 / 他人草稿）属 S9 的 CasePolicyPort，本步不实现，也不在此假装已实现。
 */
import { describe, expect, it } from "vitest";

import { CaseHubError, CaseService, InMemoryCaseRepository } from "../src/modules/case-hub/index.js";
import type { CaseRepository } from "../src/modules/case-hub/index.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";

/** 端口是接口类型，内存仓储按结构实现它；这里显式标注以便类型检查同时盯住两侧。 */
function newService(): { service: CaseService; repository: CaseRepository } {
  const repository: CaseRepository = new InMemoryCaseRepository();
  return { service: new CaseService(repository), repository };
}

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

describe("Case Hub 草稿服务", () => {
  it("创建草稿：draft / version 0 / 归属 ownerId", async () => {
    const { service } = newService();
    const record = await service.createDraft({ ownerId: OWNER, payload: { profile: { title: "A" } } });
    expect(record.status).toBe("draft");
    expect(record.version).toBe(0);
    expect(record.ownerId).toBe(OWNER);
    expect(record.sourceProjectId).toBeNull();
    expect(record.payload).toEqual({ profile: { title: "A" } });
  });

  it("创建时校验 payload 形状与 extensions 限额，非法输入不落库", async () => {
    const { service } = newService();
    await expectCode(() => service.createDraft({ ownerId: OWNER, payload: { unexpected: {} } }), "VALIDATION_FAILED");
    await expectCode(
      () => service.createDraft({ ownerId: OWNER, payload: { extensions: { "case:secret": 1 } } }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      () => service.createDraft({ ownerId: OWNER, payload: { extensions: { "acl:note": { a: { b: { c: { d: 1 } } } } } } }),
      "VALIDATION_FAILED",
    );
    expect(await service.listCases()).toHaveLength(0);
  });

  it("payload 不是对象时拒绝且不落库（JSON 请求体的运行时边界）", async () => {
    const { service } = newService();
    for (const bad of [null, [], ["profile"], "profile"]) {
      await expectCode(
        () => service.createDraft({ ownerId: OWNER, payload: bad as unknown as Record<string, unknown> }),
        "VALIDATION_FAILED",
      );
    }
    expect(await service.listCases()).toHaveLength(0);
  });

  it("读取与列表：不存在抛 NOT_FOUND，列表按 owner 过滤", async () => {
    const { service } = newService();
    const mine = await service.createDraft({ ownerId: OWNER, payload: { profile: {} } });
    await service.createDraft({ ownerId: OTHER_OWNER, payload: { profile: {} } });
    expect((await service.getCase(mine.id)).id).toBe(mine.id);
    await expectCode(() => service.getCase("missing"), "NOT_FOUND");
    const mineList = await service.listCases({ ownerId: OWNER });
    expect(mineList.map((record) => record.id)).toEqual([mine.id]);
    expect(await service.listCases({ ownerId: OTHER_OWNER })).toHaveLength(1);
  });

  it("条件更新成功：version + 1，payload 整份替换（局部合并语义属 D01）", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: { title: "A" } } });
    const updated = await service.updateDraft(created.id, {
      version: 0,
      payload: { profile: { title: "B" }, narrative: { background: "背景" } },
    });
    expect(updated.version).toBe(1);
    expect(updated.payload).toEqual({ profile: { title: "B" }, narrative: { background: "背景" } });
  });

  it("过期版本抛 VERSION_CONFLICT，且不改动存储", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: { title: "A" } } });
    await service.updateDraft(created.id, { version: 0, payload: { profile: { title: "B" } } });
    await expectCode(
      () => service.updateDraft(created.id, { version: 0, payload: { profile: { title: "C" } } }),
      "VERSION_CONFLICT",
    );
    const current = await service.getCase(created.id);
    expect(current.version).toBe(1);
    expect(current.payload).toEqual({ profile: { title: "B" } });
  });

  it("缺少 version 按校验失败处理", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: {} });
    await expectCode(
      () => service.updateDraft(created.id, { version: undefined as unknown as number, payload: {} }),
      "VALIDATION_FAILED",
    );
  });

  it("非法 payload 不推进版本，也不写入存储", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: { title: "A" } } });
    await expectCode(
      () => service.updateDraft(created.id, { version: 0, payload: { profile: {}, extraGroup: 1 } }),
      "VALIDATION_FAILED",
    );
    const current = await service.getCase(created.id);
    expect(current.version).toBe(0);
    expect(current.payload).toEqual({ profile: { title: "A" } });
  });

  it("非草稿不可编辑（D03 未定，暂只放开 draft）", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: { title: "A" } } });
    await service.submitForReview(created.id);
    await expectCode(
      () => service.updateDraft(created.id, { version: 1, payload: { profile: { title: "B" } } }),
      "CASE_STATE_INVALID",
    );
    expect((await service.getCase(created.id)).payload).toEqual({ profile: { title: "A" } });
  });

  it("提交审核：draft → pending_review，version + 1", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: {} } });
    const submitted = await service.submitForReview(created.id);
    expect(submitted.status).toBe("pending_review");
    expect(submitted.version).toBe(1);
  });

  it("非草稿提交抛 CASE_STATE_INVALID", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: {} });
    await service.submitForReview(created.id);
    await expectCode(() => service.submitForReview(created.id), "CASE_STATE_INVALID");
    expect((await service.getCase(created.id)).version).toBe(1);
  });

  it("已发布后不可直接编辑（D03 提案方向的最小落点；正式口径待 D03）", async () => {
    const { service, repository } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: {} } });
    await service.submitForReview(created.id);
    await repository.transition(created.id, "approved", { reviewNote: "通过" });
    await repository.transition(created.id, "published");
    const published = await service.getCase(created.id);
    expect(published.status).toBe("published");
    await expectCode(
      () => service.updateDraft(created.id, { version: published.version, payload: { profile: { title: "改" } } }),
      "CASE_STATE_INVALID",
    );
    await expectCode(() => service.submitForReview(created.id), "CASE_STATE_INVALID");
  });

  it("sourceProjectId：不传保留原值、传 null 清空弱引用", async () => {
    const { service } = newService();
    const created = await service.createDraft({
      ownerId: OWNER,
      payload: { profile: {} },
      sourceProjectId: "33333333-3333-4333-8333-333333333333",
    });
    expect(created.sourceProjectId).toBe("33333333-3333-4333-8333-333333333333");
    const kept = await service.updateDraft(created.id, { version: 0, payload: { profile: { title: "A" } } });
    expect(kept.sourceProjectId).toBe("33333333-3333-4333-8333-333333333333");
    const cleared = await service.updateDraft(created.id, { version: 1, sourceProjectId: null });
    expect(cleared.sourceProjectId).toBeNull();
    expect(cleared.payload).toEqual({ profile: { title: "A" } });
  });

  it("并发条件更新：同版本两次写入一成功一冲突", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: { profile: {} } });
    const results = await Promise.allSettled([
      service.updateDraft(created.id, { version: 0, payload: { profile: { title: "A" } } }),
      service.updateDraft(created.id, { version: 0, payload: { profile: { title: "B" } } }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(CaseHubError);
    expect((rejected[0]?.reason as CaseHubError).code).toBe("VERSION_CONFLICT");
    const current = await service.getCase(created.id);
    expect(current.version).toBe(1);
    expect(["A", "B"]).toContain((current.payload.profile as Record<string, unknown>).title);
  });

  it("并发提交：一次成功一次状态非法", async () => {
    const { service } = newService();
    const created = await service.createDraft({ ownerId: OWNER, payload: {} });
    const results = await Promise.allSettled([
      service.submitForReview(created.id),
      service.submitForReview(created.id),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(CaseHubError);
    expect((rejected[0]?.reason as CaseHubError).code).toBe("CASE_STATE_INVALID");
    const current = await service.getCase(created.id);
    expect(current.status).toBe("pending_review");
    expect(current.version).toBe(1);
  });
});
