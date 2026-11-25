import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { MaterialReissueTrackingService } from "../src/modules/file/material-reissue-tracking.service.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const CHANGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHANGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_A = "44444444-4444-4444-8444-444444444444";
const TASK_B = "55555555-5555-4555-8555-555555555555";
const ACTOR = "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69";
const NOW = new Date("2026-11-25T05:00:00.000Z");

function changeRow(id: string, taskId: string, lineCount: number, tracking: unknown[] = []) {
  return {
    id,
    projectId: PROJECT,
    changeType: "material_reissue",
    materialReissue: {
      taskId,
      materials: Array.from({ length: lineCount }, (_, index) => ({
        materialCode: "M-" + String(index + 1),
        materialName: "物料" + String(index + 1),
        specification: "",
        quantity: 1,
        unit: "个",
        remark: "",
      })),
    },
    materialReissueTracking: tracking,
  };
}

class FakeRepository {
  changes = new Map<string, ReturnType<typeof changeRow>>();
  tasks = new Map<string, { id: string; projectId: string; ownerIds: string[]; deletedAt: Date | null }>();
  updated: Array<{ id: string; tracking: unknown[] }> = [];

  async lockChangeRequest(id: string): Promise<unknown> {
    return this.changes.get(id) ?? null;
  }

  async findTaskReissueBrief(taskId: string): Promise<unknown> {
    return this.tasks.get(taskId) ?? null;
  }

  async updateChangeRequestTracking(id: string, tracking: unknown[]): Promise<unknown> {
    this.updated.push({ id, tracking });
    return { ...this.changes.get(id), materialReissueTracking: tracking };
  }

  async findFileById(): Promise<unknown> {
    return null;
  }
}

class FakePermissionService {
  constructor(private readonly access: { accessLevel: "edit" | "view"; projectManager: boolean }) {}
  async assertProjectVisible(): Promise<unknown> {
    return { member: true, projectManager: this.access.projectManager, taskOwner: false, groupAccessLevel: "view", accessLevel: this.access.accessLevel };
  }
}

class FakeAuditService {
  records: unknown[] = [];
  async record(_tx: unknown, input: unknown): Promise<void> {
    this.records.push(input);
  }
}

function buildService(repository: FakeRepository, access: { accessLevel: "edit" | "view"; projectManager: boolean }) {
  const audit = new FakeAuditService();
  const service = new MaterialReissueTrackingService(
    repository as never,
    { db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) } } as never,
    new FakePermissionService(access) as never,
    audit as never,
    { now: () => NOW } as never,
  );
  return { service, audit };
}

describe("MaterialReissueTrackingService", () => {
  it("registers selected lines across different reissue requests", async () => {
    const repository = new FakeRepository();
    repository.changes.set(CHANGE_A, changeRow(CHANGE_A, TASK_A, 2));
    repository.changes.set(CHANGE_B, changeRow(CHANGE_B, TASK_B, 1));
    const { service } = buildService(repository, { accessLevel: "edit", projectManager: true });

    const result = await service.register(PROJECT, {
      items: [
        { changeRequestId: CHANGE_A, lineIndex: 0 },
        { changeRequestId: CHANGE_B, lineIndex: 0 },
      ],
      status: "shipped",
      trackingNo: "SF123",
      estimatedArrivalDate: "2026-11-30",
      note: "已发出",
    }, ACTOR);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.changeRequestId).sort()).toEqual([CHANGE_A, CHANGE_B]);
    expect(result.items[0]?.trackingNo).toBe("SF123");
    expect(result.items[0]?.shippedBy).toBe(ACTOR);
    expect(repository.updated).toHaveLength(2);
  });

  it("rejects a task owner selecting another task's reissue", async () => {
    const repository = new FakeRepository();
    repository.changes.set(CHANGE_A, changeRow(CHANGE_A, TASK_A, 1));
    repository.changes.set(CHANGE_B, changeRow(CHANGE_B, TASK_B, 1));
    repository.tasks.set(TASK_A, { id: TASK_A, projectId: PROJECT, ownerIds: [ACTOR], deletedAt: null });
    repository.tasks.set(TASK_B, { id: TASK_B, projectId: PROJECT, ownerIds: ["someone-else"], deletedAt: null });
    const { service } = buildService(repository, { accessLevel: "view", projectManager: false });

    await expect(
      service.register(PROJECT, {
        items: [
          { changeRequestId: CHANGE_A, lineIndex: 0 },
          { changeRequestId: CHANGE_B, lineIndex: 0 },
        ],
        status: "shipped",
      }, ACTOR),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects already tracked lines", async () => {
    const repository = new FakeRepository();
    repository.changes.set(CHANGE_A, changeRow(CHANGE_A, TASK_A, 1, [{ lineIndex: 0 }]));
    const { service } = buildService(repository, { accessLevel: "edit", projectManager: true });

    await expect(
      service.register(PROJECT, {
        items: [{ changeRequestId: CHANGE_A, lineIndex: 0 }],
        status: "shipped",
      }, ACTOR),
    ).rejects.toBeInstanceOf(AppError);
  });
});
