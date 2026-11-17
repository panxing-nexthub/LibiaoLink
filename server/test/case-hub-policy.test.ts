/**
 * Case Hub 策略矩阵（W3）：四维度取值来自《团队分工.md》§3 W3，属已冻结内容。
 * `CaseViewerFacts` 的算法（谁属于本区域 / 项目名册 / 合作伙伴名单）属待定项 D04，本文件只测判定。
 */
import { describe, expect, it } from "vitest";

import {
  CASE_ASSET_POLICIES,
  CASE_EXTERNAL_ACCESS,
  CASE_INTERNAL_VISIBILITIES,
  canInternalRead,
  decideAssetAccess,
  decideExternalAccess,
} from "../src/modules/case-hub/index.js";

describe("Case Hub 策略矩阵 · 内部可见范围", () => {
  it("全公司：任何内部主体可见", () => {
    expect(canInternalRead("company")).toBe(true);
    expect(canInternalRead("company", {})).toBe(true);
  });

  it("本区域或团队 / 项目相关人员：只看事实是否成立", () => {
    expect(canInternalRead("region_or_team", { sameRegionOrTeam: true })).toBe(true);
    expect(canInternalRead("region_or_team", { sameRegionOrTeam: false })).toBe(false);
    expect(canInternalRead("region_or_team")).toBe(false);
    expect(canInternalRead("project_members", { projectMember: true })).toBe(true);
    expect(canInternalRead("project_members", { sameRegionOrTeam: true })).toBe(false);
    expect(canInternalRead("project_members")).toBe(false);
  });

  it("严格保密：不因事实成立而放宽（案例负责人与授权名单属 D04）", () => {
    expect(canInternalRead("strict")).toBe(false);
    expect(
      canInternalRead("strict", { sameRegionOrTeam: true, projectMember: true, partnerAllowlisted: true }),
    ).toBe(false);
  });
});

describe("Case Hub 策略矩阵 · 外部访问", () => {
  it("不允许 / 仅脱敏后允许", () => {
    expect(decideExternalAccess("denied")).toBe("denied");
    expect(decideExternalAccess("masked_only")).toBe("masked");
  });

  it("仅指定合作伙伴：名单内放行，名单外拒绝", () => {
    expect(decideExternalAccess("partners_only", { partnerAllowlisted: true })).toBe("granted");
    expect(decideExternalAccess("partners_only", { partnerAllowlisted: false })).toBe("denied");
    expect(decideExternalAccess("partners_only")).toBe("denied");
  });

  it("待确认不是授权：业务给出结论前外部一律拒绝", () => {
    expect(decideExternalAccess("pending")).toBe("denied");
    expect(decideExternalAccess("pending", { partnerAllowlisted: true })).toBe("denied");
  });
});

describe("Case Hub 策略矩阵 · 素材权限", () => {
  it("不展示素材：内外都拒绝，两个素材类型都一样", () => {
    for (const kind of ["image", "video"] as const) {
      for (const scope of ["internal", "external"] as const) {
        expect(decideAssetAccess({ policy: "hidden", kind, scope })).toBe("deny");
      }
    }
  });

  it("内部可看图片视频：对内放行，对外不签发", () => {
    expect(decideAssetAccess({ policy: "all_internal", kind: "image", scope: "internal" })).toBe("grant");
    expect(decideAssetAccess({ policy: "all_internal", kind: "video", scope: "internal" })).toBe("grant");
    expect(decideAssetAccess({ policy: "all_internal", kind: "image", scope: "external" })).toBe("deny");
    expect(decideAssetAccess({ policy: "all_internal", kind: "video", scope: "external" })).toBe("deny");
  });

  it("图片可看·视频需审批：对外图片直通、视频转审批", () => {
    expect(
      decideAssetAccess({ policy: "image_ok_video_approval", kind: "image", scope: "external" }),
    ).toBe("grant");
    expect(
      decideAssetAccess({ policy: "image_ok_video_approval", kind: "video", scope: "external" }),
    ).toBe("approval_required");
    expect(
      decideAssetAccess({ policy: "image_ok_video_approval", kind: "video", scope: "internal" }),
    ).toBe("grant");
  });

  it("素材均需审批：对外两个类型都转审批", () => {
    expect(
      decideAssetAccess({ policy: "all_require_approval", kind: "image", scope: "external" }),
    ).toBe("approval_required");
    expect(
      decideAssetAccess({ policy: "all_require_approval", kind: "video", scope: "external" }),
    ).toBe("approval_required");
  });
});

describe("Case Hub 策略矩阵 · 取值集合", () => {
  it("三个已落地维度的取值与团队分工给定选项一一对应（改动需先改团队分工）", () => {
    expect(CASE_INTERNAL_VISIBILITIES).toHaveLength(4);
    expect(CASE_EXTERNAL_ACCESS).toHaveLength(4);
    expect(CASE_ASSET_POLICIES).toHaveLength(4);
  });

  it("每个取值都有判定结果，不存在未覆盖分支", () => {
    for (const visibility of CASE_INTERNAL_VISIBILITIES) {
      expect(typeof canInternalRead(visibility)).toBe("boolean");
    }
    for (const access of CASE_EXTERNAL_ACCESS) {
      expect(["granted", "masked", "denied"]).toContain(decideExternalAccess(access));
    }
    for (const policy of CASE_ASSET_POLICIES) {
      expect(["grant", "approval_required", "deny"]).toContain(
        decideAssetAccess({ policy, kind: "image", scope: "external" }),
      );
    }
  });
});
