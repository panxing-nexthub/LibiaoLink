import { describe, expect, it } from "vitest";
import { ProjectArchiveBodySchema, ProjectStatusSchema, ProjectUpdateBodySchema } from "@libiaolink/contracts";
import { AppError } from "../src/common/errors/app-error.js";
import { convertLegacyWorkbook } from "../src/modules/project-import/legacy.js";
import { DatabaseService } from "../src/db/database.service.js";
import type { AuditService } from "../src/modules/admin/index.js";
import { ArchiveRepository, type ArchiveViewRow } from "../src/modules/project/archive.repository.js";
import { ArchiveService } from "../src/modules/project/archive.service.js";
import { FlowService } from "../src/modules/project/flow.service.js";
import { ProjectRepository, type ProjectRow, type ProjectViewRow } from "../src/modules/project/project.repository.js";
import { buildProjectFilter } from "../src/modules/project/project.query.js";

const AT = new Date("2026-09-28T06:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

async function expectAppErrorAsync(fn: () => Promise<unknown>, code: string): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    code: "CNBJ-20260928-0001",
    seqNo: 1,
    name: "XX 客户分拣项目",
    customer: null,
    region: "华东",
    projectType: "分拣",
    managerIds: [ACTOR],
    stageKey: "acceptance",
    status: "active",
    description: null,
    version: 3,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    deletedBy: null,
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

interface ArchiveInserted {
  archiveKind: "accepted" | "unaccepted";
  projectId: string;
  archivedBy: string;
  snapshot: Record<string, unknown>;
  acknowledgedMissing: unknown[];
}

class FakeArchiveRepository {
  project: ProjectRow | null = projectRow();
  stage: { stageKey: string; status: string; advancedAt: Date | null } | null = { stageKey: "acceptance", status: "active", advancedAt: null };
  unfinished: { id: string; title: string; stageKey: string | null; status: string }[] = [];
  taskCounts: Record<string, number> = { pending: 0, active: 1, done: 1 };
  fileRows: { id: string; name: string; docType: string | null; status: string; nodeId: string | null; versionCount: number; latestSeq: number | null; latestUploadedAt: Date | null }[] = [];
  changeRows: { id: string; reason: string; stageKey: string | null; appliedAt: Date }[] = [];
  reportCounts: Record<string, number> = { draft: 0, submitted: 2, supplement: 0 };
  issueCounts: Record<string, number> = { open: 0, in_progress: 1, done: 0 };
  inserted: ArchiveInserted | null = null;
  aborted = 0;
  record: ArchiveViewRow | null = null;
  lastExpectedVersion: number | null = null;

  async lockProjectRow(): Promise<ProjectRow | null> {
    return this.project;
  }

  async findStage(): Promise<{ stageKey: string; status: string; advancedAt: Date | null } | null> {
    return this.stage;
  }

  hasAcceptance = true;
  async hasCompletedAcceptanceTask() { return this.hasAcceptance; }

  async listUnfinishedTasks(): Promise<{ id: string; title: string; stageKey: string | null; status: string }[]> {
    return this.unfinished;
  }

  async countTasksByStatus(): Promise<Record<string, number>> {
    return this.taskCounts;
  }

  async listFileSnapshotRows() {
    return this.fileRows;
  }

  async listChanges() {
    return this.changeRows;
  }

  async countReportsByState(): Promise<Record<string, number>> {
    return this.reportCounts;
  }

  async countIssuesByState(): Promise<Record<string, number>> {
    return this.issueCounts;
  }

  async updateProjectArchived(_tx: unknown, _projectId: string, actorId: string, expectedVersion: number): Promise<ProjectRow | null> {
    const at = AT;
    this.lastExpectedVersion = expectedVersion;
    if (this.project === null || this.project.version !== expectedVersion || this.project.deletedAt !== null) return null;
    this.project = { ...this.project, status: "archived", archivedAt: at, archivedBy: actorId, version: expectedVersion + 1, updatedAt: at };
    return this.project;
  }

  async restoreActiveWithVersion(_tx: unknown, _projectId: string, at: Date, expectedVersion: number): Promise<ProjectRow | null> {
    this.lastExpectedVersion = expectedVersion;
    if (this.project === null || this.project.status !== "archived" || this.project.version !== expectedVersion || this.project.deletedAt !== null) return null;
    this.project = { ...this.project, status: "active", archivedAt: null, archivedBy: null, version: expectedVersion + 1, updatedAt: at };
    return this.project;
  }

  async insertArchive(_tx: unknown, input: ArchiveInserted): Promise<{ id: string }> {
    this.inserted = input;
    this.record = {
      archive: {
        id: "archive-1",
        projectId: input.projectId,
        archiveKind: input.archiveKind,
        archivedAt: this.project?.archivedAt,
        archivedBy: input.archivedBy,
        snapshot: input.snapshot,
        acknowledgedMissing: input.acknowledgedMissing,
      },
      archivedByName: "张工",
    } as unknown as ArchiveViewRow;
    return { id: "archive-1" };
  }

  async abortActiveUploadSessions(): Promise<number> {
    this.aborted += 1;
    return 1;
  }

  async findArchive(): Promise<ArchiveViewRow | null> {
    return this.record;
  }
}

class FakeProjectRepository {
  view: ProjectViewRow | null = { project: projectRow(), managerNames: ["张工"] };
  async findViewById(): Promise<ProjectViewRow | null> {
    return this.view;
  }
}

class FakeFlowService {
  calls: string[] = [];
  reject = false;
  async assertProjectEditor(_projectId: string, _actorId: string, action: string): Promise<void> {
    this.calls.push(action);
    if (this.reject) throw new AppError("FORBIDDEN", "仅项目编辑者可执行" + action);
  }
}

class FakeAuditService {
  entries: { action?: string; result?: string; metadata?: Record<string, unknown> }[] = [];
  async record(_client: unknown, input: { action?: string; result?: string; metadata?: Record<string, unknown> }): Promise<void> {
    this.entries.push(input);
  }
}

function makeService() {
  const repo = new FakeArchiveRepository();
  const projects = new FakeProjectRepository();
  const flow = new FakeFlowService();
  const audit = new FakeAuditService();
  const outbox: unknown[] = [];
  const tx = { insert: () => ({ values: (event: unknown) => outbox.push(event) }) };
  const fakeDb = { db: { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(tx) } };
  const service = new ArchiveService(
    fakeDb as unknown as DatabaseService,
    repo as unknown as ArchiveRepository,
    projects as unknown as ProjectRepository,
    flow as unknown as FlowService,
    audit as unknown as AuditService,
  );
  return { service, repo, projects, flow, audit, outbox };
}

describe("项目归档（任务全部完成口径）", () => {

  it("Excel 完成态缺实际完成日期时按未完成阻止归档", async () => {
    const parsed = convertLegacyWorkbook({
      sheets: [{
        name: "任务", path: "task",
        rows: [["任务描述", "阶段性里程", "任务状态", "实际完成日期"], ["导入任务", "投产阶段", "已完成", ""]],
      }],
      anchors: [], hasMedia: () => false, readMedia: () => null, close: () => {},
    }, "[TEST] UK-导入.xlsx");
    const importedTask = parsed.tasks[0]!;
    const { service, repo } = makeService();
    repo.unfinished = importedTask.baseStatus === "done" ? [] : [{
      id: "imported-task", title: importedTask.title, stageKey: importedTask.stageKey, status: importedTask.baseStatus,
    }];
    await expectAppErrorAsync(() => service.archiveProject(PROJECT_ID, { version: 3, confirm: true, archiveKind: "accepted" }, ACTOR), "ARCHIVE_NOT_READY");
    expect(repo.inserted).toBeNull();
  });

  it("契约：confirm 缺省 false；PATCH 更新体拒绝新写 done 和 archived", () => {
    expect(ProjectArchiveBodySchema.parse({ version: 3 })).toEqual({ version: 3, confirm: false, archiveKind: "accepted" });
    expect(ProjectArchiveBodySchema.safeParse({ version: 3, archiveKind: "other" }).success).toBe(false);
    expect(ProjectArchiveBodySchema.parse({ version: 3, confirm: true }).confirm).toBe(true);
    expect(ProjectStatusSchema.options).toEqual(["active", "paused", "archived"]);
    expect(ProjectUpdateBodySchema.safeParse({ version: 3, status: "done" }).success).toBe(false);
    expect(ProjectUpdateBodySchema.safeParse({ version: 3, status: "archived" }).success).toBe(false);
    expect(ProjectUpdateBodySchema.safeParse({ version: 3, status: "paused" }).success).toBe(true);
  });

  it("有未完成任务时 409 ARCHIVE_NOT_READY，confirm=true 也不能越过", async () => {
    const { service, repo, audit, outbox } = makeService();
    repo.unfinished = [
      { id: "t1", title: "装配工装", stageKey: null, status: "active" },
      { id: "t2", title: "现场验收", stageKey: "acceptance", status: "pending" },
    ];
    const error = await expectAppErrorAsync(() => service.archiveProject(PROJECT_ID, { version: 3, confirm: true, archiveKind: "accepted" }, ACTOR), "ARCHIVE_NOT_READY");
    expect(error.httpStatus).toBe(409);
    expect(error.details).toHaveLength(2);
    expect(error.details.every((item) => item.code === "task_not_done" && item.path === "missing")).toBe(true);
    expect(repo.project?.status).toBe("active");
    expect(repo.inserted).toBeNull();
    expect(repo.aborted).toBe(0);
    expect(outbox).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("全部普通任务完成但没有已完成的验收任务时，不能按已验收归档", async () => {
    const { service, repo, outbox } = makeService();
    repo.hasAcceptance = false;
    const error = await expectAppErrorAsync(() => service.archiveProject(PROJECT_ID, { version: 3, confirm: true, archiveKind: "accepted" }, ACTOR), "ARCHIVE_NOT_READY");
    expect(error.details[0]?.code).toBe("acceptance_missing");
    expect(repo.inserted).toBeNull();
    expect(outbox).toEqual([]);
  });

  it.each([false, true])("异常归档保留清单与任务状态且不产生喜报（有未完成任务 %s）", async (unfinished) => {
    const { service, repo, audit, outbox } = makeService();
    repo.hasAcceptance = !unfinished;
    if (unfinished) repo.unfinished = [{ id: "t1", title: "实施", stageKey: "install", status: "active" }];
    const view = await service.archiveProject(PROJECT_ID, { version: 3, confirm: false, archiveKind: "unaccepted" }, ACTOR);
    expect(repo.project?.status).toBe("archived");
    expect(view.archiveKind).toBe("unaccepted");
    expect(repo.inserted?.archiveKind).toBe("unaccepted");
    expect(repo.unfinished).toHaveLength(unfinished ? 1 : 0);
    expect(audit.entries[0]?.metadata?.archiveKind).toBe("unaccepted");
    expect(outbox).toHaveLength(0);
  });

  it("全部任务完成即可归档：阶段未推进、存在 draft 文件也不阻断，confirm=false 同样成功", async () => {
    const { service, repo, audit, outbox } = makeService();
    repo.fileRows = [
      { id: "f1", name: "未定档图纸", docType: "图纸", status: "draft", nodeId: null, versionCount: 1, latestSeq: 1, latestUploadedAt: AT },
    ];
    repo.changeRows = [{ id: "c1", reason: "设计变更", stageKey: "design", appliedAt: AT }];
    const view = await service.archiveProject(PROJECT_ID, { version: 3, confirm: false, archiveKind: "accepted" }, ACTOR);
    expect(repo.project?.status).toBe("archived");
    expect(view.archiveKind).toBe("accepted");
    expect(repo.project?.archivedBy).toBe(ACTOR);
    expect(repo.project?.version).toBe(4);
    expect(repo.inserted?.acknowledgedMissing).toEqual([]);
    expect(repo.aborted).toBe(1);
    expect(outbox).toMatchObject([{ topic: "project.completed", dedupeKey: "project.completed:" + PROJECT_ID + ":4",
      payload: { projectId: PROJECT_ID, status: "archived", previousStatus: "active", version: 4, actorId: ACTOR } }]);
    expect(audit.entries[0]?.action).toBe("archive");
    expect(audit.entries[0]?.result).toBeUndefined();
    expect(view.projectId).toBe(PROJECT_ID);
    expect(view.id).toBe("archive-1");
    expect(view.snapshot.stage).toEqual({ stageKey: "acceptance", status: "active", advancedAt: null });
    expect(view.snapshot.tasks.total).toBe(2);
    expect(view.snapshot.files.items[0]?.status).toBe("draft");
    expect(view.snapshot.changes.total).toBe(1);
    expect(view.snapshot.reports.byState.submitted).toBe(2);
    expect(view.snapshot.issues.byState.in_progress).toBe(1);
  });

  it("归档后可恢复到进行中：清归档状态、保留清单、递增版本并写审计", async () => {
    const { service, repo, projects, flow, audit } = makeService();
    repo.project = projectRow({ status: "archived", archivedAt: AT, archivedBy: ACTOR, version: 4 });
    projects.view = { project: repo.project, managerNames: ["张工"] };
    repo.record = {
      archive: {
        id: "archive-1",
        projectId: PROJECT_ID,
        archiveKind: "accepted",
        archivedAt: AT,
        archivedBy: ACTOR,
        snapshot: {},
        acknowledgedMissing: [],
      },
      archivedByName: "张工",
    } as unknown as ArchiveViewRow;
    const view = await service.restoreArchivedProject(PROJECT_ID, { version: 4, confirm: false }, ACTOR);
    expect(view.status).toBe("active");
    expect(view.archivedAt).toBeNull();
    expect(view.archivedBy).toBeNull();
    expect(view.version).toBe(5);
    expect(repo.project?.status).toBe("active");
    expect(repo.record?.archive.id).toBe("archive-1");
    expect(flow.calls).toEqual(["恢复项目"]);
    expect(audit.entries[0]?.action).toBe("update");
    expect(audit.entries[0]?.metadata).toEqual({ restoredFrom: "project-archive", archiveId: "archive-1" });
  });

  it("恢复校验：仅归档项目可恢复；版本不匹配 409；无编辑权 403", async () => {
    const activeCase = makeService();
    await expectAppErrorAsync(() => activeCase.service.restoreArchivedProject(PROJECT_ID, { version: 3, confirm: false }, ACTOR), "VALIDATION_FAILED");

    const conflictCase = makeService();
    conflictCase.repo.project = projectRow({ status: "archived", archivedAt: AT, archivedBy: ACTOR, version: 4 });
    conflictCase.projects.view = { project: conflictCase.repo.project, managerNames: ["张工"] };
    await expectAppErrorAsync(() => conflictCase.service.restoreArchivedProject(PROJECT_ID, { version: 3, confirm: false }, ACTOR), "VERSION_CONFLICT");
    expect(conflictCase.repo.project?.status).toBe("archived");

    const deniedCase = makeService();
    deniedCase.repo.project = projectRow({ status: "archived", archivedAt: AT, archivedBy: ACTOR, version: 4 });
    deniedCase.projects.view = { project: deniedCase.repo.project, managerNames: ["张工"] };
    deniedCase.flow.reject = true;
    await expectAppErrorAsync(() => deniedCase.service.restoreArchivedProject(PROJECT_ID, { version: 4, confirm: false }, ACTOR), "FORBIDDEN");
    expect(deniedCase.repo.project?.status).toBe("archived");
  });

  it("幂等与并发：已归档 409 PROJECT_ARCHIVED；版本不匹配 409 VERSION_CONFLICT", async () => {
    const archivedCase = makeService();
    archivedCase.repo.project = projectRow({ status: "archived", archivedAt: AT, archivedBy: ACTOR });
    await expectAppErrorAsync(() => archivedCase.service.archiveProject(PROJECT_ID, { version: 3, confirm: true, archiveKind: "accepted" }, ACTOR), "PROJECT_ARCHIVED");
    const conflictCase = makeService();
    await expectAppErrorAsync(() => conflictCase.service.archiveProject(PROJECT_ID, { version: 2, confirm: true, archiveKind: "accepted" }, ACTOR), "VERSION_CONFLICT");
  });

  it("权限：项目编辑者判定拒绝 403 FORBIDDEN；通过时断言带上动作名", async () => {
    const rejected = makeService();
    rejected.flow.reject = true;
    await expectAppErrorAsync(() => rejected.service.archiveProject(PROJECT_ID, { version: 3, confirm: true, archiveKind: "accepted" }, ACTOR), "FORBIDDEN");
    const passed = makeService();
    await passed.service.archiveProject(PROJECT_ID, { version: 3, confirm: false, archiveKind: "accepted" }, ACTOR);
    expect(passed.flow.calls).toEqual(["项目归档"]);
  });

  it("清单读面：未归档 404；有记录返回视图（含操作人姓名快照）", async () => {
    const { service, repo, projects } = makeService();
    await expectAppErrorAsync(() => service.getArchive(PROJECT_ID), "NOT_FOUND");
    repo.project = projectRow({ status: "archived", archivedAt: AT, archivedBy: ACTOR, version: 4 });
    projects.view = { project: repo.project, managerNames: ["张工"] };
    repo.record = {
      archive: {
        id: "archive-1",
        projectId: PROJECT_ID,
        archiveKind: "accepted",
        archivedAt: AT,
        archivedBy: ACTOR,
        snapshot: {},
        acknowledgedMissing: [],
      },
      archivedByName: "张工",
    } as unknown as ArchiveViewRow;
    const view = await service.getArchive(PROJECT_ID);
    expect(view.archivedByName).toBe("张工");
    expect(view.archiveKind).toBe("accepted");
    expect(view.projectId).toBe(PROJECT_ID);
  });

  it("归档检索：filter[archivedYear] 解析为四位年份数组，非法年份 400", () => {
    const filter = buildProjectFilter({ "filter[archivedYear]": "2025, 2026", page: 1, limit: 20 });
    expect(filter.archivedYears).toEqual([2025, 2026]);
    expect(buildProjectFilter({ page: 1, limit: 20 }).archivedYears).toBeNull();
    expect(() => buildProjectFilter({ "filter[archivedYear]": "26", page: 1, limit: 20 })).toThrow(AppError);
    expect(() => buildProjectFilter({ "filter[archivedYear]": "3026", page: 1, limit: 20 })).toThrow(AppError);
  });
});
