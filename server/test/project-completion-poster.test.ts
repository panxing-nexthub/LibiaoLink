import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { ArchiveRepository } from "../src/modules/project/archive.repository.js";
import { ProjectCompletionPosterService } from "../src/modules/project/completion-poster.service.js";
import type { ProjectRepository, ProjectViewRow } from "../src/modules/project/project.repository.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function projectView(overrides: Record<string, unknown> = {}): ProjectViewRow {
  return {
    project: {
      id: PROJECT_ID,
      code: "P-2026-001",
      name: "上海仓储项目",
      status: "active",
      ...overrides,
    },
    managerNames: ["张工"],
    archiveKind: null,
    hasOpenPostArchiveTask: false,
  } as unknown as ProjectViewRow;
}

class FakeProjectRepository {
  view: ProjectViewRow | null = projectView();
  async findViewById(): Promise<ProjectViewRow | null> {
    return this.view;
  }
}

class FakeArchiveRepository {
  unfinished: { id: string }[] = [];
  hasAcceptance = true;
  sent: { sentAt: Date | null } | null = null;
  async listUnfinishedTasks(): Promise<{ id: string }[]> {
    return this.unfinished;
  }
  async hasCompletedAcceptanceTask(): Promise<boolean> {
    return this.hasAcceptance;
  }
  async findSentCompletionPoster(): Promise<{ sentAt: Date | null } | null> {
    return this.sent;
  }
}

class FakeDatabase {
  outbox: unknown[] = [];
  db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(this.makeTx()),
  };
  makeTx() {
    return {
      insert: () => ({
        values: (value: unknown) => {
          this.outbox.push(value);
          return { onConflictDoUpdate: async () => undefined };
        },
      }),
    };
  }
}

function makeService() {
  const database = new FakeDatabase();
  const projects = new FakeProjectRepository();
  const archive = new FakeArchiveRepository();
  const service = new ProjectCompletionPosterService(
    database as unknown as DatabaseService,
    projects as unknown as ProjectRepository,
    archive as unknown as ArchiveRepository,
  );
  return { service, database, projects, archive };
}

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

describe("项目完成喜报群同步（R06）", () => {
  it("验收完成且未同步过：写入 notify.group 完成喜报", async () => {
    const { service, database } = makeService();

    await expect(service.send(PROJECT_ID, ACTOR)).resolves.toEqual({ status: "queued" });

    expect(database.outbox).toMatchObject([
      {
        topic: "notify.group",
        dedupeKey: "R06:" + PROJECT_ID,
        payload: {
          projectId: PROJECT_ID,
          title: "🎉 叮咚~喜报来啦！",
          refType: "project",
          refId: PROJECT_ID,
          templateCode: "R06_GROUP",
        },
      },
    ]);
  });

  it("已成功同步过：返回 already_sent 且不再写群通知", async () => {
    const { service, database, archive } = makeService();
    archive.sent = { sentAt: new Date("2026-11-25T01:00:00.000Z") };

    await expect(service.send(PROJECT_ID, ACTOR)).resolves.toEqual({ status: "already_sent" });
    expect(database.outbox).toEqual([]);
  });

  it("验收未完成：拒绝同步且不写群通知", async () => {
    const { service, database, archive } = makeService();
    archive.unfinished = [{ id: "task-1" }];

    await expectAppErrorAsync(() => service.send(PROJECT_ID, ACTOR), "VALIDATION_FAILED");
    expect(database.outbox).toEqual([]);
  });

  it("状态读面只把已成功送达视为 sent", async () => {
    const { service, archive } = makeService();
    await expect(service.status(PROJECT_ID)).resolves.toEqual({ sent: false, sentAt: null });

    archive.sent = { sentAt: new Date("2026-11-25T01:00:00.000Z") };
    await expect(service.status(PROJECT_ID)).resolves.toEqual({
      sent: true,
      sentAt: "2026-11-25T01:00:00.000Z",
    });
  });
});