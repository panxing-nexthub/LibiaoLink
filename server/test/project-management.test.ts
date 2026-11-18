import { describe, expect, it } from "vitest";
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
const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const ENGINEER_ID = "33333333-3333-4333-8333-333333333333";
const ENGINEER_2_ID = "55555555-5555-4555-8555-555555555555";
const DISABLED_ID = "44444444-4444-4444-8444-444444444444";

class FakeProjectManagementRepository {
  rows: ProjectManagementRecordRow[] = [];
  users: ProjectManagementUserSnapshot[] = [];
  insertCalls: unknown[] = [];
  versionChecks: Array<{ id: string; version: number }> = [];

  async list(): Promise<ProjectManagementRecordRow[]> {
    return this.rows;
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

  async listActiveUsersByIds(ids: readonly string[]): Promise<ProjectManagementUserSnapshot[]> {
    return this.users.filter((user) => ids.includes(user.userId) && user.status === "active" && user.removedAt === null);
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
    version: 0,
    createdAt: new Date("2026-11-17T01:00:00.000Z"),
    updatedAt: new Date("2026-11-17T01:00:00.000Z"),
    ...overrides,
  };
}

function makeService(): {
  service: ProjectManagementService;
  repository: FakeProjectManagementRepository;
  managers: FakeManagerEligibility;
  snapshots: FakeProjectSnapshotRepository;
} {
  const repository = new FakeProjectManagementRepository();
  const managers = new FakeManagerEligibility();
  const snapshots = new FakeProjectSnapshotRepository();
  repository.users = [
    { userId: MANAGER_ID, username: "manager", displayName: "经理甲", status: "active", removedAt: null },
    { userId: ENGINEER_ID, username: "engineer", displayName: "工程师乙", status: "active", removedAt: null },
    { userId: ENGINEER_2_ID, username: "engineer2", displayName: "工程师丁", status: "active", removedAt: null },
    { userId: DISABLED_ID, username: "disabled", displayName: "停用丙", status: "disabled", removedAt: null },
  ];
  const service = new ProjectManagementService(repository as never, managers as never, snapshots as never);
  return { service, repository, managers, snapshots };
}

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

  it("创建 / 列表按 code 附带项目空间只读快照；无匹配项目返回空值", async () => {
    const { service, repository, snapshots } = makeService();
    snapshots.snapshots.set("PM-001", {
      currentStage: "deploy",
      startupCompletedAt: "2026-05-15",
      arrivalDate: "2026-06-12",
      plannedStartDate: "2026-06-18",
      plannedEndDate: "2026-07-03",
      implementationDays: 16,
    });
    const created = await service.create({ code: " PM-001 " });
    expect(created.currentStage).toBe("deploy");
    expect(created.startupCompletedAt).toBe("2026-05-15");
    expect(created.arrivalDate).toBe("2026-06-12");
    expect(created.plannedStartDate).toBe("2026-06-18");
    expect(created.plannedEndDate).toBe("2026-07-03");
    expect(created.implementationDays).toBe(16);

    repository.rows = [makeRow({ code: "PM-404" })];
    const listed = await service.list();
    expect(listed.items[0]).toMatchObject({
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
    expect(currentOnly.get("PM-002")).toEqual(EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT);

    const noProject = buildProjectManagementSnapshots([], [task({ stageKey: "assembly", status: "done" })]);
    expect(noProject.size).toBe(0);
  });

  it("跨年天数按含首尾计算", () => {
    expect(daysBetweenInclusive("2026-12-31", "2027-01-02")).toBe(3);
    expect(daysBetweenInclusive("2027-01-02", "2026-12-31")).toBe(0);
  });
});
