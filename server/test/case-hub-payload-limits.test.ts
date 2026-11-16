/**
 * Case Hub payload 形状与 extensions 限额（S4a 预做切片）：
 * 六分组固定、未知顶层分组拒绝、extensions 键格式 / 保留命名空间 / 数量 / 单值 / 总量 / 深度。
 * 分组内业务字段（D01）不在这里校验。
 */
import { describe, expect, it } from "vitest";

import {
  CASE_EXTENSION_LIMITS,
  CaseHubError,
  assertExtensions,
  assertPayloadGroups,
  assertPayloadShape,
} from "../src/modules/case-hub/index.js";

function expectCode(fn: () => void, code: string): CaseHubError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CaseHubError);
    expect((error as CaseHubError).code).toBe(code);
    return error as CaseHubError;
  }
  throw new Error("预期抛错但没有抛");
}

describe("Case Hub payload 形状", () => {
  it("六个分组齐全时通过", () => {
    expect(() =>
      assertPayloadGroups({
        profile: {},
        narrative: {},
        solution: {},
        outcomes: {},
        confidentiality: {},
        extensions: {},
      }),
    ).not.toThrow();
  });

  it("分组值必须是对象，字符串 / 数组 / null 都被拒绝", () => {
    for (const bad of ["abc", [1], null] as const) {
      const error = expectCode(() => assertPayloadShape({ profile: bad }), "VALIDATION_FAILED");
      expect(error.details.map((detail) => detail.path)).toEqual(["profile"]);
    }
  });

  it("组合入口 assertPayloadShape 同时校验分组与 extensions", () => {
    expect(() => assertPayloadShape({ profile: {}, extensions: { "crm:level": "A" } })).not.toThrow();
    expectCode(() => assertPayloadShape({ profile: {}, extra: {} }), "VALIDATION_FAILED");
    expectCode(() => assertPayloadShape({ profile: {}, extensions: { "case:owner": 1 } }), "VALIDATION_FAILED");
  });

  it("未识别的顶层分组被拒绝，并带 path 明细", () => {
    const error = expectCode(
      () => assertPayloadGroups({ profile: {}, summary: {}, attachments: [] }),
      "VALIDATION_FAILED",
    );
    expect(error.details.map((detail) => detail.path)).toEqual(["summary", "attachments"]);
  });
});

describe("Case Hub extensions 限额", () => {
  it("缺省 / null 直接放过", () => {
    expect(() => assertExtensions(undefined)).not.toThrow();
    expect(() => assertExtensions(null)).not.toThrow();
  });

  it("合法命名空间化键通过", () => {
    expect(() => assertExtensions({ "crm:customerLevel": "A", "erp:orderRef": { no: 1 } })).not.toThrow();
  });

  it("键格式非法被拒绝", () => {
    for (const key of ["crmCustomerLevel", "Crm:level", "c:level", "crm:", "crm:level:extra"]) {
      expectCode(() => assertExtensions({ [key]: 1 }), "VALIDATION_FAILED");
    }
  });

  it("保留命名空间被拒绝", () => {
    expectCode(() => assertExtensions({ "case:owner": 1 }), "VALIDATION_FAILED");
    expectCode(() => assertExtensions({ "internal:note": 1 }), "VALIDATION_FAILED");
  });

  it("数量超过上限被拒绝", () => {
    const extensions: Record<string, unknown> = {};
    for (let index = 0; index <= CASE_EXTENSION_LIMITS.maxKeys; index += 1) {
      extensions[`ns:key${index}`] = index;
    }
    expectCode(() => assertExtensions(extensions), "VALIDATION_FAILED");
  });

  it("单值超过 8 KiB 被拒绝", () => {
    expectCode(
      () => assertExtensions({ "ns:big": "x".repeat(CASE_EXTENSION_LIMITS.maxValueBytes) }),
      "VALIDATION_FAILED",
    );
  });

  it("总量超过 64 KiB 被拒绝（单值都合法）", () => {
    const chunk = "x".repeat(7 * 1024);
    const extensions: Record<string, unknown> = {};
    for (let index = 0; index < 10; index += 1) {
      extensions[`ns:chunk${index}`] = chunk;
    }
    expectCode(() => assertExtensions(extensions), "VALIDATION_FAILED");
  });

  it("嵌套深度超过 3 被拒绝", () => {
    expectCode(() => assertExtensions({ "ns:deep": { a: { b: { c: { d: 1 } } } } }), "VALIDATION_FAILED");
  });

  it("extensions 不是对象被拒绝", () => {
    expectCode(() => assertExtensions([1, 2]), "VALIDATION_FAILED");
    expectCode(() => assertExtensions("x"), "VALIDATION_FAILED");
  });
});
