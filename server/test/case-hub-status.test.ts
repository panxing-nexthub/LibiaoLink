/**
 * Case Hub 状态机（S4a 预做切片）：主线五态流转来自《团队分工.md》§3 W0，
 * `rejected` 的表示方式属待定项 D03，因此两条口径都要能用开关切换。
 */
import { describe, expect, it } from "vitest";

import {
  CASE_STATUS_REJECTED,
  CaseHubError,
  assertTransition,
  canTransition,
  transitionsOf,
} from "../src/modules/case-hub/index.js";

describe("Case Hub 状态机", () => {
  it("主线：draft → pending_review → approved → published → retired 全部合法", () => {
    expect(canTransition("draft", "pending_review")).toBe(true);
    expect(canTransition("pending_review", "approved")).toBe(true);
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("published", "retired")).toBe(true);
  });

  it("retired 是终态，没有任何后继", () => {
    expect(transitionsOf("retired")).toEqual([]);
    expect(canTransition("retired", "draft")).toBe(false);
  });

  it("跳级与回退一律非法，并抛 CASE_STATE_INVALID", () => {
    for (const [from, to] of [
      ["draft", "published"],
      ["draft", "approved"],
      ["pending_review", "published"],
      ["published", "draft"],
      ["approved", "draft"],
    ] as const) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrowError(CaseHubError);
      try {
        assertTransition(from, to);
      } catch (error) {
        expect((error as CaseHubError).code).toBe("CASE_STATE_INVALID");
        expect((error as CaseHubError).httpStatus).toBe(409);
      }
    }
  });

  it("D03 默认口径：rejected 不参与流转", () => {
    expect(canTransition("pending_review", CASE_STATUS_REJECTED)).toBe(false);
    expect(transitionsOf("pending_review")).toEqual(["approved"]);
  });

  it("D03 若判定 rejected 为独立状态：pending_review → rejected → draft", () => {
    expect(canTransition("pending_review", CASE_STATUS_REJECTED, { rejectedAsStatus: true })).toBe(true);
    expect(canTransition(CASE_STATUS_REJECTED, "draft", { rejectedAsStatus: true })).toBe(true);
    expect(canTransition(CASE_STATUS_REJECTED, "pending_review", { rejectedAsStatus: true })).toBe(false);
    expect(transitionsOf("pending_review", { rejectedAsStatus: true })).toEqual(["approved", "rejected"]);
  });
});
