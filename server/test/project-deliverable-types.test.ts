import { ProjectDeliverableTypeCreateBodySchema, type Dict } from "@libiaolink/contracts";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { ProjectsController } from "../src/modules/project/project.controller.js";
import type { ProjectMemberService } from "../src/modules/project/project-member.service.js";
import type { ProjectGroupService } from "../src/modules/project/project-group.service.js";
import type { ProjectService } from "../src/modules/project/project.service.js";
import type { DictService } from "../src/modules/admin/index.js";
import type { ProjectAccessContext, ProjectManagerEligibilityService } from "../src/modules/permission/index.js";
import type { TranslateService } from "../src/modules/translate/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ACCESS: ProjectAccessContext = { projectId: PROJECT_ID, member: true, projectManager: false, groupAccessLevel: "edit", accessLevel: "edit" };

class FakeDictService {
  calls: { name: string; actorId: string; visibility: "public" | "private" }[] = [];
  async createCustomDeliverableType(name: string, actorId: string): Promise<Dict> {
    this.calls.push({ name, actorId, visibility: "public" });
    return { type: "deliverableType", items: [], updatedAt: "2026-11-06T00:00:00.000Z" };
  }

  async createPersonalDeliverableType(name: string, actorId: string) {
    this.calls.push({ name, actorId, visibility: "private" });
    return { id: "33333333-3333-4333-8333-333333333333", name };
  }
}

function makeController(): { controller: ProjectsController; dicts: FakeDictService } {
  const dicts = new FakeDictService();
  const controller = new ProjectsController(
    {} as ProjectService,
    {} as ProjectMemberService,
    {} as ProjectGroupService,
    {} as ProjectManagerEligibilityService,
    {} as TranslateService,
    dicts as unknown as DictService,
  );
  return { controller, dicts };
}

describe("项目内新增成果文件下拉选项", () => {
  it("旧请求缺少可见范围时拒绝；名称与可见范围必填", () => {
    expect(ProjectDeliverableTypeCreateBodySchema.safeParse({ name: "竣工图" }).success).toBe(false);
    expect(ProjectDeliverableTypeCreateBodySchema.safeParse({ name: "竣工图", visibility: "unknown" }).success).toBe(false);
    expect(ProjectDeliverableTypeCreateBodySchema.parse({ name: " 竣工图 ", visibility: "private" })).toEqual({ name: "竣工图", visibility: "private" });
  });

  it("只读项目经理及仅有 edit 规则的非项目经理都不能创建", async () => {
    const { controller, dicts } = makeController();
    for (const access of [ACCESS, { ...ACCESS, projectManager: true, groupAccessLevel: "view", accessLevel: "view" } as const]) {
      await expect(controller.createDeliverableType(PROJECT_ID, { name: "竣工图", visibility: "private" }, access, ACTOR_ID)).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<AppError>);
    }
    expect(dicts.calls).toEqual([]);
  });

  it("项目经理只能创建自己的个人选项", async () => {
    const { controller, dicts } = makeController();
    const access = { ...ACCESS, projectManager: true };
    await expect(controller.createDeliverableType(PROJECT_ID, { name: "现场签证单", visibility: "public" }, access, ACTOR_ID)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await controller.createDeliverableType(PROJECT_ID, { name: "现场签证单", visibility: "private" }, access, ACTOR_ID);
    expect(dicts.calls).toEqual([{ name: "现场签证单", actorId: ACTOR_ID, visibility: "private" }]);
    expect(result).toMatchObject({ visibility: "private", item: { name: "现场签证单" } });
  });

  it("系统管理员可选择公共或个人，个人选项同样绑定其账号", async () => {
    const { controller, dicts } = makeController();
    const access = { ...ACCESS, admin: true as const };
    const shared = await controller.createDeliverableType(PROJECT_ID, { name: "公共选项", visibility: "public" }, access, ACTOR_ID);
    const personal = await controller.createDeliverableType(PROJECT_ID, { name: "个人选项", visibility: "private" }, access, ACTOR_ID);
    expect(shared).toMatchObject({ visibility: "public", dictionary: { type: "deliverableType" } });
    expect(personal).toMatchObject({ visibility: "private", item: { name: "个人选项" } });
    expect(dicts.calls).toEqual([
      { name: "公共选项", actorId: ACTOR_ID, visibility: "public" },
      { name: "个人选项", actorId: ACTOR_ID, visibility: "private" },
    ]);
  });
});
