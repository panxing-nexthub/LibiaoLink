import { describe, expect, it } from "vitest";
import { canUseProjectManagement, ProjectManagementRecordCreateBodySchema } from "@libiaolink/contracts";
import { ProjectManagementAccessGuard } from "../src/modules/project-management/project-management-access.guard.js";
import type { AppError } from "../src/common/errors/app-error.js";
import type { ProjectManagementRecordRow } from "../src/db/schema/project-management.js";
import {
  isBlankProjectManagementFields,
  type ProjectManagementRecordPatch,
  type ProjectManagementUserSnapshot,
} from "../src/modules/project-management/project-management.repository.js";
import { ProjectManagementService } from "../src/modules/project-management/project-management.service.js";
import {
  buildProjectManagementSnapshots,
  daysBetweenInclusive,
  EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT,
  type ProjectManagementProjectSnapshot,
  type ProjectManagementSnapshotTaskRow,
} from "../src/modules/project-management/project-management-snapshot.repository.js";

const RECORD_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_RECORD_ID = "77777777-7777-4777-8777-777777777777";
const THIRD_RECORD_ID = "88888888-8888-4888-8888-888888888888";
const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const ENGINEER_ID = "33333333-3333-4333-8333-333333333333";
const ENGINEER_2_ID = "55555555-5555-4555-8555-555555555555";
const DISABLED_ID = "44444444-4444-4444-8444-444444444444";
const OUTSIDE_ID = "66666666-6666-4666-8666-666666666666";

class FakeProjectManagementRepository {
  rows: ProjectManagementRecordRow[] = [];
  users: ProjectManagementUserSnapshot[] = [];
  insertCalls: unknown[] = [];
  versionChecks: Array<{ id: string; version: number }> = [];

  orderWrites: string[][] = [];

  async list(): Promise<ProjectManagementRecordRow[]> {
    return this.rows
      .filter((row) => !isBlankProjectManagementFields(row))
      .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
  }

  async lockOrder(): Promise<void> {}

  async writeOrder(ids: string[]): Promise<void> {
    this.orderWrites.push(ids);
    const positions = new Map(ids.map((id, index) => [id, index + 1]));
    this.rows = this.rows.map((row) => ({ ...row, sortOrder: positions.get(row.id) ?? row.sortOrder }));
  }

  async findById(id: string): Promise<ProjectManagementRecordRow | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async insert(values: Record<string, unknown>, at: Date): Promise<ProjectManagementRecordRow> {
    this.insertCalls.push(values);
    const row = makeRow({
      ...values,
      id: RECORD_ID,
      version: 0,
      createdAt: at,
      updatedAt: at,
    } as Partial<ProjectManagementRecordRow>);
    this.rows.push(row);
    return row;
  }

  async updateIfVersion(id: string, version: number, patch: ProjectManagementRecordPatch, at: Date): Promise<ProjectManagementRecordRow | null> {
    this.versionChecks.push({ id, version });
    const index = this.rows.findIndex((row) => row.id === id && row.version === version);
    if (index === -1) return null;
    const next = { ...this.rows[index]!, ...patch, updatedAt: at, version: version + 1 };
    this.rows[index] = next;
    return next;
  }

  async deleteIfVersion(id: string, version: number): Promise<string | null> {
    this.versionChecks.push({ id, version });
    const index = this.rows.findIndex((row) => row.id === id && row.version === version);
    if (index === -1) return null;
    this.rows.splice(index, 1);
    return id;
  }

  async listUsersByIds(ids: readonly string[]): Promise<ProjectManagementUserSnapshot[]> {
    return this.users.filter((user) => ids.includes(user.userId));
  }

}

class FakeProjectSnapshotRepository {
  snapshots = new Map<string, ProjectManagementProjectSnapshot>();
  calls: string[][] = [];

  async loadByCodes(codes: readonly string[]): Promise<Map<string, ProjectManagementProjectSnapshot>> {
    this.calls.push([...codes]);
    const result = new Map<string, ProjectManagementProjectSnapshot>();
    for (const code of codes) {
      const snapshot = this.snapshots.get(code.trim());
      if (snapshot !== undefined) {
        result.set(code.trim(), snapshot);
      }
    }
    return result;
  }
}

class FakeManagerEligibility {
  calls: string[][] = [];

  async eligibleUserIds(): Promise<Set<string>> {
    return new Set([MANAGER_ID, ENGINEER_ID, ENGINEER_2_ID]);
  }

  async assertAssignable(ids: readonly string[]): Promise<void> {
    this.calls.push([...ids]);
    if (ids.includes(DISABLED_ID)) {
      throw new Error("ineligible");
    }
  }
}

function makeRow(overrides: Partial<ProjectManagementRecordRow> = {}): ProjectManagementRecordRow {
  return {
    id: RECORD_ID,
    code: "",
    name: "",
    managerIds: [],
    implementationEngineerIds: [],
    implementationHandedOver: false,
    implementationMethod: null,
    riskReminder: null,
    region: "未分类",
    currentStageOverride: null,
    startupCompletedAtOverride: null,
    arrivalDateOverride: null,
    plannedStartDateOverride: null,
    plannedEndDateOverride: null,
    implementationDaysOverride: null,
    currentStage: null,
    arrivalDate: null,
    plannedStartDate: null,
    plannedEndDate: null,
    implementationDays: null,
    sortOrder: null,
    version: 0,
    createdAt: new Date("2026-11-17T01:00:00.000Z"),
    updatedAt: new Date("2026-11-17T01:00:00.000Z"),
    ...overrides,
  };
}

class FakeAuditService {
  records: unknown[] = [];

  async record(_client: unknown, input: unknown): Promise<void> {
    this.records.push(input);
  }
}

function makeService(): {
  service: ProjectManagementService;
  repository: FakeProjectManagementRepository;
  managers: FakeManagerEligibility;
  snapshots: FakeProjectSnapshotRepository;
  audits: FakeAuditService;
} {
  const repository = new FakeProjectManagementRepository();
  const managers = new FakeManagerEligibility();
  const snapshots = new FakeProjectSnapshotRepository();
  repository.users = [
    { userId: MANAGER_ID, username: "manager", displayName: "经理甲", status: "active", removedAt: null },
    { userId: ENGINEER_ID, username: "engineer", displayName: "工程师乙", status: "active", removedAt: null },
    { userId: ENGINEER_2_ID, username: "engineer2", displayName: "工程师丁", status: "active", removedAt: null },
    { userId: DISABLED_ID, username: "disabled", displayName: "停用丙", status: "disabled", removedAt: null },
    { userId: OUTSIDE_ID, username: "outside", displayName: "其他部门成员", status: "active", removedAt: null },
  ];
  const audits = new FakeAuditService();
  const database = { db: { transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run({}) } };
  const service = new ProjectManagementService(
    database as never,
    repository as never,
    managers as never,
    snapshots as never,
    audits as never,
  );
  return { service, repository, managers, snapshots, audits };
}

describe("项目管理阶段契约（2026-11-20）", () => {
  it("项目当前阶段人工覆盖接受新增三种状态", () => {
    for (const currentStageOverride of ["not_started", "archived", "terminated"] as const) {
      expect(ProjectManagementRecordCreateBodySchema.parse({ currentStageOverride }).currentStageOverride).toBe(currentStageOverride);
    }
  });
});

describe("项目管理记录顺序", () => {
  it("移动可见记录并保持字段版本与时间戳", async () => {
    const { service, repository, audits } = makeService();
    const first = makeRow({ id: SECOND_RECORD_ID, name: "先创建", version: 2 });
    const second = makeRow({ id: THIRD_RECORD_ID, name: "后创建", version: 5 });
    repository.rows = [first, second];
    await expect(service.move(second.id, { beforeId: first.id })).resolves.toEqual({ id: second.id });
    expect((await service.list()).items.map(({ id, version, updatedAt }) => ({ id, version, updatedAt }))).toEqual([
      { id: second.id, version: 5, updatedAt: second.updatedAt.toISOString() },
      { id: first.id, version: 2, updatedAt: first.updatedAt.toISOString() },
    ]);
    await service.move(second.id, { beforeId: first.id });
    expect(repository.orderWrites).toHaveLength(1);
    expect(audits.records).toHaveLength(1);
    await service.move(second.id, { beforeId: null });
    expect((await service.list()).items.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it("相对插入和移动只接受可见锚点，空草稿和不合资格人员不能创建", async () => {
    const { service, repository } = makeService();
    const first = makeRow({ id: SECOND_RECORD_ID, name: "已有记录" });
    const hidden = makeRow({ id: THIRD_RECORD_ID });
    repository.rows = [first, hidden];
    const missing = { code: "NOT_FOUND" };
    await expect(service.move(first.id, { beforeId: hidden.id })).rejects.toMatchObject(missing);
    await expect(service.move(hidden.id, { beforeId: first.id })).rejects.toMatchObject(missing);
    await expect(service.create({ name: "没有锚点", beforeId: hidden.id })).rejects.toMatchObject(missing);
    await expect(service.create({ beforeId: first.id })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(service.create({
      name: "复制历史工程师",
      beforeId: first.id,
      implementationEngineerIds: [OUTSIDE_ID],
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(repository.insertCalls).toHaveLength(0);
    expect(repository.orderWrites).toHaveLength(0);
  });

  it("有锚点的创建只写可编辑字段，并按编号解析自动快照", async () => {
    const { service, repository, snapshots } = makeService();
    const target = makeRow({ id: SECOND_RECORD_ID, code: "PM-LINK", name: "原记录", version: 7 });
    repository.rows = [target];
    snapshots.snapshots.set("PM-LINK", {
      ...EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT,
      projectId: THIRD_RECORD_ID,
      plannedStartDate: "2026-10-01",
    });
    const created = await service.create({
      beforeId: target.id,
      code: "PM-LINK",
      name: "原记录",
      implementationHandedOver: true,
      plannedEndDateOverride: "2026-10-08",
    });
    expect(created).toMatchObject({
      id: RECORD_ID,
      version: 0,
      projectId: THIRD_RECORD_ID,
      plannedStartDate: "2026-10-01",
      plannedEndDateOverride: "2026-10-08",
      implementationHandedOver: true,
    });
    expect(repository.insertCalls[0]).not.toHaveProperty("beforeId");
    expect(repository.insertCalls[0]).not.toHaveProperty("projectId");
    expect(repository.rows[0]).toMatchObject({ id: target.id, name: "原记录", version: 7 });
    expect((await service.list()).items.map((row) => row.id)).toEqual([created.id, target.id]);
  });
});

describe("项目管理独立记录服务（2026-11-17）", () => {
  it("首笔输入即可创建：文本收敛、地点空值回落未分类、返回账号姓名", async () => {
    const { service, repository, managers } = makeService();
    const created = await service.create({
      code: "  PM-001  ",
      name: " 独立准备记录 ",
      managerIds: [MANAGER_ID],
      implementationEngineerIds: [ENGINEER_ID],
      implementationMethod: "remote_installation_guidance",
      riskReminder: " 需要提前确认现场 ",
      region: "",
    });
    expect(managers.calls).toEqual([[MANAGER_ID]]);
    expect(repository.insertCalls[0]).toMatchObject({
      code: "PM-001",
      name: "独立准备记录",
      managerIds: [MANAGER_ID],
      implementationEngineerIds: [ENGINEER_ID],
      riskReminder: " 需要提前确认现场 ",
      region: "未分类",
    });
    expect(created.managerNames).toEqual(["经理甲"]);
    expect(created.implementationEngineerNames).toEqual(["工程师乙"]);
    expect(created.version).toBe(0);
  });

  it("全空记录不创建；清空后的更新要求走删除", async () => {
    const { service, repository } = makeService();
    await expect(service.create({})).rejects.toMatchObject<Partial<AppError>>({ code: "VALIDATION_FAILED" });
    expect(repository.insertCalls).toHaveLength(0);
    expect(
      isBlankProjectManagementFields({
        code: "",
        name: "",
        managerIds: [],
        implementationEngineerIds: [],
        implementationHandedOver: false,
        implementationMethod: null,
        riskReminder: "   ",
        region: "未分类",
        currentStageOverride: null,
        startupCompletedAtOverride: null,
        arrivalDateOverride: null,
        plannedStartDateOverride: null,
        plannedEndDateOverride: null,
        implementationDaysOverride: null,
      }),
    ).toBe(true);

    repository.rows = [makeRow({ name: "仅名称", version: 1 })];
    await expect(
      service.update(RECORD_ID, { name: "", version: 1 }),
    ).rejects.toMatchObject<Partial<AppError>>({ code: "VALIDATION_FAILED" });
    expect(repository.rows[0]?.name).toBe("仅名称");
  });

  it("实施工程师必须是启用账号", async () => {
    const { service } = makeService();
    await expect(
      service.create({ implementationEngineerIds: [DISABLED_ID] }),
    ).rejects.toMatchObject<Partial<AppError>>({ code: "VALIDATION_FAILED" });
  });

  it("实施工程师可保留或移除存量名单外人员，但不能新选或重新加入", async () => {
    const { service, repository } = makeService();
    const ineligible = {
      code: "VALIDATION_FAILED",
      details: [{ code: "IMPLEMENTATION_ENGINEER_INELIGIBLE", path: "implementationEngineerIds" }],
    };
    await expect(service.create({ implementationEngineerIds: [OUTSIDE_ID] })).rejects.toMatchObject(ineligible);
    expect(repository.insertCalls).toHaveLength(0);

    repository.rows = [makeRow({ implementationEngineerIds: [OUTSIDE_ID], version: 0 })];
    const added = await service.update(RECORD_ID, { implementationEngineerIds: [OUTSIDE_ID, ENGINEER_ID], version: 0 });
    expect(added.implementationEngineerIds).toEqual([OUTSIDE_ID, ENGINEER_ID]);
    const removed = await service.update(RECORD_ID, { implementationEngineerIds: [ENGINEER_ID], version: 1 });
    expect(removed.implementationEngineerIds).toEqual([ENGINEER_ID]);
    await expect(
      service.update(RECORD_ID, { implementationEngineerIds: [ENGINEER_ID, OUTSIDE_ID], version: 2 }),
    ).rejects.toMatchObject(ineligible);
    expect(repository.rows[0]?.implementationEngineerIds).toEqual([ENGINEER_ID]);
  });

  it("更新使用 version 乐观锁，并返回最新姓名", async () => {
    const { service, repository } = makeService();
    repository.rows = [makeRow({ managerIds: [MANAGER_ID], version: 2 })];
    const updated = await service.update(RECORD_ID, {
      name: "更新后的名称",
      version: 2,
    });
    expect(repository.versionChecks).toEqual([{ id: RECORD_ID, version: 2 }]);
    expect(updated.name).toBe("更新后的名称");
    expect(updated.version).toBe(3);
    expect(updated.managerNames).toEqual(["经理甲"]);
  });

  it("版本冲突返回 VERSION_CONFLICT", async () => {
    const { service, repository } = makeService();
    repository.rows = [makeRow({ version: 5 })];
    await expect(
      service.update(RECORD_ID, { name: "x", version: 4 }),
    ).rejects.toMatchObject<Partial<AppError>>({ code: "VERSION_CONFLICT" });
  });

  it("删除为物理删除，版本不符返回冲突", async () => {
    const { service, repository } = makeService();
    repository.rows = [makeRow({ version: 1 })];
    await expect(service.remove(RECORD_ID, 1)).resolves.toEqual({ id: RECORD_ID, deleted: true });
    expect(repository.rows).toHaveLength(0);
    await expect(service.remove(RECORD_ID, 1)).rejects.toMatchObject<Partial<AppError>>({ code: "NOT_FOUND" });
  });

  it("已移交状态可单独创建与取消", async () => {
    const { service, repository } = makeService();
    const created = await service.create({ implementationHandedOver: true });
    expect(repository.insertCalls[0]).toMatchObject({
      implementationEngineerIds: [],
      implementationHandedOver: true,
    });
    expect(created.implementationHandedOver).toBe(true);
    expect(created.implementationEngineerNames).toEqual([]);

    await expect(service.remove(RECORD_ID, 0)).resolves.toEqual({ id: RECORD_ID, deleted: true });
  });

  it("已移交优先清空工程师；重新选择工程师自动取消已移交", async () => {
    const { service, repository } = makeService();
    const created = await service.create({
      implementationHandedOver: true,
      implementationEngineerIds: [ENGINEER_ID],
    });
    expect(repository.insertCalls[0]).toMatchObject({
      implementationEngineerIds: [],
      implementationHandedOver: true,
    });
    expect(created.implementationEngineerNames).toEqual([]);

    const withEngineer = await service.update(RECORD_ID, {
      implementationEngineerIds: [ENGINEER_ID],
      version: 0,
    });
    expect(withEngineer.implementationHandedOver).toBe(false);
    expect(withEngineer.implementationEngineerNames).toEqual(["工程师乙"]);

    const handedOverAgain = await service.update(RECORD_ID, {
      implementationHandedOver: true,
      version: 1,
    });
    expect(handedOverAgain.implementationHandedOver).toBe(true);
    expect(handedOverAgain.implementationEngineerIds).toEqual([]);
    expect(handedOverAgain.implementationEngineerNames).toEqual([]);
  });

  it("实施工程师支持多位，并按选择顺序返回姓名", async () => {
    const { service, repository } = makeService();
    const created = await service.create({
      implementationEngineerIds: [ENGINEER_2_ID, ENGINEER_ID],
    });
    expect(repository.insertCalls[0]).toMatchObject({
      implementationEngineerIds: [ENGINEER_2_ID, ENGINEER_ID],
    });
    expect(created.implementationEngineerNames).toEqual(["工程师丁", "工程师乙"]);
  });

  it("自动识别字段的人工覆盖值可创建、更新，并原样返回", async () => {
    const { service, repository } = makeService();
    const created = await service.create({
      currentStageOverride: "install",
      startupCompletedAtOverride: "2026-05-20",
      arrivalDateOverride: "2026-07-08",
      plannedStartDateOverride: "2026-09-10",
      plannedEndDateOverride: "2026-10-30",
      implementationDaysOverride: 51,
    });
    expect(created).toMatchObject({
      currentStageOverride: "install",
      startupCompletedAtOverride: "2026-05-20",
      arrivalDateOverride: "2026-07-08",
      plannedStartDateOverride: "2026-09-10",
      plannedEndDateOverride: "2026-10-30",
      implementationDaysOverride: 51,
    });

    const updated = await service.update(RECORD_ID, {
      currentStageOverride: "acceptance",
      implementationDaysOverride: 60,
      version: 0,
    });
    expect(updated.currentStageOverride).toBe("acceptance");
    expect(updated.implementationDaysOverride).toBe(60);
    expect(repository.versionChecks).toEqual([{ id: RECORD_ID, version: 0 }]);
  });

  it("实施日期允许只填一端或同一天，拒绝写入逆序日期", async () => {
    const { service, repository } = makeService();
    const invalid = { code: "VALIDATION_FAILED", message: "计划实施完成日期不能早于计划实施开始日期" };
    await expect(service.create({
      plannedStartDateOverride: "2026-09-20",
      plannedEndDateOverride: "2026-09-19",
    })).rejects.toMatchObject(invalid);
    expect(repository.insertCalls).toHaveLength(0);

    const created = await service.create({ plannedEndDateOverride: "2026-09-20" });
    expect(created.plannedStartDateOverride).toBeNull();
    await expect(service.update(RECORD_ID, {
      version: created.version,
      plannedStartDateOverride: "2026-09-20",
    })).resolves.toMatchObject({ plannedStartDateOverride: "2026-09-20", plannedEndDateOverride: "2026-09-20" });
    await expect(service.update(RECORD_ID, {
      version: 1,
      plannedEndDateOverride: "2026-09-19",
    })).rejects.toMatchObject(invalid);
  });

  it("实施日期写入和恢复自动时按有效日期校验", async () => {
    const { service, snapshots } = makeService();
    const invalid = { code: "VALIDATION_FAILED", message: "计划实施完成日期不能早于计划实施开始日期" };
    snapshots.snapshots.set("PM-001", {
      ...EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT,
      plannedStartDate: "2026-09-20",
      plannedEndDate: "2026-09-25",
    });
    await expect(service.create({
      code: "PM-001",
      plannedStartDateOverride: "2026-09-26",
    })).rejects.toMatchObject(invalid);
    const created = await service.create({
      code: "PM-001",
      plannedStartDateOverride: "2026-09-15",
      plannedEndDateOverride: "2026-09-18",
    });
    await expect(service.update(RECORD_ID, {
      version: created.version,
      plannedStartDateOverride: null,
    })).rejects.toMatchObject(invalid);
    const reopened = await service.update(RECORD_ID, {
      version: created.version,
      plannedEndDateOverride: null,
    });
    expect(reopened).toMatchObject({ plannedEndDateOverride: null, plannedEndDate: "2026-09-25" });
    await expect(service.update(RECORD_ID, {
      version: reopened.version,
      plannedStartDateOverride: null,
    })).resolves.toMatchObject({ plannedStartDateOverride: null, plannedStartDate: "2026-09-20" });
  });

  it("历史逆序日期覆盖值未变时可以保存其它字段", async () => {
    const { service, repository } = makeService();
    repository.rows = [makeRow({
      name: "历史记录",
      plannedStartDateOverride: "2026-09-20",
      plannedEndDateOverride: "2026-09-19",
    })];
    await expect(service.update(RECORD_ID, {
      version: 0,
      name: "历史记录改名",
      plannedStartDateOverride: "2026-09-20",
      plannedEndDateOverride: "2026-09-19",
    })).resolves.toMatchObject({ name: "历史记录改名", version: 1 });
  });

  it("创建 / 列表按 code 附带项目空间只读快照；无匹配项目返回空值", async () => {
    const { service, repository, snapshots } = makeService();
    snapshots.snapshots.set("PM-001", {
      projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      currentStage: "deploy",
      startupCompletedAt: "2026-05-15",
      arrivalDate: "2026-06-12",
      plannedStartDate: "2026-06-18",
      plannedEndDate: "2026-07-03",
      implementationDays: 16,
    });
    const created = await service.create({ code: " PM-001 " });
    expect(created.projectId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(created.currentStage).toBe("deploy");
    expect(created.startupCompletedAt).toBe("2026-05-15");
    expect(created.arrivalDate).toBe("2026-06-12");
    expect(created.plannedStartDate).toBe("2026-06-18");
    expect(created.plannedEndDate).toBe("2026-07-03");
    expect(created.implementationDays).toBe(16);

    repository.rows = [makeRow({ code: "PM-404" })];
    const listed = await service.list();
    expect(listed.items[0]).toMatchObject({
      projectId: null,
      currentStage: null,
      startupCompletedAt: null,
      arrivalDate: null,
      plannedStartDate: null,
      plannedEndDate: null,
      implementationDays: null,
    });
    expect(snapshots.calls).toContainEqual(["PM-001"]);
    expect(snapshots.calls).toContainEqual(["PM-404"]);
  });

  it("新增 / 修改 / 删除写项目管理审计，修改包含字段级变化", async () => {
    const { service, audits } = makeService();
    await service.create(
      {
        code: "PM-AUDIT",
        name: "审计项目",
        managerIds: [MANAGER_ID],
        implementationMethod: "onsite_guidance",
      },
      MANAGER_ID,
    );
    await service.update(
      RECORD_ID,
      {
        managerIds: [ENGINEER_ID],
        implementationMethod: "installation_delivery",
        version: 0,
      },
      MANAGER_ID,
    );
    await service.remove(RECORD_ID, 1, MANAGER_ID);

    const records = audits.records as Array<{
      action: string;
      objectType: string;
      objectId: string;
      projectCode: string | null;
      changes: Array<{ field: string; from: unknown; to: unknown }> | null;
    }>;
    expect(records.map((record) => record.action)).toEqual(["create", "update", "delete"]);
    expect(records.every((record) => record.objectType === "project_management_record")).toBe(true);
    expect(records[0]?.projectCode).toBe("PM-AUDIT");
    expect(records[1]?.changes).toEqual(
      expect.arrayContaining([
        { field: "managerIds", from: ["经理甲"], to: ["工程师乙"] },
        { field: "implementationMethod", from: "onsite_guidance", to: "installation_delivery" },
      ]),
    );
  });
});

describe("项目空间只读快照聚合（2026-11-17）", () => {
  const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function task(overrides: Partial<ProjectManagementSnapshotTaskRow>): ProjectManagementSnapshotTaskRow {
    return {
      projectId: PROJECT_ID,
      stageKey: null,
      title: "临时任务",
      titleEn: null,
      status: "pending",
      plannedStart: null,
      plannedEnd: null,
      actualEnd: null,
      ...overrides,
    };
  }

  it("阶段取已动工任务的阶段序最靠后者，日期按 min / max 聚合，天数含首尾", () => {
    const snapshots = buildProjectManagementSnapshots(
      [{ id: PROJECT_ID, code: "PM-001" }],
      [
        task({
          stageKey: "presale",
          title: "项目启动",
          titleEn: "Project Startup",
          status: "done",
          actualEnd: "2026-05-15",
        }),
        task({ stageKey: "assembly", status: "done", actualEnd: "2026-06-10" }),
        task({ stageKey: "assembly", status: "done", actualEnd: "2026-06-12" }),
        task({
          stageKey: "install",
          status: "active",
          plannedStart: "2026-06-20",
          plannedEnd: "2026-07-01",
        }),
        task({
          stageKey: "install",
          status: "done",
          plannedStart: "2026-06-18",
          plannedEnd: "2026-07-03",
        }),
        task({ stageKey: "deploy", status: "done" }),
        task({ stageKey: "trial", status: "active" }),
      ],
    );

    expect(snapshots.get("PM-001")).toEqual({
      projectId: PROJECT_ID,
      currentStage: "trial",
      startupCompletedAt: "2026-05-15",
      arrivalDate: "2026-06-12",
      plannedStartDate: "2026-06-18",
      plannedEndDate: "2026-07-03",
      implementationDays: 16,
    });
  });

  it("未动工 / 未分组任务不参与当前阶段；无项目或任务为空时派生字段为空", () => {
    const currentOnly = buildProjectManagementSnapshots(
      [{ id: PROJECT_ID, code: "PM-002" }],
      [
        task({ stageKey: "design", status: "pending" }),
        task({ stageKey: null, status: "done", actualEnd: "2026-01-01" }),
      ],
    );
    expect(currentOnly.get("PM-002")).toEqual({
      ...EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT,
      projectId: PROJECT_ID,
    });

    const noProject = buildProjectManagementSnapshots([], [task({ stageKey: "assembly", status: "done" })]);
    expect(noProject.size).toBe(0);
  });

  it("跨年天数按含首尾计算", () => {
    expect(daysBetweenInclusive("2026-12-31", "2027-01-02")).toBe(3);
    expect(daysBetweenInclusive("2027-01-02", "2026-12-31")).toBe(0);
  });
});

describe("项目管理首批访问白名单", () => {
  it("仅潘兴、李侠伟、杨敏可进入", () => {
    expect(canUseProjectManagement("panxing@libiaorobot.com")).toBe(true);
    expect(canUseProjectManagement("lixiawei@libiaorobot.com")).toBe(true);
    expect(canUseProjectManagement("yangm@libiaorobot.com")).toBe(true);
    expect(canUseProjectManagement(" PANXING@LIBIAOROBOT.COM ")).toBe(true);
    expect(canUseProjectManagement("other@libiaorobot.com")).toBe(false);
    expect(canUseProjectManagement(null)).toBe(false);
  });

  it("接口守卫对非白名单账号返回 403", () => {
    const guard = new ProjectManagementAccessGuard();
    const context = (email: string | null) => ({
      switchToHttp: () => ({ getRequest: () => ({ user: email === null ? undefined : { email } }) }),
    }) as never;
    expect(guard.canActivate(context("panxing@libiaorobot.com"))).toBe(true);
    expect(() => guard.canActivate(context("other@libiaorobot.com"))).toThrowError(/无权访问项目管理/);
    expect(() => guard.canActivate(context(null))).toThrowError(/无权访问项目管理/);
  });
});
