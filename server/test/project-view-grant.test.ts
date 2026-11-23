import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/db/database.service.js";
import type { AuditService } from "../src/modules/admin/index.js";
import type { UserDirectoryItem, UserService } from "../src/modules/identity/index.js";
import type { PermissionService } from "../src/modules/permission/index.js";
import { ProjectViewGrantService } from "../src/modules/project/project-view-grant.service.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function directoryUser(
  id: string,
  username: string,
  displayName: string,
  email: string | null = null,
): UserDirectoryItem {
  return { id, username, displayName, email, status: "active" };
}

function displayNameBase(displayName: string): string {
  const normalized = displayName.trim().toLowerCase();
  const match = /^(.+?)\s*[(（][^()（）]+[)）]$/u.exec(normalized);
  return (match?.[1] ?? normalized).trim();
}

class FakeUserService {
  exactCalls: string[][] = [];
  baseCalls: string[][] = [];

  constructor(private readonly rows: readonly UserDirectoryItem[]) {}

  async findActiveDirectoryMatches(keys: readonly string[]): Promise<UserDirectoryItem[]> {
    this.exactCalls.push([...keys]);
    const keySet = new Set(keys);
    return this.rows.filter((user) => user.status === "active" && (
      keySet.has(user.displayName.trim().toLowerCase()) ||
      keySet.has(user.username.trim().toLowerCase()) ||
      (user.email !== null && keySet.has(user.email.trim().toLowerCase()))
    ));
  }

  async findActiveDirectoryBaseNameMatches(keys: readonly string[]): Promise<UserDirectoryItem[]> {
    this.baseCalls.push([...keys]);
    const keySet = new Set(keys);
    return this.rows.filter((user) => user.status === "active" && keySet.has(displayNameBase(user.displayName)));
  }
}

function makeService(rows: readonly UserDirectoryItem[]): {
  service: ProjectViewGrantService;
  users: FakeUserService;
} {
  const users = new FakeUserService(rows);
  const permission = {
    async assertProjectVisible() {
      return { projectManager: true };
    },
  };
  return {
    users,
    service: new ProjectViewGrantService(
      {} as DatabaseService,
      permission as unknown as PermissionService,
      users as unknown as UserService,
      {} as AuditService,
    ),
  };
}

describe("项目内批量只读授权预览", () => {
  it("精确匹配不到时，按去掉末尾括号别名后的显示名回退匹配", async () => {
    const { service, users } = makeService([
      directoryUser("dennis", "dennislee", "Dennis Lee WAI SEAK(Dennis Lee)", "dennislee@libiaorobot.com"),
    ]);

    const preview = await service.preview(PROJECT_ID, ACTOR_ID, "Dennis Lee WAI SEAK");

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]?.status).toBe("matched");
    expect(preview.items[0]?.candidates.map((candidate) => candidate.id)).toEqual(["dennis"]);
    expect(users.baseCalls).toEqual([["dennis lee wai seak"]]);
  });

  it("支持中文全角括号别名", async () => {
    const { service } = makeService([
      directoryUser("athena", "athena", "魏琛琛（Athena）"),
    ]);

    const preview = await service.preview(PROJECT_ID, ACTOR_ID, "魏琛琛");

    expect(preview.items[0]?.status).toBe("matched");
    expect(preview.items[0]?.candidates.map((candidate) => candidate.id)).toEqual(["athena"]);
  });

  it("精确显示名命中时优先使用精确结果，不执行回退查询", async () => {
    const { service, users } = makeService([
      directoryUser("dennis", "dennislee", "Dennis Lee WAI SEAK(Dennis Lee)", "dennislee@libiaorobot.com"),
    ]);

    const preview = await service.preview(PROJECT_ID, ACTOR_ID, "Dennis Lee WAI SEAK(Dennis Lee)");

    expect(preview.items[0]?.status).toBe("matched");
    expect(preview.items[0]?.candidates.map((candidate) => candidate.id)).toEqual(["dennis"]);
    expect(users.baseCalls).toEqual([]);
  });

  it("回退后同基础显示名命中多人时进入人工确认", async () => {
    const { service } = makeService([
      directoryUser("john-jd", "johnjd", "John Doe(JD)"),
      directoryUser("john-johnny", "johnny", "John Doe(Johnny)"),
    ]);

    const preview = await service.preview(PROJECT_ID, ACTOR_ID, "John Doe");

    expect(preview.items[0]?.status).toBe("confirm");
    expect(preview.items[0]?.candidates.map((candidate) => candidate.id)).toEqual(["john-jd", "john-johnny"]);
  });

  it("回退匹配继续受工号限定，避免同名账号误选", async () => {
    const { service } = makeService([
      directoryUser("dennis", "dennislee", "Dennis Lee WAI SEAK(Dennis Lee)", "dennislee@libiaorobot.com"),
      directoryUser("other", "otherdennis", "Dennis Lee WAI SEAK(Other)", "other@libiaorobot.com"),
    ]);

    const preview = await service.preview(PROJECT_ID, ACTOR_ID, "Dennis Lee WAI SEAK\tdennislee");

    expect(preview.items[0]?.status).toBe("matched");
    expect(preview.items[0]?.candidates.map((candidate) => candidate.id)).toEqual(["dennis"]);
  });
});
